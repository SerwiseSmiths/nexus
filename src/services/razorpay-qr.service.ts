import axios from 'axios';
import Jimp from 'jimp';
import jsQR from 'jsqr';
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
        imageContent: data.image_content ?? (await RazorpayQrService.decodeUpiString(data.image_url)),
        closeBy:      data.close_by,
      };
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(502, razorpayErrorMessage(err, 'Failed to create payment QR'));
    }
  }

  // Razorpay's API only returns `image_url` — a branded poster (logo, UPI app
  // icons, business name) with the QR in the middle — not the UPI string
  // itself. Decoding the poster once here gives the raw `upi://pay?...`
  // string so radix can render a plain QR natively. Returns null on any
  // failure; radix then falls back to showing the poster image.
  static async decodeUpiString(imageUrl: string): Promise<string | null> {
    try {
      const res = await axios.get<ArrayBuffer>(imageUrl, { responseType: 'arraybuffer', timeout: 8_000 });
      const image = await Jimp.read(Buffer.from(res.data));
      const { data, width, height } = image.bitmap;
      const decoded = jsQR(new Uint8ClampedArray(data), width, height, { inversionAttempts: 'attemptBoth' });
      if (!decoded?.data.startsWith('upi://')) {
        logger.warn('[RazorpayQr] Could not decode a UPI string from the QR image', { imageUrl });
        return null;
      }
      return decoded.data;
    } catch (err: unknown) {
      logger.warn('[RazorpayQr] Failed to fetch/decode QR image', { imageUrl, reason: (err as Error)?.message });
      return null;
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
