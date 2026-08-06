import { Response, NextFunction, Request } from 'express';
import crypto from 'crypto';
import { config } from '@/configs';

export type OtaApp = 'radix' | 'serwise';

const deployApiKeyFor = (app: OtaApp): string =>
  app === 'radix' ? config.ota.radixDeployApiKey : config.ota.serwiseDeployApiKey;

/**
 * Gates the per-app OTA admin API (bundle management + storage upload/delete
 * proxy) used by hot-updater's CLI (`standaloneRepository`/`standaloneStorage`
 * adapters, <app>/hot-updater.config.ts). Deliberately separate from
 * `authenticate`/`authorize` — this authenticates a CI/CLI deploy tool via a
 * static bearer key, not an app user via JWT. Never apply this to the public
 * check-update routes (/ota/version, /ota/app-version/*, /ota/fingerprint/*) —
 * installed apps call those with no prior token.
 *
 * Parameterized per app (radix/serwise) rather than a single shared key —
 * each app's deploy key only ever authenticates against that app's own admin
 * router (see ota.route.ts), which in turn only writes bundles under that
 * app's channel prefix (otaServer.service.ts's scopedDatabaseForApp). A
 * leaked radix key can't be used to touch serwise's bundles, and vice versa.
 */
export const otaDeployAuthFor = (app: OtaApp) => (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

  if (!token) {
    return res.status(401).json({ message: 'Access Denied: No OTA deploy token provided' });
  }

  const expected = Buffer.from(deployApiKeyFor(app));
  const provided = Buffer.from(token);

  const isValid = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);

  if (!isValid) {
    return res.status(403).json({ message: 'Forbidden: Invalid OTA deploy token' });
  }

  return next();
};
