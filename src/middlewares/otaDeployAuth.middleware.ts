import { Response, NextFunction, Request } from 'express';
import crypto from 'crypto';
import { config } from '@/configs';

/**
 * Gates the OTA admin API (bundle management + storage upload/delete proxy)
 * used by hot-updater's CLI (`standaloneRepository`/`standaloneStorage`
 * adapters, radix/hot-updater.config.ts). Deliberately separate from
 * `authenticate`/`authorize` — this authenticates a CI/CLI deploy tool via a
 * static bearer key, not an app user via JWT. Never apply this to the public
 * check-update routes (/ota/version, /ota/app-version/*, /ota/fingerprint/*) —
 * installed apps call those with no prior token.
 */
export const otaDeployAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

  if (!token) {
    return res.status(401).json({ message: 'Access Denied: No OTA deploy token provided' });
  }

  const expected = Buffer.from(config.ota.deployApiKey);
  const provided = Buffer.from(token);

  const isValid = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);

  if (!isValid) {
    return res.status(403).json({ message: 'Forbidden: Invalid OTA deploy token' });
  }

  return next();
};
