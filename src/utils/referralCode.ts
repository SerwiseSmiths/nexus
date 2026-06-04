import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import defaultPrisma from '@/services/prisma.service';

// Unambiguous uppercase alphanumeric — no 0/O, 1/I/L confusion
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;

function randomCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) {
    code += CHARSET[bytes[i] % CHARSET.length];
  }
  return code;
}

/**
 * Generates a unique referral code that doesn't already exist in the DB.
 * Accepts an optional PrismaClient so scripts that create their own instance
 * (e.g. backfillReferralCodes) can pass it in rather than relying on the
 * singleton which requires DATABASE_URL to be set at module load time.
 */
export async function generateUniqueReferralCode(
  prisma: PrismaClient = defaultPrisma,
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode();
    const clash = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!clash) return code;
  }
  // Collision after 10 attempts is astronomically unlikely; extend as fallback
  return randomCode() + randomCode().slice(0, 4);
}
