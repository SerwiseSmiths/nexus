import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import prisma from '@/services/prisma.service';
import { ApiError } from '@/utils/apiResponse';
import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataSet,
  SignalDataTypeMap,
} from 'baileys' with { 'resolution-mode': 'import' };

// Baileys is ESM-only; nexus compiles to CommonJS, so it's loaded through a
// real dynamic import() (NodeNext keeps it as-is rather than turning it into
// require()). Cached so warm Vercel invocations don't re-evaluate it.
export type Baileys = typeof import('baileys', { with: { 'resolution-mode': 'import' } });
let baileysPromise: Promise<Baileys> | null = null;
export const loadBaileys = (): Promise<Baileys> => (baileysPromise ??= import('baileys'));

const CREDS_KEY = 'creds';
// Bookkeeping rows, not session data — clear() leaves them alone.
const LOCK_KEY = '__send_lock__';
const PAIR_STATE_KEY = '__pair_state__';
const BOOKKEEPING_KEYS = [LOCK_KEY, PAIR_STATE_KEY];

export interface WhatsAppPairState {
  status:    'WAITING' | 'CONNECTED' | 'FAILED';
  phone:     string;
  startedAt: string;
  error?:    string;
}
// A send that crashes (or a Vercel function killed mid-send) never releases its
// lock — after this long it's considered stale and can be taken over.
const LOCK_STALE_SECONDS = 60;
const LOCK_WAIT_MS = 20_000;
const UPSERT_CHUNK = 200;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Postgres replacement for Baileys' useMultiFileAuthState — nexus runs on
 * Vercel, so the WhatsApp linked-device session can't live on disk. Every
 * write is pushed onto `pending` so the caller can flush them all before the
 * serverless function returns (an unsaved signal key = broken session).
 */
export class WhatsAppAuthStore {
  static async load(baileys: Baileys, pending: Promise<unknown>[]): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
    const encode = (value: unknown) => JSON.stringify(value, baileys.BufferJSON.replacer);
    const decode = <T>(raw: string): T => JSON.parse(raw, baileys.BufferJSON.reviver) as T;

    const creds =
      (await WhatsAppAuthStore.readOne(CREDS_KEY).then((raw) => (raw ? decode<AuthenticationCreds>(raw) : null))) ??
      baileys.initAuthCreds();

    const track = <T>(promise: Promise<T>): Promise<T> => {
      pending.push(promise);
      return promise;
    };

