import { Prisma, ProviderSignupStatus, Role } from '@prisma/client';
import prisma from '@/services/prisma.service';
import { ApiError } from '@/utils/apiResponse';
import type {
  CreateProviderSignupInput,
  ListProviderSignupInput,
  UpdateProviderSignupInput,
} from '@/types/provider-signup.types';

export class ProviderSignupService {
  /**
   * Public endpoint, so it's kept idempotent per phone number: re-submitting
   * while a request is still pending updates that request instead of piling
   * up duplicates for the admin to sift through.
   */
  static async create(input: CreateProviderSignupInput) {
    const existingProvider = await prisma.user.findFirst({
      where: { phoneNo: input.phoneNo, role: Role.PROVIDER, isDeleted: false },
      select: { id: true },
    });
    if (existingProvider) {
      throw new ApiError(409, 'This number is already registered as a professional. Please log in from the Serwise Partner app.');
    }

    const data = {
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      city: input.city.trim(),
      deviceTypes: Array.from(new Set(input.deviceTypes)),
      experienceYears: input.experienceYears ?? null,
    };

    const pending = await prisma.providerSignupRequest.findFirst({
      where: { phoneNo: input.phoneNo, status: ProviderSignupStatus.PENDING, isDeleted: false },
      select: { id: true },
    });

    if (pending) {
      return prisma.providerSignupRequest.update({ where: { id: pending.id }, data });
    }

    return prisma.providerSignupRequest.create({ data: { ...data, phoneNo: input.phoneNo } });
  }

  static async list({ status }: ListProviderSignupInput) {
    return prisma.providerSignupRequest.findMany({
      where: { isDeleted: false, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async update({ id, status, adminNotes }: UpdateProviderSignupInput) {
    const request = await prisma.providerSignupRequest.findFirst({ where: { id, isDeleted: false } });
    if (!request) throw new ApiError(404, 'Signup request not found');

    const statusChanged = status !== undefined && status !== request.status;

    return prisma.providerSignupRequest.update({
      where: { id },
      data: {
        ...(status !== undefined ? { status } : {}),
        ...(adminNotes !== undefined ? { adminNotes } : {}),
        // Stamp (or clear, when reopened) the review time on a status change
        ...(statusChanged ? { reviewedAt: status === ProviderSignupStatus.PENDING ? null : new Date() } : {}),
      },
    });
  }

  /**
   * Called inside UserService.createProvider's transaction: the provider an
   * admin just created closes out any pending request for that phone number.
   */
  static async markApprovedForProvider(tx: Prisma.TransactionClient, phoneNo: string, providerId: string) {
    await tx.providerSignupRequest.updateMany({
      where: { phoneNo, status: ProviderSignupStatus.PENDING, isDeleted: false },
      data: { status: ProviderSignupStatus.APPROVED, providerId, reviewedAt: new Date() },
    });
  }
}
