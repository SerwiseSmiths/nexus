import { Response, NextFunction } from 'express';
import { AuthRequest } from '@/middlewares/auth.middleware';
import { PaymentService } from '@/services/payment.service';
import { ApiResponse } from '@/utils/apiResponse';
import { CreateRazorpayOrderSchema } from '@/types/payment.types';

export class PaymentController {
  static async createRazorpayOrder(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = CreateRazorpayOrderSchema.safeParse(req.body);
      if (!parsed.success) return ApiResponse.error(res, 400, 'Validation failed', parsed.error.issues);

      const result = await PaymentService.createRazorpayOrder(parsed.data);
      return ApiResponse.success(res, 201, 'Razorpay order created', result);
    } catch (error) {
      next(error);
    }
  }
}
