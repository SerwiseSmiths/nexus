import { PaymentProvider, PayoutRequestStatus, Prisma, Role, WalletLedgerSource, WalletLedgerType, WalletType } from '@prisma/client';
import prisma from '@/services/prisma.service';
import { ApiError } from '@/utils/apiResponse';
import { logger } from '@/utils/logger';
import { withSerializableRetry } from '@/utils/serializableRetry';
import type {
  CreditWalletInput,
  DebitWalletInput,
  CreatePayoutRequestInput,
  GetWalletHistoryInput,
  SendMoneyInput,
  UpdatePayoutRequestInput,
} from '@/types/wallet.types';

type TxClient = Prisma.TransactionClient;

// Balances are Float rupees — keep every computed balance to whole paise so
// float error can't accumulate across ledger rows.
const toPaiseRounded = (rupees: number) => Math.round(rupees * 100) / 100;

export class WalletService {
  // Returns the ledger row an earlier request with this idempotency key
  // already created, if any. Callers run it inside a Serializable
  // transaction so two concurrent retries can't both miss it.
  //
  // A key only replays the *same* operation. Reused for a different type,
  // source or amount (e.g. an admin edited the amount and retried in the
  // same drawer), it's refused — returning the earlier row would report an
  // amount that was never moved.
  private static async findIdempotentLedger(
    tx: TxClient,
    userId: string,
    idempotencyKey: string | undefined,
    expected: { type: WalletLedgerType; source: WalletLedgerSource; amount: number },
  ) {
    if (!idempotencyKey) return null;
    const row = await tx.walletLedger.findFirst({
      where: { userId, isDeleted: false, meta: { path: ['idempotencyKey'], equals: idempotencyKey } },
    });
    if (
      row &&
      (row.type !== expected.type ||
        row.source !== expected.source ||
        toPaiseRounded(row.amount) !== toPaiseRounded(expected.amount))
    ) {
      throw new ApiError(
        409,
        `This request was already recorded as a ${row.type.toLowerCase()} of ₹${row.amount} — refresh and start a new one`,
      );
    }
    return row;
  }

  // PROVIDER users get a PROVIDER (earnings) wallet; everyone else gets a CUSTOMER (spend) wallet.
  private static roleToWalletType(role: Role): WalletType {
    return role === Role.PROVIDER ? WalletType.PROVIDER : WalletType.CUSTOMER;
  }

  // Returns the user's wallet, creating it if they never had one (admin-created
  // customers/providers start without). INSERT … ON CONFLICT DO NOTHING, not
  // find-then-create: two first-time credits (e.g. two recharge webhooks)
  // racing here must both succeed — a unique-constraint error would mark a
  // paid order FAILED.
  private static async ensureWalletTx(tx: TxClient, userId: string) {
    const existing = await tx.wallet.findUnique({ where: { userId } });
    if (existing) return existing;

    const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) throw new ApiError(404, 'User not found');

