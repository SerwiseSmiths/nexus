import * as admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';
import { DeviceApp } from '@prisma/client';
import { logger } from '@/utils/logger';

// ─── nexus's own Firebase project (server-side Remote Config — see
// configLoader.ts) ──────────────────────────────────────────────────────────
// Unrelated to the mobile apps' push credentials below — do not point this
// at app-radix/app-serwise, and do not point those at this.

let firebaseAdmin: admin.app.App | null = null;

export const initializeFirebase = () => {
  if (firebaseAdmin) return firebaseAdmin;

  let serviceAccount: admin.ServiceAccount | null = null;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) as admin.ServiceAccount;
    } catch {
      logger.error('Failed to parse FIREBASE_SERVICE_ACCOUNT env var.');
    }
  } else {
    const serviceAccountPath = path.resolve(process.cwd(), 'serviceAccountKey.json');
    if (fs.existsSync(serviceAccountPath)) {
      try {
        serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8')) as admin.ServiceAccount;
      } catch {
        logger.error('Failed to read serviceAccountKey.json.');
      }
    }
  }

  if (!serviceAccount) {
    logger.warn('Firebase service account not found. Remote Config will be unavailable.');
    return null;
  }

  try {
    firebaseAdmin = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    logger.info('Firebase Admin initialized successfully.');
    return firebaseAdmin;
  } catch (error) {
    logger.error('Error initializing Firebase Admin:', error);
    return null;
  }
};

export { firebaseAdmin };

// ─── Push-capable mobile apps' Firebase projects (FCM) ─────────────────────
// serwise and radix are separate Firebase projects (separate google-services.json,
// separate FCM token namespace) — sending a push to a radix-issued token with
// serwise's credential (or vice versa) fails with `messaging/mismatched-credential`.
// So this holds one named Firebase Admin app per mobile app, each with its own
// service account — deliberately not reusing initializeFirebase() above, which
// is nexus's own unrelated project.

const PUSH_SERVICE_ACCOUNT_ENV_VAR: Record<DeviceApp, string> = {
  [DeviceApp.SERWISE]: 'FIREBASE_SERVICE_ACCOUNT_SERWISE',
  [DeviceApp.RADIX]:   'FIREBASE_SERVICE_ACCOUNT_RADIX',
};

const pushApps: Partial<Record<DeviceApp, admin.app.App | null>> = {};

export const initializePushFirebase = (deviceApp: DeviceApp): admin.app.App | null => {
  if (deviceApp in pushApps) return pushApps[deviceApp] ?? null;

  const envVar = PUSH_SERVICE_ACCOUNT_ENV_VAR[deviceApp];
  const envValue = process.env[envVar];

  if (!envValue) {
    logger.warn(`Push Firebase service account not found for ${deviceApp} (${envVar} is unset).`);
    pushApps[deviceApp] = null;
    return null;
  }

  let serviceAccount: admin.ServiceAccount;
  try {
    serviceAccount = JSON.parse(envValue) as admin.ServiceAccount;
  } catch {
    logger.error(`Failed to parse ${envVar} env var.`);
    pushApps[deviceApp] = null;
    return null;
  }

  try {
    // Named app (second arg) — the two mobile apps' credentials must coexist
    // in the same process, and possibly alongside the unnamed default app
    // from initializeFirebase() above.
    pushApps[deviceApp] = admin.initializeApp(
      { credential: admin.credential.cert(serviceAccount) },
      `push-${deviceApp}`,
    );
    logger.info(`Push Firebase Admin initialized successfully for ${deviceApp}.`);
    return pushApps[deviceApp]!;
  } catch (error) {
    logger.error(`Error initializing push Firebase Admin for ${deviceApp}:`, error);
    pushApps[deviceApp] = null;
    return null;
  }
};
