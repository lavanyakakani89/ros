import { PaymentMode } from "@prisma/client";
import { z } from "zod";

const decimalSchema = z.coerce.number().finite();

export const recordPaymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: decimalSchema.positive(),
  mode: z.nativeEnum(PaymentMode),
  referenceNumber: z.string().trim().min(1).optional(),
  razorpayId: z.string().trim().min(1).optional(),
});

export const paymentListQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const razorpayOrderSchema = z.object({
  amount: decimalSchema.positive(),
  receipt: z.string().trim().min(1).optional(),
  invoiceId: z.string().trim().min(1).optional(),
});

export const razorpayVerifySchema = z.object({
  orderId: z.string().min(1),
  paymentId: z.string().min(1),
  signature: z.string().min(1),
});
