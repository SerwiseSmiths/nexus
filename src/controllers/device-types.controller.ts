import { Response, NextFunction } from 'express';
import { ApiResponse } from '@/utils/apiResponse';
import { StrapiService } from '@/services/strapi.service';
import type { AuthRequest } from '@/middlewares/auth.middleware';

export class DeviceTypesController {
  static async list(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const deviceTypes = await StrapiService.fetchDeviceTypes();
      res.status(200).json(ApiResponse.success('Device types fetched successfully', deviceTypes));
    } catch (error) {
      next(error);
    }
  }
}
