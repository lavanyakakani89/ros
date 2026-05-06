import { InvoiceStatus, Prisma, type PrismaClient } from "@prisma/client";

import type { CreateInvoiceInput, InvoiceListQuery } from "./billing.types.js";

export class BillingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findProducts(tenantId: string, productIds: string[]) {
    return this.prisma.product.findMany({
      where: {
        tenantId,
        id: {
          in: productIds,
        },
        isActive: true,
      },
    });
  }

  async createInvoice(input: {
    tenantId: string;
    datePart: string;
    invoice: CreateInvoiceInput;
    totals: InvoiceTotals;
    items: Prisma.InvoiceItemUncheckedCreateWithoutInvoiceInput[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      const counter = await tx.invoiceCounter.upsert({
        where: {
          tenantId_date: {
            tenantId: input.tenantId,
            date: input.datePart,
          },
        },
        create: {
          tenantId: input.tenantId,
          date: input.datePart,
          nextSeq: 2,
        },
        update: {
          nextSeq: {
            increment: 1,
          },
        },
      });
      const sequence = counter.nextSeq - 1;

      return tx.invoice.create({
        data: {
          tenantId: input.tenantId,
          invoiceNumber: `INV-${input.datePart}-${String(sequence).padStart(4, "0")}`,
          paymentMode: input.invoice.paymentMode,
          subtotal: input.totals.subtotal,
          totalDiscount: input.totals.totalDiscount,
          totalCgst: input.totals.totalCgst,
          totalSgst: input.totals.totalSgst,
          totalIgst: 0,
          grandTotal: input.totals.grandTotal,
          amountDue: input.totals.grandTotal,
          ...(input.invoice.customerId ? { customerId: input.invoice.customerId } : {}),
          ...(input.invoice.dueDate ? { dueDate: input.invoice.dueDate } : {}),
          ...(input.invoice.verticalData ? { verticalData: input.invoice.verticalData as Prisma.InputJsonValue } : {}),
          ...(input.invoice.notes ? { notes: input.invoice.notes } : {}),
          items: {
            create: input.items,
          },
        },
        include: invoiceInclude,
      });
    });
  }

  async listInvoices(tenantId: string, query: InvoiceListQuery) {
    const where: Prisma.InvoiceWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status as InvoiceStatus } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.from || query.to
        ? {
            invoiceDate: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: endOfDay(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { invoiceNumber: { contains: query.search, mode: "insensitive" } },
              { customer: { name: { contains: query.search, mode: "insensitive" } } },
              { customer: { phone: { contains: query.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        include: {
          customer: true,
          items: true,
          delivery: true,
        },
        orderBy: {
          invoiceDate: "desc",
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

  async getInvoice(tenantId: string, invoiceId: string) {
    return this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        tenantId,
      },
      include: invoiceInclude,
    });
  }

  async replaceInvoice(input: {
    tenantId: string;
    invoiceId: string;
    invoice: CreateInvoiceInput;
    totals: InvoiceTotals;
    items: Prisma.InvoiceItemUncheckedCreateWithoutInvoiceInput[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: {
          id: input.invoiceId,
          tenantId: input.tenantId,
        },
        include: {
          items: true,
          payments: true,
        },
      });

      if (!invoice) {
        return null;
      }

      if (stockAffectsInvoice(invoice.status)) {
        const oldStockByProduct = aggregateExistingInvoiceItems(invoice.items);
        for (const [productId, quantity] of oldStockByProduct) {
          await tx.product.update({
            where: {
              id: productId,
            },
            data: {
              currentStock: {
                increment: quantity,
              },
            },
          });
        }
      }

      const amountPaid = roundMoney(invoice.payments.reduce((sum, payment) => sum + payment.amount.toNumber(), 0));
      const amountDue = Math.max(roundMoney(input.totals.grandTotal - amountPaid), 0);
      const nextStatus = resolveEditedInvoiceStatus(invoice.status, amountPaid, input.totals.grandTotal);

      if (stockAffectsInvoice(nextStatus)) {
        const newStockByProduct = aggregateCreateInvoiceItems(input.items);
        const products = await tx.product.findMany({
          where: {
            tenantId: input.tenantId,
            id: {
              in: [...newStockByProduct.keys()],
            },
            isActive: true,
          },
        });
        const productById = new Map(products.map((product) => [product.id, product]));

        for (const [productId, quantity] of newStockByProduct) {
          const product = productById.get(productId);
          if (!product || product.currentStock.toNumber() + 0.0005 < quantity) {
            const productName = input.items.find((item) => item.productId === productId)?.productName ?? "product";
            throw new Error(`Insufficient stock for ${productName}`);
          }
        }

        for (const [productId, quantity] of newStockByProduct) {
          await tx.product.update({
            where: {
              id: productId,
            },
            data: {
              currentStock: {
                decrement: quantity,
              },
            },
          });
        }
      }

      await tx.invoiceItem.deleteMany({
        where: {
          invoiceId: input.invoiceId,
          tenantId: input.tenantId,
        },
      });

      const data: Prisma.InvoiceUncheckedUpdateInput = {
        paymentMode: input.invoice.paymentMode,
        subtotal: input.totals.subtotal,
        totalDiscount: input.totals.totalDiscount,
        totalCgst: input.totals.totalCgst,
        totalSgst: input.totals.totalSgst,
        totalIgst: 0,
        grandTotal: input.totals.grandTotal,
        amountPaid,
        amountDue,
        status: nextStatus,
        customerId: input.invoice.customerId ?? null,
        dueDate: input.invoice.dueDate ?? null,
        notes: input.invoice.notes ?? null,
        pdfUrl: null,
        verticalData: input.invoice.verticalData ? input.invoice.verticalData as Prisma.InputJsonValue : Prisma.JsonNull,
        items: {
          create: input.items,
        },
      };

      return tx.invoice.update({
        where: {
          id: input.invoiceId,
        },
        data,
        include: invoiceInclude,
      });
    });
  }

  async confirmInvoice(tenantId: string, invoiceId: string) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: {
          id: invoiceId,
          tenantId,
          status: InvoiceStatus.DRAFT,
        },
        include: {
          items: true,
        },
      });

      if (!invoice) {
        return null;
      }

      const products = await tx.product.findMany({
        where: {
          id: {
            in: invoice.items.map((item) => item.productId),
          },
          tenantId,
          isActive: true,
        },
      });
      const productById = new Map(products.map((product) => [product.id, product]));

      for (const item of invoice.items) {
        const product = productById.get(item.productId);
        if (!product || product.currentStock.lt(item.quantity)) {
          throw new Error(`Insufficient stock for ${item.productName}`);
        }
      }

      await Promise.all(
        invoice.items.map((item) => tx.product.update({
          where: {
            id: item.productId,
          },
          data: {
            currentStock: {
              decrement: item.quantity,
            },
          },
        })),
      );

      return tx.invoice.update({
        where: {
          id: invoiceId,
        },
        data: {
          status: InvoiceStatus.CONFIRMED,
        },
        include: invoiceInclude,
      });
    });
  }

  async cancelInvoice(tenantId: string, invoiceId: string) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: {
          id: invoiceId,
          tenantId,
        },
        include: {
          items: true,
        },
      });

      if (!invoice || invoice.status === InvoiceStatus.CANCELLED) {
        return null;
      }

      if (invoice.status !== InvoiceStatus.DRAFT) {
        for (const item of invoice.items) {
          await tx.product.update({
            where: {
              id: item.productId,
            },
            data: {
              currentStock: {
                increment: item.quantity,
              },
            },
          });
        }
      }

      return tx.invoice.update({
        where: {
          id: invoiceId,
        },
        data: {
          status: InvoiceStatus.CANCELLED,
        },
        include: invoiceInclude,
      });
    });
  }

  async updateInvoicePdfUrl(tenantId: string, invoiceId: string, pdfUrl: string) {
    return this.prisma.invoice.updateMany({
      where: {
        id: invoiceId,
        tenantId,
      },
      data: {
        pdfUrl,
      },
    });
  }
}

