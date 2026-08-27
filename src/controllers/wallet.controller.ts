import { NextFunction, Response } from 'express';
import { z } from 'zod';
import { PayoutRequestStatus, WalletLedgerSource } from '@prisma/client';
import { ApiError, ApiResponse } from '@/utils/apiResponse';
import { WalletService } from '@/services/wallet.service';
import type { AuthRequest } from '@/middlewares/auth.middleware';

const sendMoneySchema = z.object({
  recipientPhone: z.string().min(10, 'Invalid phone number'),
  amount:         z.number({ error: 'Amount must be a number' }).positive('Amount must be positive'),
});

const creditDebitSchema = z.object({
  userId:  z.string().uuid('Invalid userId'),
  amount:  z.number({ error: 'Amount must be a number' }).positive('Amount must be positive'),
  source:  z.nativeEnum(WalletLedgerSource, { error: 'Invalid source' }),
  refId:   z.string().optional(),
  meta:    z.record(z.string(), z.unknown()).optional(),
});

const createPayoutRequestSchema = z.object({
  amount: z.number({ error: 'Amount must be a number' }).positive('Amount must be positive'),
});

const updatePayoutRequestSchema = z.object({
  status: z.enum([PayoutRequestStatus.APPROVED, PayoutRequestStatus.REJECTED, PayoutRequestStatus.PAID], {
    error: 'Invalid status',
  }),
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

  static async sendMoney(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = sendMoneySchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());

      const result = await WalletService.sendMoney({
        senderUserId:   req.user!.id,
        recipientPhone: parsed.data.recipientPhone,
        amount:         parsed.data.amount,
      });
      ApiResponse.success(res, 200, 'Money sent successfully', result);
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

  static async requestPayout(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = createPayoutRequestSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());

      const result = await WalletService.createPayoutRequest({ userId: req.user!.id, amount: parsed.data.amount });
      ApiResponse.success(res, 201, 'Payout request created successfully', result);
    } catch (error) {
      next(error);
    }
  }

  static async getMyPayoutRequests(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await WalletService.getPayoutRequests(req.user!.id);
      ApiResponse.success(res, 200, 'Payout requests fetched successfully', result);
    } catch (error) {
      next(error);
    }
  }

  static async updatePayoutRequest(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      if (!id) throw new ApiError(400, 'id is required');

      const parsed = updatePayoutRequestSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, 'Validation failed', parsed.error.flatten());

      const result = await WalletService.updatePayoutRequestStatus({
        payoutRequestId: id,
        status:          parsed.data.status,
        adminId:         req.user!.id,
      });
      ApiResponse.success(res, 200, 'Payout request updated successfully', result);
    } catch (error) {
      next(error);
    }
  }
}
