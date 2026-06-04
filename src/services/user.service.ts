import prisma from '@/services/prisma.service';
import { UploadService } from '@/services/upload.service';
import { ApiError } from '@/utils/apiResponse';
import { generateUniqueReferralCode } from '@/utils/referralCode';
import type { UpdateProfileInput, UploadAvatarInput, UpdateEmailInput } from '@/types/user.types';

// Fields included in every public profile response
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
} as const;

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

    return user;
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

    return user;
  }
}
