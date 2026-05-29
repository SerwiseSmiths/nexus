import { Router } from 'express';
import { PartsController } from '@/controllers/parts.controller';
import { authenticate } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';
import { Role } from '@prisma/client';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Parts
 *   description: Service parts catalogue (sourced from Strapi console)
 */

/**
 * @swagger
 * /parts:
 *   get:
 *     summary: List all active service parts
 *     tags: [Parts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: deviceType
 *         schema:
 *           type: string
 *           enum: [MASTER_PURIFIER, AIR_CONDITIONER, FRIDGE, WASHING_MACHINE, GEYSER]
 *         description: Filter parts applicable to a specific device type
 *     responses:
 *       200:
 *         description: Parts list fetched successfully
 *       401:
 *         description: Unauthorized
 */
router.get('/', authenticate, authorize([Role.PROVIDER, Role.ADMIN]), PartsController.list);

/**
 * @swagger
 * /parts/{documentId}:
 *   get:
 *     summary: Get a single service part by Strapi document ID
 *     tags: [Parts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Part fetched successfully
 *       404:
 *         description: Part not found
 *       401:
 *         description: Unauthorized
 */
router.get('/:documentId', authenticate, authorize([Role.PROVIDER, Role.ADMIN]), PartsController.getById);

export default router;