export interface InvoiceTotals {
  subtotal: number;
  totalDiscount: number;
  totalCgst: number;
  totalSgst: number;
  grandTotal: number;
}

function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

const invoiceInclude = {
  customer: true,
  items: true,
  payments: true,
  delivery: true,
} satisfies Prisma.InvoiceInclude;

function stockAffectsInvoice(status: InvoiceStatus): boolean {
  return status !== InvoiceStatus.DRAFT && status !== InvoiceStatus.CANCELLED;
}

function resolveEditedInvoiceStatus(status: InvoiceStatus, amountPaid: number, grandTotal: number): InvoiceStatus {
  if (status === InvoiceStatus.DRAFT || status === InvoiceStatus.CANCELLED) {
    return status;
  }

  if (amountPaid + 0.01 >= grandTotal) {
    return InvoiceStatus.PAID;
  }

  if (amountPaid > 0) {
    return InvoiceStatus.PARTIAL;
  }

  return InvoiceStatus.CONFIRMED;
}

function aggregateExistingInvoiceItems(items: Array<{ productId: string; quantity: Prisma.Decimal }>): Map<string, number> {
  const result = new Map<string, number>();
  for (const item of items) {
    result.set(item.productId, roundQuantity((result.get(item.productId) ?? 0) + item.quantity.toNumber()));
  }
  return result;
}

function aggregateCreateInvoiceItems(items: Prisma.InvoiceItemUncheckedCreateWithoutInvoiceInput[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const item of items) {
    result.set(item.productId, roundQuantity((result.get(item.productId) ?? 0) + Number(item.quantity)));
  }
  return result;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}
