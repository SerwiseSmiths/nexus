import { Response, NextFunction } from 'express';
import { ApiError, ApiResponse } from '@/utils/apiResponse';
import { SubscriptionService } from '@/services/subscription.service';
import { StrapiService } from '@/services/strapi.service';
import { PurchaseSubscriptionSchema } from '@/types/subscription.types';
import type { AuthRequest } from '@/middlewares/auth.middleware';

export class SubscriptionController {
  // ─── CMS catalogue (public) ──────────────────────────────────────────────────

  static async listPlans(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const plans = await StrapiService.fetchSubscriptionPlans();
      ApiResponse.success(res, 200, 'Plans fetched successfully', plans);
    } catch (error) {
      next(error);
    }
  }

  static async listAddons(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const deviceTypeKey = req.query.deviceType as string | undefined;
      const addons = await StrapiService.fetchSubscriptionAddons(deviceTypeKey);
      ApiResponse.success(res, 200, 'Addons fetched successfully', addons);
    } catch (error) {
      next(error);
    }
  }

  // ─── Purchase ────────────────────────────────────────────────────────────────

  static async purchase(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = PurchaseSubscriptionSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.issues);

      const subscription = await SubscriptionService.purchase({
        userId: req.user!.id,
        ...parsed.data,
      });

      ApiResponse.success(res, 201, 'Subscription purchased successfully', { subscription });
    } catch (error) {
      next(error);
    }
  }

  // ─── Query ───────────────────────────────────────────────────────────────────

  static async mySubscriptions(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const subscriptions = await SubscriptionService.listByUser(req.user!.id);
      ApiResponse.success(res, 200, 'Subscriptions fetched successfully', { subscriptions });
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const subscription = await SubscriptionService.getById(id, req.user!.id);
      ApiResponse.success(res, 200, 'Subscription fetched successfully', { subscription });
    } catch (error) {
      next(error);
    }
  }

  static async getActiveByDeviceType(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const deviceTypeKey = req.params.deviceTypeKey as string;
      const subscription = await SubscriptionService.getActiveByDeviceType(
        deviceTypeKey,
        req.user!.id,
      );
      ApiResponse.success(
        res,
        200,
        subscription ? 'Active subscription found' : 'No active subscription for this device type',
        { subscription },
      );
    } catch (error) {
      next(error);
    }
  }

  // ─── Cancel ──────────────────────────────────────────────────────────────────

  static async cancel(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const subscription = await SubscriptionService.cancel(id, req.user!.id);
      ApiResponse.success(res, 200, 'Subscription cancelled', { subscription });
    } catch (error) {
      next(error);
    }
  }

  // ─── Active plan summary (hero grid) ─────────────────────────────────────────

  static async activePlanSummary(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const summary = await SubscriptionService.getActivePlanSummary(req.user!.id);
      ApiResponse.success(res, 200, 'Active plan summary fetched', summary);
    } catch (error) {
      next(error);
    }
  }
}
