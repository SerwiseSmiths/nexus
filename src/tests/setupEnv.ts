import dotenv from 'dotenv';
import path from 'path';

// Loaded via jest `setupFiles`, before any test module (incl. `@/configs`) is imported.
process.env.NODE_ENV = 'test';
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });
