import { CreditNoteStatus, InvoiceStatus, POStatus, type Tenant, type UserRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { InventoryRepository } from "./inventory.repository.js";
import type { AddBatchInput, CreateProductInput, ProductListQuery, ProductLookupQuery, StockAdjustmentInput, StockMovementQuery, StockMovementRecord, UpdateProductInput } from "./inventory.types.js";

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

  async listProductMovements(tenant: Tenant, productId: string, query: StockMovementQuery) {
    if (!(await this.repository.findProduct(tenant.id, productId))) {
      throw new InventoryError("Product not found", 404);
    }

    const [adjustments, sales, purchases, returns] = await Promise.all([
      this.fastify.prisma.stockAdjustment.findMany({
        where: { tenantId: tenant.id, productId },
        orderBy: { createdAt: "asc" },
      }),
      this.fastify.prisma.invoiceItem.findMany({
        where: {
          tenantId: tenant.id,
          productId,
          invoice: {
            tenantId: tenant.id,
            status: { in: [InvoiceStatus.CONFIRMED, InvoiceStatus.PAID, InvoiceStatus.PARTIAL] },
          },
        },
        include: {
          invoice: {
            select: { invoiceNumber: true, invoiceDate: true },
          },
        },
      }),
      this.fastify.prisma.purchaseOrderItem.findMany({
        where: {
          tenantId: tenant.id,
          productId,
          receivedQuantity: { gt: 0 },
          purchaseOrder: {
            tenantId: tenant.id,
            status: { in: [POStatus.PARTIAL, POStatus.RECEIVED] },
          },
        },
        include: {
          purchaseOrder: {
            select: { poNumber: true, receivedAt: true, createdAt: true },
          },
        },
      }),
      this.fastify.prisma.creditNoteItem.findMany({
        where: {
          tenantId: tenant.id,
          productId,
          creditNote: {
            tenantId: tenant.id,
            status: CreditNoteStatus.CONFIRMED,
          },
        },
        include: {
          creditNote: {
            select: { creditNoteNumber: true, createdAt: true, reason: true },
          },
        },
      }),
    ]);

    const events: Omit<StockMovementRecord, "runningBalance">[] = [
      ...adjustments.map((adjustment) => ({
        date: adjustment.createdAt,
        type: "adjustment" as const,
        qty: decimalToNumber(adjustment.quantityChange),
        reference: "Stock adjustment",
        notes: [adjustment.reason, adjustment.notes].filter(Boolean).join(" | "),
      })),
      ...sales.map((item) => ({
        date: item.invoice.invoiceDate,
        type: "sale" as const,
        qty: -decimalToNumber(item.quantity),
        reference: item.invoice.invoiceNumber,
        notes: item.productName,
      })),
      ...purchases.map((item) => ({
        date: item.purchaseOrder.receivedAt ?? item.purchaseOrder.createdAt,
        type: "purchase" as const,
        qty: decimalToNumber(item.receivedQuantity),
        reference: item.purchaseOrder.poNumber,
        notes: item.productName,
      })),
      ...returns.map((item) => ({
        date: item.creditNote.createdAt,
        type: "return" as const,
        qty: decimalToNumber(item.quantity),
        reference: item.creditNote.creditNoteNumber,
        notes: item.creditNote.reason ?? item.productName,
      })),
    ].sort((left, right) => left.date.getTime() - right.date.getTime());

    let runningBalance = 0;
    const withBalance = events.map((event) => {
      runningBalance = roundQty(runningBalance + event.qty);
      return {
        ...event,
        runningBalance,
      };
    });
    const filtered = withBalance
      .filter((event) => !query.type || event.type === query.type)
      .filter((event) => !query.from || event.date >= query.from)
      .filter((event) => !query.to || event.date <= endOfDay(query.to))
      .sort((left, right) => right.date.getTime() - left.date.getTime());
    const offset = (query.page - 1) * query.limit;

    return {
      data: filtered.slice(offset, offset + query.limit),
      page: query.page,
      limit: query.limit,
      total: filtered.length,
    };
  }
}

function readCategoryName(verticalData: Record<string, unknown> | undefined): string | undefined {
  const category = verticalData?.category;
  return typeof category === "string" && category.trim().length > 0 ? category : undefined;
}

function decimalToNumber(value: { toNumber(): number }): number {
  return value.toNumber();
}

function roundQty(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function endOfDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}
