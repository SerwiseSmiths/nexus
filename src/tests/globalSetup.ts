import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

// Runs once, before any test file — in its own process context, so `setupFiles`
// (which only runs per test file) hasn't executed yet. Load env directly here too.
export default async function globalSetup() {
  dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

  if (!process.env.DATABASE_URL?.includes('nexus_test')) {
    throw new Error(
      `Refusing to run tests: DATABASE_URL does not point at nexus_test (got: ${process.env.DATABASE_URL}). ` +
        'Check .env.test — tests must never run against a shared/dev/prod database.'
    );
  }

  const prisma = new PrismaClient();
  await prisma.$connect();
  await prisma.$disconnect();
}
