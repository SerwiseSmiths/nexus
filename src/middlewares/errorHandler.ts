import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';

export class AppError extends Error {
  constructor(public statusCode: number, public message: string) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message = err.message || 'Internal Server Error';

  logger.error(err);

  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message,
  });
};
