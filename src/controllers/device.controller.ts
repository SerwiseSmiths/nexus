import { Response, NextFunction } from 'express';
import { AuthRequest } from '@/middlewares/auth.middleware';
import { DeviceService } from '@/services/device.service';
import { ApiResponse } from '@/utils/apiResponse';
import type {
  AddDeviceBody,
  UpdateDeviceBody,
  AddWorkHistoryBody,
  DeviceKey,
} from '@/types/device.types';

export class DeviceController {
  static async addDevice(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { deviceKey, addressId, imageUrl, metadata } = req.body as AddDeviceBody;
      if (!deviceKey) return ApiResponse.error(res, 400, 'deviceKey is required');
      if (!metadata)  return ApiResponse.error(res, 400, 'metadata is required');

      const device = await DeviceService.addDevice({
        userId:    req.user!.id,
        addressId,
        deviceKey: deviceKey as DeviceKey,
        imageUrl,
        metadata,
      });

      return ApiResponse.success(res, 201, 'Device added successfully', { device });
    } catch (error) {
      next(error);
    }
  }

  static async getDevices(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const deviceKey = req.query.deviceKey as string | undefined;
      const devices   = await DeviceService.getDevices(req.user!.id, deviceKey);
      return ApiResponse.success(res, 200, 'Devices fetched successfully', { devices });
    } catch (error) {
      next(error);
    }
  }

  static async getDevice(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const device = await DeviceService.getDevice(req.params.id as string, req.user!.id);
      return ApiResponse.success(res, 200, 'Device fetched successfully', { device });
    } catch (error) {
      next(error);
    }
  }

  static async updateDevice(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { imageUrl, metadata } = req.body as UpdateDeviceBody;
      const device = await DeviceService.updateDevice({
        deviceId: req.params.id as string,
        userId:   req.user!.id,
        imageUrl,
        metadata,
      });
      return ApiResponse.success(res, 200, 'Device updated successfully', { device });
    } catch (error) {
      next(error);
    }
  }

  static async deleteDevice(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await DeviceService.deleteDevice(req.params.id as string, req.user!.id);
      return ApiResponse.success(res, 200, 'Device deleted successfully', null);
    } catch (error) {
      next(error);
    }
  }

  static async addWorkHistory(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { event, eventDate, notes } = req.body as AddWorkHistoryBody;
      if (!event)     return ApiResponse.error(res, 400, 'event is required');
      if (!eventDate) return ApiResponse.error(res, 400, 'eventDate is required');

      const entry = await DeviceService.addWorkHistory({
        deviceId:  req.params.id as string,
        userId:    req.user!.id,
        event,
        eventDate,
        notes,
      });

      return ApiResponse.success(res, 201, 'Work history entry added successfully', { entry });
    } catch (error) {
      next(error);
    }
  }

  static async getWorkHistory(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const history = await DeviceService.getWorkHistory(req.params.id as string, req.user!.id);
      return ApiResponse.success(res, 200, 'Work history fetched successfully', { history });
    } catch (error) {
      next(error);
    }
  }

  static async deleteWorkHistoryEntry(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await DeviceService.deleteWorkHistoryEntry(
        req.params.entryId as string,
        req.params.id      as string,
        req.user!.id,
      );
      return ApiResponse.success(res, 200, 'Work history entry deleted successfully', null);
    } catch (error) {
      next(error);
    }
  }
}
