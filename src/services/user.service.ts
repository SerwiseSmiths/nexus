import prisma from '@/services/prisma.service';
import { UploadService } from '@/services/upload.service';
import { ApiError } from '@/utils/apiResponse';
import type { UpdateProfileInput, UploadAvatarInput, UpdateEmailInput } from '@/types/user.types';

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
    const user = await prisma.user.findUnique({
      where: { id: userId, isDeleted: false },
      select: {
        id: true,
        phoneNo: true,
        email: true,
        firstName: true,
        lastName: true,
        avatar: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) throw new ApiError(404, 'User not found');
    return user;
  }
}
