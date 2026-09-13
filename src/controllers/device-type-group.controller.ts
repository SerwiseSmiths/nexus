import { NextFunction, Response } from 'express';
import type { AuthRequest } from '@/middlewares/auth.middleware';
import { DeviceTypeGroupService } from '@/services/device-type-group.service';
import { ApiResponse } from '@/utils/apiResponse';
import type {
  CreateDeviceTypeGroupBody,
  UpdateDeviceTypeGroupBody,
} from '@/types/device-type-group.types';

export class DeviceTypeGroupController {
  static async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as CreateDeviceTypeGroupBody;
      const group = await DeviceTypeGroupService.create(body);
      return ApiResponse.success(res, 201, 'Device type group created successfully', { group });
    } catch (error) {
      next(error);
    }
  }

  static async getAll(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const groups = await DeviceTypeGroupService.findAll();
      return ApiResponse.success(res, 200, 'Device type groups fetched successfully', { groups });
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const group = await DeviceTypeGroupService.findByKey(req.params.key as string);
      return ApiResponse.success(res, 200, 'Device type group fetched successfully', { group });
    } catch (error) {
      next(error);
    }
  }

  static async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as UpdateDeviceTypeGroupBody;
      const group = await DeviceTypeGroupService.update({ key: req.params.key as string, ...body });
      return ApiResponse.success(res, 200, 'Device type group updated successfully', { group });
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await DeviceTypeGroupService.remove(req.params.key as string);
      return ApiResponse.success(res, 200, 'Device type group deleted successfully', null);
    } catch (error) {
      next(error);
    }
  }
}
