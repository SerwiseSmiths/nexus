import { Response, NextFunction } from 'express';
import { NotificationType } from '@prisma/client';
import { AuthRequest } from '@/middlewares/auth.middleware';
import { NotificationService } from '@/services/notification.service';
import { ApiResponse } from '@/utils/apiResponse';
import type {
  RegisterDeviceTokenBody,
  SendNotificationBody,
} from '@/types/notification.types';

export class NotificationController {
  static async registerDeviceToken(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { token, platform } = req.body as RegisterDeviceTokenBody;
      if (!token) return ApiResponse.error(res, 400, 'token is required');
      if (!platform || !['ANDROID', 'IOS'].includes(platform.toUpperCase())) {
        return ApiResponse.error(res, 400, 'platform must be ANDROID or IOS');
      }

      const deviceToken = await NotificationService.registerDeviceToken({
        userId:   req.user!.id,
        token,
        platform: platform.toUpperCase() as 'ANDROID' | 'IOS',
      });

      return ApiResponse.success(res, 200, 'Device token registered', { deviceToken });
    } catch (error) {
      next(error);
    }
  }

  static async unregisterDeviceToken(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await NotificationService.unregisterDeviceToken(req.params.token as string, req.user!.id);
      return ApiResponse.success(res, 200, 'Device token unregistered', null);
    } catch (error) {
      next(error);
    }
  }

  static async getNotifications(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const skip  = Number(req.query.skip) || 0;

      const notifications = await NotificationService.getNotifications(req.user!.id, limit, skip);
      return ApiResponse.success(res, 200, 'Notifications fetched', { notifications });
    } catch (error) {
      next(error);
    }
  }

  static async markAsRead(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const notification = await NotificationService.markAsRead(req.params.id as string, req.user!.id);
      return ApiResponse.success(res, 200, 'Notification marked as read', { notification });
    } catch (error) {
      next(error);
    }
  }

  static async sendNotification(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { userId, title, body, type, metadata } = req.body as SendNotificationBody;
      if (!userId) return ApiResponse.error(res, 400, 'userId is required');
      if (!title)  return ApiResponse.error(res, 400, 'title is required');
      if (!body)   return ApiResponse.error(res, 400, 'body is required');

      const validTypes    = Object.values(NotificationType);
      const resolvedType  =
        type && validTypes.includes(type as NotificationType)
          ? (type as NotificationType)
          : NotificationType.GENERAL;

      const notification = await NotificationService.sendToUser({
        userId,
        title,
        body,
        type:     resolvedType,
        metadata: metadata ?? undefined,
      });

      return ApiResponse.success(res, 200, 'Notification sent', { notification });
    } catch (error) {
      next(error);
    }
  }
}
