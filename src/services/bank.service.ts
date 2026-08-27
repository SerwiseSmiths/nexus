import prisma from '@/services/prisma.service';
import { ApiError } from '@/utils/apiResponse';
import type { BankAccountInput } from '@/types/user.types';

const EDIT_LOCK_DAYS = 7;
const EDIT_LOCK_MS = EDIT_LOCK_DAYS * 24 * 60 * 60 * 1000;

export class BankService {
  private static async getProviderProfileByUserId(userId: string) {
    const profile = await prisma.providerProfile.findUnique({
      where: { userId },
      include: { bankAccount: true },
    });
    if (!profile) throw new ApiError(404, 'Provider profile not found');
    return profile;
  }

  static async getForUser(userId: string) {
    const profile = await BankService.getProviderProfileByUserId(userId);
    const bankAccount = profile.bankAccount;

    if (!bankAccount || bankAccount.isDeleted) {
      return { bankAccount: null, canEdit: true, nextEditableAt: null };
    }

    const nextEditableAt = new Date(bankAccount.lastChangedAt.getTime() + EDIT_LOCK_MS);
    const canEdit = nextEditableAt.getTime() <= Date.now();

    return { bankAccount, canEdit, nextEditableAt: canEdit ? null : nextEditableAt };
  }

  static async upsertForUser(userId: string, input: BankAccountInput, { enforceLock }: { enforceLock: boolean }) {
    const profile = await BankService.getProviderProfileByUserId(userId);
    const existing = profile.bankAccount;

    if (enforceLock && existing && !existing.isDeleted) {
      const nextEditableAt = new Date(existing.lastChangedAt.getTime() + EDIT_LOCK_MS);
      if (nextEditableAt.getTime() > Date.now()) {
        throw new ApiError(400, `Bank details can only be changed once every ${EDIT_LOCK_DAYS} days`);
      }
    }

    const data = {
      bankName: input.bankName,
      accountNumber: input.accountNumber,
      ifscCode: input.ifscCode,
      accountHolderName: input.accountHolderName,
      isApproved: false,
      approvedAt: null,
      lastChangedAt: new Date(),
      isDeleted: false,
    };

    return prisma.providerBankAccount.upsert({
      where: { providerProfileId: profile.id },
      update: data,
      create: { providerProfileId: profile.id, ...data },
    });
  }

  static async approve(providerId: string) {
    const profile = await BankService.getProviderProfileByUserId(providerId);
    if (!profile.bankAccount || profile.bankAccount.isDeleted) {
      throw new ApiError(404, 'Provider has no bank details to approve');
    }

    return prisma.providerBankAccount.update({
      where: { providerProfileId: profile.id },
      data: { isApproved: true, approvedAt: new Date() },
    });
  }
}
