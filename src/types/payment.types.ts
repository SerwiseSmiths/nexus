import { z } from 'zod';
import type { PaymentOrderStatus } from '@prisma/client';
import type { AddonSnapshot } from '@/types/subscription.types';

// ─── Razorpay order creation ──────────────────────────────────────────────────

export const PAYMENT_PURPOSES = ['subscription', 'recharge', 'complaint_payment'] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export const CreateRazorpayOrderSchema = z.object({
  // In paise. Never trusted as the price — the server computes what the
  // purpose costs and rejects a mismatch (see PaymentService.resolveOrder).
  amount: z.number().int().positive(),
  purpose: z.enum(PAYMENT_PURPOSES).default('subscription'),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type CreateRazorpayOrderBody = z.infer<typeof CreateRazorpayOrderSchema>;

export type CreateRazorpayOrderInput = {
  amount:   number;
  userId:   string;
  purpose:  PaymentPurpose;
  meta?:    Record<string, unknown>;
};

export type RazorpayOrderResult = {
  orderId:  string;
  amount:   number;
  currency: string;
  keyId:    string;
};

export type PaymentOrderStatusResult = {
  orderId: string;
  purpose: string;
  status:  PaymentOrderStatus;
  amount:  number; // paise
};

// ─── Per-purpose meta (validated at order creation, stored in PaymentOrder.meta)

// Addon prices sent by the client are ignored — only the keys are used, and
// each addon is re-priced from the CMS before the order is created.
export const SubscriptionOrderMetaSchema = z.object({
  deviceTypeKey: z.string().min(1),
  planKey:       z.string().min(1),
  billingCycle:  z.enum(['ANNUAL', 'MONTHLY']),
  addons:        z.array(z.object({ key: z.string().min(1) }).passthrough()).default([]),
  startDate:     z.string().datetime({ message: 'startDate must be an ISO datetime string' }),
});

// Website booking-fee QR — the amount and meta are checked exactly like a
// complaint_payment order (see PaymentService.resolveOrder).
export const CreateBookingQrSchema = z.object({
  amount: z.number().int().positive(), // in paise
  meta:   z.record(z.string(), z.unknown()),
});

export const ComplaintPaymentMetaSchema = z.object({
  serviceType:      z.string().optional(),
  deviceLines:      z.string().optional(),
  addressId:        z.string().min(1, 'addressId is required'),
  requestedDevices: z
    .array(z.object({ deviceKey: z.string().min(1), quantity: z.number().int().positive() }))
    .min(1, 'requestedDevices is required'),
  tags:             z.array(z.string()).optional(),
  notes:            z.string().optional(),
});

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
  id:       string;
  order_id: string | null;
  amount:   number;        // in paise
  currency: string;
  status:   string;
  contact:  string | null;
};

export type RazorpayQrCodeEntity = {
  id:                       string;  // qr_xxx
  status:                   string;
  payments_amount_received: number;  // paise
  notes:                    Record<string, string> | null;
};

export type RazorpayWebhookPayload = {
  entity:   string;
  event:    string;
  contains: string[];
  payload:  {
    payment?: { entity: RazorpayPaymentEntity };
    qr_code?: { entity: RazorpayQrCodeEntity }; // qr_code.* events only
  };
};
