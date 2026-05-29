import { Response, NextFunction } from 'express';
import { ApiResponse } from '@/utils/apiResponse';
import { SubscriptionService } from '@/services/subscription.service';
import { StrapiService } from '@/services/strapi.service';
import { PurchaseSubscriptionSchema } from '@/types/subscription.types';
import type { AuthRequest } from '@/middlewares/auth.middleware';

export class SubscriptionController {
  // ─── CMS catalogue (public) ──────────────────────────────────────────────────

  static async listPlans(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const plans = await StrapiService.fetchSubscriptionPlans();
      res.status(200).json(ApiResponse.success('Plans fetched successfully', plans));
    } catch (error) {
      next(error);
    }
  }

  static async listAddons(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const deviceTypeKey = req.query.deviceType as string | undefined;
      const addons = await StrapiService.fetchSubscriptionAddons(deviceTypeKey);
      res.status(200).json(ApiResponse.success('Addons fetched successfully', addons));
    } catch (error) {
      next(error);
    }
  }

  // ─── Purchase ────────────────────────────────────────────────────────────────

  static async purchase(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = PurchaseSubscriptionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(ApiResponse.error(res, 400, 'Validation failed', parsed.error.issues));
        return;
      }

      const subscription = await SubscriptionService.purchase({
        userId: req.user!.id,
        ...parsed.data,
      });

      res.status(201).json(ApiResponse.success('Subscription purchased successfully', { subscription }));
    } catch (error) {
      next(error);
    }
  }

  // ─── Query ───────────────────────────────────────────────────────────────────

  static async mySubscriptions(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const subscriptions = await SubscriptionService.listByUser(req.user!.id);
      res.status(200).json(ApiResponse.success('Subscriptions fetched successfully', { subscriptions }));
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const subscription = await SubscriptionService.getById(req.params.id, req.user!.id);
      res.status(200).json(ApiResponse.success('Subscription fetched successfully', { subscription }));
    } catch (error) {
      next(error);
    }
  }

  static async getActiveByDeviceType(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const subscription = await SubscriptionService.getActiveByDeviceType(
        req.params.deviceTypeKey,
        req.user!.id,
      );
      res.status(200).json(
        ApiResponse.success(
          subscription ? 'Active subscription found' : 'No active subscription for this device type',
          { subscription },
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  // ─── Cancel ──────────────────────────────────────────────────────────────────

  static async cancel(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const subscription = await SubscriptionService.cancel(req.params.id, req.user!.id);
      res.status(200).json(ApiResponse.success('Subscription cancelled', { subscription }));
    } catch (error) {
      next(error);
    }
  }

  // ─── Active plan summary (hero grid) ─────────────────────────────────────────

  static async activePlanSummary(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const summary = await SubscriptionService.getActivePlanSummary(req.user!.id);
      res.status(200).json(ApiResponse.success('Active plan summary fetched', summary));
    } catch (error) {
      next(error);
    }
  }
}
