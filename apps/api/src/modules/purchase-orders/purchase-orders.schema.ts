import { POStatus } from "@prisma/client";
import { z } from "zod";

const decimalSchema = z.coerce.number().finite();

export const purchaseOrderListQuerySchema = z.object({
  status: z.nativeEnum(POStatus).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const purchaseOrderIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().min(1),
  items: z.array(z.object({
    productId: z.string().min(1).optional(),
    productName: z.string().trim().min(1),
    quantity: decimalSchema.positive(),
    unit: z.string().trim().min(1),
    purchasePrice: decimalSchema.nonnegative(),
    batchNumber: z.string().trim().min(1).optional(),
    expiryDate: z.coerce.date().optional(),
  })).min(1),
});

export const updatePurchaseOrderStatusSchema = z.object({
  status: z.nativeEnum(POStatus),
});

export const receivePurchaseOrderSchema = z.object({
  items: z.array(z.object({
    itemId: z.string().min(1),
    receivedQuantity: decimalSchema.positive(),
    batchNumber: z.string().trim().min(1).optional(),
    expiryDate: z.coerce.date().optional(),
  })).min(1),
});

export type PurchaseOrderListQuery = z.infer<typeof purchaseOrderListQuerySchema>;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderStatusInput = z.infer<typeof updatePurchaseOrderStatusSchema>;
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;
