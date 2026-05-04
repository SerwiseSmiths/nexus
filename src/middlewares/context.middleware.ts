import { Response, NextFunction } from 'express';
import { AppContext, AppContextRequest } from '../types/appContext';
import { ApiResponse } from '../utils/apiResponse';

export const contextMiddleware = (req: AppContextRequest, res: Response, next: NextFunction) => {
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
