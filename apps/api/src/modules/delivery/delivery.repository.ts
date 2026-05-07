import { DeliveryStatus, Prisma, type DeliveryProofType, type PrismaClient } from "@prisma/client";

import type { CreateDeliveryInput, DeliveryListQuery, UpdateDeliveryStatusInput } from "./delivery.types.js";

export interface CreateDeliveryProofInput {
  deliveryId: string;
  uploadedBy: string;
  proofType: DeliveryProofType;
  objectName: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  notes?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
}

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

  async canAccessDelivery(tenantId: string, deliveryId: string, userId: string) {
    const count = await this.prisma.delivery.count({
      where: {
        id: deliveryId,
        tenantId,
        assignedTo: userId,
      },
    });

    return count > 0;
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

  async createProof(tenantId: string, input: CreateDeliveryProofInput) {
    return this.prisma.deliveryProof.create({
      data: {
        tenantId,
        deliveryId: input.deliveryId,
        uploadedBy: input.uploadedBy,
        proofType: input.proofType,
        objectName: input.objectName,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        ...(input.notes ? { notes: input.notes } : {}),
        ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
        ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
      },
    });
  }

  async getProof(tenantId: string, deliveryId: string, proofId: string) {
    return this.prisma.deliveryProof.findFirst({
      where: {
        id: proofId,
        tenantId,
        deliveryId,
      },
    });
  }

  async createNotification(input: {
    tenantId: string;
    userId: string;
    title: string;
    body: string;
    type?: "DELIVERY_ASSIGNED" | "DELIVERY_STATUS" | "SYSTEM";
    entityType?: string | undefined;
    entityId?: string | undefined;
  }) {
    return this.prisma.appNotification.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        title: input.title,
        body: input.body,
        type: input.type ?? "SYSTEM",
        ...(input.entityType ? { entityType: input.entityType } : {}),
        ...(input.entityId ? { entityId: input.entityId } : {}),
      },
    });
  }

  async listNotifications(tenantId: string, userId: string) {
    return this.prisma.appNotification.findMany({
      where: {
        tenantId,
        userId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 30,
    });
  }

  async markNotificationRead(tenantId: string, userId: string, notificationId: string) {
    return this.prisma.appNotification.updateMany({
      where: {
        id: notificationId,
        tenantId,
        userId,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }
}

const deliveryInclude = {
  invoice: true,
  customer: true,
  proofs: {
    orderBy: {
      createdAt: Prisma.SortOrder.desc,
    },
  },
} satisfies Prisma.DeliveryInclude;
