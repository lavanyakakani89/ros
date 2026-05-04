import type { PaymentMode } from "@prisma/client";

export interface RecordPaymentInput {
  invoiceId: string;
  amount: number;
  mode: PaymentMode;
  referenceNumber?: string | undefined;
  razorpayId?: string | undefined;
}

export interface PaymentListQuery {
  from?: Date | undefined;
  to?: Date | undefined;
}

export interface RazorpayOrderInput {
  amount: number;
  receipt?: string | undefined;
  invoiceId?: string | undefined;
}

export interface RazorpayVerifyInput {
  orderId: string;
  paymentId: string;
  signature: string;
}
