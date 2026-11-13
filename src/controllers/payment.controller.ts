import { Response, NextFunction } from 'express';
import { AuthRequest } from '@/middlewares/auth.middleware';
import { Request } from 'express';
import { PaymentService } from '@/services/payment.service';
import { ApiError, ApiResponse } from '@/utils/apiResponse';
import { CreateBookingQrSchema, CreateRazorpayOrderSchema } from '@/types/payment.types';

export class PaymentController {
  static async createRazorpayOrder(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = CreateRazorpayOrderSchema.safeParse(req.body);
      if (!parsed.success) return ApiResponse.error(res, 400, 'Validation failed', parsed.error.issues);

      const result = await PaymentService.createRazorpayOrder({
        amount:  parsed.data.amount,
        userId:  req.user!.id,
        purpose: parsed.data.purpose,
        meta:    parsed.data.meta,
      });
      return ApiResponse.success(res, 201, 'Razorpay order created', result);
    } catch (error) {
      next(error);
    }
  }

  static async createBookingQr(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = CreateBookingQrSchema.safeParse(req.body);
      if (!parsed.success) return ApiResponse.error(res, 400, 'Validation failed', parsed.error.issues);

      const result = await PaymentService.createBookingQr({
        userId: req.user!.id,
        amount: parsed.data.amount,
        meta:   parsed.data.meta,
      });
      return ApiResponse.success(res, 201, 'Booking QR created', result);
    } catch (error) {
      next(error);
    }
  }

  static async getOrderStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const orderId = req.params.orderId as string;
      if (!orderId) throw new ApiError(400, 'orderId is required');

      const result = await PaymentService.getOrderStatus(req.user!.id, orderId);
      return ApiResponse.success(res, 200, 'Payment order status fetched', result);
    } catch (error) {
      next(error);
    }
  }

  static async handleWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const signature = req.headers['x-razorpay-signature'];
      if (!signature || typeof signature !== 'string') {
        return ApiResponse.error(res, 400, 'Missing Razorpay signature header');
      }
      if (!req.rawBody) {
        return ApiResponse.error(res, 400, 'Missing raw body');
      }

      await PaymentService.handleWebhookEvent(req.rawBody, signature);

      // Always return 200 quickly — Razorpay retries on non-2xx
      return res.status(200).json({ received: true });
    } catch (error) {
      next(error);
    }
  }
}
