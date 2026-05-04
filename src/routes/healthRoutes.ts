import { Router } from 'express';
import { HealthController } from '@/controllers/HealthController';

const router = Router();

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check
 *     description: Pings the database and returns service status. Hit this on app launch to warm up the serverless function.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 statusCode:
 *                   type: number
 *                   example: 200
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: OK
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: UP
 *                     db:
 *                       type: string
 *                       example: connected
 *                     timestamp:
 *                       type: string
 *                       example: "2026-05-04T10:00:00.000Z"
 *       500:
 *         description: Database unreachable
 */
router.get('/', HealthController.ping);

export default router;
