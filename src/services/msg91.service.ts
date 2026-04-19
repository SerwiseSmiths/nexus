import axios, { AxiosError } from "axios";
import { config } from "../configs";

const MSG91_WHATSAPP_BASE =
  "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";

export interface SendWhatsAppTextOptions {
  recipientNumber: string;
  text: string;
}

export const sendWhatsAppText = async (
  options: SendWhatsAppTextOptions
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  const { authKey, integratedNumber, templateName, templateNamespace } = config.msg91;

  if (!authKey || !integratedNumber) {
    console.error("MSG91 WhatsApp: Missing configuration");
    return { success: false, error: "WhatsApp OTP not configured" };
  }

  const recipientNumber = normalizePhoneForMsg91(options.recipientNumber);

  const requestBody = {
    integrated_number: integratedNumber,
    content_type: "template" as const,
    payload: {
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: templateName,
        language: {
          code: "en",
          policy: "deterministic",
        },
        namespace: templateNamespace,
        to_and_components: [
          {
            to: [recipientNumber],
            components: {
              body_1: {
                type: "text",
                value: options.text,
              },
              button_1: {
                subtype: "url",
                type: "text",
                value: options.text,
              },
            },
          },
        ],
      },
    },
  };

  try {
    const response = await axios.post(MSG91_WHATSAPP_BASE, requestBody, {
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authkey: authKey,
      },
      timeout: 15000,
    });

    const data = response.data as { request_id?: string; type?: string };

    return {
      success: true,
      ...(data.request_id != null && { messageId: data.request_id }),
    };
  } catch (err) {
    const axiosError = err as AxiosError<{ message?: string }>;
    const errorMessage =
      (axiosError.response?.data &&
      typeof axiosError.response.data === "object" &&
      "message" in axiosError.response.data
        ? (axiosError.response.data as { message?: string }).message
        : null) ||
      axiosError.message ||
      "Unknown MSG91 error";

    console.error(`MSG91 WhatsApp send failed:`, errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
};

function normalizePhoneForMsg91(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 10) {
    return "91" + digits;
  }
  return digits;
}
