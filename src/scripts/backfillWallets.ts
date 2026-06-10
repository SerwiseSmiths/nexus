/// <reference types="node" />
/**
 * One-time backfill: creates a wallet for every user who doesn't have one.
 *
 * Run with:
 *   npx ts-node -r tsconfig-paths/register src/scripts/backfillWallets.ts [local|development|production]
 *
 * Defaults to 'local' if no stage argument is supplied.
 * Safe to run multiple times — only creates wallets for users that don't have one.
 */

import { PrismaClient } from '@prisma/client';
import { initializeConfig } from '../configs';
import { logger } from '@/utils/logger';

type Stage = 'local' | 'development' | 'production';

async function main() {
  const stage = (process.argv[2] ?? 'local') as Stage;
  process.env.NODE_ENV = stage;

  const config = await initializeConfig();
  const dbUrl  = config.directUrl ?? config.databaseUrl;
  if (!dbUrl) throw new Error(`Missing databaseUrl for stage: ${stage}`);

  process.env.DATABASE_URL = dbUrl;
  const prisma = new PrismaClient();

  try {
    const users = await prisma.user.findMany({
      where: {
        isDeleted: false,
        wallet:    null,
      },
      select: { id: true, phoneNo: true },
    });

    logger.info(`[${stage}] Found ${users.length} user(s) without a wallet.`);
    if (users.length === 0) {
      logger.info('Nothing to do.');
      return;
    }

    let success = 0;
    for (const user of users) {
      try {
        await prisma.wallet.create({ data: { userId: user.id } });
        logger.info(`  ✓ ${user.phoneNo}`);
        success++;
      } catch (err: unknown) {
        logger.error(`  ✗ ${user.phoneNo}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    logger.info(`Done. ${success}/${users.length} wallets created.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  logger.error(e);
  process.exit(1);
});
