import type { PaymentMode } from "@prisma/client";

export interface InvoiceItemInput {
  productId: string;
  quantity: number;
  sellingPrice?: number | undefined;
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

export type UpdateInvoiceInput = Omit<
  {
    [Key in keyof CreateInvoiceInput]?: CreateInvoiceInput[Key] | undefined;
  },
  "customerId"
  | "notes"
> & {
  customerId?: string | null | undefined;
  notes?: string | null | undefined;
};

export interface InvoiceListQuery {
  page: number;
  limit: number;
  status?: string | undefined;
  unpaid: boolean;
  customerId?: string | undefined;
  search?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export interface InvoiceIdParams {
  id: string;
}
