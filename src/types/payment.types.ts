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

// ─── Razorpay webhook ─────────────────────────────────────────────────────────

export type RazorpayPaymentEntity = {
  id:        string;
  order_id:  string;
  amount:    number;
  currency:  string;
  status:    string;
};

export type RazorpayWebhookPayload = {
  entity:   string;
  event:    string;
  contains: string[];
  payload:  {
    payment?: { entity: RazorpayPaymentEntity };
  };
};
