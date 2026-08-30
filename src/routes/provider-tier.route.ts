import { Router } from 'express';
import { Role } from '@prisma/client';
import { ProviderTierController } from '@/controllers/provider-tier.controller';
import { auth } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: ProviderTier
 *   description: Admin-configurable provider tier/level management (Watchtower-native, label only for now)
 */

/**
 * @swagger
 * /provider-tiers:
 *   get:
 *     summary: List provider tiers (ADMIN)
 *     tags: [ProviderTier]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Provider tiers fetched }
 *   post:
 *     summary: Create a provider tier (ADMIN)
 *     tags: [ProviderTier]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:        { type: string }
 *               order:       { type: integer }
 *               isActive:    { type: boolean }
 *               description: { type: string }
 *               color:       { type: string }
 *     responses:
 *       201: { description: Provider tier created successfully }
 */
router.get('/', auth, authorize([Role.ADMIN]), ProviderTierController.getAll);
router.post('/', auth, authorize([Role.ADMIN]), ProviderTierController.create);

/**
 * @swagger
 * /provider-tiers/{id}:
 *   get:
 *     summary: Get a provider tier by id (ADMIN)
 *     tags: [ProviderTier]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Provider tier fetched successfully }
 *       404: { description: Provider tier not found }
 *   patch:
 *     summary: Update a provider tier (ADMIN)
 *     tags: [ProviderTier]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Provider tier updated successfully }
 *   delete:
 *     summary: Delete a provider tier (ADMIN)
 *     description: Rejected with 409 if any provider is currently assigned to this tier.
 *     tags: [ProviderTier]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Provider tier deleted successfully }
 *       409: { description: Tier is still assigned to one or more providers }
 */
router.get('/:id', auth, authorize([Role.ADMIN]), ProviderTierController.getById);
router.patch('/:id', auth, authorize([Role.ADMIN]), ProviderTierController.update);
router.delete('/:id', auth, authorize([Role.ADMIN]), ProviderTierController.remove);

export default router;
