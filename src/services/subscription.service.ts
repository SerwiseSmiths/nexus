import { BillingCycle, SubscriptionStatus } from '@prisma/client';
import prisma from '@/services/prisma.service';
import { StrapiService } from '@/services/strapi.service';
import { TelegramService } from '@/services/telegram.service';
import { ApiError } from '@/utils/apiResponse';
import { logger } from '@/utils/logger';
import type { PurchaseSubscriptionInput, AddonSnapshot } from '@/types/subscription.types';

// ─── Shared include ───────────────────────────────────────────────────────────

const SUBSCRIPTION_INCLUDE = {
  services: {
    where:   { isDeleted: false },
    orderBy: { visitNumber: 'asc' as const },
  },
} as const;

export class SubscriptionService {
  // ─── Purchase ───────────────────────────────────────────────────────────────

  static async purchase(input: PurchaseSubscriptionInput) {
    const { userId, deviceTypeKey, planKey, billingCycle, addons, startDate } = input;

    // Check for existing active subscription for this user + device type
    const existing = await prisma.subscription.findFirst({
      where: {
        userId,
        deviceTypeKey,
        status: SubscriptionStatus.ACTIVE,
        isDeleted: false,
      },
    });
    if (existing) throw new ApiError(409, `An active subscription already exists for this device type`);

    // Fetch plan from CMS to validate and snapshot pricing
    const plans = await StrapiService.fetchSubscriptionPlans();
    const plan = plans.find((p) => p.key === planKey);
    if (!plan) throw new ApiError(404, `Subscription plan '${planKey}' not found`);

    const planPrice = billingCycle === BillingCycle.ANNUAL ? plan.annual_price : plan.monthly_price;
    const addonTotal = (addons as AddonSnapshot[]).reduce((sum, a) => sum + a.price, 0);
    const totalAmount = planPrice + addonTotal;

    const durationMonths = billingCycle === BillingCycle.ANNUAL ? plan.duration_months : 1;
    const start = new Date(startDate);
    const end = new Date(start);
    end.setMonth(end.getMonth() + durationMonths);

    // Build pre-scheduled service visits from CMS plan definition.
    // Visit 1 is always 5 days after activation (not on the activation date itself)
    // so the user experiences the ideal usage pattern before their first service.
    const FIRST_VISIT_OFFSET_MS = 5 * 24 * 60 * 60 * 1000;
    const visitServices = (plan.visit_services ?? [])
      .sort((a, b) => a.visit_number - b.visit_number)
      .map((vs) => {
        const intervalMs = (end.getTime() - start.getTime()) / Math.max(plan.max_services, 1);
        const scheduledDate = vs.visit_number === 1
          ? new Date(start.getTime() + FIRST_VISIT_OFFSET_MS)
          : new Date(start.getTime() + intervalMs * (vs.visit_number - 1));
        return {
          visitNumber:   vs.visit_number,
          scheduledDate,
          serviceKeys:   vs.service_parts.map((sp) => sp.name),
        };
      });

    const subscription = await prisma.subscription.create({
      data: {
        userId,
        deviceTypeKey,
        planKey,
        planName:       plan.name,
        planBadgeColor: plan.badge_color ?? null,
        billingCycle,
        planPrice,
        addons:      addons as object[],
        totalAmount,
        maxServices: plan.max_services,
        startDate:   start,
        endDate:     end,
        status:      SubscriptionStatus.ACTIVE,
        services: {
          create: visitServices,
        },
      },
      include: SUBSCRIPTION_INCLUDE,
    });

    logger.info('Subscription purchased', { subscriptionId: subscription.id, userId, deviceTypeKey, planKey });
    TelegramService.notifySubscriptionCreated(subscription).catch(() => {});
    return subscription;
  }

  // ─── List user subscriptions ─────────────────────────────────────────────────

