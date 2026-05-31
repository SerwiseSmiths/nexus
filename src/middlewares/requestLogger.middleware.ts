import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';

export const requestLogger = (req: Request, _res: Response, next: NextFunction) => {
  logger.info(`[Request] ${req.method} ${req.originalUrl}`, {
    headers: JSON.stringify(req.headers),
    body:    req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : undefined,
  });

  next();
};
