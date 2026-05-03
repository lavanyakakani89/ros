import type { Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { SuppliersRepository } from "./suppliers.repository.js";
import type { CreateSupplierInput, SupplierListQuery, UpdateSupplierInput } from "./suppliers.schema.js";

export class SuppliersError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export class SuppliersService {
  private readonly repository: SuppliersRepository;

  constructor(fastify: FastifyInstance) {
    this.repository = new SuppliersRepository(fastify.prisma);
  }

  listSuppliers(tenant: Tenant, query: SupplierListQuery) {
    return this.repository.list(tenant.id, query);
  }

  createSupplier(tenant: Tenant, input: CreateSupplierInput) {
    return this.repository.create(tenant.id, input);
  }

  async getSupplier(tenant: Tenant, id: string) {
    const supplier = await this.repository.find(tenant.id, id);
    if (!supplier) {
      throw new SuppliersError("Supplier not found", 404);
    }

    return {
      ...supplier,
      totalPurchaseValue: supplier.purchaseOrders.reduce((total, order) => total + order.totalAmount.toNumber(), 0),
      lastOrderAt: supplier.purchaseOrders[0]?.createdAt ?? null,
    };
  }

  async updateSupplier(tenant: Tenant, id: string, input: UpdateSupplierInput) {
    const result = await this.repository.update(tenant.id, id, input);
    if (result.count === 0) {
      throw new SuppliersError("Supplier not found", 404);
    }

    return this.getSupplier(tenant, id);
  }
}