    const state: AuthenticationState = {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const rows = await prisma.whatsAppAuthKey.findMany({
            where:  { key: { in: ids.map((id) => `${type}-${id}`) }, isDeleted: false },
            select: { key: true, value: true },
          });
          const byKey = new Map(rows.map((row) => [row.key, row.value]));
          const data: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const id of ids) {
            const raw = byKey.get(`${type}-${id}`);
            if (!raw) continue;
            let value = decode<SignalDataTypeMap[T]>(raw);
            if (type === 'app-state-sync-key') {
              value = baileys.proto.Message.AppStateSyncKeyData.fromObject(value as object) as unknown as SignalDataTypeMap[T];
            }
            data[id] = value;
          }
          return data;
        },
        set: (data: SignalDataSet) => {
          const upserts: [string, string][] = [];
          const removals: string[] = [];
          for (const category of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            for (const [id, value] of Object.entries(data[category] ?? {})) {
              const key = `${category}-${id}`;
              if (value) upserts.push([key, encode(value)]);
              else removals.push(key);
            }
          }
          return track(Promise.all([WhatsAppAuthStore.upsertMany(upserts), WhatsAppAuthStore.removeMany(removals)]).then(() => undefined));
        },
      },
    };

    return { state, saveCreds: () => track(WhatsAppAuthStore.upsertMany([[CREDS_KEY, encode(creds)]])) };
  }

  /** Forgets the current session (soft-delete) — before linking afresh, on logout, or
   *  once WhatsApp reports the device was unlinked from the phone. */
  static async clear(): Promise<void> {
    // Exact keys, not `startsWith: '__'` — Prisma turns that into LIKE '__%', where
    // "_" is a wildcard, so it matched (and protected) every row.
    await prisma.whatsAppAuthKey.updateMany({ where: { key: { notIn: BOOKKEEPING_KEYS }, isDeleted: false }, data: { isDeleted: true } });
  }

  /** The linked account's JID (e.g. "919876543210:12@s.whatsapp.net"), or null if
   *  nothing is linked. Read straight from stored creds — no connection needed. */
  static async readLinkedJid(): Promise<string | null> {
    const raw = await WhatsAppAuthStore.readOne(CREDS_KEY);
    if (!raw) return null;
    const creds = JSON.parse(raw) as { me?: { id?: string } };
    return creds.me?.id ?? null;
  }

  static async readPairState(): Promise<WhatsAppPairState | null> {
    const raw = await WhatsAppAuthStore.readOne(PAIR_STATE_KEY);
    return raw ? (JSON.parse(raw) as WhatsAppPairState) : null;
  }

  static async writePairState(state: WhatsAppPairState | null): Promise<void> {
    if (state) await WhatsAppAuthStore.upsertMany([[PAIR_STATE_KEY, JSON.stringify(state)]]);
    else await WhatsAppAuthStore.removeMany([PAIR_STATE_KEY]);
  }

  /**
   * Only one WhatsApp connection per linked device may be open at a time — a
   * second one makes WhatsApp drop the first. Two admins nudging at once (or
   * two warm Vercel instances) are serialized through this DB lease row;
   * the conditional upsert only wins if the row is free or stale.
   */
  static async acquireSendLock(): Promise<string> {
    const token = randomUUID();
    const deadline = Date.now() + LOCK_WAIT_MS;

    while (Date.now() < deadline) {
      const won = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO "WhatsAppAuthKey" ("id", "key", "value", "isDeleted", "createdAt", "updatedAt")
        VALUES (${randomUUID()}, ${LOCK_KEY}, ${token}, false, now(), now())
        ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "isDeleted" = false, "updatedAt" = now()
        WHERE "WhatsAppAuthKey"."isDeleted" = true
           OR "WhatsAppAuthKey"."updatedAt" < now() - make_interval(secs => ${LOCK_STALE_SECONDS})
        RETURNING "id"`;
      if (won.length > 0) return token;
      await sleep(1000);
    }

    throw new ApiError(429, 'Another WhatsApp message is being sent right now — please try again');
  }

  static async releaseSendLock(token: string): Promise<void> {
    await prisma.whatsAppAuthKey.updateMany({ where: { key: LOCK_KEY, value: token }, data: { isDeleted: true } });
  }

  private static async readOne(key: string): Promise<string | null> {
    const row = await prisma.whatsAppAuthKey.findFirst({ where: { key, isDeleted: false }, select: { value: true } });
    return row?.value ?? null;
  }

  // Raw bulk upsert — pairing writes hundreds of pre-keys at once, far too many
  // for one Prisma upsert round trip each.
  private static async upsertMany(entries: [string, string][]): Promise<void> {
    for (let i = 0; i < entries.length; i += UPSERT_CHUNK) {
      const rows = entries
        .slice(i, i + UPSERT_CHUNK)
        .map(([key, value]) => Prisma.sql`(${randomUUID()}, ${key}, ${value}, false, now(), now())`);
      await prisma.$executeRaw`
        INSERT INTO "WhatsAppAuthKey" ("id", "key", "value", "isDeleted", "createdAt", "updatedAt")
        VALUES ${Prisma.join(rows)}
        ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "isDeleted" = false, "updatedAt" = now()`;
    }
  }

  private static async removeMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await prisma.whatsAppAuthKey.updateMany({ where: { key: { in: keys } }, data: { isDeleted: true } });
  }
}
