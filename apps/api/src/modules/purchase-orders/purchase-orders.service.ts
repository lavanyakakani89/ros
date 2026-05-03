import type { Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { PurchaseOrdersRepository } from "./purchase-orders.repository.js";
import type {
  CreatePurchaseOrderInput,
  PurchaseOrderListQuery,
  ReceivePurchaseOrderInput,
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
    const order = await this.repository.create(tenant.id, input);
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
}
