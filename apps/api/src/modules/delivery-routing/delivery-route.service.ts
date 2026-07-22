import { DeliveryRoutePlanStatus, DeliveryRouteStopStatus, type Prisma, type PrismaClient, type Tenant, type UserRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { getMapboxConfig, MapboxClient } from "../../integrations/mapbox/mapbox.client.js";
import { MapboxDirectionsProvider } from "../../integrations/mapbox/mapbox-directions.provider.js";
import { MapboxGeocodingProvider } from "../../integrations/mapbox/mapbox-geocoding.provider.js";
import { MapboxOptimizationV2Provider } from "../../integrations/mapbox/mapbox-optimization-v2.provider.js";
import { DeliveryRouteRepository } from "./delivery-route.repository.js";
import type {
  CreateDeliveryRoutePlanInput,
  PatchDeliveryRoutePlanInput,
  PatchDeliveryRouteStopInput,
  UpdateDeliveryLocationInput,
} from "./delivery-route.types.js";
import { deliveryRouteQueue } from "./delivery-route.queue.js";
import { ManualOrderingProvider, StraightLineGeometryProvider } from "./providers/manual-ordering.provider.js";
import type {
  GeocodingProvider,
  RouteGeometryProvider,
  RouteOptimizationInput,
  RouteOptimizationProvider,
  RoutingCoordinate,
} from "./providers/route-optimization.provider.js";

export interface DeliveryRouteActor {
  userId: string;
  role: UserRole;
}

export class DeliveryRouteError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export class DeliveryRouteService {
  private readonly repository: DeliveryRouteRepository;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly log?: FastifyInstance["log"],
  ) {
    this.repository = new DeliveryRouteRepository(prisma);
  }

  static fromFastify(fastify: FastifyInstance) {
    return new DeliveryRouteService(fastify.prisma, fastify.log);
  }

  listPlans(tenant: Tenant) {
    return this.repository.listPlans(tenant.id);
  }

  async getPlan(tenant: Tenant, id: string) {
    const plan = await this.repository.getPlan(tenant.id, id);
    if (!plan) {
      throw new DeliveryRouteError("Route plan not found", 404);
    }

    return plan;
  }

  async createPlan(tenant: Tenant, actor: DeliveryRouteActor, input: CreateDeliveryRoutePlanInput) {
    const plan = await this.repository.createPlan(tenant.id, actor.userId, input);
    if (!plan) {
      throw new DeliveryRouteError("One or more deliveries or drivers were not found", 404);
    }

    if (input.optimize) {
      await this.queueOptimization(tenant, plan.id);
      return this.getPlan(tenant, plan.id);
    }

    return plan;
  }

  async patchPlan(tenant: Tenant, id: string, input: PatchDeliveryRoutePlanInput) {
    const result = await this.repository.updatePlan(tenant.id, id, input);
    if (result.count === 0) {
      throw new DeliveryRouteError("Route plan not found", 404);
    }

    return this.getPlan(tenant, id);
  }

  async queueOptimization(tenant: Tenant, id: string) {
    const plan = await this.repository.getPlan(tenant.id, id);
    if (!plan) {
      throw new DeliveryRouteError("Route plan not found", 404);
    }

    await this.ensurePlanCanOptimize(plan);
    await this.repository.setPlanQueued(tenant.id, id);
    await deliveryRouteQueue.add("submit-optimization", { routePlanId: id }, { removeOnComplete: true, removeOnFail: 100 });

    return this.getPlan(tenant, id);
  }

  async patchStop(tenant: Tenant, planId: string, stopId: string, input: PatchDeliveryRouteStopInput) {
    const result = await this.repository.patchStop(tenant.id, planId, stopId, input);
    if (result.count === 0) {
      throw new DeliveryRouteError("Route stop not found", 404);
    }

    return this.getPlan(tenant, planId);
  }

  async lockStop(tenant: Tenant, planId: string, stopId: string, locked: boolean) {
    return this.patchStop(tenant, planId, stopId, {
      isLocked: locked,
      status: locked ? DeliveryRouteStopStatus.LOCKED : DeliveryRouteStopStatus.PLANNED,
    });
  }

  async applyPlan(tenant: Tenant, id: string) {
    const plan = await this.repository.getPlan(tenant.id, id);
    if (!plan) throw new DeliveryRouteError("Route plan not found", 404);
    if (plan.status !== DeliveryRoutePlanStatus.READY_FOR_REVIEW && plan.status !== DeliveryRoutePlanStatus.APPLIED) {
      throw new DeliveryRouteError("Only a reviewed route plan can be applied", 409);
    }

    return this.repository.applyPlan(tenant.id, id, false);
  }

  async publishPlan(tenant: Tenant, id: string) {
    const plan = await this.repository.getPlan(tenant.id, id);
    if (!plan) throw new DeliveryRouteError("Route plan not found", 404);
    if (plan.status !== DeliveryRoutePlanStatus.READY_FOR_REVIEW && plan.status !== DeliveryRoutePlanStatus.APPLIED && plan.status !== DeliveryRoutePlanStatus.PUBLISHED) {
      throw new DeliveryRouteError("Only a reviewed or applied route plan can be published", 409);
    }

    return this.repository.applyPlan(tenant.id, id, true);
  }

  async cancelPlan(tenant: Tenant, id: string) {
    await this.patchPlan(tenant, id, { status: DeliveryRoutePlanStatus.CANCELLED });
    return this.getPlan(tenant, id);
  }

  async geocodeDelivery(tenant: Tenant, deliveryId: string) {
    const provider = this.getGeocodingProvider();
    if (!provider) {
      throw new DeliveryRouteError("Mapbox permanent geocoding is not configured. Set the pin manually or enable Mapbox routing.", 409);
    }

    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, tenantId: tenant.id },
      include: { customer: true, customerLocation: true, invoice: true },
    });
    if (!delivery) {
      throw new DeliveryRouteError("Delivery not found", 404);
    }

    const result = await provider.geocode({ tenantId: tenant.id, query: delivery.deliveryAddress });
    if (!result) {
      throw new DeliveryRouteError("No geocoding result was found for this delivery address", 422);
    }

    const location = delivery.customerLocationId
      ? await this.prisma.customerLocation.update({
          where: { id: delivery.customerLocationId },
          data: mapGeocodeToLocation(result),
        })
      : await this.prisma.customerLocation.create({
          data: {
            tenantId: tenant.id,
            customerId: delivery.customerId,
            label: "Delivery",
            addressLine1: delivery.deliveryAddress,
            isDefault: true,
            ...mapGeocodeToLocation(result),
          },
        });

    await this.prisma.delivery.update({
      where: { id: delivery.id },
      data: {
        customerLocationId: location.id,
        deliveryAddressSnapshot: deliverySnapshot(delivery, result.formattedAddress),
        deliveryLatitude: result.coordinate.latitude,
        deliveryLongitude: result.coordinate.longitude,
      },
    });

    return this.prisma.delivery.findFirst({
      where: { id: deliveryId, tenantId: tenant.id },
      include: { customer: true, customerLocation: true, invoice: true },
    });
  }

  async geocodeBatch(tenant: Tenant, deliveryIds: string[]) {
    const results = [];
    for (const deliveryId of deliveryIds) {
      try {
        results.push({ deliveryId, status: "ok", delivery: await this.geocodeDelivery(tenant, deliveryId) });
      } catch (error) {
        results.push({ deliveryId, status: "failed", error: error instanceof Error ? error.message : "Geocoding failed" });
      }
    }

    return { results };
  }

  async updateDeliveryLocation(tenant: Tenant, actor: DeliveryRouteActor, deliveryId: string, input: UpdateDeliveryLocationInput) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, tenantId: tenant.id },
      include: { customer: true, invoice: true },
    });
    if (!delivery) {
      throw new DeliveryRouteError("Delivery not found", 404);
    }

    const address = input.address ?? delivery.deliveryAddress;
    const location = delivery.customerLocationId
      ? await this.prisma.customerLocation.update({
          where: { id: delivery.customerLocationId },
          data: {
            addressLine1: address,
            latitude: input.latitude,
            longitude: input.longitude,
            ...(input.manuallyVerified ? { manuallyVerifiedAt: new Date(), manuallyVerifiedById: actor.userId } : {}),
          },
        })
      : await this.prisma.customerLocation.create({
          data: {
            tenantId: tenant.id,
            customerId: delivery.customerId,
            label: "Delivery",
            addressLine1: address,
            latitude: input.latitude,
            longitude: input.longitude,
            ...(input.manuallyVerified ? { manuallyVerifiedAt: new Date(), manuallyVerifiedById: actor.userId } : {}),
            isDefault: true,
          },
        });

    return this.prisma.delivery.update({
      where: { id: delivery.id },
      data: {
        customerLocationId: location.id,
        deliveryAddress: address,
        deliveryAddressSnapshot: deliverySnapshot(delivery, address),
        deliveryLatitude: input.latitude,
        deliveryLongitude: input.longitude,
      },
      include: { customer: true, customerLocation: true, invoice: true },
    });
  }

  getMyRoute(tenant: Tenant, actor: DeliveryRouteActor) {
    return this.repository.getPublishedRouteForDriver(tenant.id, actor.userId);
  }

  async getMyNextStop(tenant: Tenant, actor: DeliveryRouteActor) {
    const route = await this.getMyRoute(tenant, actor);
    return route?.stops.find((stop) => !["DELIVERED", "FAILED", "SKIPPED", "CANCELLED"].includes(stop.status)) ?? null;
  }

  startMyRoute(tenant: Tenant, actor: DeliveryRouteActor) {
    return this.repository.startDriverRoute(tenant.id, actor.userId);
  }

  completeMyStop(tenant: Tenant, actor: DeliveryRouteActor, stopId: string) {
    return this.repository.completeDriverStop(tenant.id, actor.userId, stopId, false);
  }

  failMyStop(tenant: Tenant, actor: DeliveryRouteActor, stopId: string) {
    return this.repository.completeDriverStop(tenant.id, actor.userId, stopId, true);
  }

  async submitOptimizationForWorker(routePlanId: string) {
    const plan = await this.repository.getPlanForWorker(routePlanId);
    if (!plan) return;
    await this.ensurePlanCanOptimize(plan);

    const provider = this.getOptimizationProvider();
    await this.prisma.deliveryRoutePlan.update({
      where: { id: routePlanId },
      data: { status: DeliveryRoutePlanStatus.OPTIMIZING, providerError: null },
    });

    const submit = await provider.submit(buildOptimizationInput(plan));
    await this.prisma.deliveryRoutePlan.update({
      where: { id: routePlanId },
      data: {
        provider: submit.provider,
        providerJobId: submit.providerJobId,
        rawRequest: submit.rawRequest as Prisma.InputJsonValue,
      },
    });

    await deliveryRouteQueue.add("poll-optimization", { routePlanId, pollCount: 0 }, { delay: 2_000, removeOnComplete: true, removeOnFail: 100 });
  }

  async pollOptimizationForWorker(routePlanId: string, pollCount: number) {
    const plan = await this.repository.getPlanForWorker(routePlanId);
    if (!plan?.providerJobId) return;
    const provider = this.getOptimizationProvider(plan.provider ?? undefined);
    const result = await provider.getResult(plan.providerJobId);

    if (result.status === "processing") {
      if (pollCount >= 30) {
        await this.failOptimization(routePlanId, "Optimization timed out while waiting for provider result.");
        return;
      }
      await deliveryRouteQueue.add("poll-optimization", { routePlanId, pollCount: pollCount + 1 }, { delay: Math.min(60_000, 3_000 + pollCount * 2_000), removeOnComplete: true, removeOnFail: 100 });
      return;
    }

    if (result.status === "failed") {
      await this.failOptimization(routePlanId, result.error ?? "Optimization failed.");
      return;
    }

    await this.persistOptimizationResult(routePlanId, result);
    await deliveryRouteQueue.add("generate-geometries", { routePlanId }, { removeOnComplete: true, removeOnFail: 100 });
  }

  async generateGeometriesForWorker(routePlanId: string) {
    const plan = await this.repository.getPlanForWorker(routePlanId);
    if (!plan) return;
    const geometryProvider = this.getGeometryProvider(plan.provider ?? undefined);
    let totalDistanceMeters = 0;
    let totalDurationSeconds = 0;

    for (const route of plan.routes) {
      const coordinates = routeCoordinates(plan, route.stops);
      const result = await geometryProvider.getGeometry({ profile: plan.routingProfile, coordinates });
      if (!result) continue;
      totalDistanceMeters += result.distanceMeters ?? 0;
      totalDurationSeconds += result.durationSeconds ?? 0;
      await this.prisma.deliveryRoute.update({
        where: { id: route.id },
        data: {
          geometry: result.geometry as Prisma.InputJsonValue,
          distanceMeters: result.distanceMeters ?? null,
          durationSeconds: result.durationSeconds ?? null,
        },
      });
    }

    await this.prisma.deliveryRoutePlan.update({
      where: { id: routePlanId },
      data: {
        status: DeliveryRoutePlanStatus.READY_FOR_REVIEW,
        totalDistanceMeters,
        totalDurationSeconds,
      },
    });
  }

  failOptimizationForWorker(routePlanId: string, message: string) {
    return this.failOptimization(routePlanId, message);
  }

  private async persistOptimizationResult(routePlanId: string, result: Awaited<ReturnType<RouteOptimizationProvider["getResult"]>>) {
    const plan = await this.repository.getPlanForWorker(routePlanId);
    if (!plan) return;
    const stopsByService = new Map<string, (typeof plan.routes)[number]["stops"][number]>(plan.routes.flatMap((route) => route.stops.map((stop) => [`service:${stop.deliveryId ?? stop.id}`, stop] as const)));
    const driversByVehicle = new Map<string, string | null>(plan.routes.map((route) => [`vehicle:${route.assignedTo ?? route.id}`, route.assignedTo] as const));

    await this.prisma.$transaction(async (tx) => {
      await tx.deliveryRoute.deleteMany({ where: { routePlanId } });
      for (const [routeIndex, optimizedRoute] of result.routes.entries()) {
        const route = await tx.deliveryRoute.create({
          data: {
            tenantId: plan.tenantId,
            routePlanId,
            routeIndex,
            assignedTo: optimizedRoute.driverId ?? driversByVehicle.get(optimizedRoute.vehicleId) ?? null,
            distanceMeters: optimizedRoute.distanceMeters ?? null,
            durationSeconds: optimizedRoute.durationSeconds ?? null,
          },
        });
        for (const stop of optimizedRoute.stops) {
          const original = stopsByService.get(stop.serviceId);
          if (!original) continue;
          await tx.deliveryRouteStop.create({
            data: {
              tenantId: plan.tenantId,
              routeId: route.id,
              deliveryId: original.deliveryId,
              sequence: stop.sequence,
              status: original.isLocked ? DeliveryRouteStopStatus.LOCKED : DeliveryRouteStopStatus.PLANNED,
              addressSnapshot: original.addressSnapshot as Prisma.InputJsonValue,
              latitude: original.latitude,
              longitude: original.longitude,
              eta: stop.eta ? new Date(stop.eta) : null,
              distanceFromPreviousMeters: stop.odometerMeters ?? null,
              durationFromPreviousSeconds: stop.durationSeconds ?? null,
              serviceSeconds: original.serviceSeconds ?? null,
              isLocked: original.isLocked,
              lockedAt: original.lockedAt,
            },
          });
        }
      }

      await tx.deliveryRoutePlan.update({
        where: { id: routePlanId },
        data: {
          rawResult: result.rawResult as Prisma.InputJsonValue,
          providerError: result.droppedServiceIds.length > 0 ? `Dropped stops: ${result.droppedServiceIds.join(", ")}` : null,
        },
      });
    });
  }

  private async failOptimization(routePlanId: string, message: string) {
    this.log?.error({ routePlanId, message }, "Delivery route optimization failed");
    await this.prisma.deliveryRoutePlan.update({
      where: { id: routePlanId },
      data: {
        status: DeliveryRoutePlanStatus.OPTIMIZATION_FAILED,
        providerError: message,
      },
    });
  }

  private getGeocodingProvider(): GeocodingProvider | null {
    const client = new MapboxClient();
    return client.isConfigured() ? new MapboxGeocodingProvider(client) : null;
  }

  private getOptimizationProvider(provider?: string): RouteOptimizationProvider {
    const client = new MapboxClient();
    if ((provider === "mapbox-optimization-v2" || (!provider && getMapboxConfig().enabled)) && client.isConfigured()) {
      return new MapboxOptimizationV2Provider(client);
    }

    return new ManualOrderingProvider();
  }

  private getGeometryProvider(provider?: string): RouteGeometryProvider {
    const client = new MapboxClient();
    if ((provider?.startsWith("mapbox") || (!provider && getMapboxConfig().enabled)) && client.isConfigured()) {
      return new MapboxDirectionsProvider(client);
    }

    return new StraightLineGeometryProvider();
  }

  private async ensurePlanCanOptimize(plan: NonNullable<Awaited<ReturnType<DeliveryRouteRepository["getPlan"]>>>) {
    if (plan.status === DeliveryRoutePlanStatus.PUBLISHED || plan.status === DeliveryRoutePlanStatus.IN_PROGRESS || plan.status === DeliveryRoutePlanStatus.COMPLETED) {
      throw new DeliveryRouteError("Published or active route plans cannot be reoptimized from this action", 409);
    }

    if (plan.depotLatitude === null || plan.depotLongitude === null) {
      throw new DeliveryRouteError("Depot latitude and longitude are required before optimization", 422);
    }

    const missingLocations = plan.routes.flatMap((route) => route.stops.filter((stop) => stop.latitude === null || stop.longitude === null));
    if (missingLocations.length > 0) {
      await this.prisma.deliveryRoutePlan.update({
        where: { id: plan.id },
        data: { status: DeliveryRoutePlanStatus.LOCATION_REVIEW_REQUIRED },
      });
      throw new DeliveryRouteError("Some route stops need geocoding or manual pin review before optimization", 422);
    }
  }
}

