import { NextFunction, Response } from 'express';
import type { AuthRequest } from '@/middlewares/auth.middleware';
import { ProviderTierService } from '@/services/provider-tier.service';
import { ApiResponse } from '@/utils/apiResponse';
import type {
  CreateProviderTierBody,
  UpdateProviderTierBody,
} from '@/types/provider-tier.types';

export class ProviderTierController {
  static async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as CreateProviderTierBody;
      const tier = await ProviderTierService.create(body);
      return ApiResponse.success(res, 201, 'Provider tier created successfully', { tier });
    } catch (error) {
      next(error);
    }
  }

  static async getAll(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const tiers = await ProviderTierService.findAll();
      return ApiResponse.success(res, 200, 'Provider tiers fetched successfully', { tiers });
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const tier = await ProviderTierService.findById(req.params.id as string);
      return ApiResponse.success(res, 200, 'Provider tier fetched successfully', { tier });
    } catch (error) {
      next(error);
    }
  }

  static async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as UpdateProviderTierBody;
      const tier = await ProviderTierService.update({ tierId: req.params.id as string, ...body });
      return ApiResponse.success(res, 200, 'Provider tier updated successfully', { tier });
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await ProviderTierService.remove(req.params.id as string);
      return ApiResponse.success(res, 200, 'Provider tier deleted successfully', null);
    } catch (error) {
      next(error);
    }
  }
}
