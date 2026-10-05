import { NextFunction, Response } from 'express';
import { waitUntil } from '@vercel/functions';
import { z } from 'zod';
import { ApiResponse } from '@/utils/apiResponse';
import { describeZodError } from '@/utils/zodError';
import { WhatsAppService } from '@/services/whatsapp.service';
import type { AuthRequest } from '@/middlewares/auth.middleware';
import type { StartPairingBody, StartPairingResult } from '@/types/whatsapp.types';

const StartPairingSchema = z.object({
  phone: z
    .string({ error: 'Phone number is required' })
    .transform((value) => value.replace(/\D/g, ''))
    .refine((digits) => digits.length >= 10 && digits.length <= 15, 'Enter a valid phone number'),
});

export class WhatsAppController {
  static async getStatus(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const status = await WhatsAppService.getStatus();
      return ApiResponse.success(res, 200, 'WhatsApp status fetched', status);
    } catch (error) {
      next(error);
    }
  }

  static async startPairing(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = StartPairingSchema.safeParse(req.body as StartPairingBody);
      if (!parsed.success) return ApiResponse.error(res, 400, describeZodError(parsed.error), parsed.error.issues);

      const { code, finished } = await WhatsAppService.startPairing(parsed.data.phone);
      // The WhatsApp connection must stay open after this response until the
      // admin types the code — keep the Vercel invocation alive for it.
      waitUntil(finished);

      const result: StartPairingResult = { code };
      return ApiResponse.success(res, 200, 'Enter this code on the phone', result);
    } catch (error) {
      next(error);
    }
  }

  static async logout(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await WhatsAppService.logout();
      return ApiResponse.success(res, 200, 'WhatsApp disconnected', null);
    } catch (error) {
      next(error);
    }
  }
}
