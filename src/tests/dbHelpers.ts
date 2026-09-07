import prisma from '@/services/prisma.service';

// Full reset of every table touched by the auth and device test suites.
// Deletion order respects FK constraints: leaves (WalletLedger,
// DeviceWorkHistory) -> things that reference User (RefreshToken, Wallet,
// Device, Complaint) -> Address -> User. Otp is standalone.
export async function resetAllTestTables() {
  await prisma.walletLedger.deleteMany({});
  await prisma.deviceWorkHistory.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.wallet.deleteMany({});
  await prisma.complaint.deleteMany({});
  await prisma.device.deleteMany({});
  await prisma.address.deleteMany({});
  await prisma.otp.deleteMany({});
  await prisma.user.deleteMany({});
}

// Kept as named aliases so existing test files (and their intent — "reset
// before an auth test" / "reset before a device test") stay readable; both
// need the full reset since all suites share one test database.
export const resetAuthTables = resetAllTestTables;
export const resetDeviceTables = resetAllTestTables;