    logger.info('Auto-creating wallet', { userId });
    await tx.wallet.createMany({
      data:           [{ userId, walletType: WalletService.roleToWalletType(user.role) }],
      skipDuplicates: true,
    });
    return tx.wallet.findUniqueOrThrow({ where: { userId } });
  }

  static async getOrCreateWallet(userId: string) {
    return prisma.$transaction((tx) => WalletService.ensureWalletTx(tx, userId));
  }

  // For checks made before taking a customer's money (PaymentService.resolveOrder):
  // a wallet that exists but is deactivated can't be credited.
  static async assertWalletCanReceive(userId: string) {
    const wallet = await prisma.wallet.findUnique({ where: { userId }, select: { isActive: true, isDeleted: true } });
    if (wallet && (!wallet.isActive || wallet.isDeleted)) {
      throw new ApiError(403, 'Your wallet is inactive — please contact support');
    }
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
      idempotencyKey,
    } = input;

    if (amount <= 0) throw new ApiError(400, 'Amount must be greater than 0');

    const replay = await WalletService.findIdempotentLedger(tx, userId, idempotencyKey, {
      type: WalletLedgerType.CREDIT, source, amount,
    });
    if (replay) {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: replay.walletId } });
      return { wallet, ledger: replay };
    }

    const wallet = await WalletService.ensureWalletTx(tx, userId);

    if (!wallet.isActive) throw new ApiError(403, 'Wallet is inactive');

    // Atomic increment, not "write back opening + amount": credits run at the
    // default isolation level, and a read-then-write would silently lose a
    // debit (or another credit) that committed in between.
    const updatedWallet = updateBalance
      ? await tx.wallet.update({
          where: { id: wallet.id },
          data:  { balance: { increment: amount } },
        })
      : wallet;
    const closingBalance = toPaiseRounded(updatedWallet.balance);
    const openingBalance = updateBalance ? toPaiseRounded(closingBalance - amount) : wallet.balance;

    const ledger = await tx.walletLedger.create({
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
        ...((meta || idempotencyKey) && { meta: { ...meta, ...(idempotencyKey && { idempotencyKey }) } as Prisma.InputJsonValue }),
        ...(paymentProvider && { paymentProvider }),
      },
    });

    return { wallet: updatedWallet, ledger };
  }

  static async creditWallet(input: CreditWalletInput) {
    // An idempotent (admin) credit needs Serializable so two concurrent
    // retries can't both miss each other's ledger row; plain credits stay at
    // the default level so a webhook recharge never fails on a conflict.
    return withSerializableRetry(() => prisma.$transaction(
      (tx) => WalletService.creditWalletTx(tx, input),
      input.idempotencyKey ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } : undefined,
    ), 'Wallet credit');
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

  // Sanctioned entry point for charging a customer's wallet on complaint
  // completion (method: 'WALLET'). Always enforces a real balance check —
  // unlike debitWallet's ORDER_PAYMENT carve-out (used elsewhere for
  // audit-only entries with updateBalance:false), this debit actually moves
  // money, so an insufficient balance must reject the whole operation.
  // Requires the caller's own transaction client so the debit, the complaint's
  // stage update, and the provider's credit all commit or roll back together —
  // a customer must never be charged without the provider being paid, or vice
  // versa.
  static async debitCustomerForComplaintPayment(
    userId: string,
    amount: number,
    complaintId: string,
    tx: TxClient,
  ) {
    if (amount <= 0) return;

    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new ApiError(400, 'Customer wallet not found');
    if (!wallet.isActive) throw new ApiError(403, 'Customer wallet is inactive');
    if (wallet.balance < amount) throw new ApiError(400, 'Insufficient wallet balance to complete this payment');

    const openingBalance = wallet.balance;
    const closingBalance = toPaiseRounded(openingBalance - amount);

    await tx.wallet.update({ where: { id: wallet.id }, data: { balance: closingBalance } });
    await tx.walletLedger.create({
      data: {
        walletId: wallet.id,
        userId,
        type: WalletLedgerType.DEBIT,
        source: WalletLedgerSource.ORDER_PAYMENT,
        amount,
        openingBalance,
        closingBalance,
        updateBalance: true,
        refId: complaintId,
      },
    });
  }

  private static async debitWalletTx(tx: TxClient, input: DebitWalletInput) {
    const {
      userId,
      amount,
      source,
      refId,
      meta,
      paymentProvider,
      updateBalance = true,
      idempotencyKey,
    } = input;

    if (amount <= 0) throw new ApiError(400, 'Amount must be greater than 0');

    const replay = await WalletService.findIdempotentLedger(tx, userId, idempotencyKey, {
      type: WalletLedgerType.DEBIT, source, amount,
    });
    if (replay) {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: replay.walletId } });
      return { wallet, ledger: replay };
    }

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
    const closingBalance = updateBalance ? toPaiseRounded(openingBalance - amount) : openingBalance;

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
          ...((meta || idempotencyKey) && { meta: { ...meta, ...(idempotencyKey && { idempotencyKey }) } as Prisma.InputJsonValue }),
          ...(paymentProvider && { paymentProvider }),
        },
      }),
    ]);

    return { wallet: updatedWallet, ledger };
  }

  static async debitWallet(input: DebitWalletInput) {
    // Serializable isolation prevents concurrent overdrafts
    return withSerializableRetry(() => prisma.$transaction(
      (tx) => WalletService.debitWalletTx(tx, input),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ), 'Wallet debit');
  }

  // Sanctioned entry point for reclaiming a CASH payment the provider
  // collected directly from the customer on-site (see
  // ComplaintService.completePayment, which passes the full quote total as
  // `amount` and has already separately credited the provider's labour
  // share). The provider physically holds the full amount, but only their
  // labour is rightfully theirs — this debits the full amount back out so
  // the net wallet effect is "provider keeps labour, owes the rest to the
  // company." Deliberately allowed to go
  // negative (no balance floor) via the same
  // ORDER_PAYMENT carve-out debitWallet already uses for its own floor
  // check — this is an IOU being recorded, not a real-time spend that must
  // be affordable right now; the manual payout process reconciles it.
  // Requires the caller's own transaction client, same reasoning as
  // debitCustomerForComplaintPayment.
  static async debitProviderForCashCollected(
    providerId: string,
    amount: number,
    complaintId: string,
    tx: TxClient,
  ) {
    if (amount <= 0) return;
    return WalletService.debitWalletTx(tx, {
      userId: providerId,
      amount,
      source: WalletLedgerSource.ORDER_PAYMENT,
      refId: complaintId,
      meta: { reason: 'cash_collected_offset' },
    });
  }

  // Audit-only DEBIT on the customer's ledger for a complaint paid outside
  // the wallet — UPI QR on the provider's phone, or cash handed to an admin
  // at the office. wallet.balance is never touched (updateBalance: false);
  // this exists so the customer's ledger still shows what they paid for the
  // job and how. Creates the wallet if the customer never had one — unlike
  // debitCustomerForComplaintPayment, no balance is needed, and an inactive
  // wallet doesn't block it (nothing is charged to it). Also used for the
  // online ₹185 booking fee (PaymentService.fulfillComplaintPayment).
  static async recordCustomerComplaintPayment(
    userId: string,
    amount: number,
    complaintId: string,
    paymentProvider: PaymentProvider,
    meta: Record<string, unknown>,
    tx: TxClient,
  ) {
    if (amount <= 0) return null;

    const wallet = await WalletService.ensureWalletTx(tx, userId);

    return tx.walletLedger.create({
      data: {
        walletId:       wallet.id,
        userId,
        type:           WalletLedgerType.DEBIT,
        source:         WalletLedgerSource.ORDER_PAYMENT,
        amount,
        openingBalance: wallet.balance,
        closingBalance: wallet.balance,
        updateBalance:  false,
        refId:          complaintId,
        paymentProvider,
        meta:           meta as Prisma.InputJsonValue,
      },
    });
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

    return withSerializableRetry(() => prisma.$transaction(
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
          WalletService.ensureWalletTx(tx, recipient.id),
        ]);

        if (!senderWallet)           throw new ApiError(404, 'Sender wallet not found');
        if (!senderWallet.isActive)  throw new ApiError(403, 'Your wallet is inactive');
        if (!recipientWallet.isActive) throw new ApiError(403, 'Recipient wallet is inactive');
        if (senderWallet.walletType !== recipientWallet.walletType) {
          throw new ApiError(400, 'Transfers are only allowed between wallets of the same type');
        }
        if (senderWallet.balance < amount) throw new ApiError(400, 'Insufficient wallet balance');

        const senderOpening    = senderWallet.balance;
        const senderClosing    = toPaiseRounded(senderOpening - amount);
        const recipientOpening = recipientWallet.balance;
        const recipientClosing = toPaiseRounded(recipientOpening + amount);

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
    ), 'Send money');
  }

  // ─── Provider Payouts ──────────────────────────────────────────────────────
  // Scope note: this only records the request and moves the balance out of the
  // wallet on approval. Bank-account capture, KYC, and TDS/GST computation are
  // deliberately out of scope until product/legal sign off on that flow.

  static async createPayoutRequest(input: CreatePayoutRequestInput) {
    const { userId, amount } = input;
    if (amount <= 0) throw new ApiError(400, 'Amount must be greater than 0');

    // Serializable: the pending-sum check below must see a concurrent
    // request, or two taps could together ask for more than the balance.
    return prisma.$transaction(
      async (tx) => {
        const wallet = await tx.wallet.findUnique({ where: { userId, isDeleted: false } });
        if (!wallet) throw new ApiError(404, 'Wallet not found');
        if (wallet.walletType !== WalletType.PROVIDER) {
          throw new ApiError(403, 'Only provider wallets can request a payout');
        }
        if (!wallet.isActive) throw new ApiError(403, 'Wallet is inactive');

        // PENDING requests aren't debited until approved, so they still count
        // against the balance here.
        const pending = await tx.payoutRequest.aggregate({
          where: { userId, status: PayoutRequestStatus.PENDING, isDeleted: false },
          _sum:  { amount: true },
        });
        const available = toPaiseRounded(wallet.balance - (pending._sum.amount ?? 0));
        if (available < amount) {
          throw new ApiError(400, `Insufficient balance — ₹${Math.max(available, 0)} available after pending payout requests`);
        }

        return tx.payoutRequest.create({
          data: { walletId: wallet.id, userId, amount },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  static async getPayoutRequests(userId: string) {
    return prisma.payoutRequest.findMany({
      where:   { userId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async updatePayoutRequestStatus(input: UpdatePayoutRequestInput) {
    const { payoutRequestId, status, adminId } = input;

    // Allowed transitions. The wallet is debited exactly once, when a request
    // leaves PENDING for APPROVED or PAID; APPROVED → PAID just records that
    // the admin has now sent the money. An APPROVED request can't be rejected
    // here — that would need the debit reversed.
    const allowedFrom: PayoutRequestStatus[] =
      status === PayoutRequestStatus.PAID
        ? [PayoutRequestStatus.PENDING, PayoutRequestStatus.APPROVED]
        : [PayoutRequestStatus.PENDING];

    // One transaction: claim the transition and debit together, so a
    // double-click or two admins can't both debit, and a debit can never
    // commit while the request still reads PENDING.
    return prisma.$transaction(
      async (tx) => {
        const payoutRequest = await tx.payoutRequest.findFirst({
          where: { id: payoutRequestId, isDeleted: false },
        });
        if (!payoutRequest) throw new ApiError(404, 'Payout request not found');

        const claimed = await tx.payoutRequest.updateMany({
          where: { id: payoutRequestId, status: { in: allowedFrom }, isDeleted: false },
          data:  { status, adminId, processedAt: new Date() },
        });
        if (claimed.count === 0) {
          throw new ApiError(409, `Payout request is already ${payoutRequest.status}`);
        }

        const needsDebit =
          payoutRequest.status === PayoutRequestStatus.PENDING &&
          (status === PayoutRequestStatus.APPROVED || status === PayoutRequestStatus.PAID);
        if (needsDebit) {
          await WalletService.debitWalletTx(tx, {
            userId: payoutRequest.userId,
            amount: payoutRequest.amount,
            source: WalletLedgerSource.WITHDRAWAL,
            refId:  payoutRequest.id,
          });
        }

        return tx.payoutRequest.findUniqueOrThrow({ where: { id: payoutRequestId } });
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
