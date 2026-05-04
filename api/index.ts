import 'tsconfig-paths/register';
import 'dotenv/config';
import { initializeConfig } from '../src/configs';
import { initializeCloudinary } from '../src/configs/cloudinary.config';
import app from '../src/app';

let initPromise: Promise<void> | null = null;

function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await initializeConfig();
      initializeCloudinary();
    })();
  }
  return initPromise;
}

export default async function handler(req: any, res: any) {
  await ensureInitialized();
  app(req, res);
}
