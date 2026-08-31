import prisma from '@/services/prisma.service';
import { ApiError } from '@/utils/apiResponse';
import type { UpsertPartPricingInput, RemovePartPricingInput } from '@/types/service-part-pricing.types';

export class ServicePartPricingService {
  static async listByTier(providerTierId: string) {
    return prisma.servicePartTierPricing.findMany({
      where: { providerTierId, isDeleted: false },
    });
  }

  static async listByPart(servicePartId: string) {
    return prisma.servicePartTierPricing.findMany({
      where: { servicePartId, isDeleted: false },
    });
  }

  static async upsert(input: UpsertPartPricingInput) {
    if (!input.servicePartId?.trim() || !input.providerTierId?.trim()) {
      throw new ApiError(400, 'servicePartId and providerTierId are required');
    }
    if (input.salesPrice == null || Number.isNaN(input.salesPrice)) {
      throw new ApiError(400, 'salesPrice is required');
    }

    const tier = await prisma.providerTier.findFirst({ where: { id: input.providerTierId, isDeleted: false } });
    if (!tier) throw new ApiError(404, 'Provider tier not found');

    return prisma.servicePartTierPricing.upsert({
      where: { servicePartId_providerTierId: { servicePartId: input.servicePartId, providerTierId: input.providerTierId } },
      update: {
        salesPrice: input.salesPrice,
        expense: input.expense ?? null,
        labour: input.labour ?? null,
        maxDiscount: input.maxDiscount ?? null,
        isDeleted: false,
      },
      create: {
        servicePartId: input.servicePartId,
        providerTierId: input.providerTierId,
        salesPrice: input.salesPrice,
        expense: input.expense ?? null,
        labour: input.labour ?? null,
        maxDiscount: input.maxDiscount ?? null,
      },
    });
  }

  /** "Reset to default" — soft-deletes the override so the part falls back to its base
   *  face_value/expense/provider_cut for this tier. */
  static async remove({ servicePartId, providerTierId }: RemovePartPricingInput) {
    const existing = await prisma.servicePartTierPricing.findUnique({
      where: { servicePartId_providerTierId: { servicePartId, providerTierId } },
    });
    if (!existing || existing.isDeleted) return;

    await prisma.servicePartTierPricing.update({
      where: { servicePartId_providerTierId: { servicePartId, providerTierId } },
      data: { isDeleted: true },
    });
  }
}
