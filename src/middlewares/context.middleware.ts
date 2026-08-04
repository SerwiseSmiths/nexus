import { Response, NextFunction } from 'express';
import { AppContext, AppContextRequest } from '../types/appContext';
import { ApiResponse } from '../utils/apiResponse';

export const contextMiddleware = (req: AppContextRequest, res: Response, next: NextFunction) => {
  // Razorpay webhook is sent by Razorpay's servers — no x-app-id header
  if (req.originalUrl === '/api/payments/razorpay/webhook') return next();

  // OTA routes are called by hot-updater's native client (public check-update
  // API, callable by any installed app build with no prior token — same as
  // AWS's own guidance to never gate that endpoint) and by the deploy CLI
  // (admin API, gated separately by otaDeployAuth) — neither is a user-facing
  // app context.
  if (req.originalUrl.startsWith('/api/ota/')) return next();

  const appId = req.headers['x-app-id'];

  if (!appId) {
    return ApiResponse.error(res, 400, 'Missing x-app-id header');
  }

  const validAppIds = Object.values(AppContext) as string[];

  if (!validAppIds.includes(appId as string)) {
    return ApiResponse.error(res, 400, `Invalid x-app-id context. Valid values are: ${validAppIds.join(', ')}`);
  }

  req.appContext = appId as AppContext;
  return next();
};
