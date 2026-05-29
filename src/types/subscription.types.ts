import { z } from 'zod';

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const AddonSnapshotSchema = z.object({
  key:   z.string(),
  name:  z.string(),
  price: z.number().min(0),
});

export const PurchaseSubscriptionSchema = z.object({
  deviceTypeKey: z.string().min(1),
  planKey:       z.string().min(1),
  billingCycle:  z.enum(['ANNUAL', 'MONTHLY']),
  addons:        z.array(AddonSnapshotSchema).default([]),
  startDate:     z.string().datetime({ message: 'startDate must be an ISO datetime string' }),
});

// ─── TypeScript interfaces ────────────────────────────────────────────────────

export type AddonSnapshot = z.infer<typeof AddonSnapshotSchema>;

export type PurchaseSubscriptionBody = z.infer<typeof PurchaseSubscriptionSchema>;

export interface PurchaseSubscriptionInput extends PurchaseSubscriptionBody {
  userId: string;
}

// ─── CMS plan / addon shapes ──────────────────────────────────────────────────

export interface CmsPlanFeature {
  title:       string;
  description: string | null;
  qty:         string | null;
}

export interface CmsVisitService {
  visit_number:  number;
  label:         string;
  service_parts: Array<{ documentId: string; name: string }>;
}

export interface CmsSubscriptionPlan {
  documentId:      string;
  key:             string;
  name:            string;
  badge:           string | null;
  badge_color:     string | null;
  annual_price:    number;
  monthly_price:   number;
  tagline:         string | null;
  max_services:    number;
  duration_months: number;
  sort_order:      number;
  is_active:       boolean;
  visit_services:  CmsVisitService[];
  features:        CmsPlanFeature[];
}

export interface CmsSubscriptionAddon {
  documentId:  string;
  key:         string;
  name:        string;
  price:       number;
  description: string | null;
  imageUrl:    string | null;
  is_active:   boolean;
  sort_order:  number;
  device_types: Array<{ documentId: string; key: string; label: string }>;
}
