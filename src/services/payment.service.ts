import crypto from 'crypto';
import axios from 'axios';
import { PaymentOrderStatus, PaymentSessionStatus, WalletLedgerSource, PaymentProvider } from '@prisma/client';
import { config } from '@/configs';
import { ApiError } from '@/utils/apiResponse';
import { logger } from '@/utils/logger';
import prisma from '@/services/prisma.service';
import { SubscriptionService } from '@/services/subscription.service';
import { WalletService } from '@/services/wallet.service';
import { RealtimeService } from '@/services/realtime.service';
import type {
  CreateRazorpayOrderInput,
  CreatePaymentLinkInput,
  CreatePaymentLinkResult,
  CreatePaymentSessionInput,
  CreatePaymentSessionResult,
  RazorpayOrderResult,
  RazorpayWebhookPayload,
  SubscriptionPaymentMeta,
  WebviewCompleteInput,
  WebviewCompleteResult,
} from '@/types/payment.types';

export class PaymentService {
  // ─── Create Payment Session (no API keys required) ─────────────────────────
  // Must be called before opening the WebView. The webhook handler matches
  // the incoming payment to this session via phone number + amount.

  static async createPaymentSession(
    input: CreatePaymentSessionInput,
  ): Promise<CreatePaymentSessionResult> {
    const { userId, phone, purpose, amountRupees, meta } = input;
    const expectedAmountPaise = Math.round(amountRupees * 100);

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30-min window

    const session = await prisma.paymentSession.create({
      data: {
        userId,
        phone: phone.replace(/\s+/g, ''), // normalise whitespace
        purpose,
        expectedAmountPaise,
        meta: (meta ?? {}) as object,
        status:    PaymentSessionStatus.PENDING,
        expiresAt,
      },
    });

    logger.info('[Payment] Session created', { sessionId: session.id, userId, purpose });
    return { sessionId: session.id };
  }

  // ─── Create Razorpay order + persist PaymentOrder record ──────────────────

