import { DeliveryStatus, type PrismaClient } from "@prisma/client";

import type { CreateDeliveryInput, DeliveryListQuery, UpdateDeliveryStatusInput } from "./delivery.types.js";

export class DeliveryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createDelivery(tenantId: string, input: CreateDeliveryInput) {
    const [invoice, customer] = await Promise.all([
      this.prisma.invoice.findFirst({
        where: {
          id: input.invoiceId,
          tenantId,
        },
      }),
      this.prisma.customer.findFirst({
        where: {
          id: input.customerId,
          tenantId,
        },
      }),
    ]);

    if (!invoice || !customer) {
      return null;
    }

    return this.prisma.delivery.create({
      data: {
        tenantId,
        invoiceId: input.invoiceId,
        customerId: input.customerId,
        deliveryAddress: input.deliveryAddress,
        ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      },
      include: deliveryInclude,
    });
  }

  async listDeliveries(tenantId: string, query: DeliveryListQuery) {
    return this.prisma.delivery.findMany({
      where: {
        tenantId,
        ...(query.status ? { status: query.status } : {}),
      },
      include: deliveryInclude,
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async assignDelivery(tenantId: string, deliveryId: string, userId: string) {
    return this.prisma.delivery.updateMany({
      where: {
        id: deliveryId,
        tenantId,
      },
      data: {
        assignedTo: userId,
        status: DeliveryStatus.ASSIGNED,
      },
    });
  }

  async updateDeliveryStatus(tenantId: string, deliveryId: string, input: UpdateDeliveryStatusInput) {
    return this.prisma.delivery.updateMany({
      where: {
        id: deliveryId,
        tenantId,
      },
      data: {
        status: input.status,
        ...(input.notes ? { notes: input.notes } : {}),
        ...(input.status === DeliveryStatus.DELIVERED ? { deliveredAt: new Date() } : {}),
      },
    });
  }

  async getDelivery(tenantId: string, deliveryId: string) {
    return this.prisma.delivery.findFirst({
      where: {
        id: deliveryId,
        tenantId,
      },
      include: deliveryInclude,
    });
  }

  async listAgentDeliveries(tenantId: string, userId: string) {
    return this.prisma.delivery.findMany({
      where: {
        tenantId,
        assignedTo: userId,
      },
      include: deliveryInclude,
      orderBy: {
        scheduledAt: "asc",
      },
    });
  }
}

const deliveryInclude = {
  invoice: true,
  customer: true,
} as const;
