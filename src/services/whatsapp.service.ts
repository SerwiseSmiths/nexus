import { ApiError } from '@/utils/apiResponse';
import { logger } from '@/utils/logger';
import { WhatsAppAuthStore, loadBaileys, type Baileys } from '@/services/whatsapp-auth.service';
import type { WhatsAppStatus } from '@/types/whatsapp.types';
import type { AuthenticationState } from 'baileys' with { 'resolution-mode': 'import' };

// Free WhatsApp sending without the official API, runnable on Vercel. Uses
// Baileys — the WhatsApp Web (linked device) engine Evolution API is built on —
// directly inside nexus instead of a separate always-on Evolution server: each
// send opens a short-lived connection with the session stored in Postgres
// (WhatsAppAuthKey), sends, flushes any key updates, and disconnects.
//
// The sender number is linked/unlinked from watchtower's header (status, pair,
// logout endpoints below). Each nexus environment has its own DB, so dev and
// prod watchtower each manage their own linked number.

type Socket = ReturnType<Baileys['default']>;
type ILogger = NonNullable<Parameters<Baileys['default']>[0]['logger']>;

const CONNECT_TIMEOUT_MS = 25_000;
// Grace period after sendMessage resolves so the frame actually leaves the
// socket and any server-triggered key updates land before we disconnect.
const POST_SEND_SETTLE_MS = 2_000;
// How long the admin has to type the code on the phone. The whole link runs
// inside one Vercel invocation (kept alive by waitUntil), so this plus the
// post-link sync must stay under the function's max duration (300s).
const PAIRING_TIMEOUT_MS = 2 * 60_000;
const POST_LINK_SYNC_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Bare international number (digits only, country code included). phoneNo may be
 *  stored as "+91…", "91…" or a bare 10-digit Indian number. */
const toWhatsAppNumber = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
};

/** "919876543210:12@s.whatsapp.net" → "919876543210" */
const numberFromJid = (jid: string): string => jid.split('@')[0].split(':')[0];

// Baileys wants a pino-shaped logger — forward only warnings/errors to winston.
const baileysLogger: ILogger = {
  level: 'warn',
  child: () => baileysLogger,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: (obj, msg) => logger.warn(`[WhatsApp] ${msg ?? ''}`, obj),
  error: (obj, msg) => logger.error(`[WhatsApp] ${msg ?? ''}`, obj),
};

// Baileys closes with a Boom error carrying the WhatsApp status code.
const disconnectCode = (error: Error | undefined): number | undefined =>
  (error as (Error & { output?: { statusCode?: number } }) | undefined)?.output?.statusCode;

const UNLINKED_MESSAGE = 'WhatsApp was disconnected from the phone — connect it again from watchtower';

function createSocket(baileys: Baileys, state: AuthenticationState, saveCreds: () => Promise<void>): Socket {
  const sock = baileys.default({
    auth:                     { creds: state.creds, keys: baileys.makeCacheableSignalKeyStore(state.keys, baileysLogger) },
    logger:                   baileysLogger,
    browser:                  baileys.Browsers.ubuntu('Chrome'),
    markOnlineOnConnect:      false,
    syncFullHistory:          false,
    shouldSyncHistoryMessage: () => false,
    connectTimeoutMs:         CONNECT_TIMEOUT_MS,
  });
  sock.ev.on('creds.update', () => void saveCreds());
  return sock;
}

function waitForOpen(sock: Socket, baileys: Baileys): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ApiError(504, 'Timed out connecting to WhatsApp')), CONNECT_TIMEOUT_MS);
    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
      if (connection === 'open') {
        clearTimeout(timer);
        resolve();
      } else if (connection === 'close') {
        clearTimeout(timer);
        const code = disconnectCode(lastDisconnect?.error);
        reject(
          code === baileys.DisconnectReason.loggedOut
            ? new ApiError(503, UNLINKED_MESSAGE)
            : new ApiError(502, `WhatsApp connection closed (${code ?? 'unknown'})`),
        );
      }
    });
  });
}

