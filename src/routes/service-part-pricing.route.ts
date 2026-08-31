import { Router } from 'express';
import { Role } from '@prisma/client';
import { ServicePartPricingController } from '@/controllers/service-part-pricing.controller';
import { auth } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: ServicePartPricing
 *   description: Per-provider-tier ("Group") pricing overrides for Strapi-mirrored service parts
 */

/**
 * @swagger
 * /service-part-pricing:
 *   get:
 *     summary: List all pricing overrides for one provider tier (ADMIN)
 *     description: Parts with no row here for this tier fall back to their own base face_value/expense/provider_cut.
 *     tags: [ServicePartPricing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: providerTierId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Part pricing fetched }
 *   put:
 *     summary: Create or update a part's pricing override for a tier (ADMIN)
 *     tags: [ServicePartPricing]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [servicePartId, providerTierId, salesPrice]
 *             properties:
 *               servicePartId:  { type: string }
 *               providerTierId: { type: string }
 *               salesPrice:     { type: number }
 *               expense:        { type: number }
 *               labour:         { type: number }
 *               maxDiscount:    { type: number }
 *     responses:
 *       200: { description: Part pricing saved }
 *   delete:
 *     summary: Reset a part's pricing override for a tier back to the base default (ADMIN)
 *     tags: [ServicePartPricing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: servicePartId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: providerTierId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Part pricing reset to default }
 */
router.get('/', auth, authorize([Role.ADMIN]), ServicePartPricingController.listByTier);
router.put('/', auth, authorize([Role.ADMIN]), ServicePartPricingController.upsert);
router.delete('/', auth, authorize([Role.ADMIN]), ServicePartPricingController.remove);

export default router;
