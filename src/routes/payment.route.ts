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
 *     summary: Create a Razorpay order and persist a pending PaymentOrder
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
 *               purpose:
 *                 type: string
 *                 description: Intent for this payment (e.g. "subscription")
 *                 example: subscription
 *               meta:
 *                 type: object
 *                 description: Payload to store with the order for webhook fulfilment
 *     responses:
 *       201:
 *         description: Order created successfully
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

/**
 * @swagger
 * /payments/razorpay/webhook:
 *   post:
 *     summary: Razorpay webhook — verifies signature and fulfils pending payments
 *     tags: [Payment]
 *     description: >
 *       Registered in the Razorpay dashboard. Handles payment.captured and
 *       payment.authorized events. Signature verified via RAZORPAY_WEBHOOK_SECRET.
 *     responses:
 *       200:
 *         description: Event received
 *       400:
 *         description: Invalid signature or missing body
 */
router.post('/razorpay/webhook', PaymentController.handleWebhook);

export default router;
