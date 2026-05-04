import { register } from 'tsconfig-paths';
import path from 'path';

// register() must run before any module that uses @/ aliases is loaded.
// Static imports are hoisted by esbuild to the top of the file (above this call),
// so all @/-dependent modules are loaded via require() below instead.
register({
  baseUrl: path.join(__dirname, '..'),
  paths: { '@/*': ['src/*'] },
});

/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv/config');
const { initializeConfig } = require('../src/configs');
const { initializeCloudinary } = require('../src/configs/cloudinary.config');
const app = require('../src/app').default;
/* eslint-enable @typescript-eslint/no-require-imports */

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
