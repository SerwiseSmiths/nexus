import { Request, Response, NextFunction } from 'express';
import { DeviceType, ProviderSignupStatus } from '@prisma/client';
import { z } from 'zod';
import { AuthRequest } from '@/middlewares/auth.middleware';
import { ProviderSignupService } from '@/services/provider-signup.service';
import { ApiResponse } from '@/utils/apiResponse';
import { isValidPhoneNo } from '@/utils/validators';

const createSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(60),
  lastName: z.string().trim().min(1, 'Last name is required').max(60),
  phoneNo: z.string().refine(isValidPhoneNo, 'Enter a valid 10-digit mobile number'),
  city: z.string().trim().min(1, 'City is required').max(60),
  deviceTypes: z.array(z.nativeEnum(DeviceType)).min(1, 'Pick at least one appliance you service'),
  experienceYears: z.number().int().min(0).max(60).optional(),
});

const updateSchema = z.object({
  status: z.nativeEnum(ProviderSignupStatus).optional(),
  adminNotes: z.string().max(1000).nullable().optional(),
});

export class ProviderSignupController {
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return ApiResponse.error(res, 400, parsed.error.issues[0].message);
      }

      const request = await ProviderSignupService.create(parsed.data);
      return ApiResponse.success(res, 201, 'Request received — our team will contact you soon', {
        request: { id: request.id, status: request.status },
      });
    } catch (error) {
      next(error);
    }
  }

  static async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const raw = req.query.status as string | undefined;
      const status = raw && raw in ProviderSignupStatus ? (raw as ProviderSignupStatus) : undefined;
      const requests = await ProviderSignupService.list({ status });
      return ApiResponse.success(res, 200, 'Signup requests fetched successfully', { requests });
    } catch (error) {
      next(error);
    }
  }

  static async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return ApiResponse.error(res, 400, parsed.error.issues[0].message);
      }

      const request = await ProviderSignupService.update({ id: req.params.id as string, ...parsed.data });
      return ApiResponse.success(res, 200, 'Signup request updated successfully', { request });
    } catch (error) {
      next(error);
    }
  }
}
