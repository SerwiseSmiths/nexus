import { DeviceType, WorkHistoryEvent, Prisma } from '@prisma/client';
import prisma from '@/services/prisma.service';
import { ApiError } from '@/utils/apiResponse';
import {
  DEVICE_KEYS,
  DEVICE_META_VALIDATORS,
  type DeviceKey,
  type AddDeviceInput,
  type UpdateDeviceInput,
  type AddWorkHistoryInput,
  type AddDeviceForCustomerInput,
  type ListCustomerDevicesInput,
} from '@/types/device.types';

const DEVICE_KEY_TO_TYPE: Record<DeviceKey, DeviceType> = {
  [DEVICE_KEYS.MASTER_PURIFIER]: DeviceType.MASTER_PURIFIER,
  [DEVICE_KEYS.AIR_CONDITIONER]: DeviceType.AIR_CONDITIONER,
  [DEVICE_KEYS.FRIDGE]:          DeviceType.FRIDGE,
  [DEVICE_KEYS.WASHING_MACHINE]: DeviceType.WASHING_MACHINE,
  [DEVICE_KEYS.GEYSER]:          DeviceType.GEYSER,
};

const VALID_EVENTS = new Set(Object.values(WorkHistoryEvent));

export class DeviceService {
  static async addDevice({ userId, addressId, deviceKey, imageUrl, metadata }: AddDeviceInput) {
    const validator = DEVICE_META_VALIDATORS[deviceKey];
    if (!validator) throw new ApiError(400, `Unknown device key: ${deviceKey}`);

    const result = validator.safeParse(metadata);
    if (!result.success) throw new ApiError(400, 'Invalid device metadata', result.error.issues);

    return prisma.device.create({
      data: {
        userId,
        addressId: addressId ?? null,
        deviceKey,
        type: DEVICE_KEY_TO_TYPE[deviceKey],
        imageUrl: imageUrl ?? null,
        metadata: result.data,
      },
      include: { address: { select: { id: true, title: true, houseNo: true, societyName: true, city: true, state: true } } },
    });
  }

  static async getDevices(userId: string, deviceKey?: string) {
    return prisma.device.findMany({
      where: {
        userId,
        isDeleted: false,
        ...(deviceKey && { deviceKey }),
      },
      include: {
        address: {
          select: { id: true, title: true, houseNo: true, societyName: true, city: true, state: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getDevice(deviceId: string, userId: string) {
    const device = await prisma.device.findFirst({
      where: { id: deviceId, userId, isDeleted: false },
      include: {
        address: {
          select: { id: true, title: true, houseNo: true, societyName: true, city: true, state: true },
        },
        workHistory: {
          where: { isDeleted: false },
          orderBy: { eventDate: 'desc' },
        },
      },
    });
    if (!device) throw new ApiError(404, 'Device not found');
    return device;
  }

  static async updateDevice({ deviceId, userId, imageUrl, metadata }: UpdateDeviceInput) {
    const device = await prisma.device.findFirst({
      where: { id: deviceId, userId, isDeleted: false },
    });
    if (!device) throw new ApiError(404, 'Device not found');

    let validatedMeta: Record<string, unknown> | undefined;
    if (metadata !== undefined) {
      const validator = DEVICE_META_VALIDATORS[device.deviceKey as DeviceKey];
      if (!validator) throw new ApiError(400, `Unknown device key: ${device.deviceKey}`);

      const result = validator.safeParse(metadata);
      if (!result.success) throw new ApiError(400, 'Invalid device metadata', result.error.issues);
      validatedMeta = result.data as Record<string, unknown>;
    }

    return prisma.device.update({
      where: { id: deviceId },
      data: {
        ...(imageUrl !== undefined && { imageUrl }),
        ...(validatedMeta !== undefined && { metadata: validatedMeta as Prisma.InputJsonValue }),
      },
    });
  }

  static async deleteDevice(deviceId: string, userId: string) {
    const device = await prisma.device.findFirst({
      where: { id: deviceId, userId, isDeleted: false },
    });
    if (!device) throw new ApiError(404, 'Device not found');

    return prisma.device.update({
      where: { id: deviceId },
      data: { isDeleted: true },
    });
  }

  static async addWorkHistory({ deviceId, userId, event, eventDate, notes }: AddWorkHistoryInput) {
    const device = await prisma.device.findFirst({
      where: { id: deviceId, userId, isDeleted: false },
    });
    if (!device) throw new ApiError(404, 'Device not found');

    if (!VALID_EVENTS.has(event as WorkHistoryEvent)) {
      throw new ApiError(400, `Invalid event. Valid values: ${[...VALID_EVENTS].join(', ')}`);
    }

    const parsedDate = new Date(eventDate);
    if (isNaN(parsedDate.getTime())) throw new ApiError(400, 'Invalid eventDate — use ISO 8601 format');

    return prisma.deviceWorkHistory.create({
      data: {
        deviceId,
        event: event as WorkHistoryEvent,
        eventDate: parsedDate,
        notes: notes ?? null,
      },
    });
  }

  static async getWorkHistory(deviceId: string, userId: string) {
    const device = await prisma.device.findFirst({
      where: { id: deviceId, userId, isDeleted: false },
    });
    if (!device) throw new ApiError(404, 'Device not found');

    return prisma.deviceWorkHistory.findMany({
      where: { deviceId, isDeleted: false },
      orderBy: { eventDate: 'desc' },
    });
  }

  static async getDevicesByUserId({ targetUserId, addressId }: ListCustomerDevicesInput) {
    return prisma.device.findMany({
      where: {
        userId:    targetUserId,
        isDeleted: false,
        ...(addressId && { addressId }),
      },
      include: {
        address: {
          select: { id: true, title: true, houseNo: true, societyName: true, city: true, state: true },
        },
        workHistory: {
          where: { isDeleted: false },
          orderBy: { eventDate: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async addDeviceForCustomer({
    targetUserId,
    deviceKey,
    addressId,
    imageUrl,
    metadata,
  }: AddDeviceForCustomerInput) {
    const validator = DEVICE_META_VALIDATORS[deviceKey];
    if (!validator) throw new ApiError(400, `Unknown device key: ${deviceKey}`);

    const result = validator.safeParse(metadata);
    if (!result.success) throw new ApiError(400, 'Invalid device metadata', result.error.issues);

    return prisma.device.create({
      data: {
        userId:    targetUserId,
        addressId: addressId ?? null,
        deviceKey,
        type:      DEVICE_KEY_TO_TYPE[deviceKey],
        imageUrl:  imageUrl ?? null,
        metadata:  result.data,
      },
      include: {
        address: { select: { id: true, title: true, houseNo: true, societyName: true, city: true, state: true } },
      },
    });
  }

  static async deleteWorkHistoryEntry(entryId: string, deviceId: string, userId: string) {
    const device = await prisma.device.findFirst({
      where: { id: deviceId, userId, isDeleted: false },
    });
    if (!device) throw new ApiError(404, 'Device not found');

    const entry = await prisma.deviceWorkHistory.findFirst({
      where: { id: entryId, deviceId, isDeleted: false },
    });
    if (!entry) throw new ApiError(404, 'Work history entry not found');

    return prisma.deviceWorkHistory.update({
      where: { id: entryId },
      data: { isDeleted: true },
    });
  }
}
