import type { Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { DeliveryRepository } from "./delivery.repository.js";
import type { AssignDeliveryInput, CreateDeliveryInput, DeliveryListQuery, UpdateDeliveryStatusInput } from "./delivery.types.js";
import { VerticalConfigRepository } from "../vertical-config/vertical-config.repository.js";

export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export class DeliveryService {
  private readonly repository: DeliveryRepository;
  private readonly verticalConfigRepository = new VerticalConfigRepository();

  constructor(fastify: FastifyInstance) {
    this.repository = new DeliveryRepository(fastify.prisma);
  }

  async createDelivery(tenant: Tenant, input: CreateDeliveryInput) {
    if (!this.verticalConfigRepository.getByVertical(tenant.vertical).modules.delivery) {
      throw new DeliveryError("Delivery module is not enabled for this tenant", 403);
    }

    const delivery = await this.repository.createDelivery(tenant.id, input);
    if (!delivery) {
      throw new DeliveryError("Invoice or customer not found", 404);
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

    return this.repository.getDelivery(tenant.id, deliveryId);
  }

  async updateStatus(tenant: Tenant, deliveryId: string, input: UpdateDeliveryStatusInput) {
    const result = await this.repository.updateDeliveryStatus(tenant.id, deliveryId, input);
    if (result.count === 0) {
      throw new DeliveryError("Delivery not found", 404);
    }

    return this.repository.getDelivery(tenant.id, deliveryId);
  }

  listAgentDeliveries(tenant: Tenant, userId: string) {
    return this.repository.listAgentDeliveries(tenant.id, userId);
  }
}