function buildOptimizationInput(plan: NonNullable<Awaited<ReturnType<DeliveryRouteRepository["getPlanForWorker"]>>>): RouteOptimizationInput {
  const depotLocation = {
    id: "depot",
    name: plan.depotName ?? "Store",
    coordinate: {
      latitude: Number(plan.depotLatitude),
      longitude: Number(plan.depotLongitude),
    },
  };
  const services = plan.routes.flatMap((route) => route.stops.map((stop) => ({
    id: `service:${stop.deliveryId ?? stop.id}`,
    deliveryId: stop.deliveryId ?? stop.id,
    locationId: `stop:${stop.id}`,
    durationSeconds: stop.serviceSeconds ?? Number(process.env.MAPBOX_DEFAULT_SERVICE_SECONDS ?? 300),
    ...(stop.isLocked ? { lockedSequence: stop.sequence } : {}),
  })));
  const locations = [
    depotLocation,
    ...plan.routes.flatMap((route) => route.stops.map((stop) => ({
      id: `stop:${stop.id}`,
      name: stop.delivery === null ? stop.id : stop.delivery.customer.name,
      coordinate: {
        latitude: Number(stop.latitude),
        longitude: Number(stop.longitude),
      },
    }))),
  ];

  return {
    routePlanId: plan.id,
    locations,
    vehicles: plan.routes.map((route) => ({
      id: `vehicle:${route.assignedTo ?? route.id}`,
      name: route.driver?.name ?? route.id,
      driverId: route.assignedTo ?? undefined,
      startLocationId: "depot",
      endLocationId: "depot",
      routingProfile: plan.routingProfile,
    })),
    services,
    objective: "min-schedule-completion-time",
  };
}

