import { DeliveryGeocodingStatus, DeliveryRouteStatus, DeliveryStatus, Prisma, UserRole, type DeliveryProofType, type PrismaClient } from "@prisma/client";

import type { CreateDeliveryInput, DeliveryListQuery, DeliveryLocationPingInput, UpdateDeliveryStatusInput } from "./delivery.types.js";

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
        ...(input.latitude !== undefined && input.longitude !== undefined
          ? {
              latitude: input.latitude,
              longitude: input.longitude,
              geocodingStatus: DeliveryGeocodingStatus.MANUAL,
              geocodedAt: new Date(),
            }
          : {}),
        ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
        ...(input.timeWindowStart ? { timeWindowStart: input.timeWindowStart } : {}),
        ...(input.timeWindowEnd ? { timeWindowEnd: input.timeWindowEnd } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.weightKg !== undefined ? { weightKg: input.weightKg } : {}),
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

  async updateDeliveryCoordinates(
    tenantId: string,
    deliveryId: string,
    input: {
      latitude?: number | undefined;
      longitude?: number | undefined;
      status: DeliveryGeocodingStatus;
      provider?: string | undefined;
    },
  ) {
    return this.prisma.delivery.updateMany({
      where: {
        tenantId,
        id: deliveryId,
      },
      data: {
        geocodingStatus: input.status,
        geocodedAt: new Date(),
        ...(input.provider !== undefined ? { geocodingProvider: input.provider } : {}),
        ...(input.latitude !== undefined && input.longitude !== undefined ? { latitude: input.latitude, longitude: input.longitude } : {}),
      },
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

  async listActiveRouteForAgent(tenantId: string, userId: string) {
    return this.prisma.deliveryRoute.findFirst({
      where: {
        tenantId,
        assignedTo: userId,
        status: {
          in: [DeliveryRouteStatus.OPTIMIZED, DeliveryRouteStatus.DISPATCHED],
        },
      },
      include: {
        stops: {
          include: {
            delivery: {
              include: deliveryInclude,
            },
          },
          orderBy: {
            sequence: "asc",
          },
        },
      },
      orderBy: {
        optimizedAt: "desc",
      },
    });
  }

  async listDeliveryUsers(tenantId: string, userIds?: string[]) {
    return this.prisma.user.findMany({
      where: {
        tenantId,
        role: UserRole.DELIVERY,
        isActive: true,
        ...(userIds?.length ? { id: { in: userIds } } : {}),
      },
      select: {
        id: true,
        name: true,
        phone: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
  }

  async listRouteCandidates(tenantId: string, options: { deliveryIds?: string[]; userIds?: string[] }) {
    return this.prisma.delivery.findMany({
      where: {
        tenantId,
        status: {
          in: [DeliveryStatus.PENDING, DeliveryStatus.ASSIGNED, DeliveryStatus.OUT_FOR_DELIVERY],
        },
        ...(options.deliveryIds?.length ? { id: { in: options.deliveryIds } } : {}),
        ...(options.userIds?.length ? { OR: [{ assignedTo: { in: options.userIds } }, { assignedTo: null }] } : {}),
      },
      include: deliveryInclude,
      orderBy: [
        { priority: "desc" },
        { scheduledAt: "asc" },
        { createdAt: "asc" },
      ],
    });
  }

  async saveOptimizedRoutes(
    tenantId: string,
    routes: Array<{
      assignedTo: string;
      depotLatitude?: number | undefined;
      depotLongitude?: number | undefined;
      totalDistanceMeters?: number | undefined;
      totalDurationSeconds?: number | undefined;
      routeGeometry?: unknown;
      optimizationProvider: string;
      stops: Array<{
        deliveryId: string;
        sequence: number;
        eta?: Date | undefined;
        distanceMeters?: number | undefined;
        durationSeconds?: number | undefined;
      }>;
    }>,
  ) {
    const deliveryIds = routes.flatMap((route) => route.stops.map((stop) => stop.deliveryId));

    return this.prisma.$transaction(async (tx) => {
      await tx.deliveryRouteStop.deleteMany({
        where: {
          tenantId,
          deliveryId: {
            in: deliveryIds,
          },
        },
      });

      const savedRoutes = [];

      for (const route of routes) {
        const savedRoute = await tx.deliveryRoute.create({
          data: {
            tenantId,
            assignedTo: route.assignedTo,
            ...(route.depotLatitude !== undefined ? { depotLatitude: route.depotLatitude } : {}),
            ...(route.depotLongitude !== undefined ? { depotLongitude: route.depotLongitude } : {}),
            ...(route.totalDistanceMeters !== undefined ? { totalDistanceMeters: route.totalDistanceMeters } : {}),
            ...(route.totalDurationSeconds !== undefined ? { totalDurationSeconds: route.totalDurationSeconds } : {}),
            ...(route.routeGeometry !== undefined ? { routeGeometry: route.routeGeometry as Prisma.InputJsonValue } : {}),
            optimizationProvider: route.optimizationProvider,
            optimizedAt: new Date(),
            stops: {
              create: route.stops.map((stop) => ({
                tenant: {
                  connect: {
                    id: tenantId,
                  },
                },
                delivery: {
                  connect: {
                    id: stop.deliveryId,
                  },
                },
                sequence: stop.sequence,
                ...(stop.eta !== undefined ? { eta: stop.eta } : {}),
                ...(stop.distanceMeters !== undefined ? { distanceMeters: stop.distanceMeters } : {}),
                ...(stop.durationSeconds !== undefined ? { durationSeconds: stop.durationSeconds } : {}),
              })),
            },
          },
          include: {
            stops: {
              include: {
                delivery: {
                  include: deliveryInclude,
                },
              },
              orderBy: {
                sequence: "asc",
              },
            },
          },
        });

        await tx.delivery.updateMany({
          where: {
            tenantId,
            id: {
              in: route.stops.map((stop) => stop.deliveryId),
            },
          },
          data: {
            assignedTo: route.assignedTo,
            status: DeliveryStatus.ASSIGNED,
          },
        });

        savedRoutes.push(savedRoute);
      }

      return savedRoutes;
    });
  }

  async createLocationPing(tenantId: string, userId: string, input: DeliveryLocationPingInput) {
    return this.prisma.deliveryLocationPing.create({
      data: {
        tenantId,
        userId,
        latitude: input.latitude,
        longitude: input.longitude,
        ...(input.deliveryId !== undefined ? { deliveryId: input.deliveryId } : {}),
        ...(input.accuracyMeters !== undefined ? { accuracyMeters: input.accuracyMeters } : {}),
        ...(input.batteryPct !== undefined ? { batteryPct: input.batteryPct } : {}),
        capturedAt: input.capturedAt,
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
  routeStop: {
    include: {
      route: true,
    },
  },
  proofs: {
    orderBy: {
      createdAt: Prisma.SortOrder.desc,
    },
  },
} satisfies Prisma.DeliveryInclude;
