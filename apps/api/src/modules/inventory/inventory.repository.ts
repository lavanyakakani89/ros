import type { Prisma, PrismaClient } from "@prisma/client";

import type { AddBatchInput, CreateProductInput, ProductListQuery, StockAdjustmentInput, UpdateProductInput } from "./inventory.types.js";

export class InventoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createProduct(tenantId: string, input: CreateProductInput) {
    const data: Prisma.ProductUncheckedCreateInput = {
      tenantId,
      name: input.name,
      unit: input.unit,
      mrp: input.mrp,
      sellingPrice: input.sellingPrice,
      gstRate: input.gstRate,
      cessRate: input.cessRate,
      currentStock: input.currentStock,
      ...(input.sku ? { sku: input.sku } : {}),
      ...(input.barcode ? { barcode: input.barcode } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.partGroup ? { partGroup: input.partGroup } : {}),
      ...(input.legacySubCategoryId ? { legacySubCategoryId: input.legacySubCategoryId } : {}),
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.purchasePrice !== undefined ? { purchasePrice: input.purchasePrice } : {}),
      ...(input.wholesalePrice !== undefined ? { wholesalePrice: input.wholesalePrice } : {}),
      ...(input.defaultDiscountPercent !== undefined ? { defaultDiscountPercent: input.defaultDiscountPercent } : {}),
      ...(input.hsnCode ? { hsnCode: input.hsnCode } : {}),
      ...(input.reorderLevel !== undefined ? { reorderLevel: input.reorderLevel } : {}),
      ...(input.purchaseUnit ? { purchaseUnit: input.purchaseUnit } : {}),
      ...(input.salesUnit ? { salesUnit: input.salesUnit } : {}),
      ...(input.alternateUnit ? { alternateUnit: input.alternateUnit } : {}),
      ...(input.conversionValue !== undefined ? { conversionValue: input.conversionValue } : {}),
      ...(input.godown ? { godown: input.godown } : {}),
      ...(input.rack ? { rack: input.rack } : {}),
      ...(input.defaultSaleQty !== undefined ? { defaultSaleQty: input.defaultSaleQty } : {}),
      ...(input.supplierId ? { supplierId: input.supplierId } : {}),
      ...(input.verticalData ? { verticalData: input.verticalData as Prisma.InputJsonValue } : {}),
    };

    return this.prisma.product.create({
      data,
    });
  }

  async listProducts(tenantId: string, query: ProductListQuery) {
    const where: Prisma.ProductWhereInput = {
      tenantId,
      isActive: true,
      ...(query.lowStock ? { reorderLevel: { not: null } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { sku: { contains: query.search, mode: "insensitive" } },
              { barcode: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    if (query.lowStock) {
      const products = await this.prisma.product.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      });
      const filteredProducts = products.filter((product) => product.reorderLevel !== null && product.currentStock.lte(product.reorderLevel));
      const offset = (query.page - 1) * query.limit;

      return {
        data: filteredProducts.slice(offset, offset + query.limit),
        page: query.page,
        limit: query.limit,
        total: filteredProducts.length,
      };
    }

    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      data: products,
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async findProduct(tenantId: string, productId: string) {
    return this.prisma.product.findFirst({
      where: {
        id: productId,
        tenantId,
        isActive: true,
      },
    });
  }

  async updateProduct(tenantId: string, productId: string, input: UpdateProductInput) {
    return this.prisma.product.updateMany({
      where: {
        id: productId,
        tenantId,
        isActive: true,
      },
      data: toProductUpdateInput(input),
    });
  }

  async softDeleteProduct(tenantId: string, productId: string) {
    return this.prisma.product.updateMany({
      where: {
        id: productId,
        tenantId,
      },
      data: {
        isActive: false,
      },
    });
  }

  async addBatch(tenantId: string, productId: string, input: AddBatchInput) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: {
          id: productId,
          tenantId,
          isActive: true,
        },
      });

      if (!product) {
        return null;
      }

      const batch = await tx.productBatch.create({
        data: {
          tenantId,
          productId,
          batchNumber: input.batchNumber,
          ...(input.mfgDate ? { mfgDate: input.mfgDate } : {}),
          expiryDate: input.expiryDate,
          quantity: input.quantity,
          purchasePrice: input.purchasePrice,
        },
      });

      await tx.product.update({
        where: {
          id: productId,
        },
        data: {
          currentStock: {
            increment: input.quantity,
          },
        },
      });

      return batch;
    });
  }

  async listBatches(tenantId: string, productId: string) {
    return this.prisma.productBatch.findMany({
      where: {
        tenantId,
        productId,
      },
      orderBy: {
        expiryDate: "asc",
      },
    });
  }

  async listExpiringBatches(tenantId: string, days: number) {
    const expiresBefore = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    return this.prisma.productBatch.findMany({
      where: {
        tenantId,
        expiryDate: {
          not: null,
          lte: expiresBefore,
        },
      },
      include: {
        product: true,
      },
      orderBy: {
        expiryDate: "asc",
      },
    });
  }

  async adjustStock(tenantId: string, createdBy: string, input: StockAdjustmentInput) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: {
          id: input.productId,
          tenantId,
          isActive: true,
        },
      });

      if (!product) {
        return null;
      }

      const adjustment = await tx.stockAdjustment.create({
        data: {
          tenantId,
          productId: input.productId,
          quantityChange: input.quantityChange,
          reason: input.reason,
          ...(input.notes ? { notes: input.notes } : {}),
          createdBy,
        },
      });

      const updatedProduct = await tx.product.update({
        where: {
          id: input.productId,
        },
        data: {
          currentStock: {
            increment: input.quantityChange,
          },
        },
      });

      return {
        adjustment,
        product: updatedProduct,
      };
    });
  }
}

