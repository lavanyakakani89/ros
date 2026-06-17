import type { Tenant, UserRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { InventoryRepository } from "./inventory.repository.js";
import type { AddBatchInput, CreateProductInput, ProductListQuery, ProductLookupQuery, StockAdjustmentInput, UpdateProductInput } from "./inventory.types.js";

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

  constructor(private readonly fastify: FastifyInstance) {
    this.repository = new InventoryRepository(fastify.prisma);
  }

  async createProduct(tenant: Tenant, input: CreateProductInput) {
    return this.repository.createProduct(tenant.id, await this.normalizeProductCategory(tenant.id, input, true));
  }

  listProducts(tenant: Tenant, query: ProductListQuery) {
    return this.repository.listProducts(tenant.id, query);
  }

  nextProductSku(tenant: Tenant) {
    return this.repository.nextProductSku(tenant.id);
  }

  async lookupProduct(tenant: Tenant, query: ProductLookupQuery) {
    const product = await this.repository.findProductByCode(tenant.id, query.code);
    if (!product) {
      throw new InventoryError("Product not found", 404);
    }

    return product;
  }

  async updateProduct(tenant: Tenant, productId: string, input: UpdateProductInput) {
    const result = await this.repository.updateProduct(tenant.id, productId, await this.normalizeProductCategory(tenant.id, input, false));
    if (result.count === 0) {
      throw new InventoryError("Product not found", 404);
    }

    return this.repository.findProduct(tenant.id, productId);
  }

  private async normalizeProductCategory<T extends CreateProductInput | UpdateProductInput>(tenantId: string, input: T, requireCategory: boolean): Promise<T> {
    if (!input.legacySubCategoryId) {
      return input;
    }

    const categoryCodeOrId = input.legacySubCategoryId;
    const categoryName = readCategoryName(input.verticalData);
    if (requireCategory && !categoryName) {
      throw new InventoryError("Category is required", 400);
    }

    const category = await this.fastify.prisma.category.findFirst({
      where: {
        tenantId,
        isActive: true,
        OR: [
          { code: categoryCodeOrId.toUpperCase() },
          { id: categoryCodeOrId },
        ],
      },
      include: { parent: true },
    });
    if (!category) {
      throw new InventoryError(`Category/Sub Category Code ${categoryCodeOrId} was not found`, 400);
    }
    const expectedCategoryName = category.parent?.name ?? category.name;
    if (categoryName && expectedCategoryName.trim().toLowerCase() !== categoryName.trim().toLowerCase()) {
      throw new InventoryError(`Category/Sub Category Code ${categoryCodeOrId} is under Category ${expectedCategoryName}, not ${categoryName}`, 400);
    }

    return {
      ...input,
      legacySubCategoryId: category.code,
      categoryId: category.id,
      verticalData: {
        ...(input.verticalData ?? {}),
        category: categoryName ?? expectedCategoryName,
      },
    };
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

function readCategoryName(verticalData: Record<string, unknown> | undefined): string | undefined {
  const category = verticalData?.category;
  return typeof category === "string" && category.trim().length > 0 ? category : undefined;
}
