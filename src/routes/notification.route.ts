import { Router } from 'express';
import { Role } from '@prisma/client';
import { NotificationController } from '@/controllers/notification.controller';
import { auth } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Notification
 *   description: Push notifications and FCM device token management
 */

// ─── Device Token ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /notification/device/register:
 *   post:
 *     summary: Register an FCM device token for push notifications
 *     description: Call this on app launch after user logs in. Safe to call multiple times.
 *     tags: [Notification]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, platform]
 *             properties:
 *               token:
 *                 type: string
 *                 description: FCM registration token
 *               platform:
 *                 type: string
 *                 enum: [ANDROID, IOS]
 *     responses:
 *       200:
 *         description: Token registered
 */
router.post('/device/register', auth, NotificationController.registerDeviceToken);

/**
 * @swagger
 * /notification/device/{token}:
 *   delete:
 *     summary: Unregister an FCM device token (e.g. on logout)
 *     tags: [Notification]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: token, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Token unregistered }
 *       404: { description: Token not found }
 */
router.delete('/device/:token', auth, NotificationController.unregisterDeviceToken);

// ─── Notifications ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /notification:
 *   get:
 *     summary: Get the authenticated user's notification history
 *     tags: [Notification]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *       - { in: query, name: skip,  schema: { type: integer, default: 0 } }
 *     responses:
 *       200:
 *         description: Notifications fetched
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     notifications:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Notification' }
 */
router.get('/', auth, NotificationController.getNotifications);

/**
 * @swagger
 * /notification/{id}/read:
 *   patch:
 *     summary: Mark a notification as read
 *     tags: [Notification]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Marked as read }
 *       404: { description: Not found }
 */
router.patch('/:id/read', auth, NotificationController.markAsRead);

/**
 * @swagger
 * /notification/send:
 *   post:
 *     summary: Manually send a push notification to a user (ADMIN)
 *     tags: [Notification]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, title, body]
 *             properties:
 *               userId:   { type: string, format: uuid }
 *               title:    { type: string }
 *               body:     { type: string }
 *               type:
 *                 type: string
 *                 enum: [SERVICE, COMPLAINT, GENERAL]
 *               metadata: { type: object }
 *     responses:
 *       200: { description: Notification sent }
 */
router.post('/send', auth, authorize([Role.ADMIN]), NotificationController.sendNotification);

/**
 * @swagger
 * components:
 *   schemas:
 *     Notification:
 *       type: object
 *       properties:
 *         id:          { type: string, format: uuid }
 *         userId:      { type: string, format: uuid }
 *         complaintId: { type: string, format: uuid, nullable: true }
 *         title:       { type: string }
 *         body:        { type: string }
 *         type:        { type: string, enum: [SERVICE, COMPLAINT, GENERAL] }
 *         status:      { type: string, enum: [PENDING, SENT, FAILED] }
 *         isRead:      { type: boolean }
 *         metadata:    { type: object, nullable: true }
 *         createdAt:   { type: string, format: date-time }
 */

export default router;
