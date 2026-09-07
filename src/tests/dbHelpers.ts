import prisma from '@/services/prisma.service';

// Deletion order respects FK constraints: WalletLedger -> Wallet/RefreshToken -> User, Otp is standalone.
export async function resetAuthTables() {
  await prisma.walletLedger.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.wallet.deleteMany({});
  await prisma.otp.deleteMany({});
  await prisma.user.deleteMany({});
}
