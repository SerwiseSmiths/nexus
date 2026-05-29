import { Router } from 'express';
import { PaymentController } from '@/controllers/payment.controller';
import { auth as authenticate } from '@/middlewares/auth.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Payment
 *   description: Payment gateway integration
 */

/**
 * @swagger
 * /payments/razorpay/order:
 *   post:
 *     summary: Create a Razorpay order
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: integer
 *                 description: Amount in paise (e.g. 18500 for ₹185)
 *                 example: 18500
 *     responses:
 *       201:
 *         description: Order created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     orderId: { type: string }
 *                     amount: { type: integer }
 *                     currency: { type: string }
 *                     keyId: { type: string }
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       502:
 *         description: Razorpay API error
 *       503:
 *         description: Razorpay not configured
 */
router.post('/razorpay/order', authenticate, PaymentController.createRazorpayOrder);

export default router;
