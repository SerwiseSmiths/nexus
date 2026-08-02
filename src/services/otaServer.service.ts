import { createHotUpdater } from '@hot-updater/server';
import { prismaAdapter } from '@hot-updater/server/adapters/prisma';
import prisma from '@/services/prisma.service';
import { cloudinaryStorage } from '@/services/otaCloudinaryStorage.service';

// Resolved once and reused both as createHotUpdater's storage plugin and
// directly by the /storage/* proxy routes (ota.route.ts) that back the CLI's
// `standaloneStorage` adapter — see otaCloudinaryStorage.service.ts.
export const otaStoragePlugin = cloudinaryStorage({})();

const database = prismaAdapter({ prisma, provider: 'postgresql' });

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
