import { NextFunction, Response } from 'express';
import type { AuthRequest } from '@/middlewares/auth.middleware';
import { ServicePartPricingService } from '@/services/service-part-pricing.service';
import { ApiResponse } from '@/utils/apiResponse';
import type { UpsertPartPricingBody } from '@/types/service-part-pricing.types';

export class ServicePartPricingController {
  static async listByTier(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const providerTierId = req.query.providerTierId as string | undefined;
      if (!providerTierId) return ApiResponse.error(res, 400, 'providerTierId query param is required');

      const pricing = await ServicePartPricingService.listByTier(providerTierId);
      return ApiResponse.success(res, 200, 'Part pricing fetched successfully', { pricing });
    } catch (error) {
      next(error);
    }
  }

  static async upsert(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as UpsertPartPricingBody;
      const pricing = await ServicePartPricingService.upsert(body);
      return ApiResponse.success(res, 200, 'Part pricing saved successfully', { pricing });
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const servicePartId = req.query.servicePartId as string | undefined;
      const providerTierId = req.query.providerTierId as string | undefined;
      if (!servicePartId || !providerTierId) {
        return ApiResponse.error(res, 400, 'servicePartId and providerTierId query params are required');
      }

      await ServicePartPricingService.remove({ servicePartId, providerTierId });
      return ApiResponse.success(res, 200, 'Part pricing reset to default successfully', null);
    } catch (error) {
      next(error);
    }
  }
}
