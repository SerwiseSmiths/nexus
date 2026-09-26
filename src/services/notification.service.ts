import * as admin from 'firebase-admin';
import { DeviceApp, DevicePlatform, NotificationStatus, NotificationType } from '@prisma/client';
import { initializePushFirebase } from '@/configs/firebase.admin';
import prisma from '@/services/prisma.service';
import { AppContext } from '@/types/appContext';
import { ApiError } from '@/utils/apiResponse';
import { logger } from '@/utils/logger';
import type { SendNotificationInput, RegisterDeviceTokenInput } from '@/types/notification.types';

// serwise and radix are separate Firebase projects — an FCM token is only
// ever valid for the app it was issued to, so the app is derived from the
// caller's x-app-id (set by contextMiddleware, not client-supplied body)
// rather than trusted from the request. serwise-website/watchtower aren't
// push-capable device apps and have no token.
const APP_CONTEXT_TO_DEVICE_APP: Partial<Record<AppContext, DeviceApp>> = {
  [AppContext.SERWISE_APP]: DeviceApp.SERWISE,
  [AppContext.RADIX_APP]:   DeviceApp.RADIX,
};

export class NotificationService {
  private static getMessaging(deviceApp: DeviceApp): admin.messaging.Messaging | null {
    const app = initializePushFirebase(deviceApp);
    if (!app) return null;
    return admin.messaging(app);
  }

  static deviceAppForContext(appContext?: AppContext): DeviceApp | undefined {
    return appContext ? APP_CONTEXT_TO_DEVICE_APP[appContext] : undefined;
  }

  // ─── Device Token ──────────────────────────────────────────────────────────

  // One token per user per app: registering a new token (reinstall, new
  // phone, FCM rotation) replaces whatever that user had before, so pushes
  // never fan out to stale devices. The same token moving to a different user
  // (shared phone, account switch) is rebound by the upsert. Tokens left over
  // from before app-scoping (app: null) are unusable for sends anyway, so
  // they're cleared out here as well.
  static async registerDeviceToken({ userId, token, platform, app }: RegisterDeviceTokenInput) {
    return prisma.$transaction(async (tx) => {
      await tx.deviceToken.deleteMany({
        where: {
          userId,
          token: { not: token },
          OR:    [{ app }, { app: null }],
        },
      });

      return tx.deviceToken.upsert({
        where:  { token },
        update: { userId, platform: platform as DevicePlatform, app, isActive: true },
        create: { userId, token, platform: platform as DevicePlatform, app },
      });
    });
  }

  // Called on logout — the signed-out device must stop receiving this user's
  // pushes. Scoped to the app being logged out of when known.
  static async clearDeviceTokens(userId: string, app?: DeviceApp) {
    const { count } = await prisma.deviceToken.deleteMany({
      where: { userId, ...(app && { app }) },
    });
    logger.info('[FCM] Cleared device tokens on logout', { userId, app, count });
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
    dataOnly,
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
    const allTokens = await prisma.deviceToken.findMany({
      where:  { userId, isActive: true },
      select: { token: true, app: true },
    });

    // Tokens registered before the `app` field existed can't be attributed to
    // a Firebase project — sending to them would just fail with
    // `messaging/mismatched-credential` against whichever project we guessed.
    // The client re-registers on its own on next launch (NotificationService.init),
    // so these self-heal rather than needing a backfill.
    const legacyCount = allTokens.filter(t => !t.app).length;
    if (legacyCount > 0) {
      logger.warn('[FCM] Skipping tokens registered before app-scoping — they will self-heal on next app launch', {
        userId, notificationId: notification.id, legacyCount,
      });
    }

    const tokensByApp = new Map<DeviceApp, string[]>();
    for (const t of allTokens) {
      if (!t.app) continue;
      const list = tokensByApp.get(t.app) ?? [];
      list.push(t.token);
      tokensByApp.set(t.app, list);
    }

    if (tokensByApp.size === 0) {
      logger.warn('[FCM] No active, app-scoped device tokens — skipping push', { userId, notificationId: notification.id });
      await prisma.notification.update({
        where: { id: notification.id },
        data:  { status: NotificationStatus.FAILED },
      });
      return notification;
    }

    const fcmData: Record<string, string> = {
      notificationId: notification.id,
      type:           type ?? NotificationType.SERVICE,
      ...(dataOnly && { title, body }),
      ...(complaintId && { complaintId }),
      ...(metadata &&
        Object.fromEntries(
          Object.entries(metadata).map(([k, v]) => [k, String(v)]),
        )),
    };

    let totalSuccess = 0;

    for (const [deviceApp, tokens] of tokensByApp) {
      const messaging = this.getMessaging(deviceApp);
      if (!messaging) {
        logger.warn('[FCM] Firebase not initialized for app — skipping push', {
          userId, notificationId: notification.id, deviceApp,
        });
        continue;
      }

      try {
        logger.info('[FCM] Sending push', {
          userId,
          notificationId: notification.id,
          deviceApp,
          tokenCount:     tokens.length,
          dataOnly:       !!dataOnly,
          type:           type ?? NotificationType.SERVICE,
        });

        const response = await messaging.sendEachForMulticast({
          tokens,
          ...(!dataOnly && { notification: { title, body } }),
          data:         fcmData,
          android:      { priority: 'high' },
          apns:         { payload: { aps: { contentAvailable: true } } },
        });

        totalSuccess += response.successCount;

        // Deactivate stale tokens
        response.responses.forEach((r, i) => {
          const invalidCodes = [
            'messaging/invalid-registration-token',
            'messaging/registration-token-not-registered',
          ];
          if (!r.success && r.error?.code) {
            logger.warn('[FCM] Token delivery failed', {
              notificationId: notification.id,
              deviceApp,
              token:          tokens[i],
              errorCode:      r.error.code,
            });
            if (invalidCodes.includes(r.error.code)) {
              prisma.deviceToken
                .update({ where: { token: tokens[i] }, data: { isActive: false } })
                .catch(() => {});
            }
          }
        });

        logger.info('[FCM] Push result', {
          notificationId: notification.id,
          deviceApp,
          successCount:   response.successCount,
          failureCount:   response.failureCount,
        });
      } catch (err) {
        logger.error('[FCM] sendEachForMulticast error:', { userId, notificationId: notification.id, deviceApp, err });
      }
    }

    await prisma.notification.update({
      where: { id: notification.id },
      data:  { status: totalSuccess > 0 ? NotificationStatus.SENT : NotificationStatus.FAILED },
    });

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
