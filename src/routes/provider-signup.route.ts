import { Router } from 'express';
import { Role } from '@prisma/client';
import { ProviderSignupController } from '@/controllers/provider-signup.controller';
import { auth } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: ProviderSignup
 *   description: '"Join Serwise" requests from would-be providers, reviewed by admins'
 */

/**
 * @swagger
 * /provider-signup:
 *   post:
 *     summary: Submit a request to join as a provider (public — serwise-website)
 *     description: >
 *       Idempotent per phone number: re-submitting while a request is still
 *       PENDING updates that request. Numbers already registered as providers
 *       get a 409.
 *     tags: [ProviderSignup]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, lastName, phoneNo, city, deviceTypes]
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               phoneNo:
 *                 type: string
 *                 example: "9876543210"
 *               city:
 *                 type: string
 *                 example: Surat
 *               deviceTypes:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [MASTER_PURIFIER, AIR_CONDITIONER, FRIDGE, WASHING_MACHINE, GEYSER]
 *               experienceYears:
 *                 type: integer
 *                 minimum: 0
 *     responses:
 *       201:
 *         description: Request received
 *       400:
 *         description: Validation error
 *       409:
 *         description: Number already registered as a provider
 */
router.post('/', ProviderSignupController.create);

/**
 * @swagger
 * /provider-signup:
 *   get:
 *     summary: List signup requests, newest first (admin)
 *     tags: [ProviderSignup]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED]
 *     responses:
 *       200:
 *         description: List of signup requests
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get('/', auth, authorize([Role.ADMIN]), ProviderSignupController.list);

/**
 * @swagger
 * /provider-signup/{id}:
 *   patch:
 *     summary: Review a signup request — change status and/or notes (admin)
 *     tags: [ProviderSignup]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [PENDING, APPROVED, REJECTED]
 *               adminNotes:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Updated
 *       404:
 *         description: Not found
 */
router.patch('/:id', auth, authorize([Role.ADMIN]), ProviderSignupController.update);

export default router;
