import { Request, Response, NextFunction } from 'express';
import { ApiError } from '@/utils/apiResponse';
export declare const errorHandler: (err: Error | ApiError, _req: Request, res: Response, _next: NextFunction) => any;
