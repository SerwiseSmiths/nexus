import { WalletLedgerSource, PaymentProvider, PayoutRequestStatus } from '@prisma/client';

export interface CreditWalletBody {
  userId:          string;
  amount:          number;
  source:          WalletLedgerSource;
  refId?:          string;
  meta?:           Record<string, unknown>;
  paymentProvider?: PaymentProvider;
  // When false, ledger entry is created for audit but wallet.balance is NOT updated
  updateBalance?:  boolean;
}

export interface DebitWalletBody {
  userId:          string;
  amount:          number;
  source:          WalletLedgerSource;
  refId?:          string;
  meta?:           Record<string, unknown>;
  paymentProvider?: PaymentProvider;
  updateBalance?:  boolean;
}

export interface CreditWalletInput extends CreditWalletBody {}
export interface DebitWalletInput extends DebitWalletBody {}

export interface GetWalletHistoryInput {
  userId: string;
  page:   number;
  limit:  number;
}

export interface SendMoneyBody {
  recipientPhone: string;
  amount:         number;
}

export interface SendMoneyInput {
  senderUserId:   string;
  recipientPhone: string;
  amount:         number;
}

export interface CreatePayoutRequestBody {
  amount: number;
}

export interface CreatePayoutRequestInput extends CreatePayoutRequestBody {
  userId: string;
}

export interface UpdatePayoutRequestBody {
  status: PayoutRequestStatus;
}

export interface UpdatePayoutRequestInput {
  payoutRequestId: string;
  status:          PayoutRequestStatus;
  adminId:         string;
}
