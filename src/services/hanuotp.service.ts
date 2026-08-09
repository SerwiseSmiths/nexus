import axios, { AxiosError } from "axios";
import { config } from "@/configs";
import { logger } from "@/utils/logger";

const HANUOTP_BASE = "https://api.hanuotp.in/sms-otp.php";

export interface SendOtpSmsOptions {
  recipientNumber: string;
  otp: string;
}

export const sendOtpSms = async (
  options: SendOtpSmsOptions
): Promise<{ success: boolean; error?: string }> => {
  const { apiKey, templateSid } = config.hanuOtp;

  if (!apiKey) {
    logger.error("HanuOTP: Missing configuration");
    return { success: false, error: "SMS OTP not configured" };
  }

  const recipientNumber = normalizePhoneForHanuOtp(options.recipientNumber);

  logger.info(`HanuOTP: sending OTP to ${recipientNumber} (templateSid=${templateSid})`);

  try {
    const response = await axios.get(HANUOTP_BASE, {
      params: {
        number: recipientNumber,
        OTP: options.otp,
        apikey: apiKey,
        templatesid: templateSid,
      },
      timeout: 15000,
    });

    logger.info(`HanuOTP: response for ${recipientNumber} - ${JSON.stringify(response.data)}`);

    if (response.data?.status === "error") {
      const errorMessage = response.data?.message || "Unknown HanuOTP error";
      logger.error(`HanuOTP send failed for ${recipientNumber}: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }

    return { success: true };
  } catch (err) {
    const axiosError = err as AxiosError<{ message?: string }>;
    const errorMessage =
      (axiosError.response?.data &&
      typeof axiosError.response.data === "object" &&
      "message" in axiosError.response.data
        ? (axiosError.response.data as { message?: string }).message
        : null) ||
      axiosError.message ||
      "Unknown HanuOTP error";

    logger.error(`HanuOTP send failed for ${recipientNumber}: ${errorMessage}`);
    return {
      success: false,
      error: errorMessage,
    };
  }
};

function normalizePhoneForHanuOtp(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) {
    return digits.slice(-10);
  }
  return digits;
}
