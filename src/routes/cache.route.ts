import { Router } from 'express';
import { Role } from '@prisma/client';
import { CacheController } from '@/controllers/cache.controller';
import { authenticate } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Cache
 *   description: Invalidation for the in-memory cache in front of watchtower CMS reads
 */

/**
 * @swagger
 * /cache/invalidate:
 *   post:
 *     summary: Invalidate cached CMS content by tag (ADMIN only — called by watchtower on write)
 *     tags: [Cache]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tags]
 *             properties:
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["api::device-type.device-type"]
 *     responses:
 *       200:
 *         description: Cache invalidated
 *       400:
 *         description: Invalid or unknown tag(s)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — ADMIN role required
 */
router.post('/invalidate', authenticate, authorize([Role.ADMIN]), CacheController.invalidate);

export default router;
