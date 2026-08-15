import { Router } from 'express';
import { Role } from '@prisma/client';
import { UserController } from '@/controllers/user.controller';
import { auth } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';

const router = Router();

/**
 * @swagger
 * /user/avatar:
 *   post:
 *     summary: Upload user avatar to Cloudinary
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [base64, mimeType]
 *             properties:
 *               base64:
 *                 type: string
 *                 description: Base64-encoded image data (without data URI prefix)
 *               mimeType:
 *                 type: string
 *                 example: image/jpeg
 *     responses:
 *       200:
 *         description: Avatar uploaded successfully
 */
router.post('/avatar', auth, UserController.uploadAvatar);

/**
 * @swagger
 * /user/profile:
 *   patch:
 *     summary: Update user profile
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, lastName]
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               avatarUrl:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *   get:
 *     summary: Get current user profile
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile fetched successfully
 */
router.patch('/profile', auth, UserController.updateProfile);
router.get('/profile', auth, UserController.getProfile);

/**
 * @swagger
 * /user/email:
 *   patch:
 *     summary: Update user email
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Email updated successfully
 */
router.patch('/email', auth, UserController.updateEmail);

/**
 * @swagger
 * /user/providers:
 *   get:
 *     summary: List active providers (ADMIN)
 *     description: Used to populate a provider picker, e.g. when reassigning a complaint.
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Filter by name or phone number
 *     responses:
 *       200: { description: Providers fetched }
 */
router.get('/providers', auth, authorize([Role.ADMIN]), UserController.listProviders);

export default router;
