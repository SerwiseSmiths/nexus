import { Router, Request, Response, NextFunction } from 'express';
import { toNodeHandler } from '@hot-updater/server/node';
import { otaDeployAuthFor, OtaApp } from '@/middlewares/otaDeployAuth.middleware';
import {
  otaPublicHandler,
  otaAdminHandlerRadix,
  otaAdminHandlerSerwise,
  otaStoragePlugin,
} from '@/services/otaServer.service';
import { createUploadSignature } from '@/services/otaCloudinaryStorage.service';
import { logger } from '@/utils/logger';

const router = Router();

// ─── Admin API (gated, per app) ────────────────────────────────────────────────
// Registered BEFORE the public catch-all below — Express matches routes in
// registration order, so `/admin/*` must be claimed here first or the public
// catch-all would swallow it.
//
// Two separate routers — /admin/radix and /admin/serwise — each gated by that
// app's own deploy key (otaDeployAuthFor) and backed by that app's own
// pre-scoped admin handler (otaServer.service.ts's scopedDatabaseForApp).
// Cloudinary storage itself is shared (bundle ids are globally-unique
// UUIDv7s regardless of app) — only bundle-record CRUD needs per-app scoping.
const buildAppAdminRouter = (app: OtaApp, adminHandler: typeof otaAdminHandlerRadix) => {
  const adminRouter = Router();
  adminRouter.use(otaDeployAuthFor(app));

  // Direct-to-Cloudinary upload, step 1: hand the CLI a short-lived signed
  // payload (tiny JSON, well under Vercel's 4.5MB body cap) instead of
  // proxying the bundle bytes through this function. The CLI uses this to
  // PUT the actual file straight to Cloudinary — see
  // <app>/hot-updater.config.ts's custom `storage.upload`.
  adminRouter.post('/storage/upload-signature', (req: Request, res: Response) => {
    const { key, filename } = req.body ?? {};
    if (!key || !filename) {
      return res.status(400).json({ message: 'Missing required "key" or "filename" field' });
    }

    return res.status(200).json(createUploadSignature(key, filename));
  });

  adminRouter.delete('/storage/delete', async (req: Request, res: Response) => {
    const storageUri = req.body?.storageUri;
    if (!storageUri) {
      return res.status(400).json({ message: 'Missing required "storageUri" field' });
    }

    try {
      await otaStoragePlugin.profiles.node!.delete(storageUri);
      return res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[ota] storage delete failed', error);
      return res.status(500).json({ message: 'Failed to delete OTA bundle' });
    }
  });

  adminRouter.post('/storage/readText', async (req: Request, res: Response) => {
    const storageUri = req.body?.storageUri;
    if (!storageUri) {
      return res.status(400).json({ message: 'Missing required "storageUri" field' });
    }

    try {
      const text = await otaStoragePlugin.profiles.runtime!.readText(storageUri);
      if (text === null) {
        return res.status(404).json({ message: 'Not found' });
      }
      return res.status(200).type('text/plain').send(text);
    } catch (error) {
      logger.error('[ota] storage readText failed', error);
      return res.status(500).json({ message: 'Failed to read OTA storage text' });
    }
  });

  adminRouter.post('/storage/getDownloadUrl', async (req: Request, res: Response) => {
    const storageUri = req.body?.storageUri;
    if (!storageUri) {
      return res.status(400).json({ message: 'Missing required "storageUri" field' });
    }

    try {
      const { fileUrl } = await otaStoragePlugin.profiles.runtime!.getDownloadUrl(storageUri);
      return res.status(200).json({ fileUrl });
    } catch (error) {
      logger.error('[ota] storage getDownloadUrl failed', error);
      return res.status(500).json({ message: 'Failed to get OTA download URL' });
    }
  });

  // Bundle management CRUD (/bundles, /bundles/:id, /bundles/channels) — fully
  // handled by createHotUpdater's own admin handler. Verified against the
  // installed @hot-updater/server: its internal router hardcodes these routes
  // as literally "/api/bundles*" regardless of the `basePath` option passed to
  // createHotUpdater (only the always-mounted "/version" diagnostic route has
  // no such prefix) — so req.url must be rewritten to include it here, even
  // though our own external path (/api/ota/admin/<app>/bundles) has no double
  // "/api".
  adminRouter.all('/*splat', (req: Request, res: Response, next: NextFunction) => {
    if (req.url.startsWith('/bundles')) {
      req.url = `/api${req.url}`;
    }
    return toNodeHandler(adminHandler)(req, res, next);
  });

  return adminRouter;
};

router.use('/admin/radix', buildAppAdminRouter('radix', otaAdminHandlerRadix));
router.use('/admin/serwise', buildAppAdminRouter('serwise', otaAdminHandlerSerwise));

// ─── Public check-update API (no auth) ────────────────────────────────────────
// GET /version, GET /app-version/*, GET /fingerprint/*
// Installed apps call these with no prior token — never gate this router.
// Shared across both apps — isolated purely by the `channel` query param
// (radix-*/serwise-*), not by URL. Registered LAST so it never shadows
// /admin/* above.
router.all('/*splat', toNodeHandler(otaPublicHandler));

export default router;
