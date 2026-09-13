import { z } from 'zod';
import { ComplaintStage, Role } from '@prisma/client';

// ---------------------------------------------------------------------------
// Zod request schemas
// ---------------------------------------------------------------------------

// What the customer asks for at creation time — device *type* + quantity, no
// pre-existing Device row required. Actual Device rows get created/linked
// later, once a provider identifies each physical unit on-site (see
// LinkDeviceSchema / ComplaintService.linkDevice).
const RequestedDeviceSchema = z.object({
  deviceKey: z.string().min(1, 'deviceKey is required'),
  quantity:  z.number().int().min(1, 'Quantity must be at least 1').default(1),
});

export const CreateComplaintSchema = z.object({
  title:            z.string().min(1, 'Title is required').max(200, 'Title must be 200 characters or fewer'),
  notes:            z.string().optional(),
  addressId:        z.string().uuid('Invalid address ID'),
  requestedDevices: z.array(RequestedDeviceSchema).min(1, 'At least one device is required'),
  // Only read when the caller is ADMIN — identifies which customer the ticket is
  // raised for, since an admin isn't the complaint's owner the way a customer is.
  customerId: z.string().uuid('Invalid customer ID').optional(),
});

export const UpdateStageSchema = z.object({
  stage:           z.nativeEnum(ComplaintStage, { error: 'Please select a valid stage' }),
  rejectionReason: z.string().optional(),
});

export const AssignProviderSchema = z.object({
  providerId: z.string().uuid('Invalid provider ID'),
});

export const AddQuoteSchema = z.object({
  items: z.array(z.object({
    partId:    z.string().optional(),       // Strapi documentId (from catalogue)
    name:      z.string().min(1, 'Item name is required'),
    unitPrice: z.number().min(0, 'Unit price cannot be negative'),
    quantity:  z.number().int().min(1, 'Quantity must be at least 1').default(1),
    // For a catalogue item (partId set): overrides the CMS price with this
    // exact value instead of re-resolving it from the CMS — a manual backup
    // for when the real cost ran higher than the listed catalogue price.
    // Ignored for a custom item (no partId), which is always admin-priced.
    priceOverridden: z.boolean().optional(),
  })).min(1, 'At least one item is required'),
  notes: z.string().optional(),
});

export const RespondToQuoteSchema = z.object({
  approved:        z.boolean({ error: 'Please specify whether the quote is approved' }),
  rejectionReason: z.string().optional(),
});

// A provider identifies physical units on-site — each item either points at
// a device the customer already owns (deviceId), or describes a brand-new
// one to create (deviceKey + metadata), but never both.
const LinkDeviceItemSchema = z.object({
  deviceId:  z.string().uuid('Invalid device ID').optional(),
  deviceKey: z.string().min(1, 'deviceKey is required').optional(),
  metadata:  z.record(z.string(), z.unknown()).optional(),
  imageUrl:  z.string().optional(),
}).refine(
  (item) => Boolean(item.deviceId) !== Boolean(item.deviceKey),
  { message: 'Each device must have either deviceId (existing device) or deviceKey (new device), not both' },
);

export const LinkDeviceSchema = z.object({
  devices: z.array(LinkDeviceItemSchema).min(1, 'At least one device is required'),
});

export const ValidateQrSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export const ReopenComplaintSchema = z.object({
  title:     z.string().min(1, 'Title is required').max(200, 'Title must be 200 characters or fewer').optional(),
  notes:     z.string().optional(),
  addressId: z.string().uuid('Invalid address ID').optional(),
});

export const CompletePaymentSchema = z.object({
  method: z.enum(['CASH', 'WALLET'], 'Please choose a payment method: CASH or WALLET'),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type RequestedDevice       = z.infer<typeof RequestedDeviceSchema>;
export type CreateComplaintDto    = z.infer<typeof CreateComplaintSchema>;
export type UpdateStageDto        = z.infer<typeof UpdateStageSchema>;
export type AssignProviderDto     = z.infer<typeof AssignProviderSchema>;
export type AddQuoteDto           = z.infer<typeof AddQuoteSchema>;
export type RespondToQuoteDto     = z.infer<typeof RespondToQuoteSchema>;
export type LinkDeviceItemDto     = z.infer<typeof LinkDeviceItemSchema>;
export type LinkDeviceDto         = z.infer<typeof LinkDeviceSchema>;
export type ValidateQrDto         = z.infer<typeof ValidateQrSchema>;
export type ReopenComplaintDto    = z.infer<typeof ReopenComplaintSchema>;
export type CompletePaymentDto    = z.infer<typeof CompletePaymentSchema>;

// ---------------------------------------------------------------------------
// Request body interfaces (what controllers receive from req.body)
// ---------------------------------------------------------------------------

export interface CreateComplaintBody extends CreateComplaintDto {}
export interface UpdateStageBody     extends UpdateStageDto {}
export interface AssignProviderBody  extends AssignProviderDto {}
export interface AddQuoteBody        extends AddQuoteDto {}
export interface RespondToQuoteBody  extends RespondToQuoteDto {}
export interface LinkDeviceBody      extends LinkDeviceDto {}
export interface ValidateQrBody      extends ValidateQrDto {}
export interface ReopenComplaintBody    extends ReopenComplaintDto {}
export interface CompletePaymentBody   extends CompletePaymentDto {}

// ---------------------------------------------------------------------------
// Service input interfaces (controller → service)
// ---------------------------------------------------------------------------

export interface CreateComplaintInput extends CreateComplaintDto {
  userId: string;
}

export interface UpdateStageInput extends UpdateStageDto {
  complaintId:   string;
  updatedById:   string;
  requesterRole: Role;
}

export interface AssignProviderInput extends AssignProviderDto {
  complaintId: string;
  // Who triggered this assignment — an admin via the API, or omitted when
  // the system auto-assigned (createComplaint, rejectAssignment's
  // reassignment, the assignment-deadline sweep). Recorded on the
  // complaint's audit log (see ComplaintService.logComplaintEvent).
  actorId?:   string;
  actorRole?: Role;
}

export interface AddQuoteInput extends AddQuoteDto {
  complaintId: string;
  // The provider's own id, or the admin's id when submitting on the
  // provider's behalf from watchtower (see `asAdmin`).
  requesterId: string;
  // True when an ADMIN is entering the quote on the assigned provider's
  // behalf from watchtower — skips the providerId ownership filter (an
  // admin isn't the complaint's provider) but still requires a provider to
  // already be assigned, since a quote is inherently that provider's estimate.
  asAdmin?: boolean;
}

export interface RespondToQuoteInput extends RespondToQuoteDto {
  complaintId: string;
  userId:      string;
  // True when an ADMIN is acting on the customer's behalf from watchtower —
  // skips the userId ownership filter (admin isn't the complaint's customer)
  // but rejectedBy still records the real actor (the admin), not the customer.
  asAdmin?:    boolean;
}

export interface LinkDeviceInput extends LinkDeviceDto {
  complaintId:   string;
  requesterId:   string;
  requesterRole: Role;
}

export interface ValidateQrInput extends ValidateQrDto {
  complaintId: string;
  providerId:  string;
}

export interface ReopenComplaintInput {
  complaintId: string;
  userId:      string;
  // True when an ADMIN is reopening on the customer's behalf from watchtower —
  // skips the userId ownership filter and reopens as the original complaint's
  // owner rather than the admin.
  asAdmin?:    boolean;
  title?:      string;
  notes?:      string;
  addressId?:  string;
}

export interface CompletePaymentInput extends CompletePaymentDto {
  complaintId: string;
  providerId:  string;
}
