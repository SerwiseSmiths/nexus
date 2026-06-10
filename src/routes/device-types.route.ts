import { Router } from 'express';
import { DeviceTypesController } from '@/controllers/device-types.controller';
import { authenticate } from '@/middlewares/auth.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: DeviceTypes
 *   description: Device type catalogue (sourced from Strapi console)
 */

/**
 * @swagger
 * /device-types:
 *   get:
 *     summary: List all device types with icons
 *     tags: [DeviceTypes]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Device types fetched successfully
 *       401:
 *         description: Unauthorized
 */
router.get('/', authenticate, DeviceTypesController.list);

export default router;