  static async createRazorpayOrder(
    input: CreateRazorpayOrderInput,
  ): Promise<RazorpayOrderResult> {
    const { amount, userId, purpose, meta } = input;
    const keyId     = config.razorpay?.keyId;
    const keySecret = config.razorpay?.keySecret;
    if (!keyId || !keySecret) throw new ApiError(503, 'Razorpay is not configured');

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
        meta: (meta ?? {}) as object,
        status: PaymentOrderStatus.PENDING,
      },
    });

    logger.info('[Payment] Razorpay order created', { razorpayOrderId, userId, purpose });

    return { orderId: razorpayOrderId, amount: orderAmount, currency, keyId };
  }

  // ─── Create Razorpay Payment Link (WebView — real Razorpay URL, no JS injection) ──

  static async createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatePaymentLinkResult> {
    const { amountRupees, userId, description, userName, userPhone, userEmail } = input;
    const keyId     = config.razorpay?.keyId;
    const keySecret = config.razorpay?.keySecret;
    if (!keyId || !keySecret) throw new ApiError(503, 'Razorpay is not configured');

    const amountPaise = Math.round(amountRupees * 100);
    // Callback URL the WebView detects to know payment is done
    const callbackUrl = `${config.appUrl ?? 'https://nexus.dev.serwise.co.in'}/api/payments/razorpay/link-callback`;

    try {
      const response = await axios.post(
        'https://api.razorpay.com/v1/payment_links',
        {
          amount:          amountPaise,
          currency:        'INR',
          description:     description ?? 'Serwise Payment',
          callback_url:    callbackUrl,
          callback_method: 'get',
          expire_by:       Math.floor(Date.now() / 1000) + 1800, // 30-min expiry
          ...(userName || userPhone || userEmail
            ? { customer: { name: userName, contact: userPhone, email: userEmail } }
            : {}),
        },
        { auth: { username: keyId, password: keySecret } },
      );

      const linkId: string = response.data.id;
      const url:    string = response.data.short_url;

      logger.info('[Payment] Payment link created', { linkId, userId, amountRupees });
      return { url, linkId };
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { description?: string } } } };
      throw new ApiError(502, axiosErr?.response?.data?.error?.description ?? 'Failed to create payment link');
    }
  }

  // ─── WebView (link-based) completion — no API keys required ──────────────
  // Processes payments made via razorpay.me/@username payment links.
  // Idempotency: same paymentId can only be fulfilled once.

  static async webviewComplete(input: WebviewCompleteInput): Promise<WebviewCompleteResult> {
    const { userId, paymentId, purpose, amountRupees, meta } = input;

    // Prevent double-processing the same Razorpay payment
    const existing = await prisma.paymentOrder.findFirst({
      where: { razorpayOrderId: paymentId, status: PaymentOrderStatus.CAPTURED, isDeleted: false },
    });
    if (existing) throw new ApiError(409, 'This payment has already been processed');

    // Store an audit record — razorpayOrderId holds the payment_id (no order in link flow)
    await prisma.paymentOrder.create({
      data: {
        userId,
        razorpayOrderId:   paymentId,
        razorpayPaymentId: paymentId,
        amount:  Math.round(amountRupees * 100),
        status:  PaymentOrderStatus.CAPTURED,
        purpose,
        meta: (meta ?? {}) as object,
      },
    });

    const result: WebviewCompleteResult = { purpose };

    if (purpose === 'subscription') {
      const m = meta as SubscriptionPaymentMeta;
      const subscription = await SubscriptionService.purchase({
        userId,
        deviceTypeKey: m.deviceTypeKey,
        planKey:       m.planKey,
        billingCycle:  m.billingCycle,
        addons:        m.addons,
        startDate:     m.startDate,
      });
      await WalletService.creditWallet({
        userId,
        amount:          amountRupees,
        source:          WalletLedgerSource.ORDER_PAYMENT,
        refId:           subscription.id,
        paymentProvider: PaymentProvider.RAZORPAY,
        updateBalance:   false, // audit-only — paid via Razorpay link, not wallet
        meta:            { razorpayPaymentId: paymentId, subscriptionId: subscription.id },
      });
      result.subscriptionId = subscription.id;

    } else if (purpose === 'recharge') {
      const { wallet } = await WalletService.creditWallet({
        userId,
        amount:          amountRupees,
        source:          WalletLedgerSource.RECHARGE,
        paymentProvider: PaymentProvider.RAZORPAY,
        updateBalance:   true, // wallet balance actually increases
        meta:            { razorpayPaymentId: paymentId },
      });
      result.walletBalance = wallet.balance;

    } else if (purpose === 'complaint_payment') {
      const complaintId = (meta as { complaintId?: string })?.complaintId;
      await WalletService.debitWallet({
        userId,
        amount:          amountRupees,
        source:          WalletLedgerSource.ORDER_PAYMENT,
        refId:           complaintId,
        paymentProvider: PaymentProvider.RAZORPAY,
        updateBalance:   false,
        meta:            { razorpayPaymentId: paymentId, complaintId },
      });
    }

    logger.info('[Payment] WebView payment completed', { userId, paymentId, purpose, amountRupees });
    return result;
  }

  // ─── Webhook: verify signature ────────────────────────────────────────────

  static verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const secret = config.razorpay?.webhookSecret;
    if (!secret) throw new ApiError(503, 'Webhook secret not configured');

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  // ─── Webhook: process event ───────────────────────────────────────────────

  static async handleWebhookEvent(rawBody: Buffer, signature: string): Promise<void> {
    if (!PaymentService.verifyWebhookSignature(rawBody, signature)) {
      throw new ApiError(400, 'Invalid webhook signature');
    }

    const event: RazorpayWebhookPayload = JSON.parse(rawBody.toString());

    logger.info('[Webhook] Received Razorpay event', { event: event.event });

    // Handle both authorized (manual capture) and auto-captured payments
    if (event.event === 'payment.captured' || event.event === 'payment.authorized') {
      const payment = event.payload.payment?.entity;
      if (!payment) return;

      const { id: razorpayPaymentId, order_id: razorpayOrderId, amount, contact } = payment;

      logger.info('[Webhook] Payment event received', { razorpayPaymentId, razorpayOrderId, amount, contact });

      // ── Path A: order-based payment (API keys were used) ─────────────────────
      if (razorpayOrderId) {
        const paymentOrder = await prisma.paymentOrder.findFirst({
          where: { razorpayOrderId, status: PaymentOrderStatus.PENDING, isDeleted: false },
        });

        if (!paymentOrder) {
          logger.warn('[Webhook] No pending PaymentOrder for order', { razorpayOrderId });
          return;
        }

        try {
          if (paymentOrder.purpose === 'subscription') {
            await PaymentService.fulfillSubscription(paymentOrder, razorpayPaymentId);
          } else if (paymentOrder.purpose === 'recharge') {
            await PaymentService.fulfillRecharge(paymentOrder, razorpayPaymentId);
          } else if (paymentOrder.purpose === 'complaint_payment') {
            await PaymentService.fulfillComplaintPayment(paymentOrder, razorpayPaymentId);
          }
          await prisma.paymentOrder.update({
            where: { id: paymentOrder.id },
            data:  { status: PaymentOrderStatus.CAPTURED, razorpayPaymentId },
          });
        } catch (err) {
          await prisma.paymentOrder.update({
            where: { id: paymentOrder.id },
            data:  { status: PaymentOrderStatus.FAILED },
          });
          throw err;
        }
        return;
      }

      // ── Path B: payment-link WebView (no order ID) ────────────────────────────
      // Match by phone number + amount against a pending PaymentSession.
      if (!contact) {
        logger.warn('[Webhook] No contact in payment payload, cannot match session');
        return;
      }

      const normalizedPhone = contact.replace(/\s+/g, '');

      const session = await prisma.paymentSession.findFirst({
        where: {
          phone:               normalizedPhone,
          expectedAmountPaise: amount,
          status:              PaymentSessionStatus.PENDING,
          isDeleted:           false,
          expiresAt:           { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' }, // most recent session wins
      });

      if (!session) {
        logger.warn('[Webhook] No matching PaymentSession', { phone: normalizedPhone, amount });
        return;
      }

      logger.info('[Webhook] Session matched, fulfilling', {
        sessionId: session.id,
        userId:    session.userId,
        purpose:   session.purpose,
      });

      try {
        const orderProxy = {
          id:     session.id,
          userId: session.userId,
          amount: session.expectedAmountPaise,
          meta:   session.meta,
        };

        if (session.purpose === 'subscription') {
          await PaymentService.fulfillSubscription(orderProxy, razorpayPaymentId);
        } else if (session.purpose === 'recharge') {
          await PaymentService.fulfillRecharge(orderProxy, razorpayPaymentId);
        } else if (session.purpose === 'complaint_payment') {
          await PaymentService.fulfillComplaintPayment(orderProxy, razorpayPaymentId);
        }

        await prisma.paymentSession.update({
          where: { id: session.id },
          data:  { status: PaymentSessionStatus.FULFILLED },
        });
      } catch (err) {
        logger.error('[Webhook] Session fulfillment failed', { error: err, sessionId: session.id });
        throw err;
      }
    }
  }

  // ─── Fulfil a subscription after payment ──────────────────────────────────

  private static async fulfillSubscription(
    paymentOrder: { id: string; userId: string; amount: number; meta: unknown },
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

    await RealtimeService.emitPaymentVerified(paymentOrder.userId, {
      subscriptionId: subscription.id,
      ledgerId:       ledger.id,
      amount:         paymentOrder.amount / 100,
    });
  }

  // ─── Fulfil a wallet recharge after payment ────────────────────────────────

  private static async fulfillRecharge(
    paymentOrder: { id: string; userId: string; amount: number },
    razorpayPaymentId: string,
  ): Promise<void> {
    // CREDIT wallet — this actually increases the wallet balance
    const { wallet, ledger } = await WalletService.creditWallet({
      userId:          paymentOrder.userId,
      amount:          paymentOrder.amount / 100,
      source:          WalletLedgerSource.RECHARGE,
      paymentProvider: PaymentProvider.RAZORPAY,
      updateBalance:   true, // recharge → balance increases
      meta:            { razorpayPaymentId },
    });

    logger.info('[Payment] Wallet recharged', {
      userId: paymentOrder.userId, amount: paymentOrder.amount / 100,
      newBalance: wallet.balance, ledgerId: ledger.id,
    });

    await RealtimeService.emitPaymentVerified(paymentOrder.userId, {
      walletBalance: wallet.balance,
      ledgerId:      ledger.id,
      amount:        paymentOrder.amount / 100,
    });
  }

  // ─── Fulfil a one-off complaint/service payment ────────────────────────────
  // Complaint was already created by the client; we just record the ledger entry.

  private static async fulfillComplaintPayment(
    paymentOrder: { id: string; userId: string; amount: number; meta: unknown },
    razorpayPaymentId: string,
  ): Promise<void> {
    const meta = paymentOrder.meta as { complaintId?: string };

    // Audit-only debit entry — tracks the service fee without touching wallet balance
    const { ledger } = await WalletService.debitWallet({
      userId:          paymentOrder.userId,
      amount:          paymentOrder.amount / 100,
      source:          WalletLedgerSource.ORDER_PAYMENT,
      refId:           meta.complaintId,
      paymentProvider: PaymentProvider.RAZORPAY,
      updateBalance:   false,
      meta:            { razorpayPaymentId, complaintId: meta.complaintId },
    });

    logger.info('[Payment] Complaint payment ledger recorded', {
      userId: paymentOrder.userId, ledgerId: ledger.id, complaintId: meta.complaintId,
    });

    await RealtimeService.emitPaymentVerified(paymentOrder.userId, {
      complaintId: meta.complaintId,
      ledgerId:    ledger.id,
      amount:      paymentOrder.amount / 100,
    });
  }
}
