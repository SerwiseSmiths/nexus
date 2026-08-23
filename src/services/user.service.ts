import { ComplaintStage, DeviceType, Prisma, Role } from '@prisma/client';
import prisma from '@/services/prisma.service';
import { UploadService } from '@/services/upload.service';
import { AddressService } from '@/services/address.service';
import { ApiError } from '@/utils/apiResponse';
import { generateUniqueReferralCode } from '@/utils/referralCode';
import type {
  UpdateProfileInput,
  UploadAvatarInput,
  UpdateEmailInput,
  UpdateSkillsInput,
  CreateProviderInput,
  UpdateProviderInput,
  ProviderAddressInput,
  UpdateCustomerInput,
} from '@/types/user.types';

// A non-terminal complaint still assigned past this many hours counts as "overdue"
// for a provider — there's no per-job SLA field today, so this fixed window is a
// pragmatic stand-in rather than a configured business rule.
const OVERDUE_THRESHOLD_HOURS = 24;

const PROVIDER_ADDRESS_SELECT = {
  houseNo:        true,
  addressLineOne: true,
  addressLineTwo: true,
  area:           true,
  city:           true,
  state:          true,
  pinCode:        true,
  country:        true,
  latitude:       true,
  longitude:      true,
} satisfies Prisma.AddressSelect;

// Fields included in every public profile response — skills live on the
// ProviderProfile relation, but the API keeps exposing them flat on the user
// object (see flattenProfile) so callers never need to know about the split.
const PROFILE_SELECT = {
  id:           true,
  phoneNo:      true,
  email:        true,
  firstName:    true,
  lastName:     true,
  avatar:       true,
  role:         true,
  isActive:     true,
  referralCode: true,
  createdAt:    true,
  updatedAt:    true,
  providerProfile: { select: { skills: true } },
} satisfies Prisma.UserSelect;

type ProfileRow = Prisma.UserGetPayload<{ select: typeof PROFILE_SELECT }>;

function flattenProfile(user: ProfileRow) {
  const { providerProfile, ...rest } = user;
  return { ...rest, skills: providerProfile?.skills ?? [] };
}

const PROVIDER_DETAIL_SELECT = {
  id:        true,
  phoneNo:   true,
  email:     true,
  firstName: true,
  lastName:  true,
  avatar:    true,
  role:      true,
  isActive:  true,
  createdAt: true,
  updatedAt: true,
  providerProfile: {
    select: {
      skills:         true,
      currentAddress: { select: PROVIDER_ADDRESS_SELECT },
      aadharAddress:  { select: PROVIDER_ADDRESS_SELECT },
      adminNotes:     true,
    },
  },
} satisfies Prisma.UserSelect;

type ProviderDetailRow = Prisma.UserGetPayload<{ select: typeof PROVIDER_DETAIL_SELECT }>;

// Reshapes the DB row (skills/addresses/notes nested under providerProfile) back
// into the flat shape the API has always returned — the relation split is purely
// internal, callers (watchtower, radix) never see it.
function flattenProviderDetail(user: ProviderDetailRow) {
  const { providerProfile, ...rest } = user;
  return {
    ...rest,
    skills:         providerProfile?.skills ?? [],
    currentAddress: providerProfile?.currentAddress ?? null,
    aadharAddress:  providerProfile?.aadharAddress ?? null,
    adminNotes:     providerProfile?.adminNotes ?? null,
  };
}

const EMPTY_STATS = { complaintSuccess: 0, overdue: 0, walletBalance: 0 };

/** Ensures the user has a referral code, generating one if missing (lazy backfill). */
async function ensureReferralCode(userId: string): Promise<string> {
  const code = await generateUniqueReferralCode();
  await prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
  return code;
}

