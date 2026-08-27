import { Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AuthRequest } from '@/middlewares/auth.middleware';
import { ComplaintService } from '@/services/complaint.service';
import { ApiResponse } from '@/utils/apiResponse';
import {
  CreateComplaintSchema,
  UpdateStageSchema,
  AssignProviderSchema,
  AddQuoteSchema,
  RespondToQuoteSchema,
  LinkDeviceSchema,
  ValidateQrSchema,
  ReopenComplaintSchema,
  CompletePaymentSchema,
} from '@/types/complaint.types';

export class ComplaintController {
  // ─── CRUD ─────────────────────────────────────────────────────────────────

  static async createComplaint(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = CreateComplaintSchema.safeParse(req.body);
      if (!parsed.success) return ApiResponse.error(res, 400, 'Validation failed', parsed.error.issues);

      const complaints = await ComplaintService.createComplaint({
        userId: req.user!.id,
        ...parsed.data,
      });

      if (complaints.length === 1) {
        return ApiResponse.success(res, 201, 'Complaint created successfully', { complaint: complaints[0] });
      }
      return ApiResponse.success(res, 201, 'Complaints created successfully', { complaints });
    } catch (error) {
      next(error);
    }
  }

  static async listComplaints(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const complaints = await ComplaintService.listAll();
      return ApiResponse.success(res, 200, 'Complaints fetched successfully', { complaints });
    } catch (error) {
      next(error);
    }
  }

  static async myComplaints(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const complaints = await ComplaintService.listByCustomer(req.user!.id);
      return ApiResponse.success(res, 200, 'Complaints fetched successfully', { complaints });
    } catch (error) {
      next(error);
    }
  }

  static async assignedComplaints(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const complaints = await ComplaintService.listByProvider(req.user!.id);
      return ApiResponse.success(res, 200, 'Assigned complaints fetched successfully', { complaints });
    } catch (error) {
      next(error);
    }
  }

  static async getComplaint(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const complaint = await ComplaintService.getById(id, req.user!.id, req.user!.role);
      return ApiResponse.success(res, 200, 'Complaint fetched successfully', { complaint });
    } catch (error) {
      next(error);
    }
  }

  static async deleteComplaint(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await ComplaintService.deleteComplaint(id, req.user!.id, req.user!.role);
      return ApiResponse.success(res, 200, 'Complaint deleted successfully', null);
    } catch (error) {
      next(error);
    }
  }

  // ─── Stage ────────────────────────────────────────────────────────────────

  static async updateStage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = UpdateStageSchema.safeParse(req.body);
      if (!parsed.success) return ApiResponse.error(res, 400, 'Validation failed', parsed.error.issues);

      const complaint = await ComplaintService.updateStage({
        complaintId: req.params.id as string,
        updatedById: req.user!.id,
        ...parsed.data,
      });

      return ApiResponse.success(res, 200, 'Stage updated successfully', { complaint });
    } catch (error) {
      next(error);
    }
  }

  // ─── Provider Assignment ──────────────────────────────────────────────────

  static async assignProvider(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = AssignProviderSchema.safeParse(req.body);
      if (!parsed.success) return ApiResponse.error(res, 400, 'Validation failed', parsed.error.issues);

      const complaint = await ComplaintService.assignProvider({
        complaintId: req.params.id as string,
        ...parsed.data,
      });

      return ApiResponse.success(res, 200, 'Provider assigned successfully', { complaint });
    } catch (error) {
      next(error);
    }
  }

  static async acceptAssignment(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const complaint = await ComplaintService.acceptAssignment(req.params.id as string, req.user!.id);
      return ApiResponse.success(res, 200, 'Assignment accepted', { complaint });
    } catch (error) {
      next(error);
    }
  }

  static async rejectAssignment(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const complaint = await ComplaintService.rejectAssignment(req.params.id as string, req.user!.id);
      return ApiResponse.success(res, 200, 'Assignment rejected', { complaint });
    } catch (error) {
      next(error);
    }
  }

  // ─── Quote ────────────────────────────────────────────────────────────────

  static async addQuote(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = AddQuoteSchema.safeParse(req.body);
      if (!parsed.success) return ApiResponse.error(res, 400, 'Validation failed', parsed.error.issues);

      const result = await ComplaintService.addQuote({
        complaintId: req.params.id as string,
        providerId:  req.user!.id,
        ...parsed.data,
      });

      return ApiResponse.success(res, 201, 'Quote submitted successfully', result);
    } catch (error) {
      next(error);
    }
  }

  static async respondToQuote(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = RespondToQuoteSchema.safeParse(req.body);
      if (!parsed.success) return ApiResponse.error(res, 400, 'Validation failed', parsed.error.issues);

      const complaint = await ComplaintService.respondToQuote({
        complaintId: req.params.id as string,
        userId:      req.user!.id,
        asAdmin:     req.user!.role === Role.ADMIN,
        ...parsed.data,
      });

      return ApiResponse.success(res, 200, 'Quote response recorded', { complaint });
    } catch (error) {
      next(error);
    }
  }

  // ─── Device ───────────────────────────────────────────────────────────────

  static async linkDevice(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = LinkDeviceSchema.safeParse(req.body);
      if (!parsed.success) return ApiResponse.error(res, 400, 'Validation failed', parsed.error.issues);

      const complaint = await ComplaintService.linkDevice({
        complaintId:   req.params.id as string,
        requesterId:   req.user!.id,
        requesterRole: req.user!.role,
        ...parsed.data,
      });

      return ApiResponse.success(res, 200, 'Device linked successfully', { complaint });
    } catch (error) {
      next(error);
    }
  }

  static async completePayment(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = CompletePaymentSchema.safeParse(req.body);
      if (!parsed.success) return ApiResponse.error(res, 400, 'Validation failed', parsed.error.issues);

      const complaint = await ComplaintService.completePayment({
        complaintId: req.params.id as string,
        providerId:  req.user!.id,
        ...parsed.data,
      });

      return ApiResponse.success(res, 200, 'Payment completed successfully', { complaint });
    } catch (error) {
      next(error);
    }
  }

  // ─── QR Entry ─────────────────────────────────────────────────────────────

  static async generateEntryQr(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await ComplaintService.generateEntryQr(req.params.id as string, req.user!.id);
      return ApiResponse.success(res, 200, 'QR token generated', result);
    } catch (error) {
      next(error);
    }
  }

  static async validateEntryQr(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = ValidateQrSchema.safeParse(req.body);
      if (!parsed.success) return ApiResponse.error(res, 400, 'Validation failed', parsed.error.issues);

      const complaint = await ComplaintService.validateEntryQr({
        complaintId: req.params.id as string,
        providerId:  req.user!.id,
        ...parsed.data,
      });

      return ApiResponse.success(res, 200, 'QR validated — provider arrival confirmed', { complaint });
    } catch (error) {
      next(error);
    }
  }

  static async requestEntranceScan(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await ComplaintService.requestEntranceScan(req.params.id as string, req.user!.id);
      return ApiResponse.success(res, 200, result.message, null);
    } catch (error) {
      next(error);
    }
  }

  // ─── Reopen ───────────────────────────────────────────────────────────────

  static async reopenComplaint(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = ReopenComplaintSchema.safeParse(req.body);
      if (!parsed.success) return ApiResponse.error(res, 400, 'Validation failed', parsed.error.issues);

      const complaint = await ComplaintService.reopenComplaint({
        complaintId: req.params.id as string,
        userId:      req.user!.id,
        ...parsed.data,
      });

      return ApiResponse.success(res, 201, 'Complaint reopened', { complaint });
    } catch (error) {
      next(error);
    }
  }

  // ─── Dev ──────────────────────────────────────────────────────────────────

  static async devAdvanceStage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const complaint = await ComplaintService.devAdvance(req.params.id as string);
      return ApiResponse.success(res, 200, 'Stage advanced (dev)', { complaint });
    } catch (error) {
      next(error);
    }
  }
}
