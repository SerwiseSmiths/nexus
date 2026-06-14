import { Prisma, WalletLedgerSource, WalletLedgerType } from '@prisma/client';
import prisma from '@/services/prisma.service';
import { ApiError } from '@/utils/apiResponse';
import { logger } from '@/utils/logger';
import type { CreditWalletInput, DebitWalletInput, GetWalletHistoryInput, SendMoneyInput } from '@/types/wallet.types';

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

  private static displayName(user: { firstName: string | null; lastName: string | null; phoneNo: string }): string {
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.phoneNo;
  }

  private static deriveTitle(
    source: WalletLedgerSource,
    type: WalletLedgerType,
    meta: Prisma.JsonValue | null,
  ): string {
    if (source === WalletLedgerSource.TRANSFER) {
      const name = (meta as { counterpartName?: string } | null)?.counterpartName ?? 'Someone';
      return type === WalletLedgerType.DEBIT ? `To ${name}` : `From ${name}`;
    }
    return type === WalletLedgerType.CREDIT ? 'Fund Added' : 'Fund Deducted';
  }

  static async sendMoney(input: SendMoneyInput) {
    const { senderUserId, recipientPhone, amount } = input;

    if (amount <= 0) throw new ApiError(400, 'Amount must be greater than 0');

    return prisma.$transaction(
      async (tx) => {
        const [recipient, sender] = await Promise.all([
          tx.user.findUnique({ where: { phoneNo: recipientPhone, isDeleted: false } }),
           tx.user.findUnique({ where: { id: senderUserId, isDeleted: false } }),
        ]);
        if (!recipient) throw new ApiError(404, 'Recipient not found');
        if (!sender)    throw new ApiError(404, 'Sender not found');
        if (recipient.id === senderUserId) throw new ApiError(400, 'Cannot send money to yourself');

        const recipientName = WalletService.displayName(recipient);
        const senderName    = WalletService.displayName(sender);

        const [senderWallet, recipientWallet] = await Promise.all([
          tx.wallet.findUnique({ where: { userId: senderUserId, isDeleted: false } }),
          tx.wallet.upsert({
            where:  { userId: recipient.id },
            create: { userId: recipient.id },
            update: {},
          }),
        ]);

        if (!senderWallet)           throw new ApiError(404, 'Sender wallet not found');
        if (!senderWallet.isActive)  throw new ApiError(403, 'Your wallet is inactive');
        if (!recipientWallet.isActive) throw new ApiError(403, 'Recipient wallet is inactive');
        if (senderWallet.balance < amount) throw new ApiError(400, 'Insufficient wallet balance');

        const senderOpening    = senderWallet.balance;
        const senderClosing    = senderOpening - amount;
        const recipientOpening = recipientWallet.balance;
        const recipientClosing = recipientOpening + amount;

        await Promise.all([
          tx.wallet.update({ where: { id: senderWallet.id },    data: { balance: senderClosing } }),
          tx.wallet.update({ where: { id: recipientWallet.id }, data: { balance: recipientClosing } }),
          tx.walletLedger.create({
            data: {
              walletId:       senderWallet.id,
              userId:         senderUserId,
              type:           WalletLedgerType.DEBIT,
              source:         WalletLedgerSource.TRANSFER,
              amount,
              openingBalance: senderOpening,
              closingBalance: senderClosing,
              updateBalance:  true,
              meta:           { counterpartName: recipientName } as Prisma.InputJsonValue,
            },
          }),
          tx.walletLedger.create({
            data: {
              walletId:       recipientWallet.id,
              userId:         recipient.id,
              type:           WalletLedgerType.CREDIT,
              source:         WalletLedgerSource.TRANSFER,
              amount,
              openingBalance: recipientOpening,
              closingBalance: recipientClosing,
              updateBalance:  true,
              meta:           { counterpartName: senderName } as Prisma.InputJsonValue,
            },
          }),
        ]);

        return { newBalance: senderClosing };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  static async getWalletHistory(input: GetWalletHistoryInput) {
    const { userId, page, limit } = input;
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      prisma.walletLedger.findMany({
        where:   { userId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        skip,
        take:    limit,
      }),
      prisma.walletLedger.count({ where: { userId, isDeleted: false } }),
    ]);

    const entries = rows.map(e => ({
      ...e,
      title: WalletService.deriveTitle(e.source, e.type, e.meta),
    }));

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
