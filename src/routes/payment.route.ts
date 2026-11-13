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
 *                 description: >
 *                   Amount in paise (e.g. 18500 for ₹185). Must equal the server-computed
 *                   price for the purpose; recharge must be whole rupees, ₹1–₹1,00,000.
 *                 example: 18500
 *               purpose:
 *                 type: string
 *                 enum: [subscription, recharge, complaint_payment]
 *                 example: subscription
 *               meta:
 *                 type: object
 *                 description: >
 *                   subscription → { deviceTypeKey, planKey, billingCycle, addons: [{ key }], startDate };
 *                   complaint_payment → { addressId, requestedDevices, serviceType?, deviceLines?, tags?, notes? }
 *     responses:
 *       201:
 *         description: Order created successfully
 *       400:
 *         description: Validation error / recharge outside limits / invalid address
 *       409:
 *         description: Price changed, or an active plan already exists for this device type
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
 * /payments/razorpay/order/{orderId}:
 *   get:
 *     summary: Status of one of the current user's Razorpay orders
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Polled by the app while verifying a payment, as a fallback to the
 *       realtime payment:verified event. PENDING = not paid yet, PROCESSING =
 *       paid and being fulfilled, CAPTURED = fulfilled, FAILED = paid but could
 *       not be fulfilled (support is alerted to fulfil or refund).
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *         description: Razorpay order id (order_xxx)
 *     responses:
 *       200:
 *         description: Order status fetched
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No such order for this user
 */
router.get('/razorpay/order/:orderId', authenticate, PaymentController.getOrderStatus);

/**
 * @swagger
 * /payments/razorpay/booking-qr:
 *   post:
 *     summary: Single-use UPI QR for the service-visit fee (website "Scan to pay")
 *     tags: [Payment]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Same checks as a complaint_payment order (visit fee, address ownership,
 *       requestedDevices). The tickets are created by the qr_code.credited webhook
 *       once paid. Poll GET /payments/razorpay/order/{orderId} with the returned
 *       orderId (the QR id) for the status.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, meta]
 *             properties:
 *               amount: { type: integer, example: 18500, description: Visit fee in paise }
 *               meta:
 *                 type: object
 *                 description: '{ addressId, requestedDevices: [{ deviceKey, quantity }], serviceType?, deviceLines?, tags?, notes? }'
 *     responses:
 *       201:
 *         description: '{ orderId, amount, imageUrl, imageContent, expiresAt }'
 *       400:
 *         description: Invalid booking details / address
 *       409:
 *         description: The visit fee changed
 *       502:
 *         description: Razorpay API error
 */
router.post('/razorpay/booking-qr', authenticate, PaymentController.createBookingQr);

/**
 * @swagger
 * /payments/razorpay/webhook:
 *   post:
 *     summary: Razorpay webhook — verifies signature and fulfils pending payments
 *     tags: [Payment]
 *     description: >
 *       Registered in the Razorpay dashboard. Handles payment.authorized (captures it),
 *       payment.captured (fulfils the order) and qr_code.credited. Signature verified
 *       via RAZORPAY_WEBHOOK_SECRET.
 *     responses:
 *       200:
 *         description: Event received
 *       400:
 *         description: Invalid signature or missing body
 */
router.post('/razorpay/webhook', PaymentController.handleWebhook);

export default router;
