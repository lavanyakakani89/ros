import type { PaymentMode } from "@prisma/client";

export interface RecordPaymentInput {
  invoiceId: string;
  amount: number;
  mode?: PaymentMode | undefined;
  payment_method_id?: string | undefined;
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

export interface RazorpayPaymentLinkInput {
  invoiceId: string;
  amount: number;
  description?: string | undefined;
  customerId?: string | undefined;
}

export interface RazorpayVerifyInput {
  orderId: string;
  paymentId: string;
  signature: string;
}
