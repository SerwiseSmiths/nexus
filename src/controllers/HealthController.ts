import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@/utils/apiResponse';
import prisma from '@/services/prisma.service';

export class HealthController {
  public static ping = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return ApiResponse.success(res, 200, 'OK', {
        status: 'UP',
        db: 'connected',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  };
}
