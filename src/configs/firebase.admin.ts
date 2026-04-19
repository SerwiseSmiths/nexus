import * as admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';
import { logger } from '@/utils/logger';

let firebaseAdmin: admin.app.App | null = null;

export const initializeFirebase = () => {
  if (firebaseAdmin) return firebaseAdmin;

  const serviceAccountPath = path.resolve(process.cwd(), 'serviceAccountKey.json');

  if (!fs.existsSync(serviceAccountPath)) {
    logger.warn('Firebase serviceAccountKey.json not found. Remote Config will be unavailable.');
    return null;
  }

  try {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    
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
