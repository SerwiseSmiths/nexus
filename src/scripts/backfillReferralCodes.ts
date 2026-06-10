/// <reference types="node" />
/**
 * One-time backfill: generates a unique referral code for every user who doesn't have one.
 *
 * Run with:
 *   npx ts-node -r tsconfig-paths/register src/scripts/backfillReferralCodes.ts [local|development|production]
 *
 * Defaults to 'local' if no stage argument is supplied.
 * Safe to run multiple times — only touches users where referralCode IS NULL.
 */

import { PrismaClient } from '@prisma/client';
import { initializeConfig } from '../configs';
import { generateUniqueReferralCode } from '@/utils/referralCode';
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
      where:  { referralCode: null, isDeleted: false },
      select: { id: true, phoneNo: true },
    });

    logger.info(`[${stage}] Found ${users.length} user(s) without a referral code.`);
    if (users.length === 0) {
      logger.info('Nothing to do.');
      return;
    }

    let success = 0;
    for (const user of users) {
      try {
        const code = await generateUniqueReferralCode(prisma);
        await prisma.user.update({
          where: { id: user.id },
          data:  { referralCode: code },
        });
        logger.info(`  ✓ ${user.phoneNo}  →  ${code}`);
        success++;
      } catch (err: unknown) {
        logger.error(`  ✗ ${user.phoneNo}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    logger.info(`Done. ${success}/${users.length} users updated.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  logger.error(e);
  process.exit(1);
});