  static async listByUser(userId: string) {
    await SubscriptionService.syncExpiredForUser(userId);

    return prisma.subscription.findMany({
      where:   { userId, isDeleted: false },
      include: SUBSCRIPTION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Get by ID ───────────────────────────────────────────────────────────────

  static async getById(id: string, userId: string) {
    const sub = await prisma.subscription.findFirst({
      where:   { id, userId, isDeleted: false },
      include: SUBSCRIPTION_INCLUDE,
    });
    if (!sub) throw new ApiError(404, 'Subscription not found');
    return sub;
  }

  // ─── Get active subscription for a device type ──────────────────────────────

  static async getActiveByDeviceType(deviceTypeKey: string, userId: string) {
    await SubscriptionService.syncExpiredForDeviceType(deviceTypeKey, userId);

    return prisma.subscription.findFirst({
      where: {
        deviceTypeKey,
        userId,
        status:    SubscriptionStatus.ACTIVE,
        isDeleted: false,
      },
      include: SUBSCRIPTION_INCLUDE,
    });
  }

  // ─── Active plan summary for hero grid ──────────────────────────────────────

  static async getActivePlanSummary(userId: string): Promise<{
    hasActivePlan: boolean;
    planName?: string;
    nextDate?: string;
  }> {
    await SubscriptionService.syncExpiredForUser(userId);

    const sub = await prisma.subscription.findFirst({
      where:   { userId, status: SubscriptionStatus.ACTIVE, isDeleted: false },
      include: {
        services: {
          where:   { completedDate: null, isDeleted: false },
          orderBy: { scheduledDate: 'asc' },
          take:    1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!sub) return { hasActivePlan: false };

    const nextService = sub.services[0];
    return {
      hasActivePlan: true,
      planName:      sub.planName,
      nextDate:      nextService?.scheduledDate?.toISOString().split('T')[0] ?? undefined,
    };
  }

  // ─── Use a subscription visit slot when complaint is created ─────────────────

  static async useServiceSlot(subscriptionId: string, complaintId: string, visitNumber: number) {
    const sub = await prisma.subscription.findFirst({
      where:     { id: subscriptionId, status: SubscriptionStatus.ACTIVE, isDeleted: false },
      include:   { services: { where: { isDeleted: false } } },
    });
    if (!sub) throw new ApiError(404, 'Active subscription not found');

    // Mark the matching visit as linked to this complaint
    await prisma.subscriptionService.updateMany({
      where: { subscriptionId, visitNumber, complaintId: null, isDeleted: false },
      data:  { complaintId },
    });

    const newServicesUsed = sub.servicesUsed + 1;
    const isExhausted = sub.maxServices !== -1 && newServicesUsed >= sub.maxServices;

    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        servicesUsed: newServicesUsed,
        ...(isExhausted && { status: SubscriptionStatus.EXPIRED }),
      },
    });
  }

  // ─── Cancel subscription ─────────────────────────────────────────────────────

  static async cancel(id: string, userId: string) {
    const sub = await prisma.subscription.findFirst({
      where: { id, userId, isDeleted: false },
    });
    if (!sub) throw new ApiError(404, 'Subscription not found');
    if (sub.status !== SubscriptionStatus.ACTIVE) {
      throw new ApiError(400, 'Only active subscriptions can be cancelled');
    }

    return prisma.subscription.update({
      where: { id },
      data:  { status: SubscriptionStatus.CANCELLED },
    });
  }

  // ─── Internal: sync expired statuses ─────────────────────────────────────────

  private static async syncExpiredForUser(userId: string) {
    await prisma.subscription.updateMany({
      where: {
        userId,
        status:    SubscriptionStatus.ACTIVE,
        endDate:   { lt: new Date() },
        isDeleted: false,
      },
      data: { status: SubscriptionStatus.EXPIRED },
    });
  }

  private static async syncExpiredForDeviceType(deviceTypeKey: string, userId: string) {
    await prisma.subscription.updateMany({
      where: {
        deviceTypeKey,
        userId,
        status:    SubscriptionStatus.ACTIVE,
        endDate:   { lt: new Date() },
        isDeleted: false,
      },
      data: { status: SubscriptionStatus.EXPIRED },
    });
  }
}
