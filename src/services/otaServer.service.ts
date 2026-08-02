import type { GetBundlesArgs } from '@hot-updater/core';
import { NIL_UUID } from '@hot-updater/core';
import { createHotUpdater } from '@hot-updater/server';
import { prismaAdapter } from '@hot-updater/server/adapters/prisma';
import type { HotUpdaterContext } from '@hot-updater/plugin-core';
import { config } from '@/configs';
import prisma from '@/services/prisma.service';
import { cloudinaryStorage } from '@/services/otaCloudinaryStorage.service';
import { computeMinBundleIdForDate } from '@/utils/hotUpdaterMinBundleId';

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

/** Public check-update API: /version, /app-version/*, /fingerprint/*. No auth — installed apps call this with no prior token. */
export const otaPublicHandler = createHotUpdater({
  database,
  storages: [otaStoragePlugin],
  basePath: '/',
  routes: { updateCheck: true, bundles: false },
});

/** Admin bundle-management API: /bundles*, used by the CLI's `standaloneRepository` adapter. Mount behind otaDeployAuth. */
export const otaAdminHandler = createHotUpdater({
  database,
  storages: [otaStoragePlugin],
  basePath: '/',
  routes: { updateCheck: false, bundles: true },
});