function routeCoordinates(
  plan: NonNullable<Awaited<ReturnType<DeliveryRouteRepository["getPlanForWorker"]>>>,
  stops: NonNullable<Awaited<ReturnType<DeliveryRouteRepository["getPlanForWorker"]>>>["routes"][number]["stops"],
): RoutingCoordinate[] {
  const depot: RoutingCoordinate = {
    latitude: Number(plan.depotLatitude),
    longitude: Number(plan.depotLongitude),
  };
  return [
    depot,
    ...stops.map((stop) => ({
      latitude: Number(stop.latitude),
      longitude: Number(stop.longitude),
    })),
    depot,
  ];
}

function mapGeocodeToLocation(result: NonNullable<Awaited<ReturnType<GeocodingProvider["geocode"]>>>) {
  return {
    latitude: result.coordinate.latitude,
    longitude: result.coordinate.longitude,
    geocodedAddress: result.formattedAddress,
    geocodingProvider: result.provider,
    geocodingQuery: result.query,
    ...(result.providerResultId ? { geocodingResultId: result.providerResultId } : {}),
    ...(result.accuracy ? { geocodingAccuracy: result.accuracy } : {}),
    ...(result.confidence !== undefined ? { geocodingConfidence: result.confidence } : {}),
    ...(result.rawResponse ? { geocodingRawResponse: result.rawResponse as Prisma.InputJsonValue } : {}),
    geocodedAt: new Date(),
  };
}

function deliverySnapshot(
  delivery: {
    deliveryAddress: string;
    customer: { name: string; phone: string; city?: string | null; state?: string | null; postalCode?: string | null };
    invoice: { invoiceNumber: string; grandTotal: Prisma.Decimal; amountDue: Prisma.Decimal };
  },
  address: string,
) {
  return {
    address,
    originalAddress: delivery.deliveryAddress,
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
