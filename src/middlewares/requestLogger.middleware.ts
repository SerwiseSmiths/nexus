import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';

export const requestLogger = (req: Request, _res: Response, next: NextFunction) => {
  logger.info(`[Request] ${req.method} ${req.originalUrl}`, {
    headers: req.headers,
    body:    req.body && Object.keys(req.body).length ? req.body : undefined,
  });

  next();
};
