import { Router } from 'express';
import { WalletController } from '@/controllers/wallet.controller';
import { auth as authenticate } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';
import { Role } from '@prisma/client';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Wallet
 *   description: Wallet and ledger management
 */

/**
 * @swagger
 * /wallet:
 *   get:
 *     summary: Get the current user's wallet (auto-creates if not found)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 statusCode: { type: integer, example: 200 }
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     userId: { type: string }
 *                     balance: { type: number }
 *                     isActive: { type: boolean }
 *       401:
 *         description: Unauthorized
 */
router.get('/', authenticate, WalletController.getMyWallet);

/**
 * @swagger
 * /wallet/history:
 *   get:
 *     summary: Get paginated ledger history for the current user
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Wallet history fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     entries:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string }
 *                           type: { type: string, enum: [CREDIT, DEBIT] }
 *                           source: { type: string }
 *                           amount: { type: number }
 *                           openingBalance: { type: number }
 *                           closingBalance: { type: number }
 *                           refId: { type: string }
 *                           createdAt: { type: string, format: date-time }
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         total: { type: integer }
 *                         totalPages: { type: integer }
 *       401:
 *         description: Unauthorized
 */
router.get('/history', authenticate, WalletController.getHistory);

/**
 * @swagger
 * /wallet/send:
 *   post:
 *     summary: Send money from the current user's wallet to a recipient by phone number
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - recipientPhone
 *               - amount
 *             properties:
 *               recipientPhone:
 *                 type: string
 *                 description: Recipient's registered phone number
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *     responses:
 *       200:
 *         description: Money sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     newBalance:
 *                       type: number
 *       400:
 *         description: Insufficient balance, invalid phone, or validation error
 *       404:
 *         description: Recipient not found
 *       401:
 *         description: Unauthorized
 */
router.post('/send', authenticate, WalletController.sendMoney);

/**
 * @swagger
 * /wallet/user/{userId}:
 *   get:
 *     summary: Get wallet for a specific user (Admin only)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Wallet fetched successfully
 *       404:
 *         description: Wallet not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get('/user/:userId', authenticate, authorize([Role.ADMIN]), WalletController.getWalletByUserId);

/**
 * @swagger
 * /wallet/credit:
 *   post:
 *     summary: Credit a user's wallet (Admin only)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - amount
 *               - source
 *             properties:
 *               userId:
 *                 type: string
 *                 format: uuid
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *               source:
 *                 type: string
 *                 enum: [RECHARGE, ORDER_PAYMENT, REFUND, ADMIN_ADJUSTMENT, CASHBACK, TRANSFER]
 *               refId:
 *                 type: string
 *                 description: Reference ID (complaint ID, order ID, etc.)
 *               meta:
 *                 type: object
 *                 description: Arbitrary context data
 *     responses:
 *       200:
 *         description: Wallet credited successfully
 *       400:
 *         description: Validation error or insufficient balance
 *       404:
 *         description: User not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post('/credit', authenticate, authorize([Role.ADMIN]), WalletController.credit);

/**
 * @swagger
 * /wallet/debit:
 *   post:
 *     summary: Debit a user's wallet (Admin only)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - amount
 *               - source
 *             properties:
 *               userId:
 *                 type: string
 *                 format: uuid
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *               source:
 *                 type: string
 *                 enum: [RECHARGE, ORDER_PAYMENT, REFUND, ADMIN_ADJUSTMENT, CASHBACK, TRANSFER]
 *               refId:
 *                 type: string
 *               meta:
 *                 type: object
 *     responses:
 *       200:
 *         description: Wallet debited successfully
 *       400:
 *         description: Insufficient balance or validation error
 *       403:
 *         description: Wallet inactive or forbidden
 *       404:
 *         description: Wallet not found
 *       401:
 *         description: Unauthorized
 */
router.post('/debit', authenticate, authorize([Role.ADMIN]), WalletController.debit);

export default router;
