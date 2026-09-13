import { DeviceType } from '@prisma/client';
import prisma from '@/services/prisma.service';
import { ApiError } from '@/utils/apiResponse';
import type {
  CreateDeviceTypeGroupInput,
  UpdateDeviceTypeGroupInput,
} from '@/types/device-type-group.types';

const VALID_DEVICE_TYPES = new Set(Object.values(DeviceType));

// Lowercase, non-alphanumeric runs collapsed to "_", trimmed — mirrors the
// backfill SQL in the add_device_type_group_key migration exactly, so
// existing and newly-created groups produce the same key for the same name.
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export class DeviceTypeGroupService {
  private static validateDeviceTypes(deviceTypes: DeviceType[]) {
    if (!Array.isArray(deviceTypes) || deviceTypes.length === 0) {
      throw new ApiError(400, 'At least one device type is required');
    }
    const invalid = deviceTypes.filter((t) => !VALID_DEVICE_TYPES.has(t));
    if (invalid.length > 0) {
      throw new ApiError(400, `Invalid device type(s): ${invalid.join(', ')}`);
    }
    const deduped = new Set(deviceTypes);
    if (deduped.size !== deviceTypes.length) {
      throw new ApiError(400, 'Duplicate device types are not allowed within one group');
    }
  }

  // Every DeviceType may belong to at most one active group at a time — this
  // is the invariant the whole grouping feature depends on (a complaint's
  // group determines exactly one eligible provider skill set). Postgres can't
  // enforce "array element unique across rows", so it's enforced here.
  private static async assertDeviceTypesAvailable(deviceTypes: DeviceType[], excludeGroupId?: string) {
    const conflicting = await prisma.deviceTypeGroup.findFirst({
      where: {
        isDeleted: false,
        ...(excludeGroupId && { id: { not: excludeGroupId } }),
        deviceTypes: { hasSome: deviceTypes },
      },
    });

    if (conflicting) {
      const overlap = deviceTypes.filter((t) => conflicting.deviceTypes.includes(t));
      throw new ApiError(
        409,
        `${overlap.join(', ')} already belong(s) to group "${conflicting.name}". Remove them from that group first.`,
      );
    }
  }

  // The key is generated once at creation time and never changes afterward,
  // even if the group is later renamed — every external consumer (watchtower,
  // radix, serwise) references a group by this stable slug, not by id.
  private static async generateUniqueKey(name: string): Promise<string> {
    const base = slugify(name) || 'group';
    let candidate = base;
    let suffix = 2;
    // Uniqueness spans the whole table (including soft-deleted rows), since
    // the DB column itself is @unique regardless of isDeleted.
    while (await prisma.deviceTypeGroup.findUnique({ where: { key: candidate } })) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  static async create(input: CreateDeviceTypeGroupInput) {
    if (!input.name?.trim()) throw new ApiError(400, 'Name is required');
    DeviceTypeGroupService.validateDeviceTypes(input.deviceTypes);
    await DeviceTypeGroupService.assertDeviceTypesAvailable(input.deviceTypes);

    const key = await DeviceTypeGroupService.generateUniqueKey(input.name);

    return prisma.deviceTypeGroup.create({
      data: {
        key,
        name: input.name.trim(),
        deviceTypes: input.deviceTypes,
      },
    });
  }

  static async findAll() {
    return prisma.deviceTypeGroup.findMany({
      where: { isDeleted: false },
      orderBy: { name: 'asc' },
    });
  }

  // Internal lookup by DB id — used where a Prisma relation already resolved
  // to an id (e.g. Complaint.groupId, ProviderProfile.skillGroups). Never
  // exposed directly to a route param; see findByKey for that.
  static async findById(groupId: string) {
    const group = await prisma.deviceTypeGroup.findFirst({ where: { id: groupId, isDeleted: false } });
    if (!group) throw new ApiError(404, 'Device type group not found');
    return group;
  }

  // External lookup by the stable slug — this is what every route param and
  // every other service/app references a group by.
  static async findByKey(key: string) {
    const group = await prisma.deviceTypeGroup.findFirst({ where: { key, isDeleted: false } });
    if (!group) throw new ApiError(404, 'Device type group not found');
    return group;
  }

  // Looks up the (single, active) group a device type currently belongs to.
  // Every DeviceType is expected to have one — a missing group means the
  // seed/admin data is incomplete, which is a server-side problem, not a
  // client error, hence 500 via a plain throw rather than ApiError(4xx).
  static async findByDeviceType(deviceType: DeviceType) {
    const group = await prisma.deviceTypeGroup.findFirst({
      where: { isDeleted: false, deviceTypes: { has: deviceType } },
    });
    if (!group) throw new Error(`No device type group covers ${deviceType} — check DeviceTypeGroup seed data`);
    return group;
  }

  // Resolves a set of device types (what the client actually selects — see
  // radix's skill picker) to the distinct set of group ids that cover them.
  // Picking any one device type from a multi-type group grants the whole
  // group, which is exactly the point of this indirection.
  static async resolveGroupIdsForDeviceTypes(deviceTypes: DeviceType[]): Promise<string[]> {
    if (deviceTypes.length === 0) return [];
    DeviceTypeGroupService.validateDeviceTypes(deviceTypes);

    const groups = await prisma.deviceTypeGroup.findMany({
      where: { isDeleted: false, deviceTypes: { hasSome: deviceTypes } },
      select: { id: true },
    });

    return Array.from(new Set(groups.map((g) => g.id)));
  }

  static async update({ key, ...input }: UpdateDeviceTypeGroupInput) {
    const group = await DeviceTypeGroupService.findByKey(key);

    if (input.deviceTypes !== undefined) {
      DeviceTypeGroupService.validateDeviceTypes(input.deviceTypes);
      await DeviceTypeGroupService.assertDeviceTypesAvailable(input.deviceTypes, group.id);
    }

    return prisma.deviceTypeGroup.update({
      where: { id: group.id },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.deviceTypes !== undefined && { deviceTypes: input.deviceTypes }),
      },
    });
  }

  static async remove(key: string) {
    const group = await DeviceTypeGroupService.findByKey(key);

    // Deleting a non-empty group would leave its device types uncovered by
    // any group at all, breaking the one-group-per-type invariant — the
    // admin must reassign its device types elsewhere first.
    if (group.deviceTypes.length > 0) {
      throw new ApiError(409, 'Reassign this group\'s device types to another group before deleting it');
    }

    const providerCount = await prisma.providerProfile.count({ where: { skillGroups: { some: { id: group.id } } } });
    if (providerCount > 0) {
      throw new ApiError(409, `Cannot delete: ${providerCount} provider(s) currently have this as a skill`);
    }

    return prisma.deviceTypeGroup.update({ where: { id: group.id }, data: { isDeleted: true } });
  }
}
