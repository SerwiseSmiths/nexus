import prisma from '@/services/prisma.service';
import { DeviceType, Role } from '@prisma/client';
import { DEVICE_KEY_TO_TYPE, type DeviceKey } from '@/types/device.types';
import { createUser, createAddressFor, VALID_METADATA } from '../device/fixtures';

export { createUser, createAddressFor, VALID_METADATA };

export async function createDeviceFor(userId: string, deviceKey: DeviceKey = 'fridge', addressId?: string) {
  return prisma.device.create({
    data: {
      userId,
      addressId: addressId ?? null,
      deviceKey,
      type: DEVICE_KEY_TO_TYPE[deviceKey],
      metadata: VALID_METADATA[deviceKey],
    },
  });
}

// Looks up the standard (one-per-DeviceType) group seeded by resetAllTestTables
// for the given device key — mirrors what ComplaintService.createComplaint
// resolves internally.
export async function groupIdForDeviceKey(deviceKey: DeviceKey): Promise<string> {
  const group = await prisma.deviceTypeGroup.findFirstOrThrow({
    where: { isDeleted: false, deviceTypes: { has: DEVICE_KEY_TO_TYPE[deviceKey] } },
  });
  return group.id;
}

export async function createProviderWithSkills(deviceKeys: DeviceKey[] = []) {
  const provider = await createUser(Role.PROVIDER);
  const groupIds = new Set<string>();
  for (const key of deviceKeys) {
    groupIds.add(await groupIdForDeviceKey(key));
  }
  await prisma.providerProfile.create({
    data: { userId: provider.id, skillGroups: { connect: Array.from(groupIds).map((id) => ({ id })) } },
  });
  return provider;
}

export async function createComplaintFor(
  userId: string,
  addressId: string,
  overrides: Partial<{
    providerId: string;
    stage: string;
    deviceKey: DeviceKey;
    quantity: number;
    totalAmount: number;
  }> = {},
) {
  const deviceKey = overrides.deviceKey ?? 'fridge';
  const groupId = await groupIdForDeviceKey(deviceKey);

  const complaint = await prisma.complaint.create({
    data: {
      userId,
      addressId,
      title: 'AC not cooling',
      providerId: overrides.providerId ?? null,
      stage: (overrides.stage as any) ?? undefined,
      groupId,
      requestedDevices: [{ deviceKey, quantity: overrides.quantity ?? 1 }],
    },
  });
  if (overrides.totalAmount !== undefined) {
    await prisma.quote.create({
      data: {
        complaintId: complaint.id,
        items: [{ name: 'Service', unitPrice: overrides.totalAmount, quantity: 1 }],
        totalAmount: overrides.totalAmount,
      },
    });
  }
  return complaint;
}

// Links a physical Device row to a complaint via ComplaintDevice, the way
// ComplaintService.linkDevice would — for tests that need a device already
// identified without going through the HTTP endpoint.
export async function linkDeviceToComplaint(complaintId: string, deviceId: string) {
  return prisma.complaintDevice.create({ data: { complaintId, deviceId } });
}
