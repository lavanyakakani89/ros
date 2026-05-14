import { UserRole, type Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { PurchaseOrdersRepository } from "./purchase-orders.repository.js";
import type {
  CreatePurchaseOrderInput,
  PurchaseOrderListQuery,
  ReceivePurchaseOrderInput,
  RejectPurchaseOrderInput,
  UpdatePurchaseOrderStatusInput,
} from "./purchase-orders.schema.js";

export class PurchaseOrdersError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export class PurchaseOrdersService {
  private readonly repository: PurchaseOrdersRepository;

  constructor(fastify: FastifyInstance) {
    this.repository = new PurchaseOrdersRepository(fastify.prisma);
  }

  listPurchaseOrders(tenant: Tenant, query: PurchaseOrderListQuery) {
    return this.repository.list(tenant.id, query);
  }

  async createPurchaseOrder(tenant: Tenant, input: CreatePurchaseOrderInput) {
    const approvalStatus = tenant.requirePoApproval ? "PENDING_APPROVAL" : "APPROVED";
    const order = await this.repository.create(tenant.id, input, approvalStatus);
    if (!order) {
      throw new PurchaseOrdersError("Supplier not found", 404);
    }

    return order;
  }

  async getPurchaseOrder(tenant: Tenant, id: string) {
    const order = await this.repository.find(tenant.id, id);
    if (!order) {
      throw new PurchaseOrdersError("Purchase order not found", 404);
    }

    return order;
  }

  async updateStatus(tenant: Tenant, id: string, input: UpdatePurchaseOrderStatusInput) {
    const result = await this.repository.updateStatus(tenant.id, id, input);
    if (result.count === 0) {
      throw new PurchaseOrdersError("Purchase order not found", 404);
    }

    return this.getPurchaseOrder(tenant, id);
  }

  async receivePurchaseOrder(tenant: Tenant, id: string, input: ReceivePurchaseOrderInput) {
    try {
      const existing = await this.getPurchaseOrder(tenant, id);
      if (existing.approvalStatus !== "APPROVED") {
        throw new PurchaseOrdersError("Purchase order must be approved before receiving stock", 409);
      }

      const order = await this.repository.receive(tenant.id, id, input);
      if (!order) {
        throw new PurchaseOrdersError("Receivable purchase order not found", 404);
      }

      return order;
    } catch (error) {
      if (error instanceof PurchaseOrdersError) {
        throw error;
      }

      throw new PurchaseOrdersError(error instanceof Error ? error.message : "Unable to receive purchase order", 409);
    }
  }

  async approvePurchaseOrder(tenant: Tenant, id: string, user: { userId: string; role: UserRole }) {
    ensureApprover(user.role);
    const order = await this.getPurchaseOrder(tenant, id);
    if (order.approvalStatus === "APPROVED") {
      return order;
    }
    if (order.approvalStatus === "REJECTED") {
      throw new PurchaseOrdersError("Rejected purchase orders cannot be approved again", 409);
    }

    const result = await this.repository.updateApproval(tenant.id, id, {
      approvalStatus: "APPROVED",
      approvedBy: user.userId,
      approvedAt: new Date(),
    });
    if (result.count === 0) {
      throw new PurchaseOrdersError("Purchase order not found", 404);
    }

    return this.getPurchaseOrder(tenant, id);
  }

  async rejectPurchaseOrder(tenant: Tenant, id: string, user: { userId: string; role: UserRole }, input: RejectPurchaseOrderInput) {
    ensureApprover(user.role);
    const order = await this.getPurchaseOrder(tenant, id);
    if (order.approvalStatus === "APPROVED") {
      throw new PurchaseOrdersError("Approved purchase orders cannot be rejected", 409);
    }
    if (order.approvalStatus === "REJECTED") {
      return order;
    }

    const result = await this.repository.updateApproval(tenant.id, id, {
      approvalStatus: "REJECTED",
      rejectedBy: user.userId,
      rejectedAt: new Date(),
      rejectionReason: input.reason,
    });
    if (result.count === 0) {
      throw new PurchaseOrdersError("Purchase order not found", 404);
    }

    return this.getPurchaseOrder(tenant, id);
  }
}

function ensureApprover(role: UserRole): void {
  if (role !== UserRole.OWNER && role !== UserRole.MANAGER) {
    throw new PurchaseOrdersError("Only owners and managers can approve purchase orders", 403);
  }
}
