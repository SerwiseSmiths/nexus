import { PaymentProvider, PayoutRequestStatus, Prisma, Role, WalletLedgerSource, WalletLedgerType, WalletType } from '@prisma/client';
import prisma from '@/services/prisma.service';
import { ApiError } from '@/utils/apiResponse';
import { logger } from '@/utils/logger';
import type {
  CreditWalletInput,
  DebitWalletInput,
  CreatePayoutRequestInput,
  GetWalletHistoryInput,
  SendMoneyInput,
  UpdatePayoutRequestInput,
} from '@/types/wallet.types';

type TxClient = Prisma.TransactionClient;

export class WalletService {
  // PROVIDER users get a PROVIDER (earnings) wallet; everyone else gets a CUSTOMER (spend) wallet.
  private static roleToWalletType(role: Role): WalletType {
    return role === Role.PROVIDER ? WalletType.PROVIDER : WalletType.CUSTOMER;
  }

  static async getOrCreateWallet(userId: string) {
    const existing = await prisma.wallet.findUnique({ where: { userId } });
    if (existing) return existing;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) throw new ApiError(404, 'User not found');

    logger.info('Auto-creating wallet', { userId });
    return prisma.wallet.create({
      data: { userId, walletType: WalletService.roleToWalletType(user.role) },
    });
  }

  static async getWallet(userId: string) {
    return WalletService.getOrCreateWallet(userId);
  }

  static async getWalletByUserId(userId: string) {
    const wallet = await prisma.wallet.findUnique({ where: { userId, isDeleted: false } });
    if (!wallet) throw new ApiError(404, 'Wallet not found');
    return wallet;
  }

  private static async creditWalletTx(tx: TxClient, input: CreditWalletInput) {
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

    const existing = await tx.wallet.findUnique({ where: { userId } });
    const wallet = existing ?? (await (async () => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (!user) throw new ApiError(404, 'User not found');
      return tx.wallet.create({
        data: { userId, walletType: WalletService.roleToWalletType(user.role) },
      });
    })());

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
  }

  static async creditWallet(input: CreditWalletInput) {
    return prisma.$transaction((tx) => WalletService.creditWalletTx(tx, input));
  }

  // Sanctioned entry point for crediting a provider's earnings on complaint completion.
  // Accepts an optional transaction client so it composes inside a caller's own transaction
  // (e.g. ComplaintService.completePayment) instead of opening a second one.
  static async creditProviderEarnings(
    providerId: string,
    amount: number,
    complaintId: string,
    paymentProvider: PaymentProvider,
    tx?: TxClient,
  ) {
    const input: CreditWalletInput = {
      userId: providerId,
      amount,
      source: WalletLedgerSource.ORDER_PAYMENT,
      refId: complaintId,
      paymentProvider,
    };

    if (tx) return WalletService.creditWalletTx(tx, input);
    return prisma.$transaction((t) => WalletService.creditWalletTx(t, input));
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
            create: { userId: recipient.id, walletType: WalletService.roleToWalletType(recipient.role) },
            update: {},
          }),
        ]);

        if (!senderWallet)           throw new ApiError(404, 'Sender wallet not found');
        if (!senderWallet.isActive)  throw new ApiError(403, 'Your wallet is inactive');
        if (!recipientWallet.isActive) throw new ApiError(403, 'Recipient wallet is inactive');
        if (senderWallet.walletType !== recipientWallet.walletType) {
          throw new ApiError(400, 'Transfers are only allowed between wallets of the same type');
        }
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

  // ─── Provider Payouts ──────────────────────────────────────────────────────
  // Scope note: this only records the request and moves the balance out of the
  // wallet on approval. Bank-account capture, KYC, and TDS/GST computation are
  // deliberately out of scope until product/legal sign off on that flow.

  static async createPayoutRequest(input: CreatePayoutRequestInput) {
    const { userId, amount } = input;
    if (amount <= 0) throw new ApiError(400, 'Amount must be greater than 0');

    const wallet = await prisma.wallet.findUnique({ where: { userId, isDeleted: false } });
    if (!wallet) throw new ApiError(404, 'Wallet not found');
    if (wallet.walletType !== WalletType.PROVIDER) {
      throw new ApiError(403, 'Only provider wallets can request a payout');
    }
    if (!wallet.isActive) throw new ApiError(403, 'Wallet is inactive');
    if (wallet.balance < amount) throw new ApiError(400, 'Insufficient wallet balance');

    return prisma.payoutRequest.create({
      data: { walletId: wallet.id, userId, amount },
    });
  }

  static async getPayoutRequests(userId: string) {
    return prisma.payoutRequest.findMany({
      where:   { userId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async updatePayoutRequestStatus(input: UpdatePayoutRequestInput) {
    const { payoutRequestId, status, adminId } = input;

    const payoutRequest = await prisma.payoutRequest.findFirst({
      where: { id: payoutRequestId, isDeleted: false },
    });
    if (!payoutRequest) throw new ApiError(404, 'Payout request not found');
    if (payoutRequest.status !== PayoutRequestStatus.PENDING) {
      throw new ApiError(400, `Payout request is already ${payoutRequest.status}`);
    }

    if (status === PayoutRequestStatus.APPROVED || status === PayoutRequestStatus.PAID) {
      await WalletService.debitWallet({
        userId: payoutRequest.userId,
        amount: payoutRequest.amount,
        source: WalletLedgerSource.WITHDRAWAL,
        refId:  payoutRequest.id,
      });
    }

    return prisma.payoutRequest.update({
      where: { id: payoutRequestId },
      data:  { status, adminId, processedAt: new Date() },
    });
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
