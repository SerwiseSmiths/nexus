import { initializeConfig } from '@/configs';

let initialized: Promise<void> | null = null;

// `app.ts` reads `config.cors.origin` at module load time, so `initializeConfig()`
// must resolve before `app` is imported — mirrors the ordering in `server.ts`.
export async function getTestApp() {
  if (!initialized) {
    initialized = initializeConfig().then(() => undefined);
  }
  await initialized;

  // `import()` requires ESM support ts-jest's CommonJS transpile doesn't have;
  // `require` after `initializeConfig()` resolves gives the same "config first" ordering.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const app = require('@/app').default;
  return app;
}
