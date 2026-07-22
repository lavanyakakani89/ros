import { DeliveryProofType, DeliveryStatus } from "@prisma/client";
import { z } from "zod";

export const createDeliverySchema = z.object({
  invoiceId: z.string().min(1),
  customerId: z.string().min(1),
  deliveryAddress: z.string().trim().min(5),
  scheduledAt: z.coerce.date().optional(),
  notes: z.string().trim().min(1).optional(),
});

export const syncInvoiceDeliverySchema = z.object({
  deliveryRequired: z.boolean(),
  customerId: z.string().min(1).optional(),
  deliveryAddress: z.string().trim().min(5).optional(),
  scheduledAt: z.coerce.date().optional(),
  notes: z.string().trim().min(1).optional(),
}).superRefine((value, context) => {
  if (!value.deliveryRequired) {
    return;
  }

  if (!value.customerId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["customerId"],
      message: "Customer is required when delivery is required",
    });
  }

  if (!value.deliveryAddress) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["deliveryAddress"],
      message: "Delivery address is required when delivery is required",
    });
  }
});

export const deliveryListQuerySchema = z.object({
  status: z.nativeEnum(DeliveryStatus).optional(),
  scope: z.enum(["active", "archive"]).optional(),
  paginated: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const deliveryIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const deliveryInvoiceParamsSchema = z.object({
  invoiceId: z.string().min(1),
});

export const deliveryAgentParamsSchema = z.object({
  userId: z.string().min(1),
});

export const deliveryProofParamsSchema = z.object({
  id: z.string().min(1),
  proofId: z.string().min(1),
});

export const notificationIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const assignDeliverySchema = z.object({
  userId: z.string().min(1),
});

export const updateDeliveryStatusSchema = z.object({
  status: z.nativeEnum(DeliveryStatus),
  notes: z.string().trim().min(1).optional(),
});

export const createDeliveryProofFieldsSchema = z.object({
  proofType: z.nativeEnum(DeliveryProofType).default(DeliveryProofType.DELIVERY_PHOTO),
  notes: z.string().trim().min(1).optional(),
  latitude: z.coerce.number().finite().optional(),
  longitude: z.coerce.number().finite().optional(),
});
