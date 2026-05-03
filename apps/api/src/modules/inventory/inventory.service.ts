import type { Tenant, UserRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { InventoryRepository } from "./inventory.repository.js";
import type { AddBatchInput, CreateProductInput, ProductListQuery, StockAdjustmentInput, UpdateProductInput } from "./inventory.types.js";

export class InventoryError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export class InventoryService {
  private readonly repository: InventoryRepository;

  constructor(fastify: FastifyInstance) {
    this.repository = new InventoryRepository(fastify.prisma);
  }

  createProduct(tenant: Tenant, input: CreateProductInput) {
    return this.repository.createProduct(tenant.id, input);
  }

  listProducts(tenant: Tenant, query: ProductListQuery) {
    return this.repository.listProducts(tenant.id, query);
  }

  async updateProduct(tenant: Tenant, productId: string, input: UpdateProductInput) {
    const result = await this.repository.updateProduct(tenant.id, productId, input);
    if (result.count === 0) {
      throw new InventoryError("Product not found", 404);
    }

    return this.repository.findProduct(tenant.id, productId);
  }

  async deleteProduct(tenant: Tenant, productId: string) {
    const result = await this.repository.softDeleteProduct(tenant.id, productId);
    if (result.count === 0) {
      throw new InventoryError("Product not found", 404);
    }

    return { status: "ok" };
  }

  async addBatch(tenant: Tenant, productId: string, input: AddBatchInput) {
    if (tenant.vertical !== "PHARMACY") {
      throw new InventoryError("Batch management is available only for pharmacy tenants", 403);
    }

    const batch = await this.repository.addBatch(tenant.id, productId, input);
    if (!batch) {
      throw new InventoryError("Product not found", 404);
    }

    return batch;
  }

  listBatches(tenant: Tenant, productId: string) {
    return this.repository.listBatches(tenant.id, productId);
  }

  async listExpiringProducts(tenant: Tenant, days: number) {
    if (tenant.vertical !== "PHARMACY") {
      throw new InventoryError("Expiry reports are available only for pharmacy tenants", 403);
    }

    return this.repository.listExpiringBatches(tenant.id, days);
  }

  async adjustStock(tenant: Tenant, user: { userId: string; role: UserRole }, input: StockAdjustmentInput) {
    const adjustment = await this.repository.adjustStock(tenant.id, user.userId, input);
    if (!adjustment) {
      throw new InventoryError("Product not found", 404);
    }

    return adjustment;
  }
}