/** Waits for every DB write Baileys queued, including ones queued while waiting. */
async function flush(pending: Promise<unknown>[]): Promise<void> {
  while (pending.length > 0) {
    await Promise.allSettled(pending.splice(0));
  }
}

/** Opens a fresh linked-device session for `phone`. Resolves `code` as soon as
 *  WhatsApp issues it; `done` settles once the phone accepted it and the new
 *  session is fully saved (or the attempt failed/timed out). */
async function linkDevice(baileys: Baileys, phone: string): Promise<{ code: Promise<string>; done: Promise<string> }> {
  await WhatsAppAuthStore.clear();
  const pending: Promise<unknown>[] = [];
  const { state, saveCreds } = await WhatsAppAuthStore.load(baileys, pending);

  let sock = createSocket(baileys, state, saveCreds);
  let codeRequested = false;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: unknown) => void;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const linked = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The code was not entered in time')), PAIRING_TIMEOUT_MS);

    const onUpdate = async ({ connection, lastDisconnect, qr }: { connection?: string; lastDisconnect?: { error: Error | undefined }; qr?: string }) => {
      // The first `qr` event means the socket is ready to request a pairing code.
      if (qr && !codeRequested) {
        codeRequested = true;
        try {
          resolveCode(await sock.requestPairingCode(toWhatsAppNumber(phone)));
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      }
      if (connection === 'open') {
        clearTimeout(timer);
        resolve();
      } else if (connection === 'close') {
        const closeCode = disconnectCode(lastDisconnect?.error);
        // WhatsApp always drops the connection once right after a successful
        // link and expects a reconnect with the new credentials.
        if (closeCode === baileys.DisconnectReason.restartRequired) {
          sock = createSocket(baileys, state, saveCreds);
          sock.ev.on('connection.update', (update) => void onUpdate(update));
        } else {
          clearTimeout(timer);
          reject(new Error(`WhatsApp closed the connection (${closeCode ?? 'unknown'})`));
        }
      }
    };

    sock.ev.on('connection.update', (update) => void onUpdate(update));
  });

  const done = linked
    .then(async () => {
      // Let the post-link key/app-state sync land before disconnecting.
      await sleep(POST_LINK_SYNC_MS);
      await sock.end(undefined).catch(() => undefined);
      await flush(pending);
      return state.creds.me?.id ?? '';
    })
    .catch(async (err: unknown) => {
      await sock.end(undefined).catch(() => undefined);
      await flush(pending);
      await WhatsAppAuthStore.clear();
      throw err;
    });

  // A failure before the code was issued must fail the code promise too.
  done.catch((err: unknown) => rejectCode(err));

  return { code, done };
}

export class WhatsAppService {
  static async getStatus(): Promise<WhatsAppStatus> {
    const [jid, pair] = await Promise.all([WhatsAppAuthStore.readLinkedJid(), WhatsAppAuthStore.readPairState()]);
    // A WAITING row older than the link window belongs to an invocation that was
    // killed mid-link — treat it as abandoned rather than "still linking" forever.
    const pairing =
      pair?.status === 'WAITING' && Date.now() - Date.parse(pair.startedAt) < PAIRING_TIMEOUT_MS + POST_LINK_SYNC_MS + 30_000
        ? pair
        : null;
    // creds.me is written mid-link, before every key is saved — only report
    // "connected" once the link has fully finished.
    const connected = Boolean(jid) && !pairing;

    return {
      connected,
      number:    connected && jid ? numberFromJid(jid) : null,
      pairing:   pairing ? { phone: pairing.phone, startedAt: pairing.startedAt } : null,
      lastError: pair?.status === 'FAILED' ? (pair.error ?? 'Linking failed') : null,
    };
  }

