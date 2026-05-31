import { Response, NextFunction } from 'express';
import { AuthRequest } from '@/middlewares/auth.middleware';
import { Request } from 'express';
import { PaymentService } from '@/services/payment.service';
import { ApiResponse } from '@/utils/apiResponse';
import { CreateRazorpayOrderSchema, CreatePaymentLinkSchema, WebviewCompleteSchema } from '@/types/payment.types';

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

  static async createPaymentLink(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = CreatePaymentLinkSchema.safeParse(req.body);
      if (!parsed.success) return ApiResponse.error(res, 400, 'Validation failed', parsed.error.issues);

      const profile = req.user!;
      const result = await PaymentService.createPaymentLink({
        ...parsed.data,
        userId:    profile.id,
        userName:  [profile.firstName, profile.lastName].filter(Boolean).join(' ') || undefined,
        userPhone: profile.phoneNo,
        userEmail: profile.email ?? undefined,
      });
      return ApiResponse.success(res, 201, 'Payment link created', result);
    } catch (error) {
      next(error);
    }
  }

  // GET callback that Razorpay redirects to after payment link payment
  static async handleLinkCallback(req: Request, res: Response) {
    const status = req.query.razorpay_payment_link_status as string;
    // Return a minimal HTML page the WebView can detect
    const html = status === 'paid'
      ? `<html><body><p id="status">paid</p></body></html>`
      : `<html><body><p id="status">failed</p></body></html>`;
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  }

  static async handleWebviewComplete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = WebviewCompleteSchema.safeParse(req.body);
      if (!parsed.success) return ApiResponse.error(res, 400, 'Validation failed', parsed.error.issues);

      const result = await PaymentService.webviewComplete({
        ...parsed.data,
        userId: req.user!.id,
      });
      return ApiResponse.success(res, 200, 'Payment completed', result);
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
