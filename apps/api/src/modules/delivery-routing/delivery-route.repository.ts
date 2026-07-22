import { DeliveryRoutePlanStatus, DeliveryRouteStatus, DeliveryRouteStopStatus, DeliveryStatus, Prisma, UserRole, type PrismaClient } from "@prisma/client";

import type { CreateDeliveryRoutePlanInput, PatchDeliveryRoutePlanInput, PatchDeliveryRouteStopInput } from "./delivery-route.types.js";

export class DeliveryRouteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  listPlans(tenantId: string) {
    return this.prisma.deliveryRoutePlan.findMany({
      where: { tenantId },
      include: routePlanInclude,
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  }

  getPlan(tenantId: string, id: string) {
    return this.prisma.deliveryRoutePlan.findFirst({
      where: { id, tenantId },
      include: routePlanInclude,
    });
  }

  getPlanForWorker(id: string) {
    return this.prisma.deliveryRoutePlan.findUnique({
      where: { id },
      include: routePlanInclude,
    });
  }

  async createPlan(tenantId: string, createdById: string | undefined, input: CreateDeliveryRoutePlanInput) {
    const deliveries = await this.prisma.delivery.findMany({
      where: {
        tenantId,
        id: { in: input.deliveryIds },
        status: { in: [DeliveryStatus.PENDING, DeliveryStatus.ASSIGNED, DeliveryStatus.OUT_FOR_DELIVERY] },
      },
      include: {
        customer: {
          include: {
            locations: {
              where: { isDefault: true },
              take: 1,
            },
          },
        },
        customerLocation: true,
        invoice: true,
      },
    });

    if (deliveries.length !== input.deliveryIds.length) {
      return null;
    }

    const drivers = await this.prisma.user.findMany({
      where: {
        tenantId,
        id: { in: input.driverIds },
        role: UserRole.DELIVERY,
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    if (drivers.length !== input.driverIds.length) {
      return null;
    }

    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.deliveryRoutePlan.create({
        data: {
          tenantId,
          name: input.name ?? `Route plan ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
          ...(createdById ? { createdById } : {}),
          depotName: input.depotName ?? "Store",
          ...(input.depotAddress ? { depotAddress: input.depotAddress } : {}),
          ...(input.depotLatitude !== undefined ? { depotLatitude: input.depotLatitude } : {}),
          ...(input.depotLongitude !== undefined ? { depotLongitude: input.depotLongitude } : {}),
          routingProfile: process.env.MAPBOX_ROUTING_PROFILE ?? "mapbox/driving",
        },
      });

      for (const [driverIndex, driver] of drivers.entries()) {
        const route = await tx.deliveryRoute.create({
          data: {
            tenantId,
            routePlanId: plan.id,
            routeIndex: driverIndex,
            assignedTo: driver.id,
          },
        });

        const assignedDeliveries = deliveries.filter((_, index) => index % drivers.length === driverIndex);
        for (const [stopIndex, delivery] of assignedDeliveries.entries()) {
          const snapshot = deliverySnapshot(delivery);
          const fallbackLocation = delivery.customer.locations[0];
          await tx.deliveryRouteStop.create({
            data: {
              tenantId,
              routeId: route.id,
              deliveryId: delivery.id,
              sequence: stopIndex + 1,
              addressSnapshot: snapshot,
              latitude: delivery.customerLocation?.latitude ?? fallbackLocation?.latitude ?? delivery.deliveryLatitude ?? null,
              longitude: delivery.customerLocation?.longitude ?? fallbackLocation?.longitude ?? delivery.deliveryLongitude ?? null,
              serviceSeconds: input.serviceSeconds,
            },
          });

          if (!delivery.deliveryAddressSnapshot) {
            await tx.delivery.update({
              where: { id: delivery.id },
              data: {
                deliveryAddressSnapshot: snapshot,
              },
            });
          }
        }
      }

      return tx.deliveryRoutePlan.findFirstOrThrow({
        where: { id: plan.id, tenantId },
        include: routePlanInclude,
      });
    });
  }

  updatePlan(tenantId: string, id: string, input: PatchDeliveryRoutePlanInput) {
    return this.prisma.deliveryRoutePlan.updateMany({
      where: { id, tenantId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
  }

  setPlanQueued(tenantId: string, id: string) {
    return this.prisma.deliveryRoutePlan.updateMany({
      where: { id, tenantId },
      data: { status: DeliveryRoutePlanStatus.QUEUED, providerError: null },
    });
  }

  async patchStop(tenantId: string, planId: string, stopId: string, input: PatchDeliveryRouteStopInput) {
    const result = await this.prisma.deliveryRouteStop.updateMany({
      where: {
        id: stopId,
        tenantId,
        route: {
          routePlanId: planId,
        },
      },
      data: {
        ...(input.sequence !== undefined ? { sequence: input.sequence } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.isLocked !== undefined ? { isLocked: input.isLocked, lockedAt: input.isLocked ? new Date() : null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    return result;
  }

  async applyPlan(tenantId: string, id: string, publish: boolean) {
    const plan = await this.getPlan(tenantId, id);
    if (!plan) {
      return null;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const route of plan.routes) {
        await tx.deliveryRoute.update({
          where: { id: route.id },
          data: {
            status: publish ? DeliveryRouteStatus.PUBLISHED : DeliveryRouteStatus.PLANNED,
          },
        });
        for (const stop of route.stops) {
          if (!stop.deliveryId || !route.assignedTo) {
            continue;
          }
          await tx.delivery.updateMany({
            where: {
              id: stop.deliveryId,
              tenantId,
              status: { in: [DeliveryStatus.PENDING, DeliveryStatus.ASSIGNED, DeliveryStatus.OUT_FOR_DELIVERY] },
            },
            data: {
              assignedTo: route.assignedTo,
              status: DeliveryStatus.ASSIGNED,
            },
          });
        }
      }

      await tx.deliveryRoutePlan.update({
        where: { id },
        data: {
          status: publish ? DeliveryRoutePlanStatus.PUBLISHED : DeliveryRoutePlanStatus.APPLIED,
        },
      });
    });

    return this.getPlan(tenantId, id);
  }

  getPublishedRouteForDriver(tenantId: string, driverId: string) {
    return this.prisma.deliveryRoute.findFirst({
      where: {
        tenantId,
        assignedTo: driverId,
        routePlan: {
          status: { in: [DeliveryRoutePlanStatus.PUBLISHED, DeliveryRoutePlanStatus.IN_PROGRESS] },
        },
      },
      include: {
        routePlan: true,
        stops: {
          include: {
            delivery: {
              include: {
                customer: true,
                invoice: true,
                proofs: { orderBy: { createdAt: "desc" } },
              },
            },
          },
          orderBy: { sequence: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async startDriverRoute(tenantId: string, driverId: string) {
    const route = await this.getPublishedRouteForDriver(tenantId, driverId);
    if (!route) return null;

    await this.prisma.$transaction([
      this.prisma.deliveryRoutePlan.update({
        where: { id: route.routePlanId },
        data: { status: DeliveryRoutePlanStatus.IN_PROGRESS },
      }),
      this.prisma.deliveryRoute.update({
        where: { id: route.id },
        data: { status: DeliveryRouteStatus.IN_PROGRESS, startedAt: new Date() },
      }),
      this.prisma.deliveryRouteStop.updateMany({
        where: {
          routeId: route.id,
          status: { in: [DeliveryRouteStopStatus.PLANNED, DeliveryRouteStopStatus.LOCKED] },
        },
        data: { status: DeliveryRouteStopStatus.EN_ROUTE },
      }),
    ]);

    return this.getPublishedRouteForDriver(tenantId, driverId);
  }

  async completeDriverStop(tenantId: string, driverId: string, stopId: string, failed: boolean) {
    const route = await this.getPublishedRouteForDriver(tenantId, driverId);
    if (!route) return null;
    const stop = route.stops.find((item) => item.id === stopId);
    if (!stop) return null;

    await this.prisma.$transaction(async (tx) => {
      await tx.deliveryRouteStop.update({
        where: { id: stopId },
        data: failed
          ? { status: DeliveryRouteStopStatus.FAILED, failedAt: new Date() }
          : { status: DeliveryRouteStopStatus.DELIVERED, completedAt: new Date() },
      });
      if (stop.deliveryId) {
        await tx.delivery.updateMany({
          where: { id: stop.deliveryId, tenantId },
          data: failed
            ? { status: DeliveryStatus.FAILED }
            : { status: DeliveryStatus.DELIVERED, deliveredAt: new Date() },
        });
      }
    });

    return this.getPublishedRouteForDriver(tenantId, driverId);
  }
}

export const routePlanInclude = {
  routes: {
    include: {
      driver: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
      stops: {
        include: {
          delivery: {
            include: {
              customer: true,
              invoice: true,
              proofs: {
                orderBy: {
                  createdAt: Prisma.SortOrder.desc,
                },
              },
            },
          },
        },
        orderBy: {
          sequence: Prisma.SortOrder.asc,
        },
      },
    },
    orderBy: {
      routeIndex: Prisma.SortOrder.asc,
    },
  },
} satisfies Prisma.DeliveryRoutePlanInclude;

function deliverySnapshot(delivery: {
  deliveryAddress: string;
  customer: {
    name: string;
    phone: string;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
  };
  invoice: {
    invoiceNumber: string;
    grandTotal: Prisma.Decimal;
    amountDue: Prisma.Decimal;
  };
}) {
  return {
    address: delivery.deliveryAddress,
    customerName: delivery.customer.name,
    customerPhone: delivery.customer.phone,
    city: delivery.customer.city,
    state: delivery.customer.state,
    postalCode: delivery.customer.postalCode,
    invoiceNumber: delivery.invoice.invoiceNumber,
    grandTotal: delivery.invoice.grandTotal.toString(),
    amountDue: delivery.invoice.amountDue.toString(),
  };
}
