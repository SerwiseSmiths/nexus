import { addAlias } from 'module-alias';
import path from 'path';

// Patches Node's require() globally so @/ resolves to dist/.
// Runs before any require() that loads @/-aliased modules.
addAlias('@', path.join(__dirname, '..', 'dist'));

/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv/config');
const { initializeConfig } = require('../dist/configs');
const { initializeCloudinary } = require('../dist/configs/cloudinary.config');
/* eslint-enable @typescript-eslint/no-require-imports */

let app: ((req: any, res: any) => void) | null = null;
let initPromise: Promise<void> | null = null;

function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await initializeConfig();
      initializeCloudinary();
      // Loaded here (not at module top) so that PrismaClient is constructed
      // only after process.env.DATABASE_URL has been set by initializeConfig()
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      app = require('../dist/app').default as (req: any, res: any) => void;
    })();
  }
  return initPromise;
}

export default async function handler(req: any, res: any) {
  await ensureInitialized();
  app!(req, res);
}
