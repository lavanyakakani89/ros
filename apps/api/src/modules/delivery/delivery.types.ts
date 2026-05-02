import type { DeliveryStatus } from "@prisma/client";

export interface CreateDeliveryInput {
  invoiceId: string;
  customerId: string;
  deliveryAddress: string;
  scheduledAt?: Date | undefined;
  notes?: string | undefined;
}

export interface DeliveryListQuery {
  status?: DeliveryStatus | undefined;
}

export interface DeliveryIdParams {
  id: string;
}

export interface DeliveryAgentParams {
  userId: string;
}

export interface AssignDeliveryInput {
  userId: string;
}

export interface UpdateDeliveryStatusInput {
  status: DeliveryStatus;
  notes?: string | undefined;
}
