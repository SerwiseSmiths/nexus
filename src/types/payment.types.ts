import { z } from 'zod';

export const CreateRazorpayOrderSchema = z.object({
  amount: z.number().int().positive(), // in paise
});

export type CreateRazorpayOrderBody = z.infer<typeof CreateRazorpayOrderSchema>;

export type CreateRazorpayOrderInput = {
  amount: number;
};

export type RazorpayOrderResult = {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
};
