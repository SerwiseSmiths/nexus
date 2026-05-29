import axios from 'axios';
import { config } from '@/configs';
import { ApiError } from '@/utils/apiResponse';
import type { CreateRazorpayOrderInput, RazorpayOrderResult } from '@/types/payment.types';

export class PaymentService {
  static async createRazorpayOrder({ amount }: CreateRazorpayOrderInput): Promise<RazorpayOrderResult> {
    const keyId = config.razorpay?.keyId;
    const keySecret = config.razorpay?.keySecret;
    if (!keyId || !keySecret) throw new ApiError(503, 'Razorpay is not configured');

    try {
      const response = await axios.post(
        'https://api.razorpay.com/v1/orders',
        { amount, currency: 'INR', receipt: `rcpt_${Date.now()}` },
        { auth: { username: keyId, password: keySecret } },
      );
      return {
        orderId: response.data.id,
        amount: response.data.amount,
        currency: response.data.currency,
        keyId,
      };
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { description?: string } } } };
      throw new ApiError(502, axiosErr?.response?.data?.error?.description ?? 'Failed to create Razorpay order');
    }
  }
}
