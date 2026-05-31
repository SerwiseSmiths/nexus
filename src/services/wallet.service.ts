import { Prisma, WalletLedgerSource, WalletLedgerType } from '@prisma/client';
import prisma from '@/services/prisma.service';
import { ApiError } from '@/utils/apiResponse';
import { logger } from '@/utils/logger';
import type { CreditWalletInput, DebitWalletInput, GetWalletHistoryInput } from '@/types/wallet.types';

export class WalletService {
  static async getOrCreateWallet(userId: string) {
    const existing = await prisma.wallet.findUnique({ where: { userId } });
    if (existing) return existing;

    logger.info('Auto-creating wallet', { userId });
    return prisma.wallet.create({ data: { userId } });
  }

  static async getWallet(userId: string) {
    return WalletService.getOrCreateWallet(userId);
  }

  static async getWalletByUserId(userId: string) {
    const wallet = await prisma.wallet.findUnique({ where: { userId, isDeleted: false } });
    if (!wallet) throw new ApiError(404, 'Wallet not found');
    return wallet;
  }

  static async creditWallet(input: CreditWalletInput) {
    const {
      userId,
      amount,
      source,
      refId,
      meta,
      paymentProvider,
      updateBalance = true, // default: actually credit the wallet
    } = input;

    if (amount <= 0) throw new ApiError(400, 'Amount must be greater than 0');

    return prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where:  { userId },
        create: { userId },
        update: {},
      });

      if (!wallet.isActive) throw new ApiError(403, 'Wallet is inactive');

      const openingBalance  = wallet.balance;
      const closingBalance  = updateBalance ? openingBalance + amount : openingBalance;

      const [updatedWallet, ledger] = await Promise.all([
        updateBalance
          ? tx.wallet.update({
              where: { id: wallet.id },
              data:  { balance: closingBalance },
            })
          : Promise.resolve(wallet),
        tx.walletLedger.create({
          data: {
            walletId:       wallet.id,
            userId,
            type:           WalletLedgerType.CREDIT,
            source,
            amount,
            openingBalance,
            closingBalance,
            updateBalance,
            ...(refId           && { refId }),
            ...(meta            && { meta: meta as Prisma.InputJsonValue }),
            ...(paymentProvider && { paymentProvider }),
          },
        }),
      ]);

      return { wallet: updatedWallet, ledger };
    });
  }

  static async debitWallet(input: DebitWalletInput) {
    const {
      userId,
      amount,
      source,
      refId,
      meta,
      paymentProvider,
      updateBalance = true,
    } = input;

    if (amount <= 0) throw new ApiError(400, 'Amount must be greater than 0');

    // Serializable isolation prevents concurrent overdrafts
    return prisma.$transaction(
      async (tx) => {
        const wallet = await tx.wallet.findUnique({ where: { userId, isDeleted: false } });
        if (!wallet) throw new ApiError(404, 'Wallet not found');
        if (!wallet.isActive) throw new ApiError(403, 'Wallet is inactive');

        if (
          updateBalance &&
          source !== WalletLedgerSource.ORDER_PAYMENT &&
          wallet.balance < amount
        ) {
          throw new ApiError(400, 'Insufficient wallet balance');
        }

        const openingBalance = wallet.balance;
        const closingBalance = updateBalance ? openingBalance - amount : openingBalance;

        const [updatedWallet, ledger] = await Promise.all([
          updateBalance
            ? tx.wallet.update({
                where: { id: wallet.id },
                data:  { balance: closingBalance },
              })
            : Promise.resolve(wallet),
          tx.walletLedger.create({
            data: {
              walletId:       wallet.id,
              userId,
              type:           WalletLedgerType.DEBIT,
              source,
              amount,
              openingBalance,
              closingBalance,
              updateBalance,
              ...(refId           && { refId }),
              ...(meta            && { meta: meta as Prisma.InputJsonValue }),
              ...(paymentProvider && { paymentProvider }),
            },
          }),
        ]);

        return { wallet: updatedWallet, ledger };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  static async getWalletHistory(input: GetWalletHistoryInput) {
    const { userId, page, limit } = input;
    const skip = (page - 1) * limit;

    const [entries, total] = await Promise.all([
      prisma.walletLedger.findMany({
        where:   { userId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        skip,
        take:    limit,
      }),
      prisma.walletLedger.count({ where: { userId, isDeleted: false } }),
    ]);

    return {
      entries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
