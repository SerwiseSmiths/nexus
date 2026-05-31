import { Response, NextFunction } from 'express';
import { ApiError, ApiResponse } from '@/utils/apiResponse';
import { StrapiService } from '@/services/strapi.service';
import type { AuthRequest } from '@/middlewares/auth.middleware';

export class PartsController {
  static async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const deviceType = req.query.deviceType as string | undefined;
      const parts = await StrapiService.fetchParts(deviceType);
      ApiResponse.success(res, 200, 'Parts fetched successfully', parts);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const documentId = req.params.documentId as string;
      const part = await StrapiService.fetchPartByDocumentId(documentId);
      if (!part) throw new ApiError(404, 'Part not found');
      ApiResponse.success(res, 200, 'Part fetched successfully', part);
    } catch (error) {
      next(error);
    }
  }
}
