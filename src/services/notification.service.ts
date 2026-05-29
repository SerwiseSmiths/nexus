import * as admin from 'firebase-admin';
import { DevicePlatform, NotificationStatus, NotificationType } from '@prisma/client';
import { initializeFirebase } from '@/configs/firebase.admin';
import prisma from '@/services/prisma.service';
import { ApiError } from '@/utils/apiResponse';
import { logger } from '@/utils/logger';
import type { SendNotificationInput, RegisterDeviceTokenInput } from '@/types/notification.types';

export class NotificationService {
  private static getMessaging(): admin.messaging.Messaging | null {
    const app = initializeFirebase();
    if (!app) return null;
    return admin.messaging(app);
  }

  // ─── Device Token ──────────────────────────────────────────────────────────

  static async registerDeviceToken({ userId, token, platform }: RegisterDeviceTokenInput) {
    const existing = await prisma.deviceToken.findUnique({ where: { token } });

    // Token belongs to a different user — deactivate old binding
    if (existing && existing.userId !== userId) {
      await prisma.deviceToken.update({ where: { token }, data: { isActive: false } });
    }

    return prisma.deviceToken.upsert({
      where:  { token },
      update: { userId, platform: platform as DevicePlatform, isActive: true },
      create: { userId, token, platform: platform as DevicePlatform },
    });
  }

  static async unregisterDeviceToken(token: string, userId: string) {
    const existing = await prisma.deviceToken.findFirst({ where: { token, userId } });
    if (!existing) throw new ApiError(404, 'Device token not found');

    return prisma.deviceToken.update({
      where: { token },
      data:  { isActive: false },
    });
  }

  // ─── Send ──────────────────────────────────────────────────────────────────

  static async sendToUser({
    userId,
    title,
    body,
    type,
    complaintId,
    metadata,
  }: SendNotificationInput) {
    // Persist notification record first
    const notification = await prisma.notification.create({
      data: {
        userId,
        complaintId: complaintId ?? null,
        title,
        body,
        type:     type ?? NotificationType.SERVICE,
        status:   NotificationStatus.PENDING,
        metadata: (metadata as object) ?? null,
      },
    });

    // Fetch active FCM tokens
    const tokens = await prisma.deviceToken.findMany({
      where:  { userId, isActive: true },
      select: { token: true },
    });

    if (tokens.length === 0) {
      await prisma.notification.update({
        where: { id: notification.id },
        data:  { status: NotificationStatus.FAILED },
      });
      return notification;
    }

    const messaging = this.getMessaging();
    if (!messaging) {
      logger.warn('[FCM] Firebase not initialized — skipping push');
      return notification;
    }

    try {
      const fcmData: Record<string, string> = {
        notificationId: notification.id,
        type:           type ?? NotificationType.SERVICE,
        ...(complaintId && { complaintId }),
        ...(metadata &&
          Object.fromEntries(
            Object.entries(metadata).map(([k, v]) => [k, String(v)]),
          )),
      };

      const response = await messaging.sendEachForMulticast({
        tokens:       tokens.map(t => t.token),
        notification: { title, body },
        data:         fcmData,
        android:      { priority: 'high' },
        apns:         { payload: { aps: { contentAvailable: true } } },
      });

      // Deactivate stale tokens
      response.responses.forEach((r, i) => {
        const invalidCodes = [
          'messaging/invalid-registration-token',
          'messaging/registration-token-not-registered',
        ];
        if (!r.success && r.error?.code && invalidCodes.includes(r.error.code)) {
          prisma.deviceToken
            .update({ where: { token: tokens[i].token }, data: { isActive: false } })
            .catch(() => {});
        }
      });

      const allFailed = response.failureCount === tokens.length;
      await prisma.notification.update({
        where: { id: notification.id },
        data:  { status: allFailed ? NotificationStatus.FAILED : NotificationStatus.SENT },
      });
    } catch (err) {
      logger.error('[FCM] sendEachForMulticast error:', err);
      await prisma.notification.update({
        where: { id: notification.id },
        data:  { status: NotificationStatus.FAILED },
      });
    }

    return notification;
  }

  // ─── Query ─────────────────────────────────────────────────────────────────

  static async getNotifications(userId: string, limit: number, skip: number) {
    return prisma.notification.findMany({
      where:   { userId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      take:    limit,
      skip,
    });
  }

  static async markAsRead(notificationId: string, userId: string) {
    const notification = await prisma.notification.findFirst({
      where: { id: notificationId, userId, isDeleted: false },
    });
    if (!notification) throw new ApiError(404, 'Notification not found');

    return prisma.notification.update({
      where: { id: notificationId },
      data:  { isRead: true },
    });
  }
}
