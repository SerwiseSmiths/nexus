import type { Bundle, GetBundlesArgs } from '@hot-updater/core';
import { NIL_UUID } from '@hot-updater/core';
import { createHotUpdater } from '@hot-updater/server';
import { prismaAdapter } from '@hot-updater/server/adapters/prisma';
import type { HotUpdaterContext } from '@hot-updater/plugin-core';
import { config } from '@/configs';
import prisma from '@/services/prisma.service';
import { cloudinaryStorage } from '@/services/otaCloudinaryStorage.service';
import { computeMinBundleIdForDate } from '@/utils/hotUpdaterMinBundleId';
import type { OtaApp } from '@/middlewares/otaDeployAuth.middleware';

// Resolved once and reused both as createHotUpdater's storage plugin and
// directly by the /storage/* proxy routes (ota.route.ts) that back the CLI's
// `standaloneStorage` adapter — see otaCloudinaryStorage.service.ts.
export const otaStoragePlugin = cloudinaryStorage({})();

const rawDatabaseFactory = prismaAdapter({ prisma, provider: 'postgresql' });

// Server-side rollback floor: whatever minBundleId a client request sends
// (its own build-time MIN_BUNDLE_ID, or its current bundle id), never let it
// resolve to anything below config.ota.minBundleDate — read lazily per
// request so a config poll refresh (see configs/index.ts) takes effect
// without needing a restart. See TRACKING.md for why this exists.
// `prismaAdapter(...)` returns a factory function (not the resolved plugin
// object) that also carries capability flags (adapterName, provider, etc.)
// directly on the function itself — preserved here via Object.assign so
// callers that inspect those flags before invoking the factory still work.
const database: typeof rawDatabaseFactory = Object.assign(
  () => {
    const real = rawDatabaseFactory();
    if (!real.getUpdateInfo) return real;

    return {
      ...real,
      getUpdateInfo: async (args: GetBundlesArgs, context?: HotUpdaterContext) => {
        const floorDate = config.ota?.minBundleDate;
        if (!floorDate) {
          return real.getUpdateInfo!(args, context);
        }

        const floorBundleId = computeMinBundleIdForDate(new Date(floorDate).getTime());
        const requestedMinBundleId = args.minBundleId ?? NIL_UUID;
        const effectiveMinBundleId =
          floorBundleId > requestedMinBundleId ? floorBundleId : requestedMinBundleId;

        return real.getUpdateInfo!({ ...args, minBundleId: effectiveMinBundleId }, context);
      },
    };
  },
  rawDatabaseFactory,
);

// basePath is '/' (not the default '/api') because Express has already
// stripped every mount prefix (`/api`, `/ota`, `/ota/admin`) by the time
// toNodeHandler builds the request from `req.url` inside the innermost
// router — see ota.route.ts and TRACKING.md for why.

/** Public check-update API: /version, /app-version/*, /fingerprint/*. No auth — installed apps call this with no prior token. Single shared instance — channel strings (the radix- and serwise- prefixes) already fully isolate apps here (verified via @hot-updater/server's pluginCore.mjs: `bundle.channel === channel`), so no per-app scoping is needed for reads. */
export const otaPublicHandler = createHotUpdater({
  database,
  storages: [otaStoragePlugin],
  basePath: '/',
  routes: { updateCheck: true, bundles: false },
});

// Per-app admin isolation: `createHotUpdater` builds its whole request
// handler once around a fixed `database` plugin — there's no hook to swap it
// per-request based on which key authenticated. So real "radix can only push
// radix-*, serwise can only push serwise-*" enforcement means one
// `scopedDatabaseForApp` per app, each wrapping the same underlying Postgres
// table but only able to see/create/update/delete rows under its own channel
// prefix. See d:\Serwise-bundle\ota-migration\TRACKING.md.
const scopedDatabaseForApp = (app: OtaApp): typeof rawDatabaseFactory => {
  const prefix = `${app}-`;
  const belongsToApp = (bundle: Bundle) => bundle.channel.startsWith(prefix);

  return Object.assign(
    () => {
      const real = rawDatabaseFactory();

      return {
        ...real,
        async getChannels(context?: HotUpdaterContext) {
          const channels = await real.getChannels(context);
          return channels.filter((channel) => channel.startsWith(prefix));
        },
        async getBundleById(bundleId: string, context?: HotUpdaterContext) {
          const bundle = await real.getBundleById(bundleId, context);
          return bundle && belongsToApp(bundle) ? bundle : null;
        },
        async getBundles(options: Parameters<typeof real.getBundles>[0], context?: HotUpdaterContext) {
          const result = await real.getBundles(options, context);
          const data = result.data.filter(belongsToApp);
          return { ...result, data, pagination: { ...result.pagination, total: data.length } };
        },
        // No existing row to scope against on insert — this is the actual
        // "radix key can't push a serwise-* bundle" enforcement.
        async appendBundle(bundle: Bundle, context?: HotUpdaterContext) {
          if (!belongsToApp(bundle)) {
            throw new Error(
              `Channel "${bundle.channel}" is not allowed for the "${app}" deploy key — channel must start with "${prefix}".`,
            );
          }
          return real.appendBundle(bundle, context);
        },
        // Defense in depth — the HTTP handler layer (pluginCore.mjs) already
        // calls the (already-scoped) getBundleById before reaching these, so
        // a cross-app id never gets this far in practice, but don't rely on
        // that alone.
        async updateBundle(targetBundleId: string, newBundle: Partial<Bundle>, context?: HotUpdaterContext) {
          const existing = await real.getBundleById(targetBundleId, context);
          if (!existing || !belongsToApp(existing)) {
            throw new Error('Bundle not found');
          }
          return real.updateBundle(targetBundleId, newBundle, context);
        },
        async deleteBundle(bundleToDelete: Bundle, context?: HotUpdaterContext) {
          if (!belongsToApp(bundleToDelete)) {
            throw new Error('Bundle not found');
          }
          return real.deleteBundle(bundleToDelete, context);
        },
      };
    },
    rawDatabaseFactory,
  );
};

/** Admin bundle-management API for radix: /bundles*, used by radix's CLI `standaloneRepository` adapter. Mount behind otaDeployAuthFor('radix'). */
export const otaAdminHandlerRadix = createHotUpdater({
  database: scopedDatabaseForApp('radix'),
  storages: [otaStoragePlugin],
  basePath: '/',
  routes: { updateCheck: false, bundles: true },
});

/** Admin bundle-management API for serwise: /bundles*, used by serwise's CLI `standaloneRepository` adapter. Mount behind otaDeployAuthFor('serwise'). */
export const otaAdminHandlerSerwise = createHotUpdater({
  database: scopedDatabaseForApp('serwise'),
  storages: [otaStoragePlugin],
  basePath: '/',
  routes: { updateCheck: false, bundles: true },
});
