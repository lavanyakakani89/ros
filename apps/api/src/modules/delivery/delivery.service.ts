import { DeliveryGeocodingStatus, DeliveryStatus, UserRole, type Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { geocodeAddress } from "./delivery.geocoding.js";
import { DeliveryRepository, type CreateDeliveryProofInput } from "./delivery.repository.js";
import { optimizeDeliveryRoutePlan, summarizeRoute } from "./delivery.routing.js";
import { stripDeliveryFinancials, stripRouteFinancials } from "./delivery.sanitizers.js";
import type { AssignDeliveryInput, CreateDeliveryInput, DeliveryListQuery, DeliveryLocationPingInput, DeliveryMobileSyncInput, OptimizeDeliveryRoutesInput, UpdateDeliveryLocationInput, UpdateDeliveryStatusInput } from "./delivery.types.js";
import { VerticalConfigRepository } from "../vertical-config/vertical-config.repository.js";
import { queueWhatsappNotification } from "../whatsapp/whatsapp.notifications.js";
import { moneyForWhatsapp, renderWhatsappMessageTemplate } from "../whatsapp/whatsapp.templates.js";

export interface DeliveryActor {
  userId: string;
  role: UserRole;
}

export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export class DeliveryService {
  private readonly repository: DeliveryRepository;
  private readonly verticalConfigRepository = new VerticalConfigRepository();

  constructor(private readonly fastify: FastifyInstance) {
    this.repository = new DeliveryRepository(fastify.prisma);
  }

  async createDelivery(tenant: Tenant, input: CreateDeliveryInput) {
    if (!this.verticalConfigRepository.getByVertical(tenant.vertical).modules.delivery) {
      throw new DeliveryError("Delivery module is not enabled for this tenant", 403);
    }

    let delivery = await this.repository.createDelivery(tenant.id, input);
    if (!delivery) {
      throw new DeliveryError("Invoice or customer not found", 404);
    }

    if (input.latitude === undefined || input.longitude === undefined) {
      const geocode = await geocodeAddress(input.deliveryAddress, this.fastify.log);
      if (geocode) {
        await this.repository.updateDeliveryCoordinates(tenant.id, delivery.id, {
          latitude: geocode.latitude,
          longitude: geocode.longitude,
          provider: geocode.provider,
          status: DeliveryGeocodingStatus.GEOCODED,
        });
        delivery = await this.repository.getDelivery(tenant.id, delivery.id) ?? delivery;
      } else {
        await this.repository.updateDeliveryCoordinates(tenant.id, delivery.id, {
          status: DeliveryGeocodingStatus.FAILED,
        });
      }
    }

    return delivery;
  }

  listDeliveries(tenant: Tenant, query: DeliveryListQuery) {
    return this.repository.listDeliveries(tenant.id, query);
  }

  async assignDelivery(tenant: Tenant, deliveryId: string, input: AssignDeliveryInput) {
    const result = await this.repository.assignDelivery(tenant.id, deliveryId, input.userId);
    if (result.count === 0) {
      throw new DeliveryError("Delivery not found", 404);
    }

    const delivery = await this.repository.getDelivery(tenant.id, deliveryId);
    await this.notifyDeliveryAssignment(tenant, delivery, input.userId).catch((error: unknown) => {
      this.fastify.log.error({ error, tenantId: tenant.id, deliveryId, assignedTo: input.userId }, "Failed to notify delivery assignment");
    });

    return delivery;
  }

  async updateStatus(tenant: Tenant, deliveryId: string, input: UpdateDeliveryStatusInput, actor?: DeliveryActor) {
    await this.ensureDeliveryAccess(tenant.id, deliveryId, actor);
    const result = await this.repository.updateDeliveryStatus(tenant.id, deliveryId, input);
    if (result.count === 0) {
      throw new DeliveryError("Delivery not found", 404);
    }

    const delivery = await this.repository.getDelivery(tenant.id, deliveryId);
    await this.notifyWhatsappDeliveryStatus(tenant, delivery, input.status).catch((error: unknown) => {
      this.fastify.log.error({ error, tenantId: tenant.id, deliveryId }, "Failed to queue WhatsApp delivery update");
    });

    return actor?.role === UserRole.DELIVERY ? stripDeliveryFinancials(delivery) : delivery;
  }

  listAgentDeliveries(tenant: Tenant, userId: string) {
    return this.repository.listAgentDeliveries(tenant.id, userId);
  }

  listMyDeliveries(tenant: Tenant, actor: DeliveryActor) {
    return this.repository.listAgentDeliveries(tenant.id, actor.userId).then((deliveries) => deliveries.map(stripDeliveryFinancials));
  }

  async getDelivery(tenant: Tenant, deliveryId: string, actor?: DeliveryActor) {
    await this.ensureDeliveryAccess(tenant.id, deliveryId, actor);
    const delivery = await this.repository.getDelivery(tenant.id, deliveryId);
    if (!delivery) {
      throw new DeliveryError("Delivery not found", 404);
    }

    return actor?.role === UserRole.DELIVERY ? stripDeliveryFinancials(delivery) : delivery;
  }

  async getMobileSync(tenant: Tenant, actor: DeliveryActor) {
    const [deliveries, notifications, route] = await Promise.all([
      this.repository.listAgentDeliveries(tenant.id, actor.userId),
      this.repository.listNotifications(tenant.id, actor.userId),
      this.repository.listActiveRouteForAgent(tenant.id, actor.userId),
    ]);

    return {
      serverTime: new Date().toISOString(),
      deliveries: deliveries.map(stripDeliveryFinancials),
      notifications,
      route: route ? stripRouteFinancials(summarizeRoute(route)) : null,
    };
  }

  async syncMobile(tenant: Tenant, actor: DeliveryActor, input: DeliveryMobileSyncInput) {
    for (const statusUpdate of input.statusUpdates) {
      await this.updateStatus(tenant, statusUpdate.deliveryId, {
        status: statusUpdate.status,
        ...(statusUpdate.notes ? { notes: statusUpdate.notes } : {}),
      }, actor);
    }

    for (const ping of input.locationPings) {
      await this.createLocationPing(tenant, actor, ping);
    }

    return this.getMobileSync(tenant, actor);
  }

  listMyNotifications(tenant: Tenant, actor: DeliveryActor) {
    return this.repository.listNotifications(tenant.id, actor.userId);
  }

  async markNotificationRead(tenant: Tenant, actor: DeliveryActor, notificationId: string) {
    const result = await this.repository.markNotificationRead(tenant.id, actor.userId, notificationId);
    if (result.count === 0) {
      throw new DeliveryError("Notification not found", 404);
    }

    return { status: "ok" };
  }

  async createProof(tenant: Tenant, actor: DeliveryActor, input: CreateDeliveryProofInput) {
    await this.ensureDeliveryAccess(tenant.id, input.deliveryId, actor);
    const delivery = await this.repository.getDelivery(tenant.id, input.deliveryId);
    if (!delivery) {
      throw new DeliveryError("Delivery not found", 404);
    }

    return this.repository.createProof(tenant.id, {
      ...input,
      proofType: input.proofType,
      uploadedBy: actor.userId,
    });
  }

  async createLocationPing(tenant: Tenant, actor: DeliveryActor, input: DeliveryLocationPingInput) {
    if (input.deliveryId) {
      await this.ensureDeliveryAccess(tenant.id, input.deliveryId, actor);
    }

    return this.repository.createLocationPing(tenant.id, actor.userId, input);
  }

  async updateLocation(tenant: Tenant, deliveryId: string, input: UpdateDeliveryLocationInput, actor?: DeliveryActor) {
    await this.ensureDeliveryAccess(tenant.id, deliveryId, actor);
    const result = await this.repository.updateDeliveryCoordinates(tenant.id, deliveryId, {
      latitude: input.latitude,
      longitude: input.longitude,
      provider: "manual",
      status: DeliveryGeocodingStatus.MANUAL,
    });

    if (result.count === 0) {
      throw new DeliveryError("Delivery not found", 404);
    }

    const delivery = await this.repository.getDelivery(tenant.id, deliveryId);
    return actor?.role === UserRole.DELIVERY ? stripDeliveryFinancials(delivery) : delivery;
  }

  async optimizeRoutes(tenant: Tenant, input: OptimizeDeliveryRoutesInput) {
    const routeCandidateOptions: { deliveryIds?: string[]; userIds?: string[] } = {};
    if (input.deliveryIds !== undefined) {
      routeCandidateOptions.deliveryIds = input.deliveryIds;
    }
    if (input.userIds !== undefined) {
      routeCandidateOptions.userIds = input.userIds;
    }

    const [vehicles, candidates] = await Promise.all([
      this.repository.listDeliveryUsers(tenant.id, input.userIds),
      this.repository.listRouteCandidates(tenant.id, routeCandidateOptions),
    ]);

    if (vehicles.length === 0) {
      throw new DeliveryError("Create at least one active DELIVERY user before optimizing routes", 409);
    }

    if (candidates.length === 0) {
      return {
        provider: "none",
        warnings: ["No pending or assigned deliveries to optimize."],
        routes: [],
      };
    }

    const routePlanInput = {
      candidates,
      vehicles,
      returnToDepot: input.returnToDepot,
      ...(input.depotLatitude !== undefined ? { depotLatitude: input.depotLatitude } : {}),
      ...(input.depotLongitude !== undefined ? { depotLongitude: input.depotLongitude } : {}),
      ...(input.vehicleCapacityKg !== undefined ? { vehicleCapacityKg: input.vehicleCapacityKg } : {}),
      ...(input.maxDistanceMeters !== undefined ? { maxDistanceMeters: input.maxDistanceMeters } : {}),
    };

    const plan = await optimizeDeliveryRoutePlan(routePlanInput);

    if (plan.routes.length === 0) {
      return plan;
    }

    const routes = await this.repository.saveOptimizedRoutes(tenant.id, plan.routes.map((route) => ({
      ...route,
      optimizationProvider: plan.provider,
    })));

    return {
      provider: plan.provider,
      warnings: plan.warnings,
      routes: routes.map(summarizeRoute),
    };
  }

  async getProof(tenant: Tenant, deliveryId: string, proofId: string, actor?: DeliveryActor) {
    await this.ensureDeliveryAccess(tenant.id, deliveryId, actor);
    const proof = await this.repository.getProof(tenant.id, deliveryId, proofId);
    if (!proof) {
      throw new DeliveryError("Delivery proof not found", 404);
    }

    return proof;
  }

  private async ensureDeliveryAccess(tenantId: string, deliveryId: string, actor?: DeliveryActor) {
    if (!actor || actor.role !== UserRole.DELIVERY) {
      return;
    }

    const allowed = await this.repository.canAccessDelivery(tenantId, deliveryId, actor.userId);
    if (!allowed) {
      throw new DeliveryError("This delivery is not assigned to you", 403, "NOT_YOUR_DELIVERY");
    }
  }

  private async notifyDeliveryAssignment(
    tenant: Tenant,
    delivery: Awaited<ReturnType<DeliveryRepository["getDelivery"]>>,
    userId: string,
  ) {
    if (!delivery) {
      return;
    }

    await this.repository.createNotification({
      tenantId: tenant.id,
      userId,
      title: "New delivery assigned",
      body: `${delivery.invoice.invoiceNumber} | ${delivery.customer.name} | ₹${delivery.invoice.grandTotal.toNumber().toFixed(2)}`,
      type: "DELIVERY_ASSIGNED",
      entityType: "DELIVERY",
      entityId: delivery.id,
    });

    const user = await this.fastify.prisma.user.findFirst({
      where: {
        id: userId,
        tenantId: tenant.id,
        isActive: true,
      },
    });

    if (user?.phone) {
      const message = await renderWhatsappMessageTemplate(this.fastify, tenant.id, "deliveryAssigned", {
        invoiceNumber: delivery.invoice.invoiceNumber,
        customerName: delivery.customer.name,
        grandTotal: moneyForWhatsapp(delivery.invoice.grandTotal),
        deliveryAddress: delivery.deliveryAddress,
      });

      await queueWhatsappNotification(this.fastify, {
        tenantId: tenant.id,
        phone: user.phone,
        invoiceId: delivery.invoiceId,
        deliveryId: delivery.id,
        jobName: "delivery-assigned",
        message,
        eventKey: "deliveryAssigned",
      });
    }
  }

  private async notifyWhatsappDeliveryStatus(
    tenant: Tenant,
    delivery: Awaited<ReturnType<DeliveryRepository["getDelivery"]>>,
    status: DeliveryStatus,
  ) {
    if (!delivery || !delivery.customer.phone) {
      return;
    }

    if (status !== DeliveryStatus.OUT_FOR_DELIVERY && status !== DeliveryStatus.DELIVERED) {
      return;
    }

    const label = status === DeliveryStatus.OUT_FOR_DELIVERY ? "out for delivery" : "delivered";
    const templateKey = status === DeliveryStatus.OUT_FOR_DELIVERY ? "deliveryOutForDelivery" : "deliveryDelivered";
    const message = await renderWhatsappMessageTemplate(this.fastify, tenant.id, templateKey, {
      customerName: delivery.customer.name,
      tenantName: tenant.name,
      invoiceNumber: delivery.invoice.invoiceNumber,
      grandTotal: moneyForWhatsapp(delivery.invoice.grandTotal),
      deliveryAddress: delivery.deliveryAddress,
    });

    await queueWhatsappNotification(this.fastify, {
      tenantId: tenant.id,
      phone: delivery.customer.phone,
      customerId: delivery.customerId,
      invoiceId: delivery.invoiceId,
      deliveryId: delivery.id,
      message,
      jobName: `delivery-${label.replaceAll(" ", "-")}`,
      eventKey: "deliveryStatusUpdate",
    });
  }
}
