import { NextFunction, Response } from 'express';
import { z } from 'zod';
import { WalletLedgerSource } from '@prisma/client';
import { ApiError, ApiResponse } from '@/utils/apiResponse';
import { WalletService } from '@/services/wallet.service';
import type { AuthRequest } from '@/middlewares/auth.middleware';

const creditDebitSchema = z.object({
  userId:  z.string().uuid('Invalid userId'),
  amount:  z.number({ error: 'Amount must be a number' }).positive('Amount must be positive'),
  source:  z.nativeEnum(WalletLedgerSource, { error: 'Invalid source' }),
  refId:   z.string().optional(),
  meta:    z.record(z.string(), z.unknown()).optional(),
});

export class WalletController {
  static async getMyWallet(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const wallet = await WalletService.getWallet(req.user!.id);
      ApiResponse.success(res, 200, 'Wallet fetched successfully', wallet);
    } catch (error) {
      next(error);
    }
  }

  static async getWalletByUserId(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.params.userId as string;
      if (!userId) throw new ApiError(400, 'userId is required');
      const wallet = await WalletService.getWalletByUserId(userId);
      ApiResponse.success(res, 200, 'Wallet fetched successfully', wallet);
    } catch (error) {
      next(error);
    }
  }

  static async credit(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = creditDebitSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());

      const result = await WalletService.creditWallet(parsed.data);
      ApiResponse.success(res, 200, 'Wallet credited successfully', result);
    } catch (error) {
      next(error);
    }
  }

  static async debit(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = creditDebitSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());

      const result = await WalletService.debitWallet(parsed.data);
      ApiResponse.success(res, 200, 'Wallet debited successfully', result);
    } catch (error) {
      next(error);
    }
  }

  static async getHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const page  = Math.max(1, parseInt(req.query.page  as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

      const result = await WalletService.getWalletHistory({ userId: req.user!.id, page, limit });
      ApiResponse.success(res, 200, 'Wallet history fetched successfully', result);
    } catch (error) {
      next(error);
    }
  }
}
