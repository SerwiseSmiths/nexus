import * as admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';
import { logger } from '@/utils/logger';

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