function toProductUpdateInput(input: UpdateProductInput): Prisma.ProductUncheckedUpdateInput {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.sku !== undefined ? { sku: input.sku } : {}),
    ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.partGroup !== undefined ? { partGroup: input.partGroup } : {}),
    ...(input.legacySubCategoryId !== undefined ? { legacySubCategoryId: input.legacySubCategoryId } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
    ...(input.unit !== undefined ? { unit: input.unit } : {}),
    ...(input.mrp !== undefined ? { mrp: input.mrp } : {}),
    ...(input.sellingPrice !== undefined ? { sellingPrice: input.sellingPrice } : {}),
    ...(input.purchasePrice !== undefined ? { purchasePrice: input.purchasePrice } : {}),
    ...(input.wholesalePrice !== undefined ? { wholesalePrice: input.wholesalePrice } : {}),
    ...(input.defaultDiscountPercent !== undefined ? { defaultDiscountPercent: input.defaultDiscountPercent } : {}),
    ...(input.gstRate !== undefined ? { gstRate: input.gstRate } : {}),
    ...(input.cessRate !== undefined ? { cessRate: input.cessRate } : {}),
    ...(input.hsnCode !== undefined ? { hsnCode: input.hsnCode } : {}),
    ...(input.currentStock !== undefined ? { currentStock: input.currentStock } : {}),
    ...(input.reorderLevel !== undefined ? { reorderLevel: input.reorderLevel } : {}),
    ...(input.purchaseUnit !== undefined ? { purchaseUnit: input.purchaseUnit } : {}),
    ...(input.salesUnit !== undefined ? { salesUnit: input.salesUnit } : {}),
    ...(input.alternateUnit !== undefined ? { alternateUnit: input.alternateUnit } : {}),
    ...(input.conversionValue !== undefined ? { conversionValue: input.conversionValue } : {}),
    ...(input.godown !== undefined ? { godown: input.godown } : {}),
    ...(input.rack !== undefined ? { rack: input.rack } : {}),
    ...(input.defaultSaleQty !== undefined ? { defaultSaleQty: input.defaultSaleQty } : {}),
    ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
    ...(input.verticalData !== undefined ? { verticalData: input.verticalData as Prisma.InputJsonValue } : {}),
  };
}
