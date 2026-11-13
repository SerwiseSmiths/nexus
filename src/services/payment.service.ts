import crypto from 'crypto';
import axios from 'axios';
import { PaymentOrderStatus, SubscriptionStatus, WalletLedgerSource, PaymentProvider, NotificationType } from '@prisma/client';
import { config } from '@/configs';
import { ApiError } from '@/utils/apiResponse';
import { logger } from '@/utils/logger';
import prisma from '@/services/prisma.service';
import { SubscriptionService } from '@/services/subscription.service';
import { StrapiService } from '@/services/strapi.service';
import { WalletService } from '@/services/wallet.service';
import { RealtimeService } from '@/services/realtime.service';
import { ComplaintService, COMPLAINT_QR_PURPOSE } from '@/services/complaint.service';
import { NotificationService } from '@/services/notification.service';
import { TelegramService } from '@/services/telegram.service';
import { RazorpayQrService } from '@/services/razorpay-qr.service';
import { DeviceTypeGroupService } from '@/services/device-type-group.service';
import { DEVICE_KEY_TO_TYPE, type DeviceKey } from '@/types/device.types';
import { waitUntil } from '@vercel/functions';
import {
  ComplaintPaymentMetaSchema,
  SubscriptionOrderMetaSchema,
  PAYMENT_PURPOSES,
} from '@/types/payment.types';
import type {
  CreateRazorpayOrderInput,
  PaymentOrderStatusResult,
  PaymentPurpose,
  RazorpayOrderResult,
  RazorpayPaymentEntity,
  RazorpayWebhookPayload,
  SubscriptionPaymentMeta,
} from '@/types/payment.types';

// Online (UPI) service-visit fee. Must match serwise's UPI_PRICE in
// ServiceTicketModal — the client shows it, the server is what charges it.
const COMPLAINT_VISIT_FEE_PAISE = 185_00;

// How long a website booking-fee QR stays payable.
const BOOKING_QR_TTL_MINUTES = 15;

export type BookingQrResult = {
  orderId:      string;        // QR id — poll GET /payments/razorpay/order/:orderId
  amount:       number;        // paise
  imageUrl:     string;        // Razorpay's hosted QR poster
  imageContent: string | null; // raw upi://pay string, when available
  expiresAt:    string;        // ISO
};

// Wallet recharge limits, in paise — whole rupees only.
const RECHARGE_MIN_PAISE = 1_00;
const RECHARGE_MAX_PAISE = 1_00_000_00;

// Notifications after a payment is applied or refused (realtime, push,
// Telegram) must never hold up the webhook: Razorpay needs a 2xx within 5 s
// (and disables the webhook after 24 h of failures), and the order is only
// marked CAPTURED once fulfilment returns. A realtime broadcast timing out
// took webhooks to 8–10 s. waitUntil keeps the Vercel invocation alive until
// these settle; outside Vercel it's a plain background promise.
function inBackground(label: string, fn: () => Promise<unknown>): void {
  waitUntil(
    Promise.resolve()
      .then(fn)
      .catch((err) => logger.error(`[Payment] ${label} failed`, { error: err })),
  );
}

type FulfilableOrder = {
  id:              string;
  userId:          string;
  razorpayOrderId: string;
  amount:          number;
  meta:            unknown;
};

export class PaymentService {
  // ─── Create Razorpay order + persist PaymentOrder record ──────────────────

