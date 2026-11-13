import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';
import { ApiResponse, ApiError } from '@/utils/apiResponse';

export const errorHandler = (
  err: Error | ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  logger.error(err);

  // P2034: a Serializable transaction lost a write conflict — i.e. a
  // concurrent request (double-click, second admin) touched the same wallet
  // or record first. Nothing was committed; the client can safely retry.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
    return ApiResponse.error(res, 409, 'This was updated by another request at the same time — please refresh and try again');
  }

  const statusCode = err instanceof ApiError ? err.statusCode : 500;
  const message = err.message || 'Internal Server Error';

  return ApiResponse.error(res, statusCode, message, (err as any).data);
};