  /**
   * Starts linking `phone` and returns the code to type on the phone right away.
   * `finished` keeps the WhatsApp connection open until the code is entered —
   * the caller must keep the serverless invocation alive for it (waitUntil).
   */
  static async startPairing(phone: string): Promise<{ code: string; finished: Promise<void> }> {
    const status = await WhatsAppService.getStatus();
    if (status.connected) throw new ApiError(409, `WhatsApp is already connected to +${status.number} — log out first`);
    if (status.pairing) throw new ApiError(409, 'A WhatsApp connection is already in progress — try again in a couple of minutes');

    const baileys = await loadBaileys();
    const startedAt = new Date().toISOString();
    await WhatsAppAuthStore.writePairState({ status: 'WAITING', phone, startedAt });

    const { code, done } = await linkDevice(baileys, phone);
    const finished = done
      .then(() => WhatsAppAuthStore.writePairState({ status: 'CONNECTED', phone, startedAt }))
      .catch(async (err: unknown) => {
        logger.error('[WhatsApp] Linking failed:', err);
        await WhatsAppAuthStore.writePairState({ status: 'FAILED', phone, startedAt, error: (err as Error)?.message ?? 'Linking failed' });
      });

    try {
      return { code: await code, finished };
    } catch (err) {
      await finished;
      throw new ApiError(502, `Could not get a WhatsApp code: ${(err as Error)?.message ?? 'unknown error'}`);
    }
  }

  /** Unlinks this device from the phone (so it disappears from WhatsApp's Linked
   *  devices list) and forgets the session, freeing watchtower to link another number. */
  static async logout(): Promise<void> {
    const baileys = await loadBaileys();
    const lockToken = await WhatsAppAuthStore.acquireSendLock();
    const pending: Promise<unknown>[] = [];
    let sock: Socket | null = null;

    try {
      const { state, saveCreds } = await WhatsAppAuthStore.load(baileys, pending);
      if (state.creds.me) {
        sock = createSocket(baileys, state, saveCreds);
        try {
          await waitForOpen(sock, baileys);
          await sock.logout();
        } catch (err) {
          // Already unlinked on the phone, or WhatsApp unreachable — forgetting
          // the session locally is still the right outcome.
          logger.warn('[WhatsApp] Remote logout failed, clearing local session anyway:', err);
        }
      }
    } finally {
      if (sock) await sock.end(undefined).catch(() => undefined);
      await flush(pending);
      await WhatsAppAuthStore.clear();
      await WhatsAppAuthStore.writePairState(null);
      await WhatsAppAuthStore.releaseSendLock(lockToken);
    }
  }

  /** Throws (unlike TelegramService) — it backs an explicit admin action, so the
   *  caller needs to know the message didn't go out. */
  static async sendText(phone: string, text: string): Promise<void> {
    const status = await WhatsAppService.getStatus();
    if (!status.connected) throw new ApiError(503, 'WhatsApp is not connected — connect it from watchtower first');

    const baileys = await loadBaileys();
    const lockToken = await WhatsAppAuthStore.acquireSendLock();
    const pending: Promise<unknown>[] = [];
    let sock: Socket | null = null;
    let unlinked = false;

    try {
      const { state, saveCreds } = await WhatsAppAuthStore.load(baileys, pending);

      sock = createSocket(baileys, state, saveCreds);
      await waitForOpen(sock, baileys);

      const [contact] = (await sock.onWhatsApp(toWhatsAppNumber(phone))) ?? [];
      if (!contact?.exists) throw new ApiError(404, "Customer's number is not on WhatsApp");

      await sock.sendMessage(contact.jid, { text });
      await sleep(POST_SEND_SETTLE_MS);
    } catch (err) {
      if (err instanceof ApiError) {
        unlinked = err.message === UNLINKED_MESSAGE;
        throw err;
      }
      logger.error('[WhatsApp] Failed to send message:', err);
      throw new ApiError(502, 'Failed to send WhatsApp message');
    } finally {
      if (sock) await sock.end(undefined).catch(() => undefined);
      await flush(pending);
      // Unlinked from the phone: drop the dead session so watchtower shows
      // "Connect" again instead of a number that can no longer send.
      if (unlinked) await WhatsAppAuthStore.clear();
      await WhatsAppAuthStore.releaseSendLock(lockToken);
    }
  }
}
