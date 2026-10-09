import axios from 'axios';
import { config } from '@/configs';
import { ApiError } from '@/utils/apiResponse';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// RazorpayQrService
//
// Thin wrapper over Razorpay's QR Codes API (`/v1/payments/qr_codes`). Kept
// free of any DB / complaint logic so ComplaintService can use it without a
// circular import through PaymentService (which itself imports
// ComplaintService for webhook fulfilment).
// ---------------------------------------------------------------------------

export interface RazorpayQrCode {
  id:           string;   // qr_xxx
  imageUrl:     string;   // hosted PNG (QR + amount + UPI branding)
  // Raw UPI intent string, when Razorpay returns it — lets the app render the
  // QR natively instead of loading the hosted image. Not guaranteed present.
  imageContent: string | null;
  closeBy:      number;   // unix seconds
}

interface CreateFixedAmountQrInput {
  amountPaise: number;
  description: string;
  closeBy:     number; // unix seconds — Razorpay requires ≥ 2 min in the future
  notes:       Record<string, string>;
}

function credentials(): { username: string; password: string } {
  const keyId     = config.razorpay?.keyId;
  const keySecret = config.razorpay?.keySecret;
  if (!keyId || !keySecret) throw new ApiError(503, 'Razorpay is not configured');
  return { username: keyId, password: keySecret };
}

function razorpayErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as { response?: { data?: { error?: { description?: string } } } };
  return axiosErr?.response?.data?.error?.description ?? fallback;
}

export class RazorpayQrService {
  // Single-use UPI QR locked to one exact amount — the payer can't edit it,
  // and Razorpay auto-closes it after the first successful payment.
  static async createFixedAmountQr(input: CreateFixedAmountQrInput): Promise<RazorpayQrCode> {
    try {
      const response = await axios.post(
        'https://api.razorpay.com/v1/payments/qr_codes',
        {
          type:           'upi_qr',
          name:           'Serwise',
          usage:          'single_use',
          fixed_amount:   true,
          payment_amount: input.amountPaise,
          description:    input.description,
          close_by:       input.closeBy,
          notes:          input.notes,
        },
        { auth: credentials() },
      );
      const data = response.data as {
        id: string; image_url: string; image_content?: string | null; close_by: number;
      };
      return {
        id:           data.id,
        imageUrl:     data.image_url,
        imageContent: data.image_content ?? null,
        closeBy:      data.close_by,
      };
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(502, razorpayErrorMessage(err, 'Failed to create payment QR'));
    }
  }

  // Best-effort — a QR that's already closed/paid makes Razorpay 400, which
  // is the outcome we wanted anyway.
  static async closeQr(qrId: string): Promise<void> {
    try {
      await axios.post(`https://api.razorpay.com/v1/payments/qr_codes/${qrId}/close`, {}, { auth: credentials() });
    } catch (err: unknown) {
      logger.warn('[RazorpayQr] Failed to close QR (may already be closed)', {
        qrId, reason: razorpayErrorMessage(err, 'unknown'),
      });
    }
  }
}
