import { DeliveryStatus, type Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { DeliveryRepository } from "./delivery.repository.js";
import type { AssignDeliveryInput, CreateDeliveryInput, DeliveryListQuery, UpdateDeliveryStatusInput } from "./delivery.types.js";
import { VerticalConfigRepository } from "../vertical-config/vertical-config.repository.js";
import { queueWhatsappNotification } from "../whatsapp/whatsapp.notifications.js";

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

  constructor(private readonly fastify: FastifyInstance) {
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

    const delivery = await this.repository.getDelivery(tenant.id, deliveryId);
    await this.notifyWhatsappDeliveryStatus(tenant, delivery, input.status).catch((error: unknown) => {
      this.fastify.log.error({ error, tenantId: tenant.id, deliveryId }, "Failed to queue WhatsApp delivery update");
    });

    return delivery;
  }

  listAgentDeliveries(tenant: Tenant, userId: string) {
    return this.repository.listAgentDeliveries(tenant.id, userId);
  }

  private async notifyWhatsappDeliveryStatus(
    tenant: Tenant,
    delivery: Awaited<ReturnType<DeliveryRepository["getDelivery"]>>,
    status: DeliveryStatus,
  ) {
    if (!delivery || !delivery.customer.phone || !isWhatsappSourced(delivery.invoice.verticalData)) {
      return;
    }

    if (status !== DeliveryStatus.OUT_FOR_DELIVERY && status !== DeliveryStatus.DELIVERED) {
      return;
    }

    const label = status === DeliveryStatus.OUT_FOR_DELIVERY ? "out for delivery" : "delivered";
    const message = status === DeliveryStatus.OUT_FOR_DELIVERY
      ? `Hi ${delivery.customer.name}, your order ${delivery.invoice.invoiceNumber} from ${tenant.name} is out for delivery.`
      : `Hi ${delivery.customer.name}, your order ${delivery.invoice.invoiceNumber} from ${tenant.name} has been delivered. Thank you.`;

    await queueWhatsappNotification(this.fastify, {
      tenantId: tenant.id,
      phone: delivery.customer.phone,
      customerId: delivery.customerId,
      invoiceId: delivery.invoiceId,
      deliveryId: delivery.id,
      message,
      jobName: `delivery-${label.replaceAll(" ", "-")}`,
    });
  }
}

function isWhatsappSourced(value: unknown): boolean {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return record.source === "WHATSAPP" || typeof record.whatsappOrderId === "string";
}
