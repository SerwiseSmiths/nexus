import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';

export const requestLogger = (req: Request, _res: Response, next: NextFunction) => {
  logger.info(`[Request] ${req.method} ${req.originalUrl}`);
  logger.info(`[Request Headers] ${JSON.stringify(req.headers)}`);
  if (req.body && Object.keys(req.body).length) {
    logger.info(`[Request Body] ${JSON.stringify(req.body)}`);
  }

  next();
};
