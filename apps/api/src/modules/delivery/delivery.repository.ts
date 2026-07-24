import { DeliveryRoutePlanStatus, DeliveryRouteStopStatus, DeliveryStatus, Prisma, UserRole, type DeliveryProofType, type PrismaClient } from "@prisma/client";

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

  upsertWebPushSubscription(
    tenantId: string,
    userId: string,
    input: {
      endpoint: string;
      p256dh: string;
      auth: string;
      userAgent?: string | undefined;
    },
  ) {
    return this.prisma.webPushSubscription.upsert({
      where: {
        endpoint: input.endpoint,
      },
      create: {
        tenantId,
        userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      },
      update: {
        tenantId,
        userId,
        p256dh: input.p256dh,
        auth: input.auth,
        ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      },
    });
  }

  listWebPushSubscriptions(tenantId: string, userId: string) {
    return this.prisma.webPushSubscription.findMany({
      where: {
        tenantId,
        userId,
      },
    });
  }

  deleteWebPushSubscription(endpoint: string) {
    return this.prisma.webPushSubscription.deleteMany({
      where: {
        endpoint,
      },
    });
  }

  updateDriverLocation(
    tenantId: string,
    userId: string,
    input: {
      latitude: number;
      longitude: number;
      accuracy?: number | undefined;
    },
  ) {
    return this.prisma.user.updateMany({
      where: {
        id: userId,
        tenantId,
        role: UserRole.DELIVERY,
        isActive: true,
      },
      data: {
        lastLatitude: input.latitude,
        lastLongitude: input.longitude,
        lastLocationAccuracy: input.accuracy ?? null,
        lastLocationAt: new Date(),
      },
    });
  }

  getDefaultDepot(tenantId: string) {
    return this.prisma.store.findFirst({
      where: {
        tenantId,
        isActive: true,
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: {
        depotName: true,
        depotAddress: true,
        depotLatitude: true,
        depotLongitude: true,
      },
    });
  }

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
        include: {
          locations: {
            where: { isDefault: true },
            take: 1,
          },
        },
      }),
    ]);

    if (!invoice || !customer) {
      return null;
    }

    const defaultLocation = customer.locations[0];

    return this.prisma.delivery.create({
      data: {
        tenantId,
        invoiceId: input.invoiceId,
        customerId: input.customerId,
        ...(defaultLocation ? { customerLocationId: defaultLocation.id } : {}),
        deliveryAddress: input.deliveryAddress,
        deliveryAddressSnapshot: {
          address: input.deliveryAddress,
          customerName: customer.name,
          customerPhone: customer.phone,
          city: customer.city,
          state: customer.state,
          postalCode: customer.postalCode,
          invoiceNumber: invoice.invoiceNumber,
          grandTotal: invoice.grandTotal.toString(),
          amountDue: invoice.amountDue.toString(),
        },
        ...(defaultLocation?.latitude ? { deliveryLatitude: defaultLocation.latitude } : {}),
        ...(defaultLocation?.longitude ? { deliveryLongitude: defaultLocation.longitude } : {}),
        ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      },
      include: deliveryInclude,
    });
  }

  async getDeliveryByInvoice(tenantId: string, invoiceId: string) {
    return this.prisma.delivery.findFirst({
      where: {
        tenantId,
        invoiceId,
      },
      include: deliveryInclude,
    });
  }

  async upsertDeliveryForInvoice(
    tenantId: string,
    input: {
      invoiceId: string;
      customerId: string;
      deliveryAddress: string;
      scheduledAt?: Date | undefined;
      notes?: string | undefined;
    },
  ) {
    const [invoice, customer, existing] = await Promise.all([
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
        include: {
          locations: {
            where: { isDefault: true },
            take: 1,
          },
        },
      }),
      this.getDeliveryByInvoice(tenantId, input.invoiceId),
    ]);

    if (!invoice || !customer) {
      return null;
    }

    const defaultLocation = customer.locations[0];
    const deliveryAddressSnapshot = {
      address: input.deliveryAddress,
      customerName: customer.name,
      customerPhone: customer.phone,
      city: customer.city,
      state: customer.state,
      postalCode: customer.postalCode,
      invoiceNumber: invoice.invoiceNumber,
      grandTotal: invoice.grandTotal.toString(),
      amountDue: invoice.amountDue.toString(),
    };

    if (existing) {
      return this.prisma.delivery.update({
        where: {
          id: existing.id,
        },
        data: {
          customer: {
            connect: {
              id: input.customerId,
            },
          },
          deliveryAddress: input.deliveryAddress,
          deliveryAddressSnapshot,
          customerLocation: defaultLocation ? { connect: { id: defaultLocation.id } } : { disconnect: true },
          deliveryLatitude: defaultLocation?.latitude ?? null,
          deliveryLongitude: defaultLocation?.longitude ?? null,
          scheduledAt: input.scheduledAt ?? null,
          notes: input.notes ?? null,
          ...(existing.status === DeliveryStatus.CANCELLED ? { status: DeliveryStatus.PENDING, assignedTo: null, deliveredAt: null } : {}),
        },
        include: deliveryInclude,
      });
    }

    return this.prisma.delivery.create({
      data: {
        tenantId,
        invoiceId: input.invoiceId,
        customerId: input.customerId,
        ...(defaultLocation ? { customerLocationId: defaultLocation.id } : {}),
        deliveryAddress: input.deliveryAddress,
        deliveryAddressSnapshot,
        ...(defaultLocation?.latitude ? { deliveryLatitude: defaultLocation.latitude } : {}),
        ...(defaultLocation?.longitude ? { deliveryLongitude: defaultLocation.longitude } : {}),
        ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      },
      include: deliveryInclude,
    });
  }

  async cancelEditableDeliveryForInvoice(tenantId: string, invoiceId: string) {
    return this.prisma.delivery.updateMany({
      where: {
        tenantId,
        invoiceId,
        status: {
          in: [DeliveryStatus.PENDING, DeliveryStatus.ASSIGNED, DeliveryStatus.CANCELLED],
        },
      },
      data: {
        status: DeliveryStatus.CANCELLED,
        assignedTo: null,
      },
    });
  }

  async listDeliveries(tenantId: string, query: DeliveryListQuery) {
    const statusFilter = query.status
      ? { equals: query.status }
      : query.scope === "active"
        ? { in: [DeliveryStatus.PENDING, DeliveryStatus.ASSIGNED, DeliveryStatus.OUT_FOR_DELIVERY] }
        : query.scope === "archive"
          ? { in: [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED, DeliveryStatus.CANCELLED] }
          : undefined;
    const createdAt: Prisma.DateTimeFilter | undefined = (query.from || query.to) && query.status === DeliveryStatus.DELIVERED
      ? {
          ...(query.from ? { gte: query.from } : {}),
          ...(query.to ? { lte: query.to } : {}),
        }
      : undefined;
    const where: Prisma.DeliveryWhereInput = {
      tenantId,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(createdAt ? { createdAt } : {}),
    };
    const orderBy = { createdAt: Prisma.SortOrder.desc };

    if (query.paginated) {
      const [total, data] = await Promise.all([
        this.prisma.delivery.count({ where }),
        this.prisma.delivery.findMany({
          where,
          include: deliveryInclude,
          orderBy,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
      ]);

      return {
        data,
        page: query.page,
        limit: query.limit,
        total,
      };
    }

    return this.prisma.delivery.findMany({
      where,
      include: deliveryInclude,
      orderBy,
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

  async updateActiveRouteStopForDeliveryStatus(tenantId: string, deliveryId: string, input: UpdateDeliveryStatusInput) {
    const routeStopStatus = mapDeliveryStatusToRouteStopStatus(input.status);
    if (!routeStopStatus) {
      return { count: 0 };
    }

    const now = new Date();
    return this.prisma.deliveryRouteStop.updateMany({
      where: {
        tenantId,
        deliveryId,
        route: {
          routePlan: {
            status: {
              in: [DeliveryRoutePlanStatus.PUBLISHED, DeliveryRoutePlanStatus.IN_PROGRESS],
            },
          },
        },
      },
      data: {
        status: routeStopStatus,
        ...(routeStopStatus === DeliveryRouteStopStatus.DELIVERED ? { completedAt: now } : {}),
        ...(routeStopStatus === DeliveryRouteStopStatus.FAILED ? { failedAt: now } : {}),
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

  async countProofsByType(tenantId: string, deliveryId: string, proofType: DeliveryProofType) {
    return this.prisma.deliveryProof.count({
      where: {
        tenantId,
        deliveryId,
        proofType,
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
  customer: {
    include: {
      locations: {
        where: { isDefault: true },
        take: 1,
      },
    },
  },
  customerLocation: true,
  proofs: {
    orderBy: {
      createdAt: Prisma.SortOrder.desc,
    },
  },
} satisfies Prisma.DeliveryInclude;

function mapDeliveryStatusToRouteStopStatus(status: DeliveryStatus) {
  switch (status) {
    case DeliveryStatus.OUT_FOR_DELIVERY:
      return DeliveryRouteStopStatus.EN_ROUTE;
    case DeliveryStatus.DELIVERED:
      return DeliveryRouteStopStatus.DELIVERED;
    case DeliveryStatus.FAILED:
      return DeliveryRouteStopStatus.FAILED;
    case DeliveryStatus.CANCELLED:
      return DeliveryRouteStopStatus.CANCELLED;
    default:
      return null;
  }
}
