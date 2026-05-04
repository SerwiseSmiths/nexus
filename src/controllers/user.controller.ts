import { Response, NextFunction } from 'express';
import { AuthRequest } from '@/middlewares/auth.middleware';
import { UserService } from '@/services/user.service';
import { ApiResponse } from '@/utils/apiResponse';
import type { UploadAvatarBody, UpdateProfileBody } from '@/types/user.types';

interface UpdateEmailBody { email: string; }

export class UserController {
  static async uploadAvatar(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { base64, mimeType } = req.body as UploadAvatarBody;
      if (!base64 || !mimeType) {
        return ApiResponse.error(res, 400, 'base64 and mimeType are required');
      }

      const avatarUrl = await UserService.uploadAvatar({
        base64,
        mimeType,
        userId: req.user!.id,
      });

      return ApiResponse.success(res, 200, 'Avatar uploaded successfully', { avatarUrl });
    } catch (error) {
      next(error);
    }
  }

  static async updateProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { firstName, lastName, avatarUrl } = req.body as UpdateProfileBody;

      const user = await UserService.updateProfile({
        userId: req.user!.id,
        firstName,
        lastName,
        avatarUrl,
      });

      return ApiResponse.success(res, 200, 'Profile updated successfully', { user });
    } catch (error) {
      next(error);
    }
  }

  static async updateEmail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { email } = req.body as UpdateEmailBody;
      const user = await UserService.updateEmail({ userId: req.user!.id, email });
      return ApiResponse.success(res, 200, 'Email updated successfully', { user });
    } catch (error) {
      next(error);
    }
  }

  static async getProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await UserService.getProfile(req.user!.id);
      return ApiResponse.success(res, 200, 'Profile fetched successfully', { user });
    } catch (error) {
      next(error);
    }
  }
}
