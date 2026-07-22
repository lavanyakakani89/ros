import { DeliveryStatus, UserRole, type Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { DeliveryRepository, type CreateDeliveryProofInput } from "./delivery.repository.js";
import type { AssignDeliveryInput, CreateDeliveryInput, DeliveryListQuery, SyncInvoiceDeliveryInput, UpdateDeliveryStatusInput } from "./delivery.types.js";
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

  async syncInvoiceDelivery(tenant: Tenant, input: SyncInvoiceDeliveryInput) {
    if (!this.verticalConfigRepository.getByVertical(tenant.vertical).modules.delivery) {
      throw new DeliveryError("Delivery module is not enabled for this tenant", 403);
    }

    const existing = await this.repository.getDeliveryByInvoice(tenant.id, input.invoiceId);

    if (!input.deliveryRequired) {
      if (!existing) {
        return { status: "not_required" };
      }

      if (existing.status === DeliveryStatus.OUT_FOR_DELIVERY) {
        throw new DeliveryError("Delivery is already out for delivery. Cancel it from the delivery board.", 409);
      }

      if (existing.status === DeliveryStatus.DELIVERED || existing.status === DeliveryStatus.FAILED) {
        return existing;
      }

      await this.repository.cancelEditableDeliveryForInvoice(tenant.id, input.invoiceId);
      return this.repository.getDeliveryByInvoice(tenant.id, input.invoiceId);
    }

    if (!input.customerId || !input.deliveryAddress) {
      throw new DeliveryError("Customer and delivery address are required", 400);
    }

    if (existing?.status === DeliveryStatus.OUT_FOR_DELIVERY) {
      throw new DeliveryError("Delivery is already out for delivery. Edit it from the delivery board.", 409);
    }

    if (existing?.status === DeliveryStatus.DELIVERED || existing?.status === DeliveryStatus.FAILED) {
      throw new DeliveryError("Completed or failed deliveries cannot be changed from invoice edit.", 409);
    }

    const delivery = await this.repository.upsertDeliveryForInvoice(tenant.id, {
      invoiceId: input.invoiceId,
      customerId: input.customerId,
      deliveryAddress: input.deliveryAddress,
      ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
    });
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

    await this.repository.updateActiveRouteStopForDeliveryStatus(tenant.id, deliveryId, input);

    const delivery = await this.repository.getDelivery(tenant.id, deliveryId);
    await this.notifyWhatsappDeliveryStatus(tenant, delivery, input.status).catch((error: unknown) => {
      this.fastify.log.error({ error, tenantId: tenant.id, deliveryId }, "Failed to queue WhatsApp delivery update");
    });

    return delivery;
  }

  listAgentDeliveries(tenant: Tenant, userId: string) {
    return this.repository.listAgentDeliveries(tenant.id, userId);
  }

  listMyDeliveries(tenant: Tenant, actor: DeliveryActor) {
    return this.repository.listAgentDeliveries(tenant.id, actor.userId);
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
      throw new DeliveryError("This delivery is not assigned to you", 403);
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
    });
  }
}
