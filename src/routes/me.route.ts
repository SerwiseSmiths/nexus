import { Router } from 'express';
import { UserController } from '@/controllers/user.controller';
import { AddressController } from '@/controllers/address.controller';
import { SubscriptionController } from '@/controllers/subscription.controller';
import { WalletController } from '@/controllers/wallet.controller';
import { auth } from '@/middlewares/auth.middleware';

const router = Router();

// ─── Self (full user + optional relations) ───────────────────────────────────

/**
 * @swagger
 * /me/self:
 *   get:
 *     summary: Get own data with optional relation flags
 *     tags: [Me]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: address
 *         schema:
 *           type: boolean
 *         description: Include saved addresses
 *     responses:
 *       200:
 *         description: User fetched successfully
 */
router.get('/self', auth, UserController.getSelf);

// ─── Profile ─────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /me/profile:
 *   get:
 *     summary: Get own profile
 *     tags: [Me]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile fetched successfully
 *   patch:
 *     summary: Update own profile (name + avatar)
 *     tags: [Me]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *                 nullable: true
 *               lastName:
 *                 type: string
 *                 nullable: true
 *               avatarUrl:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 */
router.get('/profile', auth, UserController.getProfile);
router.patch('/profile', auth, UserController.updateProfile);

/**
 * @swagger
 * /me/email:
 *   patch:
 *     summary: Update own email
 *     tags: [Me]
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
 * /me/avatar:
 *   post:
 *     summary: Upload own avatar
 *     tags: [Me]
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
 *               mimeType:
 *                 type: string
 *                 example: image/jpeg
 *     responses:
 *       200:
 *         description: Avatar uploaded successfully
 */
router.post('/avatar', auth, UserController.uploadAvatar);

// ─── Addresses ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /me/addresses:
 *   get:
 *     summary: Get own addresses
 *     tags: [Me]
 *     security:
 *       - bearerAuth: []
 *   post:
 *     summary: Create address
 *     tags: [Me]
 *     security:
 *       - bearerAuth: []
 */
/**
 * @swagger
 * /me/active-plan:
 *   get:
 *     summary: Get the active subscription plan summary for the hero grid
 *     tags: [Me]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active plan summary (hasActivePlan, planName, nextDate)
 */
router.get('/active-plan', auth, SubscriptionController.activePlanSummary);

router.get('/addresses', auth, AddressController.getAll);
router.post('/addresses', auth, AddressController.create);
router.get('/addresses/:id', auth, AddressController.getOne);
router.put('/addresses/:id', auth, AddressController.update);
router.delete('/addresses/:id', auth, AddressController.remove);

// ─── Wallet ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /me/wallet:
 *   get:
 *     summary: Get the current user's wallet
 *     tags: [Me]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet fetched successfully
 */
router.get('/wallet', auth, WalletController.getMyWallet);

/**
 * @swagger
 * /me/wallet/transactions:
 *   get:
 *     summary: Get paginated wallet transaction history for the current user
 *     tags: [Me]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Wallet transactions fetched successfully
 */
router.get('/wallet/transactions', auth, WalletController.getHistory);

export default router;
