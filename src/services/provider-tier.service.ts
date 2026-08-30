import prisma from '@/services/prisma.service';
import { ApiError } from '@/utils/apiResponse';
import type {
  CreateProviderTierInput,
  UpdateProviderTierInput,
} from '@/types/provider-tier.types';

export class ProviderTierService {
  static async create(input: CreateProviderTierInput) {
    if (!input.name?.trim()) throw new ApiError(400, 'Name is required');

    return prisma.providerTier.create({
      data: {
        name: input.name.trim(),
        order: input.order ?? 0,
        isActive: input.isActive ?? true,
        description: input.description ?? null,
        color: input.color ?? null,
      },
    });
  }

  static async findAll() {
    return prisma.providerTier.findMany({
      where: { isDeleted: false },
      orderBy: { order: 'asc' },
    });
  }

  static async findById(tierId: string) {
    const tier = await prisma.providerTier.findFirst({ where: { id: tierId, isDeleted: false } });
    if (!tier) throw new ApiError(404, 'Provider tier not found');
    return tier;
  }

  static async update({ tierId, ...input }: UpdateProviderTierInput) {
    await ProviderTierService.findById(tierId);

    return prisma.providerTier.update({
      where: { id: tierId },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.order !== undefined && { order: input.order }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.color !== undefined && { color: input.color }),
      },
    });
  }

  static async remove(tierId: string) {
    await ProviderTierService.findById(tierId);

    const inUseCount = await prisma.providerProfile.count({ where: { providerTierId: tierId } });
    if (inUseCount > 0) {
      throw new ApiError(409, `Cannot delete: ${inUseCount} provider(s) are currently assigned to this tier`);
    }

    return prisma.providerTier.update({ where: { id: tierId }, data: { isDeleted: true } });
  }
}
