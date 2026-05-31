import { WalletLedgerSource, PaymentProvider } from '@prisma/client';

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
