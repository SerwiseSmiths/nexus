import { z } from 'zod';
import { ComplaintStage } from '@prisma/client';

// ---------------------------------------------------------------------------
// Zod request schemas
// ---------------------------------------------------------------------------

export const CreateComplaintSchema = z.object({
  title:     z.string().min(1, 'Title is required').max(200),
  notes:     z.string().optional(),
  addressId: z.string().uuid('Invalid address ID'),
  deviceId:  z.string().uuid('Invalid device ID').optional(),
  deviceKey: z.string().optional(),
});

export const UpdateStageSchema = z.object({
  stage:           z.nativeEnum(ComplaintStage),
  rejectionReason: z.string().optional(),
});

export const AssignProviderSchema = z.object({
  providerId: z.string().uuid('Invalid provider ID'),
});

export const AddQuoteSchema = z.object({
  items: z.array(z.object({
    partId:    z.string().optional(),       // Strapi documentId (from catalogue)
    name:      z.string().min(1),
    unitPrice: z.number().min(0),
    quantity:  z.number().int().min(1).default(1),
  })).min(1, 'At least one item is required'),
  notes: z.string().optional(),
});

export const RespondToQuoteSchema = z.object({
  approved:        z.boolean(),
  rejectionReason: z.string().optional(),
});

export const LinkDeviceSchema = z.object({
  deviceId:  z.string().uuid('Invalid device ID'),
  deviceKey: z.string().optional(),
});

export const ValidateQrSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export const ReopenComplaintSchema = z.object({
  title:     z.string().min(1).max(200).optional(),
  notes:     z.string().optional(),
  addressId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type CreateComplaintDto    = z.infer<typeof CreateComplaintSchema>;
export type UpdateStageDto        = z.infer<typeof UpdateStageSchema>;
export type AssignProviderDto     = z.infer<typeof AssignProviderSchema>;
export type AddQuoteDto           = z.infer<typeof AddQuoteSchema>;
export type RespondToQuoteDto     = z.infer<typeof RespondToQuoteSchema>;
export type LinkDeviceDto         = z.infer<typeof LinkDeviceSchema>;
export type ValidateQrDto         = z.infer<typeof ValidateQrSchema>;
export type ReopenComplaintDto    = z.infer<typeof ReopenComplaintSchema>;

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
export interface ReopenComplaintBody extends ReopenComplaintDto {}

// ---------------------------------------------------------------------------
// Service input interfaces (controller → service)
// ---------------------------------------------------------------------------

export interface CreateComplaintInput extends CreateComplaintDto {
  userId: string;
}

export interface UpdateStageInput extends UpdateStageDto {
  complaintId: string;
  updatedById: string;
}

export interface AssignProviderInput extends AssignProviderDto {
  complaintId: string;
}

export interface AddQuoteInput extends AddQuoteDto {
  complaintId: string;
  providerId:  string;
}

export interface RespondToQuoteInput extends RespondToQuoteDto {
  complaintId: string;
  userId:      string;
}

export interface LinkDeviceInput extends LinkDeviceDto {
  complaintId: string;
  userId:      string;
}

export interface ValidateQrInput extends ValidateQrDto {
  complaintId: string;
  providerId:  string;
}

export interface ReopenComplaintInput {
  complaintId: string;
  userId:      string;
  title?:      string;
  notes?:      string;
  addressId?:  string;
}
