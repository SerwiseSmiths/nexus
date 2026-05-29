import { NextFunction, Response } from 'express';
import { z } from 'zod';
import { WalletLedgerSource } from '@prisma/client';
import { ApiError, ApiResponse } from '@/utils/apiResponse';
import { WalletService } from '@/services/wallet.service';
import type { AuthRequest } from '@/middlewares/auth.middleware';

const creditDebitSchema = z.object({
  userId: z.string().uuid('Invalid userId'),
  amount: z.number({ invalid_type_error: 'Amount must be a number' }).positive('Amount must be positive'),
  source: z.nativeEnum(WalletLedgerSource, { errorMap: () => ({ message: 'Invalid source' }) }),
  refId: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});

export class WalletController {
  static async getMyWallet(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const wallet = await WalletService.getWallet(req.user!.id);
      res.status(200).json(ApiResponse.success('Wallet fetched successfully', wallet));
    } catch (error) {
      next(error);
    }
  }

  static async getWalletByUserId(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      if (!userId) throw new ApiError(400, 'userId is required');
      const wallet = await WalletService.getWalletByUserId(userId);
      res.status(200).json(ApiResponse.success('Wallet fetched successfully', wallet));
    } catch (error) {
      next(error);
    }
  }

  static async credit(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = creditDebitSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());

      const result = await WalletService.creditWallet(parsed.data);
      res.status(200).json(ApiResponse.success('Wallet credited successfully', result));
    } catch (error) {
      next(error);
    }
  }

  static async debit(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = creditDebitSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());

      const result = await WalletService.debitWallet(parsed.data);
      res.status(200).json(ApiResponse.success('Wallet debited successfully', result));
    } catch (error) {
      next(error);
    }
  }

  static async getHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

      const result = await WalletService.getWalletHistory({ userId: req.user!.id, page, limit });
      res.status(200).json(ApiResponse.success('Wallet history fetched successfully', result));
    } catch (error) {
      next(error);
    }
  }
}
