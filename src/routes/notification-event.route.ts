import { Router } from 'express';
import { Role } from '@prisma/client';
import { NotificationEventController } from '@/controllers/notification-event.controller';
import { auth } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: NotificationEvent
 *   description: >
 *     Push delivery / engagement tracking — whether a notification reached the
 *     device, was shown, opened, acted on, dismissed or timed out.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     NotificationEventReport:
 *       type: object
 *       required: [event, source]
 *       properties:
 *         notificationId: { type: string, format: uuid, description: 'From the push data payload' }
 *         complaintId:    { type: string, format: uuid, description: 'Used when the delivery carried no notificationId (socket path)' }
 *         event:          { type: string, enum: [DELIVERED, DISPLAYED, OPENED, DISMISSED, TIMED_OUT] }
 *         source:         { type: string, enum: [NATIVE, NOTIFEE, APP] }
 *         occurredAt:     { oneOf: [{ type: number }, { type: string, format: date-time }], description: 'Device time (epoch ms or ISO)' }
 *         meta:           { type: object, additionalProperties: true, description: 'e.g. { cta: "view" }' }
 */

/**
 * @swagger
 * /notification-events:
 *   post:
 *     summary: Report notification events from the app (session-authenticated)
 *     description: >
 *       Best-effort and idempotent — the first report of each step per push
 *       wins; unattributable events are skipped, not rejected.
 *     tags: [NotificationEvent]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [events]
 *             properties:
 *               events:
 *                 type: array
 *                 maxItems: 50
 *                 items: { $ref: '#/components/schemas/NotificationEventReport' }
 *     responses:
 *       200: { description: 'Events recorded — data: { recorded, skipped }' }
 *       400: { description: Validation error }
 */
router.post('/', auth, NotificationEventController.reportEvents);

/**
 * @swagger
 * /notification-events/token:
 *   post:
 *     summary: Report job-assignment notification events with an action token (no session)
 *     description: >
 *       Used by radix's native Android ringer / floating popup, which has no
 *       session. Authenticated by the job's assignment action token; accepted
 *       up to 24h after issue so offline-queued reports still land.
 *     tags: [NotificationEvent]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, events]
 *             properties:
 *               token: { type: string }
 *               events:
 *                 type: array
 *                 maxItems: 50
 *                 items: { $ref: '#/components/schemas/NotificationEventReport' }
 *     responses:
 *       200: { description: 'Events recorded — data: { recorded, skipped }' }
 *       401: { description: Token invalid or too old }
 */
router.post('/token', NotificationEventController.reportEventsWithToken);

/**
 * @swagger
 * /notification-events/admin/notifications:
 *   get:
 *     summary: Search notifications with their event funnel (ADMIN)
 *     tags: [NotificationEvent]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: search,      schema: { type: string }, description: 'Title/body, recipient name/phone, ticket title or id suffix' }
 *       - { in: query, name: userId,      schema: { type: string, format: uuid } }
 *       - { in: query, name: complaintId, schema: { type: string, format: uuid } }
 *       - { in: query, name: role,        schema: { type: string, enum: [CUSTOMER, PROVIDER, ADMIN] } }
 *       - { in: query, name: type,        schema: { type: string, enum: [SERVICE, COMPLAINT, GENERAL, PAYMENT, SECURITY] } }
 *       - { in: query, name: status,      schema: { type: string, enum: [PENDING, SENT, FAILED] } }
 *       - { in: query, name: outcome,     schema: { type: string, enum: [failed, no_report, delivered_not_opened, opened_no_action, accepted, rejected, dismissed, timed_out] } }
 *       - { in: query, name: trackedOnly, schema: { type: string, enum: ['true', 'false'] } }
 *       - { in: query, name: from,        schema: { type: string, format: date } }
 *       - { in: query, name: to,          schema: { type: string, format: date } }
 *       - { in: query, name: page,        schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit,       schema: { type: integer, default: 25, maximum: 100 } }
 *     responses:
 *       200: { description: '{ notifications, total, page, limit, stats }' }
 */
router.get('/admin/notifications', auth, authorize([Role.ADMIN]), NotificationEventController.listNotifications);

/**
 * @swagger
 * /notification-events/admin/events:
 *   get:
 *     summary: Search the raw notification event log (ADMIN)
 *     tags: [NotificationEvent]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: search,         schema: { type: string } }
 *       - { in: query, name: userId,         schema: { type: string, format: uuid } }
 *       - { in: query, name: complaintId,    schema: { type: string, format: uuid } }
 *       - { in: query, name: notificationId, schema: { type: string, format: uuid } }
 *       - { in: query, name: event,          schema: { type: string, enum: [DELIVERED, DISPLAYED, OPENED, ACCEPTED, REJECTED, DISMISSED, TIMED_OUT] } }
 *       - { in: query, name: source,         schema: { type: string, enum: [NATIVE, NOTIFEE, APP, SERVER] } }
 *       - { in: query, name: unlinkedOnly,   schema: { type: string, enum: ['true', 'false'] } }
 *       - { in: query, name: from,           schema: { type: string, format: date } }
 *       - { in: query, name: to,             schema: { type: string, format: date } }
 *       - { in: query, name: page,           schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit,          schema: { type: integer, default: 50, maximum: 200 } }
 *     responses:
 *       200: { description: '{ events, total, page, limit }' }
 */
router.get('/admin/events', auth, authorize([Role.ADMIN]), NotificationEventController.listEvents);

export default router;
