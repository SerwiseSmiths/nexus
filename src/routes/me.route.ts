import { Router } from 'express';
import { UserController } from '@/controllers/user.controller';
import { AddressController } from '@/controllers/address.controller';
import { SubscriptionController } from '@/controllers/subscription.controller';
import { WalletController } from '@/controllers/wallet.controller';
import { HomeController } from '@/controllers/home.controller';
import { auth } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';
import { Role } from '@prisma/client';

const router = Router();

// ─── Provider Home ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /me/home:
 *   get:
 *     summary: Get provider home screen stats (wallet balance, today's earnings, open task count)
 *     tags: [Me]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Home stats fetched successfully
 */
router.get('/home', auth, authorize([Role.PROVIDER]), HomeController.getProviderStats);

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
 * /me/skills:
 *   patch:
 *     summary: Set the device types this provider is skilled to service
 *     description: Providers only see complaints auto-assigned for device types listed in their skills.
 *     tags: [Me]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [skills]
 *             properties:
 *               skills:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [MASTER_PURIFIER, AIR_CONDITIONER, FRIDGE, WASHING_MACHINE, GEYSER]
 *     responses:
 *       200:
 *         description: Skills updated successfully
 */
router.patch('/skills', auth, authorize([Role.PROVIDER]), UserController.updateSkills);

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

// ─── Bank account ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /me/bank-account:
 *   get:
 *     summary: Get own payout bank account details
 *     description: Returns canEdit/nextEditableAt computed from the 7-day self-service edit lock.
 *     tags: [Me]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Bank account fetched successfully
 *   put:
 *     summary: Create or update own payout bank account details
 *     description: Rejected with 400 if the last self-service edit was within the last 7 days. Clears any prior admin approval.
 *     tags: [Me]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bankName, accountNumber, ifscCode, accountHolderName]
 *             properties:
 *               bankName:          { type: string }
 *               accountNumber:     { type: string }
 *               ifscCode:          { type: string }
 *               accountHolderName: { type: string }
 *     responses:
 *       200:
 *         description: Bank account updated successfully
 *       400:
 *         description: Validation error or edit lock still active
 */
router.get('/bank-account', auth, UserController.getMyBankAccount);
router.put('/bank-account', auth, authorize([Role.PROVIDER]), UserController.upsertMyBankAccount);

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
