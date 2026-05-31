import { z } from 'zod';
import type { AddonSnapshot } from '@/types/subscription.types';

// ─── Razorpay order creation ──────────────────────────────────────────────────

export const CreateRazorpayOrderSchema = z.object({
  amount: z.number().int().positive(), // in paise
  purpose: z.string().default('subscription'),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type CreateRazorpayOrderBody = z.infer<typeof CreateRazorpayOrderSchema>;

export type CreateRazorpayOrderInput = {
  amount:   number;
  userId:   string;
  purpose:  string;
  meta?:    Record<string, unknown>;
};

export type RazorpayOrderResult = {
  orderId:  string;
  amount:   number;
  currency: string;
  keyId:    string;
};

// ─── Subscription payment meta (stored in PaymentOrder.meta) ─────────────────

export type SubscriptionPaymentMeta = {
  deviceTypeKey: string;
  planKey:       string;
  billingCycle:  'ANNUAL' | 'MONTHLY';
  addons:        AddonSnapshot[];
  startDate:     string;
};

// ─── Payment Session — created before WebView opens, matched by webhook ──────

export const CreatePaymentSessionSchema = z.object({
  amountRupees: z.number().positive(),
  purpose:      z.string().min(1),
  meta:         z.record(z.string(), z.unknown()).optional(),
});

export type CreatePaymentSessionBody  = z.infer<typeof CreatePaymentSessionSchema>;
export type CreatePaymentSessionInput = CreatePaymentSessionBody & { userId: string; phone: string };

export type CreatePaymentSessionResult = {
  sessionId: string;
};

// ─── Payment Link (WebView) — dynamic link with exact amount, no JS injection ─

export const CreatePaymentLinkSchema = z.object({
  amountRupees: z.number().positive(),
  purpose:      z.string().min(1),
  meta:         z.record(z.string(), z.unknown()).optional(),
  description:  z.string().optional(),
});

export type CreatePaymentLinkBody  = z.infer<typeof CreatePaymentLinkSchema>;
export type CreatePaymentLinkInput = CreatePaymentLinkBody & { userId: string; userName?: string; userPhone?: string; userEmail?: string };

export type CreatePaymentLinkResult = {
  url:    string; // short_url to load in WebView
  linkId: string; // plink_xxx — used for idempotency
};

// ─── WebView (link-based) completion — used before API keys are available ────

export const WebviewCompleteSchema = z.object({
  paymentId:    z.string().min(1),
  purpose:      z.string().min(1),
  amountRupees: z.number().positive(),
  meta:         z.record(z.string(), z.unknown()).optional(),
});

export type WebviewCompleteBody  = z.infer<typeof WebviewCompleteSchema>;
export type WebviewCompleteInput = WebviewCompleteBody & { userId: string };

export type WebviewCompleteResult = {
  purpose:        string;
  subscriptionId?: string;
  walletBalance?:  number;
};

// ─── Razorpay webhook ─────────────────────────────────────────────────────────

export type RazorpayPaymentEntity = {
  id:       string;
  order_id: string | null; // null for payment-link payments (no order created)
  amount:   number;        // in paise
  currency: string;
  status:   string;
  contact:  string | null; // user's phone number — used to match PaymentSession
};

export type RazorpayWebhookPayload = {
  entity:   string;
  event:    string;
  contains: string[];
  payload:  {
    payment?: { entity: RazorpayPaymentEntity };
  };
};