  static async createRazorpayOrder(
    input: CreateRazorpayOrderInput,
  ): Promise<RazorpayOrderResult> {
    const { userId, purpose } = input;
    const keyId     = config.razorpay?.keyId;
    const keySecret = config.razorpay?.keySecret;
    if (!keyId || !keySecret) throw new ApiError(503, 'Razorpay is not configured');

    // Price and meta are resolved server-side — everything that could make
    // fulfilment fail after the customer has paid is checked here instead.
    const { amount, meta } = await PaymentService.resolveOrder(input);

    let razorpayOrderId: string;
    let orderAmount:     number;
    let currency:        string;

    try {
      const response = await axios.post(
        'https://api.razorpay.com/v1/orders',
        { amount, currency: 'INR', receipt: `rcpt_${userId.slice(0, 8)}_${Date.now()}` },
        { auth: { username: keyId, password: keySecret } },
      );
      razorpayOrderId = response.data.id;
      orderAmount     = response.data.amount;
      currency        = response.data.currency;
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { description?: string } } } };
      throw new ApiError(
        502,
        axiosErr?.response?.data?.error?.description ?? 'Failed to create Razorpay order',
      );
    }

    // Persist so the webhook can fulfil the payment without re-sending data
    await prisma.paymentOrder.create({
      data: {
        userId,
        razorpayOrderId,
        amount,
        purpose,
        meta: meta as object,
        status: PaymentOrderStatus.PENDING,
      },
    });

    logger.info('[Payment] Razorpay order created', { razorpayOrderId, userId, purpose, amount });

    return { orderId: razorpayOrderId, amount: orderAmount, currency, keyId };
  }

  // Works out what this purpose actually costs and the meta to store with the
  // order. The client's amount is only accepted when it equals the server
  // price — a mismatch means the app showed a stale price (409, so the user
  // sees the new one before paying) or a tampered request.
  private static async resolveOrder(
    input: CreateRazorpayOrderInput,
  ): Promise<{ amount: number; meta: Record<string, unknown> }> {
    const { userId, purpose, amount } = input;

    if (purpose === 'recharge') {
      if (amount % 100 !== 0) throw new ApiError(400, 'Recharge amount must be in whole rupees');
      if (amount < RECHARGE_MIN_PAISE || amount > RECHARGE_MAX_PAISE) {
        throw new ApiError(
          400,
          `Recharge amount must be between ₹${RECHARGE_MIN_PAISE / 100} and ₹${RECHARGE_MAX_PAISE / 100}`,
        );
      }
      // creditWallet refuses an inactive wallet — refuse before payment, not after.
      await WalletService.assertWalletCanReceive(userId);
      return { amount, meta: {} };
    }

    if (purpose === 'subscription') {
      const parsed = SubscriptionOrderMetaSchema.safeParse(input.meta ?? {});
      if (!parsed.success) throw new ApiError(400, 'Invalid subscription details', parsed.error.issues);
      const { deviceTypeKey, planKey, billingCycle, startDate } = parsed.data;

      const existing = await prisma.subscription.findFirst({
        where: { userId, deviceTypeKey, status: SubscriptionStatus.ACTIVE, isDeleted: false },
        select: { id: true },
      });
      if (existing) throw new ApiError(409, 'You already have an active plan for this device type');

      const plans = await StrapiService.fetchSubscriptionPlans();
      const plan = plans.find((p) => p.key === planKey);
      if (!plan) throw new ApiError(404, `Subscription plan '${planKey}' not found`);
      const planPrice = billingCycle === 'ANNUAL' ? plan.annual_price : plan.monthly_price;

      const cmsAddons = await StrapiService.fetchSubscriptionAddons(deviceTypeKey);
      const addonKeys = [...new Set(parsed.data.addons.map((a) => a.key))];
      const addons: SubscriptionPaymentMeta['addons'] = addonKeys.map((key) => {
        const addon = cmsAddons.find((a) => a.key === key);
        if (!addon) throw new ApiError(409, 'An add-on you selected is no longer available — please review your plan');
        return { key: addon.key, name: addon.name, price: addon.price };
      });

      const totalRupees  = planPrice + addons.reduce((sum, a) => sum + a.price, 0);
      const expectedPaise = Math.round(totalRupees * 100);
      if (amount !== expectedPaise) {
        logger.warn('[Payment] Subscription amount mismatch', { userId, planKey, amount, expectedPaise });
        throw new ApiError(409, `The price for this plan is now ₹${totalRupees} — please review and try again`);
      }

      const meta: SubscriptionPaymentMeta = { deviceTypeKey, planKey, billingCycle, addons, startDate };
      return { amount: expectedPaise, meta };
    }

    // complaint_payment — the online service-visit fee
    const parsed = ComplaintPaymentMetaSchema.safeParse(input.meta ?? {});
    if (!parsed.success) throw new ApiError(400, 'Invalid booking details', parsed.error.issues);

    const address = await prisma.address.findFirst({
      where: { id: parsed.data.addressId, userId, isDeleted: false },
      select: { id: true },
    });
    if (!address) throw new ApiError(400, 'Please choose a valid address');

    // Same device resolution ComplaintService.createComplaint does at
    // fulfilment — an unknown appliance (or one no service group covers) must
    // be refused now, not after the customer has paid.
    for (const { deviceKey } of parsed.data.requestedDevices) {
      const deviceType = DEVICE_KEY_TO_TYPE[deviceKey as DeviceKey];
      if (!deviceType) throw new ApiError(400, `Unknown device key: ${deviceKey}`);
      try {
        await DeviceTypeGroupService.findByDeviceType(deviceType);
      } catch (err) {
        logger.error('[Payment] No device type group for booking', { deviceKey, error: err });
        throw new ApiError(503, 'Booking for this appliance is temporarily unavailable — please try again later');
      }
    }

    if (amount !== COMPLAINT_VISIT_FEE_PAISE) {
      logger.warn('[Payment] Visit fee amount mismatch', { userId, amount });
      throw new ApiError(409, `The visit fee is ₹${COMPLAINT_VISIT_FEE_PAISE / 100} — please update the app and try again`);
    }
    return { amount: COMPLAINT_VISIT_FEE_PAISE, meta: parsed.data };
  }

  // ─── Booking-fee UPI QR (website "Scan to pay") ───────────────────────────
  // Same price + meta checks as a complaint_payment order, but collected with a
  // single-use fixed-amount UPI QR instead of Razorpay Checkout. Stored as a
  // complaint_payment PaymentOrder keyed by the QR id, so the client polls
  // GET /payments/razorpay/order/:qrId and qr_code.credited fulfils it exactly
  // like an app booking (tickets are only created once the money arrives).

  static async createBookingQr(input: {
    userId: string;
    amount: number;
    meta?:  Record<string, unknown>;
  }): Promise<BookingQrResult> {
    const { amount, meta } = await PaymentService.resolveOrder({ ...input, purpose: 'complaint_payment' });

    const qr = await RazorpayQrService.createFixedAmountQr({
      amountPaise: amount,
      description: 'Service Visit Fee',
      closeBy:     Math.floor(Date.now() / 1000) + BOOKING_QR_TTL_MINUTES * 60,
      notes:       { userId: input.userId, purpose: 'complaint_payment' },
    });

    await prisma.paymentOrder.create({
      data: {
        userId:          input.userId,
        razorpayOrderId: qr.id,
        amount,
        purpose:         'complaint_payment',
        meta:            meta as object,
        status:          PaymentOrderStatus.PENDING,
      },
    });

    logger.info('[Payment] Booking QR created', { qrId: qr.id, userId: input.userId, amount });

    return {
      orderId:      qr.id,
      amount,
      imageUrl:     qr.imageUrl,
      imageContent: qr.imageContent,
      expiresAt:    new Date(qr.closeBy * 1000).toISOString(),
    };
  }

  // ─── Order status (app polls this while verifying) ────────────────────────

  static async getOrderStatus(userId: string, orderId: string): Promise<PaymentOrderStatusResult> {
    const order = await prisma.paymentOrder.findFirst({
      where: {
        razorpayOrderId: orderId,
        userId,
        isDeleted: false,
        purpose: { in: [...PAYMENT_PURPOSES] },
      },
      select: { razorpayOrderId: true, purpose: true, status: true, amount: true },
    });
    if (!order) throw new ApiError(404, 'Payment order not found');

    return {
      orderId: order.razorpayOrderId,
      purpose: order.purpose,
      status:  order.status,
      amount:  order.amount,
    };
  }

  // ─── Webhook: verify signature ────────────────────────────────────────────

  static verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const secret = config.razorpay?.webhookSecret;
    if (!secret) throw new ApiError(503, 'Webhook secret not configured');

    const expected = Buffer.from(crypto.createHmac('sha256', secret).update(rawBody).digest('hex'));
    const received = Buffer.from(signature);
    // timingSafeEqual throws on a length mismatch — a malformed signature is
    // just an invalid one, not a server error.
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
  }

  // ─── Webhook: process event ───────────────────────────────────────────────
  // Only throws on a bad signature. Every order is claimed (PENDING →
  // PROCESSING) before it's fulfilled, so a Razorpay retry could never apply
  // a payment that failed half-way — and repeated 5xx responses make Razorpay
  // disable the whole webhook. A captured payment that can't be applied is
  // marked FAILED and escalated on Telegram instead.

  static async handleWebhookEvent(rawBody: Buffer, signature: string): Promise<void> {
    if (!PaymentService.verifyWebhookSignature(rawBody, signature)) {
      throw new ApiError(400, 'Invalid webhook signature');
    }

    const event: RazorpayWebhookPayload = JSON.parse(rawBody.toString());

    logger.info('[Webhook] Received Razorpay event', { event: event.event });

    // Customer paid a complaint's fixed-amount UPI QR shown in radix.
    if (event.event === 'qr_code.credited') {
      await PaymentService.handleQrCredited(event);
      return;
    }

    if (event.event === 'payment.authorized') {
      await PaymentService.handlePaymentAuthorized(event);
      return;
    }

    if (event.event === 'payment.captured') {
      const payment = event.payload.payment?.entity;
      if (payment) await PaymentService.fulfilCapturedPayment(payment);
    }
  }

  // An authorized payment is not money received — Razorpay auto-refunds it
  // unless it's captured. Capture it here (a no-op when the account
  // auto-captures), then fulfil only once Razorpay confirms it's captured.
  // Fulfilment is claim-based, so the payment.captured delivery that follows
  // is a harmless duplicate — and this still works if the dashboard only
  // subscribes to payment.authorized.
  private static async handlePaymentAuthorized(event: RazorpayWebhookPayload): Promise<void> {
    const payment = event.payload.payment?.entity;
    if (!payment?.order_id) return;

    const order = await prisma.paymentOrder.findFirst({
      where: { razorpayOrderId: payment.order_id, status: PaymentOrderStatus.PENDING, isDeleted: false },
      select: { amount: true },
    });
    if (!order) return;
    if (payment.amount !== order.amount || payment.currency !== 'INR') {
      logger.error('[Webhook] Authorized amount does not match order, not capturing', {
        razorpayOrderId: payment.order_id, paid: payment.amount, expected: order.amount, currency: payment.currency,
      });
      return;
    }

    const keyId     = config.razorpay?.keyId;
    const keySecret = config.razorpay?.keySecret;
    if (!keyId || !keySecret) return;
    const auth = { username: keyId, password: keySecret };

    try {
      await axios.post(
        `https://api.razorpay.com/v1/payments/${payment.id}/capture`,
        { amount: payment.amount, currency: payment.currency },
        { auth },
      );
      logger.info('[Webhook] Payment captured', { razorpayPaymentId: payment.id, razorpayOrderId: payment.order_id });
    } catch (err: unknown) {
      // Already captured (auto-capture on) is the common case and is fine.
      const axiosErr = err as { response?: { data?: { error?: { description?: string } } } };
      logger.warn('[Webhook] Capture call failed (may already be captured)', {
        razorpayPaymentId: payment.id,
        reason: axiosErr?.response?.data?.error?.description,
      });
    }

    try {
      const { data } = await axios.get<{ status: string }>(
        `https://api.razorpay.com/v1/payments/${payment.id}`,
        { auth },
      );
      if (data.status !== 'captured') {
        logger.warn('[Webhook] Payment not captured yet, waiting for payment.captured', {
          razorpayPaymentId: payment.id, status: data.status,
        });
        return;
      }
    } catch (err: unknown) {
      logger.warn('[Webhook] Could not confirm capture, waiting for payment.captured', {
        razorpayPaymentId: payment.id, reason: (err as Error)?.message,
      });
      return;
    }

    await PaymentService.fulfilCapturedPayment(payment);
  }

  private static async fulfilCapturedPayment(payment: RazorpayPaymentEntity): Promise<void> {
    const { id: razorpayPaymentId, order_id: razorpayOrderId, amount, currency } = payment;
    logger.info('[Webhook] Payment captured event', { razorpayPaymentId, razorpayOrderId, amount });

    if (!razorpayOrderId) {
      logger.warn('[Webhook] Captured payment has no order id — not a Serwise order, skipping', { razorpayPaymentId });
      return;
    }

    // Atomically claim the order by transitioning PENDING→PROCESSING.
    // If count===0, another delivery already claimed it — safe to ignore.
    const claimed = await prisma.paymentOrder.updateMany({
      where: { razorpayOrderId, status: PaymentOrderStatus.PENDING, isDeleted: false },
      data:  { status: PaymentOrderStatus.PROCESSING, razorpayPaymentId },
    });

    if (claimed.count === 0) {
      logger.info('[Webhook] PaymentOrder already claimed or not found, skipping', { razorpayOrderId });
      return;
    }

    const paymentOrder = await prisma.paymentOrder.findFirst({
      where: { razorpayOrderId, isDeleted: false },
    });
    if (!paymentOrder) return; // should never happen after successful updateMany

    await PaymentService.applyClaimedOrder(paymentOrder, razorpayPaymentId, amount, currency);
  }

  // Fulfils an order already claimed (PENDING → PROCESSING) by the caller:
  // checks the amount, runs the purpose's fulfilment, then marks it CAPTURED —
  // or FAILED with a Telegram escalation. Never rethrows (see handleWebhookEvent).
  private static async applyClaimedOrder(
    paymentOrder: FulfilableOrder & { purpose: string },
    razorpayPaymentId: string,
    amount: number,
    currency: string,
  ): Promise<void> {
    const { razorpayOrderId } = paymentOrder;

    const fail = async (reason: string, error?: unknown) => {
      logger.error('[Webhook] Captured payment not fulfilled', { razorpayOrderId, razorpayPaymentId, reason, error });
      await prisma.paymentOrder.update({
        where: { id: paymentOrder.id },
        data:  { status: PaymentOrderStatus.FAILED },
      });
      inBackground('Unapplied-payment Telegram alert', () => TelegramService.notifyUnappliedPayment({
        userId:          paymentOrder.userId,
        razorpayOrderId,
        razorpayPaymentId,
        purpose:         paymentOrder.purpose,
        amountRupees:    amount / 100,
        reason,
      }));
    };

    if (amount !== paymentOrder.amount || currency !== 'INR') {
      await fail(`Paid ${currency} ${amount / 100}, order was INR ${paymentOrder.amount / 100}`);
      return;
    }

    try {
      if (paymentOrder.purpose === 'subscription') {
        await PaymentService.fulfillSubscription(paymentOrder, razorpayPaymentId);
      } else if (paymentOrder.purpose === 'recharge') {
        await PaymentService.fulfillRecharge(paymentOrder, razorpayPaymentId);
      } else if (paymentOrder.purpose === 'complaint_payment') {
        await PaymentService.fulfillComplaintPayment(paymentOrder, razorpayPaymentId);
      } else {
        await fail(`Unknown purpose '${paymentOrder.purpose}'`);
        return;
      }
    } catch (err) {
      await fail(err instanceof Error ? err.message : 'Unknown error', err);
      return;
    }

    await prisma.paymentOrder.update({
      where: { id: paymentOrder.id },
      data:  { status: PaymentOrderStatus.CAPTURED },
    });

    inBackground('Payment push notification', () =>
      PaymentService.notifyFulfilled(paymentOrder.purpose as PaymentPurpose, paymentOrder.userId));
  }

  // ─── Webhook: complaint UPI QR paid ───────────────────────────────────────
  // PaymentOrder.razorpayOrderId holds the QR id for these (see
  // ComplaintService.getPaymentQr). Never rethrows — see handleWebhookEvent.

  private static async handleQrCredited(event: RazorpayWebhookPayload): Promise<void> {
    const qr      = event.payload.qr_code?.entity;
    const payment = event.payload.payment?.entity;
    if (!qr || !payment) {
      logger.warn('[Webhook] qr_code.credited without qr_code/payment entity');
      return;
    }

    // Booking-fee QR from the website (see createBookingQr): same fulfilment as
    // an app order for the visit fee.
    const bookingClaim = await prisma.paymentOrder.updateMany({
      where: {
        razorpayOrderId: qr.id,
        purpose:         'complaint_payment',
        status:          PaymentOrderStatus.PENDING,
        isDeleted:       false,
      },
      data: { status: PaymentOrderStatus.PROCESSING, razorpayPaymentId: payment.id },
    });
    const bookingOrder = await prisma.paymentOrder.findFirst({
      where: { razorpayOrderId: qr.id, purpose: 'complaint_payment', isDeleted: false },
    });
    if (bookingOrder) {
      if (bookingClaim.count > 0) {
        await PaymentService.applyClaimedOrder(bookingOrder, payment.id, payment.amount, payment.currency);
      } else {
        logger.info('[Webhook] Booking QR already claimed, skipping', { qrId: qr.id, status: bookingOrder.status });
      }
      return;
    }

    const claimed = await prisma.paymentOrder.updateMany({
      where: {
        razorpayOrderId: qr.id,
        purpose:         COMPLAINT_QR_PURPOSE,
        status:          PaymentOrderStatus.PENDING,
        isDeleted:       false,
      },
      data: { status: PaymentOrderStatus.PROCESSING },
    });

    const order = await prisma.paymentOrder.findFirst({ where: { razorpayOrderId: qr.id, isDeleted: false } });
    const complaintId = (order?.meta as { complaintId?: string } | null)?.complaintId ?? qr.notes?.complaintId ?? '';

    if (claimed.count === 0) {
      // Not PENDING: already processed (duplicate delivery — fine), or closed
      // by a cash settlement a moment before the customer paid (needs refund).
      if (order?.status === PaymentOrderStatus.FAILED) {
        logger.error('[Webhook] Payment received on a closed complaint QR', { qrId: qr.id, complaintId });
        inBackground('Closed-QR Telegram alert', () => TelegramService.notifyUnappliedQrPayment({
          complaintId,
          qrId:              qr.id,
          razorpayPaymentId: payment.id,
          amountRupees:      payment.amount / 100,
          reason:            'QR was already closed — the complaint was settled another way',
        }));
      } else {
        logger.info('[Webhook] QR order already claimed or unknown, skipping', { qrId: qr.id });
      }
      return;
    }

    try {
      await ComplaintService.settleViaUpiQr({
        complaintId,
        qrId:              qr.id,
        razorpayPaymentId: payment.id,
        amountPaidPaise:   payment.amount,
      });
      await prisma.paymentOrder.update({
        where: { razorpayOrderId: qr.id },
        data:  { status: PaymentOrderStatus.CAPTURED, razorpayPaymentId: payment.id },
      });
      logger.info('[Webhook] Complaint settled via UPI QR', { complaintId, qrId: qr.id, razorpayPaymentId: payment.id });
    } catch (err) {
      await prisma.paymentOrder.update({
        where: { razorpayOrderId: qr.id },
        data:  { status: PaymentOrderStatus.FAILED, razorpayPaymentId: payment.id },
      });
      const reason = err instanceof Error ? err.message : 'Unknown error';
      logger.error('[Webhook] Failed to settle complaint via UPI QR', { error: err, complaintId, qrId: qr.id });
      inBackground('Unapplied-QR Telegram alert', () => TelegramService.notifyUnappliedQrPayment({
        complaintId,
        qrId:              qr.id,
        razorpayPaymentId: payment.id,
        amountRupees:      payment.amount / 100,
        reason,
      }));
      // Tell radix so the provider stops waiting on the collection screen
      // (and doesn't collect cash on top of the customer's UPI payment).
      inBackground('payment_failed emit', async () => {
        const complaint = await prisma.complaint.findFirst({
          where:  { id: complaintId },
          select: { id: true, userId: true, providerId: true, stage: true },
        });
        if (complaint) {
          await RealtimeService.emitPaymentFailed(complaint as unknown as Record<string, unknown>, reason);
        }
      });
    }
  }

  // ─── Fulfil a subscription after payment ──────────────────────────────────

  private static async fulfillSubscription(
    paymentOrder: FulfilableOrder,
    razorpayPaymentId: string,
  ): Promise<void> {
    const meta = paymentOrder.meta as SubscriptionPaymentMeta;

    const subscription = await SubscriptionService.purchase({
      userId:        paymentOrder.userId,
      deviceTypeKey: meta.deviceTypeKey,
      planKey:       meta.planKey,
      billingCycle:  meta.billingCycle,
      addons:        meta.addons,
      startDate:     meta.startDate,
    });

    // Audit-only ledger entry — money went via Razorpay, not through wallet balance
    const { ledger } = await WalletService.creditWallet({
      userId:          paymentOrder.userId,
      amount:          paymentOrder.amount / 100,
      source:          WalletLedgerSource.ORDER_PAYMENT,
      refId:           subscription.id,
      paymentProvider: PaymentProvider.RAZORPAY,
      updateBalance:   false,
      meta:            { razorpayPaymentId, subscriptionId: subscription.id },
    });

    logger.info('[Payment] Subscription fulfilled', {
      subscriptionId: subscription.id, ledgerId: ledger.id, userId: paymentOrder.userId,
    });

    inBackground('payment:verified emit', () => RealtimeService.emitPaymentVerified(paymentOrder.userId, {
      orderId:        paymentOrder.razorpayOrderId,
      subscriptionId: subscription.id,
      ledgerId:       ledger.id,
      amount:         paymentOrder.amount / 100,
    }));
    inBackground('Subscription Telegram alert', () => TelegramService.notifyPaymentVerified({
      userId:            paymentOrder.userId,
      subscriptionId:    subscription.id,
      amountRupees:      paymentOrder.amount / 100,
      razorpayPaymentId,
      ledgerId:          ledger.id,
    }));
  }

  // ─── Fulfil a wallet recharge after payment ────────────────────────────────

  private static async fulfillRecharge(
    paymentOrder: FulfilableOrder,
    razorpayPaymentId: string,
  ): Promise<void> {
    // CREDIT wallet — this actually increases the wallet balance
    const { wallet, ledger } = await WalletService.creditWallet({
      userId:          paymentOrder.userId,
      amount:          paymentOrder.amount / 100,
      source:          WalletLedgerSource.RECHARGE,
      paymentProvider: PaymentProvider.RAZORPAY,
      updateBalance:   true, // recharge → balance increases
      meta:            { razorpayPaymentId, razorpayOrderId: paymentOrder.razorpayOrderId },
    });

    logger.info('[Payment] Wallet recharged', {
      userId: paymentOrder.userId, amount: paymentOrder.amount / 100,
      newBalance: wallet.balance, ledgerId: ledger.id,
    });

    inBackground('payment:verified emit', () => RealtimeService.emitPaymentVerified(paymentOrder.userId, {
      orderId:       paymentOrder.razorpayOrderId,
      walletBalance: wallet.balance,
      ledgerId:      ledger.id,
      amount:        paymentOrder.amount / 100,
    }));
  }

  // ─── Fulfil a one-off complaint/service payment ────────────────────────────
  // Creates the complaint from the meta stored on the payment order, then records
  // the audit ledger entry. Complaint creation lives here (not client-side) so
  // that UPI payments which interrupt the app still result in a complaint.

  private static async fulfillComplaintPayment(
    paymentOrder: FulfilableOrder,
    razorpayPaymentId: string,
  ): Promise<void> {
    const meta = paymentOrder.meta as {
      serviceType?:      string;
      deviceLines?:      string;
      addressId?:        string;
      // requestedDevices is the current shape; deviceKey is kept for backward
      // compatibility with payment orders created before this field existed.
      requestedDevices?: { deviceKey: string; quantity: number }[];
      deviceKey?:        string;
      tags?:             string[];
      notes?:            string;
    };

    const title = [meta.serviceType, meta.deviceLines].filter(Boolean).join(': ') || 'Service Visit';

    const notesParts: string[] = [];
    if (meta.tags?.length) notesParts.push(`Issues: ${meta.tags.join(', ')}`);
    if (meta.notes)        notesParts.push(meta.notes);
    notesParts.push(`Payment: UPI (₹${paymentOrder.amount / 100})`);
    notesParts.push(`Razorpay ID: ${razorpayPaymentId}`);

    const requestedDevices = meta.requestedDevices?.length
      ? meta.requestedDevices
      : meta.deviceKey
        ? [{ deviceKey: meta.deviceKey, quantity: 1 }]
        : null;
    if (!requestedDevices) {
      throw new ApiError(400, 'requestedDevices is required to create a service complaint');
    }

    // Requested devices spanning multiple device-type groups become multiple
    // complaints — one Razorpay payment still only produces one audit ledger
    // entry, tied to the first complaint created.
    const complaints = await ComplaintService.createComplaint({
      userId:    paymentOrder.userId,
      title,
      notes:     notesParts.join('\n'),
      addressId: meta.addressId ?? '',
      requestedDevices,
    });
    const [complaint] = complaints;

    // The booking now exists, so the payment IS applied — from here nothing may
    // throw (that would mark the order FAILED and ask support to refund a
    // booking the customer has). The audit-only ledger entry creates the
    // wallet if the customer never had one (admin-created customers) and
    // doesn't care whether it's active — nothing is charged to it.
    let ledgerId: string | null = null;
    try {
      const ledger = await prisma.$transaction((tx) => WalletService.recordCustomerComplaintPayment(
        paymentOrder.userId,
        paymentOrder.amount / 100,
        complaint.id,
        PaymentProvider.RAZORPAY,
        { razorpayPaymentId, complaintId: complaint.id, complaintIds: complaints.map(c => c.id) },
        tx,
      ));
      ledgerId = ledger?.id ?? null;
    } catch (err) {
      logger.error('[Payment] Booking fee audit ledger entry not written', {
        userId: paymentOrder.userId, razorpayPaymentId, complaintId: complaint.id, error: err,
      });
    }

    logger.info('[Payment] Complaint payment fulfilled', {
      userId: paymentOrder.userId, ledgerId, complaintIds: complaints.map(c => c.id),
    });

    inBackground('payment:verified emit', () => RealtimeService.emitPaymentVerified(paymentOrder.userId, {
      orderId:     paymentOrder.razorpayOrderId,
      complaintId: complaint.id,
      ledgerId,
      amount:      paymentOrder.amount / 100,
    }));
  }

  // Push notification once the order is fully settled (status CAPTURED), so a
  // user who taps it and opens the app sees the finished state.
  private static async notifyFulfilled(purpose: PaymentPurpose, userId: string): Promise<void> {
    const content: Record<PaymentPurpose, { title: string; body: string }> = {
      subscription:      { title: 'Plan Activated',    body: 'Your service plan is now active.' },
      recharge:          { title: 'Payment Received',  body: 'Money has been added to your wallet.' },
      complaint_payment: { title: 'Booking Confirmed', body: 'Your service visit has been scheduled.' },
    };
    await NotificationService.sendToUser({
      userId,
      ...content[purpose],
      type:     NotificationType.PAYMENT,
      metadata: { navigate: 'wallet' },
    }).catch((err) => logger.error('[Payment] Notification failed', { error: err }));
  }
}
