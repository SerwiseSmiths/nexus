import { DeviceType } from '@prisma/client';
import prisma from '@/services/prisma.service';

// One group per DeviceType, mirroring the seed data the real migration
// inserts — nexus_test is synced via `prisma db push` (not migrations), so
// it never gets that seed and every complaint/skill test needs these rows to
// exist for DeviceTypeGroupService.findByDeviceType to resolve anything.
const STANDARD_GROUPS: { key: string; name: string; deviceTypes: DeviceType[] }[] = [
  { key: 'master_purifier', name: 'Master Purifier',  deviceTypes: [DeviceType.MASTER_PURIFIER] },
  { key: 'air_conditioner', name: 'Air Conditioner',  deviceTypes: [DeviceType.AIR_CONDITIONER] },
  { key: 'fridge',          name: 'Fridge',           deviceTypes: [DeviceType.FRIDGE] },
  { key: 'washing_machine', name: 'Washing Machine',  deviceTypes: [DeviceType.WASHING_MACHINE] },
  { key: 'geyser',          name: 'Geyser',           deviceTypes: [DeviceType.GEYSER] },
];

export async function seedDeviceTypeGroups() {
  return Promise.all(
    STANDARD_GROUPS.map((g) => prisma.deviceTypeGroup.create({ data: g })),
  );
}

// Full reset of every table touched by the auth, device, and complaint test
// suites. Deletion order respects FK constraints: leaves (WalletLedger,
// DeviceWorkHistory, Quote, ComplaintDevice, ComplaintLog) -> things that
// reference User (RefreshToken, Wallet, ProviderProfile [cascades its
// skillGroups join rows], Complaint [references DeviceTypeGroup]) -> Device
// -> DeviceTypeGroup -> Address -> User. Otp is standalone. DeviceTypeGroup
// is re-seeded after every reset so every test starts with the standard
// one-group-per-type set.
export async function resetAllTestTables() {
  await prisma.walletLedger.deleteMany({});
  await prisma.deviceWorkHistory.deleteMany({});
  await prisma.quote.deleteMany({});
  await prisma.complaintDevice.deleteMany({});
  await prisma.complaintLog.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.deviceToken.deleteMany({});
  await prisma.wallet.deleteMany({});
  await prisma.providerProfile.deleteMany({});
  await prisma.complaint.deleteMany({});
  await prisma.device.deleteMany({});
  await prisma.deviceTypeGroup.deleteMany({});
  await prisma.address.deleteMany({});
  await prisma.otp.deleteMany({});
  await prisma.user.deleteMany({});
  await seedDeviceTypeGroups();
}

// Kept as named aliases so existing test files (and their intent — "reset
// before an auth test" / "reset before a device test") stay readable; all
// need the full reset since every suite shares one test database.
export const resetAuthTables = resetAllTestTables;
export const resetDeviceTables = resetAllTestTables;
export const resetComplaintTables = resetAllTestTables;
