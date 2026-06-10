import { Router } from 'express';
import { SubscriptionController } from '@/controllers/subscription.controller';
import { authenticate } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';
import { Role } from '@prisma/client';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Subscription
 *   description: Subscription plans and management
 */

/**
 * @swagger
 * /subscription/plans:
 *   get:
 *     summary: List all available subscription plans from CMS
 *     tags: [Subscription]
 *     responses:
 *       200:
 *         description: Plans list
 */
router.get('/plans', SubscriptionController.listPlans);

/**
 * @swagger
 * /subscription/addons:
 *   get:
 *     summary: List available subscription addons from CMS
 *     tags: [Subscription]
 *     parameters:
 *       - in: query
 *         name: deviceType
 *         schema:
 *           type: string
 *         description: Filter addons compatible with this device type key
 *     responses:
 *       200:
 *         description: Addons list
 */
router.get('/addons', SubscriptionController.listAddons);

/**
 * @swagger
 * /subscription:
 *   post:
 *     summary: Purchase a subscription for a device type (covers all devices of that type)
 *     tags: [Subscription]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - deviceTypeKey
 *               - planKey
 *               - billingCycle
 *               - startDate
 *             properties:
 *               deviceTypeKey:
 *                 type: string
 *                 example: master_purifier
 *               planKey:
 *                 type: string
 *                 example: LITE
 *               billingCycle:
 *                 type: string
 *                 enum: [ANNUAL, MONTHLY]
 *               addons:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     key:   { type: string }
 *                     name:  { type: string }
 *                     price: { type: number }
 *               startDate:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Subscription purchased
 *       409:
 *         description: Active subscription already exists for this device type
 */
router.post('/', authenticate, authorize([Role.CUSTOMER]), SubscriptionController.purchase);

/**
 * @swagger
 * /subscription/my:
 *   get:
 *     summary: List authenticated user's subscriptions
 *     tags: [Subscription]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Subscriptions list
 */
router.get('/my', authenticate, authorize([Role.CUSTOMER]), SubscriptionController.mySubscriptions);

/**
 * @swagger
 * /subscription/active-plan:
 *   get:
 *     summary: Get active plan summary for hero grid display
 *     tags: [Subscription]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active plan summary
 */
router.get('/active-plan', authenticate, SubscriptionController.activePlanSummary);

/**
 * @swagger
 * /subscription/device-type/{deviceTypeKey}:
 *   get:
 *     summary: Get active subscription for a device type (e.g. master_purifier)
 *     tags: [Subscription]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceTypeKey
 *         required: true
 *         schema:
 *           type: string
 *         example: master_purifier
 *     responses:
 *       200:
 *         description: Active subscription or null
 */
router.get('/device-type/:deviceTypeKey', authenticate, SubscriptionController.getActiveByDeviceType);

/**
 * @swagger
 * /subscription/{id}:
 *   get:
 *     summary: Get subscription by ID
 *     tags: [Subscription]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Subscription details
 *       404:
 *         description: Not found
 */
router.get('/:id', authenticate, SubscriptionController.getById);

/**
 * @swagger
 * /subscription/{id}/cancel:
 *   patch:
 *     summary: Cancel a subscription
 *     tags: [Subscription]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Subscription cancelled
 */
router.patch('/:id/cancel', authenticate, authorize([Role.CUSTOMER]), SubscriptionController.cancel);

export default router;
