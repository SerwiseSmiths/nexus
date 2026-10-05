import { Router } from 'express';
import { Role } from '@prisma/client';
import { WhatsAppController } from '@/controllers/whatsapp.controller';
import { authenticate } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: WhatsApp
 *   description: >
 *     The WhatsApp number this environment sends customer nudges from — linked
 *     as a WhatsApp Web linked device, managed from watchtower's header.
 */

/**
 * @swagger
 * /whatsapp/status:
 *   get:
 *     summary: Which WhatsApp number is connected, if any (ADMIN)
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: >
 *           { connected, number, pairing, lastError } — `pairing` is set while a
 *           link is waiting for its code to be entered on the phone.
 */
router.get('/status', authenticate, authorize([Role.ADMIN]), WhatsAppController.getStatus);

/**
 * @swagger
 * /whatsapp/pair:
 *   post:
 *     summary: Start linking a WhatsApp number (ADMIN)
 *     description: >
 *       Returns an 8-character code to enter on the phone (WhatsApp → Linked
 *       devices → Link a device → Link with phone number instead) within 2
 *       minutes. The link completes in the background — poll /whatsapp/status
 *       until `connected` is true.
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               phone: { type: string, example: "919876543210" }
 *     responses:
 *       200: { description: Pairing code issued }
 *       400: { description: Invalid phone number }
 *       409: { description: Already connected, or a link is already in progress }
 *       502: { description: WhatsApp did not issue a code }
 */
router.post('/pair', authenticate, authorize([Role.ADMIN]), WhatsAppController.startPairing);

/**
 * @swagger
 * /whatsapp/logout:
 *   post:
 *     summary: Disconnect the linked WhatsApp number (ADMIN)
 *     description: Unlinks the device from the phone and forgets the session, so another number can be connected.
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Disconnected }
 *       429: { description: A message is being sent right now — retry }
 */
router.post('/logout', authenticate, authorize([Role.ADMIN]), WhatsAppController.logout);

export default router;
