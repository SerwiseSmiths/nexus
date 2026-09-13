import { Request, Response, NextFunction } from 'express';
export declare class HealthController {
    static ping: (_req: Request, res: Response, next: NextFunction) => Promise<any>;
}
