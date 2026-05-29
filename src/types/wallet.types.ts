import { WalletLedgerSource } from '@prisma/client';

export interface CreditWalletBody {
  userId: string;
  amount: number;
  source: WalletLedgerSource;
  refId?: string;
  meta?: Record<string, unknown>;
}

export interface DebitWalletBody {
  userId: string;
  amount: number;
  source: WalletLedgerSource;
  refId?: string;
  meta?: Record<string, unknown>;
}

export interface CreditWalletInput extends CreditWalletBody {}
export interface DebitWalletInput extends DebitWalletBody {}

export interface GetWalletHistoryInput {
  userId: string;
  page: number;
  limit: number;
}
