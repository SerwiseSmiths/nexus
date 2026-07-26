import { NextFunction, Response } from 'express';
import { ApiResponse } from '@/utils/apiResponse';
import { HomeService } from '@/services/home.service';
import type { AuthRequest } from '@/middlewares/auth.middleware';

export class HomeController {
  static async getProviderStats(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const stats = await HomeService.getProviderHomeStats(req.user!.id);
      ApiResponse.success(res, 200, 'Home stats fetched successfully', stats);
    } catch (error) {
      next(error);
    }
  }
}
