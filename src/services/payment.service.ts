import crypto from 'crypto';
import axios from 'axios';
import { PaymentOrderStatus, WalletLedgerSource, PaymentProvider } from '@prisma/client';
import { config } from '@/configs';
import { ApiError } from '@/utils/apiResponse';
import { logger } from '@/utils/logger';
import prisma from '@/services/prisma.service';
import { SubscriptionService } from '@/services/subscription.service';
import { WalletService } from '@/services/wallet.service';
import { RealtimeService } from '@/services/realtime.service';
import type {
  CreateRazorpayOrderInput,
  RazorpayOrderResult,
  RazorpayWebhookPayload,
  SubscriptionPaymentMeta,
} from '@/types/payment.types';

export class PaymentService {
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

      const { id: razorpayPaymentId, order_id: razorpayOrderId } = payment;

      const paymentOrder = await prisma.paymentOrder.findFirst({
        where: { razorpayOrderId, status: PaymentOrderStatus.PENDING, isDeleted: false },
      });

      if (!paymentOrder) {
        logger.warn('[Webhook] No pending PaymentOrder for Razorpay order', { razorpayOrderId });
        return;
      }

      logger.info('[Webhook] Processing payment capture', {
        razorpayOrderId,
        razorpayPaymentId,
        purpose: paymentOrder.purpose,
        userId:  paymentOrder.userId,
      });

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
        logger.error('[Webhook] Fulfillment failed', { error: err, razorpayOrderId });
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
