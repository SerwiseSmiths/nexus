import { Request, Response } from 'express';

export class HealthController {
  public static getStatus = (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'UP',
      timestamp: new Date().toISOString(),
      service: 'Nexus Backend',
    });
  };
}
