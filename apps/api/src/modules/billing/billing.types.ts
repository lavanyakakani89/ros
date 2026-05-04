import type { PaymentMode } from "@prisma/client";

export interface InvoiceItemInput {
  productId: string;
  quantity: number;
  discount?: number | undefined;
  discountPercent?: number | undefined;
  batchNumber?: string | undefined;
  expiryDate?: Date | undefined;
}

export interface CreateInvoiceInput {
  customerId?: string | undefined;
  dueDate?: Date | undefined;
  paymentMode: PaymentMode;
  billDiscount: number;
  verticalData?: Record<string, unknown> | undefined;
  notes?: string | undefined;
  items: InvoiceItemInput[];
}

export type UpdateInvoiceInput = {
  [Key in keyof CreateInvoiceInput]?: CreateInvoiceInput[Key] | undefined;
};

export interface InvoiceListQuery {
  page: number;
  limit: number;
  status?: string | undefined;
  customerId?: string | undefined;
  search?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export interface InvoiceIdParams {
  id: string;
}
