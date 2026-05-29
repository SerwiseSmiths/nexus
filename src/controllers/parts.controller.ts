import { Response, NextFunction } from 'express';
import { ApiError, ApiResponse } from '@/utils/apiResponse';
import { StrapiService } from '@/services/strapi.service';
import type { AuthRequest } from '@/middlewares/auth.middleware';

export class PartsController {
  static async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const deviceType = req.query.deviceType as string | undefined;
      const parts = await StrapiService.fetchParts(deviceType);
      res.status(200).json(ApiResponse.success('Parts fetched successfully', parts));
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { documentId } = req.params;
      const part = await StrapiService.fetchPartByDocumentId(documentId);
      if (!part) throw new ApiError(404, 'Part not found');
      res.status(200).json(ApiResponse.success('Part fetched successfully', part));
    } catch (error) {
      next(error);
    }
  }
}
