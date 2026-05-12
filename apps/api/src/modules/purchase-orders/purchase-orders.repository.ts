import { POStatus, type Prisma, type PrismaClient } from "@prisma/client";

import type {
  CreatePurchaseOrderInput,
  PurchaseOrderListQuery,
  ReceivePurchaseOrderInput,
  UpdatePurchaseOrderStatusInput,
} from "./purchase-orders.schema.js";

export class PurchaseOrdersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(tenantId: string, query: PurchaseOrderListQuery) {
    const createdAt: Prisma.DateTimeFilter | undefined = query.from || query.to
      ? {
          ...(query.from ? { gte: query.from } : {}),
          ...(query.to ? { lte: query.to } : {}),
        }
      : undefined;
    const where: Prisma.PurchaseOrderWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(createdAt ? { createdAt } : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        include: {
          supplier: true,
          items: {
            include: {
              product: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      data,
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  find(tenantId: string, id: string) {
    return this.prisma.purchaseOrder.findFirst({
      where: {
        id,
        tenantId,
      },
      include: purchaseOrderInclude,
    });
  }

  create(tenantId: string, input: CreatePurchaseOrderInput) {
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: {
          id: input.supplierId,
          tenantId,
        },
      });

      if (!supplier) {
        return null;
      }

      const datePart = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()).replaceAll("-", "");

      const count = await tx.purchaseOrder.count({
        where: {
          tenantId,
          poNumber: {
            startsWith: `PO-${datePart}-`,
          },
        },
      });
      const totalAmount = input.items.reduce((total, item) => total + item.quantity * item.purchasePrice, 0);

      return tx.purchaseOrder.create({
        data: {
          tenantId,
          supplierId: input.supplierId,
          poNumber: `PO-${datePart}-${String(count + 1).padStart(4, "0")}`,
          totalAmount,
          items: {
            create: input.items.map((item) => ({
              tenantId,
              ...(item.productId ? { productId: item.productId } : {}),
              productName: item.productName,
              quantity: item.quantity,
              unit: item.unit,
              purchasePrice: item.purchasePrice,
              total: item.quantity * item.purchasePrice,
              ...(item.batchNumber ? { batchNumber: item.batchNumber } : {}),
              ...(item.expiryDate ? { expiryDate: item.expiryDate } : {}),
            })),
          },
        },
        include: purchaseOrderInclude,
      });
    });
  }

  updateStatus(tenantId: string, id: string, input: UpdatePurchaseOrderStatusInput) {
    return this.prisma.purchaseOrder.updateMany({
      where: {
        id,
        tenantId,
      },
      data: {
        status: input.status,
        ...(input.status === POStatus.RECEIVED ? { receivedAt: new Date() } : {}),
      },
    });
  }

  receive(tenantId: string, id: string, input: ReceivePurchaseOrderInput) {
    return this.prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.findFirst({
        where: {
          id,
          tenantId,
          status: {
            notIn: [POStatus.CANCELLED, POStatus.RECEIVED],
          },
        },
        include: {
          items: true,
        },
      });

      if (!purchaseOrder) {
        return null;
      }

      const itemById = new Map(purchaseOrder.items.map((item) => [item.id, item]));

      for (const received of input.items) {
        const item = itemById.get(received.itemId);
        if (!item) {
          throw new Error("Purchase order item not found");
        }

        const nextReceived = item.receivedQuantity.toNumber() + received.receivedQuantity;
        if (nextReceived > item.quantity.toNumber()) {
          throw new Error(`Received quantity exceeds ordered quantity for ${item.productName}`);
        }

        await tx.purchaseOrderItem.update({
          where: {
            id: item.id,
          },
          data: {
            receivedQuantity: nextReceived,
            ...(received.batchNumber ? { batchNumber: received.batchNumber } : {}),
            ...(received.expiryDate ? { expiryDate: received.expiryDate } : {}),
          },
        });

        if (item.productId) {
          await tx.product.update({
            where: {
              id: item.productId,
            },
            data: {
              currentStock: {
                increment: received.receivedQuantity,
              },
            },
          });

          if (received.batchNumber || received.expiryDate) {
            await tx.productBatch.create({
              data: {
                tenantId,
                productId: item.productId,
                batchNumber: received.batchNumber ?? item.batchNumber ?? "PO-RECEIPT",
                expiryDate: received.expiryDate ?? item.expiryDate,
                quantity: received.receivedQuantity,
                purchasePrice: item.purchasePrice,
              },
            });
          }
        }
      }

      const refreshedItems = await tx.purchaseOrderItem.findMany({
        where: {
          tenantId,
          purchaseOrderId: id,
        },
      });
      const isFullyReceived = refreshedItems.every((item) => item.receivedQuantity.gte(item.quantity));

      return tx.purchaseOrder.update({
        where: {
          id,
        },
        data: {
          status: isFullyReceived ? POStatus.RECEIVED : POStatus.PARTIAL,
          ...(isFullyReceived ? { receivedAt: new Date() } : {}),
        },
        include: purchaseOrderInclude,
      });
    });
  }
}

const purchaseOrderInclude = {
  supplier: true,
  items: {
    include: {
      product: true,
    },
  },
} satisfies Prisma.PurchaseOrderInclude;