export class UserService {
  static async uploadAvatar({ base64, mimeType, userId }: UploadAvatarInput): Promise<string> {
    if (!base64 || !mimeType) {
      throw new ApiError(400, 'base64 and mimeType are required');
    }

    const user = await prisma.user.findUnique({ where: { id: userId, isDeleted: false } });
    if (!user) throw new ApiError(404, 'User not found');

    const avatarUrl = await UploadService.uploadAvatar(base64, mimeType, userId);
    return avatarUrl;
  }

  static async updateProfile({ userId, firstName, lastName, avatarUrl }: UpdateProfileInput) {
    const user = await prisma.user.update({
      where: { id: userId, isDeleted: false },
      data: {
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        ...(avatarUrl && { avatar: avatarUrl }),
      },
    });

    return user;
  }

  static async updateEmail({ userId, email }: UpdateEmailInput) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      throw new ApiError(400, 'Valid email is required');
    }

    const existing = await prisma.user.findFirst({ where: { email, isDeleted: false } });
    if (existing && existing.id !== userId) {
      throw new ApiError(409, 'Email already in use');
    }

    const user = await prisma.user.update({
      where: { id: userId, isDeleted: false },
      data: { email: email.trim().toLowerCase() },
    });

    return user;
  }

  static async getProfile(userId: string) {
    let user = await prisma.user.findUnique({
      where:  { id: userId, isDeleted: false },
      select: PROFILE_SELECT,
    });

    if (!user) throw new ApiError(404, 'User not found');

    if (!user.referralCode) {
      const code = await ensureReferralCode(userId);
      user = { ...user, referralCode: code };
    }

    return flattenProfile(user);
  }

  static async getSelf(userId: string, flags: { address?: boolean }) {
    let user = await prisma.user.findUnique({
      where:  { id: userId, isDeleted: false },
      select: {
        ...PROFILE_SELECT,
        ...(flags.address && {
          addresses: {
            where:   { isDeleted: false },
            orderBy: { createdAt: 'desc' as const },
          },
        }),
      },
    });

    if (!user) throw new ApiError(404, 'User not found');

    if (!user.referralCode) {
      const code = await ensureReferralCode(userId);
      user = { ...user, referralCode: code };
    }

    return flattenProfile(user);
  }

  static async listProviders(search?: string, deviceType?: DeviceType) {
    const providers = await prisma.user.findMany({
      where: {
        role: Role.PROVIDER,
        isDeleted: false,
        isActive: true,
        ...(deviceType && { providerProfile: { skills: { has: deviceType } } }),
        ...(search && {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { phoneNo: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      select: {
        id: true, firstName: true, lastName: true, phoneNo: true, email: true, avatar: true,
        providerProfile: { select: { skills: true } },
      },
      orderBy: { firstName: 'asc' },
    });

    return providers.map(({ providerProfile, ...provider }) => ({
      ...provider,
      skills: providerProfile?.skills ?? [],
    }));
  }

  // Providers self-edit their own skills; admins may edit any provider's skills
  // via the same method (see UserController.updateSkills / updateProviderSkills).
  static async updateSkills({ userId, skills }: UpdateSkillsInput) {
    const unique = Array.from(new Set(skills));
    const invalid = unique.filter(s => !Object.values(DeviceType).includes(s));
    if (invalid.length > 0) {
      throw new ApiError(400, `Invalid device type(s): ${invalid.join(', ')}`);
    }

    const user = await prisma.user.findFirst({ where: { id: userId, isDeleted: false } });
    if (!user) throw new ApiError(404, 'User not found');
    if (user.role !== Role.PROVIDER) throw new ApiError(400, 'Only providers can have skills');

    await prisma.providerProfile.upsert({
      where:  { userId },
      update: { skills: unique },
      create: { userId, skills: unique },
    });

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: PROFILE_SELECT });
    return flattenProfile(updated);
  }

  // ─── Provider management (admin) ───────────────────────────────────────────

  private static async computeProviderStats(providerId: string) {
    const overdueSince = new Date(Date.now() - OVERDUE_THRESHOLD_HOURS * 60 * 60 * 1000);

    const [complaintSuccess, overdue, wallet] = await Promise.all([
      prisma.complaint.count({
        where: { providerId, stage: ComplaintStage.COMPLETED, isDeleted: false },
      }),
      prisma.complaint.count({
        where: {
          providerId,
          isDeleted: false,
          stage:     { notIn: [ComplaintStage.COMPLETED, ComplaintStage.REJECTED] },
          createdAt: { lt: overdueSince },
        },
      }),
      prisma.wallet.findUnique({ where: { userId: providerId } }),
    ]);

    return { complaintSuccess, overdue, walletBalance: wallet?.balance ?? 0 };
  }

  static async listProvidersWithStats(search?: string) {
    const providers = await prisma.user.findMany({
      where: {
        role: Role.PROVIDER,
        isDeleted: false,
        ...(search && {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { phoneNo: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      select: PROVIDER_DETAIL_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      providers.map(async (provider) => ({
        ...flattenProviderDetail(provider),
        stats: await UserService.computeProviderStats(provider.id),
      })),
    );
  }

  static async getProviderById(providerId: string) {
    const provider = await prisma.user.findFirst({
      where:  { id: providerId, role: Role.PROVIDER, isDeleted: false },
      select: PROVIDER_DETAIL_SELECT,
    });
    if (!provider) throw new ApiError(404, 'Provider not found');

    const stats = await UserService.computeProviderStats(provider.id);
    return { ...flattenProviderDetail(provider), stats };
  }

  private static async resolveProviderImage(
    providerId: string,
    imageBase64?: string,
    imageMimeType?: string,
  ): Promise<string | undefined> {
    if (!imageBase64 || !imageMimeType) return undefined;
    return UploadService.uploadProviderImage(imageBase64, imageMimeType, providerId);
  }

  private static hasAddressContent(address?: ProviderAddressInput): boolean {
    if (!address) return false;
    return Object.values(address).some(v => v !== undefined && v !== null && v !== '');
  }

  private static addressWriteData(address: ProviderAddressInput, providerId: string) {
    return {
      userId:         providerId,
      houseNo:        address.houseNo ?? '',
      societyName:    '',
      addressLineOne: address.addressLineOne,
      addressLineTwo: address.addressLineTwo,
      area:           address.area,
      city:           address.city,
      state:          address.state,
      pinCode:        address.pinCode,
      country:        address.country ?? 'India',
      latitude:       address.latitude,
      longitude:      address.longitude,
    };
  }

  /** Creates or updates the Address row backing a provider's current/Aadhar address
   *  slot — reuses the existing Address table rather than an embedded blob, so a
   *  second save on the same provider updates the same row instead of piling up new ones. */
  private static async upsertProviderAddress(
    existingAddressId: string | null | undefined,
    address: ProviderAddressInput | undefined,
    providerId: string,
  ): Promise<string | null> {
    if (!UserService.hasAddressContent(address)) return existingAddressId ?? null;

    const data = UserService.addressWriteData(address!, providerId);
    if (existingAddressId) {
      await prisma.address.update({ where: { id: existingAddressId }, data });
      return existingAddressId;
    }

    const created = await prisma.address.create({ data });
    return created.id;
  }

  static async createProvider({
    firstName,
    lastName,
    phoneNo,
    email,
    skills,
    currentAddress,
    aadharAddress,
    adminNotes,
    imageBase64,
    imageMimeType,
  }: CreateProviderInput) {
    if (!firstName?.trim() || !lastName?.trim()) {
      throw new ApiError(400, 'First and last name are required');
    }
    if (!phoneNo?.trim()) {
      throw new ApiError(400, 'Phone number is required');
    }

    const existing = await prisma.user.findFirst({ where: { phoneNo, isDeleted: false } });
    if (existing) throw new ApiError(409, 'A user with this phone number already exists');

    if (email) {
      const existingEmail = await prisma.user.findFirst({ where: { email, isDeleted: false } });
      if (existingEmail) throw new ApiError(409, 'Email already in use');
    }

    const provider = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          firstName: firstName.trim(),
          lastName:  lastName.trim(),
          phoneNo:   phoneNo.trim(),
          email:     email?.trim().toLowerCase() || null,
          role:      Role.PROVIDER,
          isActive:  true,
        },
      });

      const currentAddressId = UserService.hasAddressContent(currentAddress)
        ? (await tx.address.create({ data: UserService.addressWriteData(currentAddress!, created.id) })).id
        : null;
      const aadharAddressId = UserService.hasAddressContent(aadharAddress)
        ? (await tx.address.create({ data: UserService.addressWriteData(aadharAddress!, created.id) })).id
        : null;

      await tx.providerProfile.create({
        data: {
          userId: created.id,
          skills: skills ?? [],
          adminNotes: adminNotes ?? null,
          currentAddressId,
          aadharAddressId,
        },
      });

      return tx.user.findUniqueOrThrow({ where: { id: created.id }, select: PROVIDER_DETAIL_SELECT });
    });

    const avatarUrl = await UserService.resolveProviderImage(provider.id, imageBase64, imageMimeType);
    if (!avatarUrl) return { ...flattenProviderDetail(provider), stats: EMPTY_STATS };

    const updated = await prisma.user.update({
      where: { id: provider.id },
      data:  { avatar: avatarUrl },
      select: PROVIDER_DETAIL_SELECT,
    });
    return { ...flattenProviderDetail(updated), stats: EMPTY_STATS };
  }

  static async updateProvider({
    providerId,
    firstName,
    lastName,
    phoneNo,
    email,
    skills,
    currentAddress,
    aadharAddress,
    adminNotes,
    isActive,
    imageBase64,
    imageMimeType,
  }: UpdateProviderInput) {
    const provider = await prisma.user.findFirst({
      where:   { id: providerId, role: Role.PROVIDER, isDeleted: false },
      include: { providerProfile: true },
    });
    if (!provider) throw new ApiError(404, 'Provider not found');

    if (phoneNo && phoneNo !== provider.phoneNo) {
      const existing = await prisma.user.findFirst({ where: { phoneNo, isDeleted: false } });
      if (existing) throw new ApiError(409, 'A user with this phone number already exists');
    }
    if (email && email !== provider.email) {
      const existingEmail = await prisma.user.findFirst({ where: { email, isDeleted: false } });
      if (existingEmail) throw new ApiError(409, 'Email already in use');
    }

    const avatarUrl = await UserService.resolveProviderImage(providerId, imageBase64, imageMimeType);

    const currentAddressId = currentAddress !== undefined
      ? await UserService.upsertProviderAddress(provider.providerProfile?.currentAddressId, currentAddress, providerId)
      : undefined;
    const aadharAddressId = aadharAddress !== undefined
      ? await UserService.upsertProviderAddress(provider.providerProfile?.aadharAddressId, aadharAddress, providerId)
      : undefined;

    if (skills !== undefined || currentAddressId !== undefined || aadharAddressId !== undefined || adminNotes !== undefined) {
      await prisma.providerProfile.upsert({
        where: { userId: providerId },
        update: {
          ...(skills !== undefined && { skills }),
          ...(currentAddressId !== undefined && { currentAddressId }),
          ...(aadharAddressId !== undefined && { aadharAddressId }),
          ...(adminNotes !== undefined && { adminNotes }),
        },
        create: {
          userId: providerId,
          skills: skills ?? [],
          currentAddressId: currentAddressId ?? null,
          aadharAddressId:  aadharAddressId ?? null,
          adminNotes: adminNotes ?? null,
        },
      });
    }

    const updated = await prisma.user.update({
      where: { id: providerId },
      data: {
        ...(firstName !== undefined && { firstName: firstName.trim() }),
        ...(lastName !== undefined && { lastName: lastName.trim() }),
        ...(phoneNo !== undefined && { phoneNo: phoneNo.trim() }),
        ...(email !== undefined && { email: email.trim().toLowerCase() || null }),
        ...(isActive !== undefined && { isActive }),
        ...(avatarUrl && { avatar: avatarUrl }),
      },
      select: PROVIDER_DETAIL_SELECT,
    });

    const stats = await UserService.computeProviderStats(providerId);
    return { ...flattenProviderDetail(updated), stats };
  }

  // ─── Customer management (admin) ───────────────────────────────────────────

  private static async getCustomerWalletBalance(customerId: string): Promise<number> {
    const wallet = await prisma.wallet.findUnique({ where: { userId: customerId } });
    return wallet?.balance ?? 0;
  }

  static async listCustomersWithStats(search?: string) {
    const customers = await prisma.user.findMany({
      where: {
        role: Role.CUSTOMER,
        isDeleted: false,
        ...(search && {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { phoneNo: { contains: search, mode: 'insensitive' } },
            { addresses: { some: { pinCode: { contains: search, mode: 'insensitive' } } } },
          ],
        }),
      },
      select: {
        id: true, phoneNo: true, email: true, firstName: true, lastName: true, avatar: true, createdAt: true,
        // First address added is treated as "primary" for the table's pin code/location
        // columns — customers aren't asked to designate one explicitly today.
        addresses: {
          where:   { isDeleted: false },
          orderBy: { createdAt: 'asc' },
          take:    1,
          select:  { pinCode: true, city: true, state: true, country: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      customers.map(async ({ addresses, ...customer }) => {
        const primary = addresses[0];
        return {
          ...customer,
          pinCode:  primary?.pinCode ?? null,
          location: primary ? [primary.city, primary.state, primary.country].filter(Boolean).join(', ') || null : null,
          walletBalance: await UserService.getCustomerWalletBalance(customer.id),
        };
      }),
    );
  }

  static async getCustomerById(customerId: string) {
    const customer = await prisma.user.findFirst({
      where:  { id: customerId, role: Role.CUSTOMER, isDeleted: false },
      select: {
        id: true, phoneNo: true, email: true, firstName: true, lastName: true, avatar: true, createdAt: true, updatedAt: true,
      },
    });
    if (!customer) throw new ApiError(404, 'Customer not found');

    const [addresses, walletBalance] = await Promise.all([
      AddressService.getAllByUserIncludingArchived(customerId),
      UserService.getCustomerWalletBalance(customerId),
    ]);

    return { ...customer, addresses, walletBalance };
  }

  static async updateCustomer({ customerId, firstName, lastName, phoneNo, email }: UpdateCustomerInput) {
    const customer = await prisma.user.findFirst({
      where: { id: customerId, role: Role.CUSTOMER, isDeleted: false },
    });
    if (!customer) throw new ApiError(404, 'Customer not found');

    if (phoneNo && phoneNo !== customer.phoneNo) {
      const existing = await prisma.user.findFirst({ where: { phoneNo, isDeleted: false } });
      if (existing) throw new ApiError(409, 'A user with this phone number already exists');
    }
    if (email && email !== customer.email) {
      const existingEmail = await prisma.user.findFirst({ where: { email, isDeleted: false } });
      if (existingEmail) throw new ApiError(409, 'Email already in use');
    }

    return prisma.user.update({
      where: { id: customerId },
      data: {
        ...(firstName !== undefined && { firstName: firstName.trim() }),
        ...(lastName !== undefined && { lastName: lastName.trim() }),
        ...(phoneNo !== undefined && { phoneNo: phoneNo.trim() }),
        ...(email !== undefined && { email: email.trim().toLowerCase() || null }),
      },
      select: {
        id: true, phoneNo: true, email: true, firstName: true, lastName: true, avatar: true, createdAt: true, updatedAt: true,
      },
    });
  }
}
