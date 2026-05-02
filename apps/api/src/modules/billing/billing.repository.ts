import { InvoiceStatus, type Prisma, type PrismaClient } from "@prisma/client";

import type { CreateInvoiceInput, InvoiceListQuery } from "./billing.types.js";

export class BillingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async countInvoicesForDate(tenantId: string, start: Date, end: Date): Promise<number> {
    return this.prisma.invoice.count({
      where: {
        tenantId,
        invoiceDate: {
          gte: start,
          lt: end,
        },
      },
    });
  }

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
    invoiceNumber: string;
    invoice: CreateInvoiceInput;
    totals: InvoiceTotals;
    items: Prisma.InvoiceItemUncheckedCreateWithoutInvoiceInput[];
  }) {
    return this.prisma.invoice.create({
      data: {
        tenantId: input.tenantId,
        invoiceNumber: input.invoiceNumber,
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
  }

  async listInvoices(tenantId: string, query: InvoiceListQuery) {
    const where: Prisma.InvoiceWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status as InvoiceStatus } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        include: {
          customer: true,
          items: true,
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

  async replaceDraftInvoice(input: {
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
          status: InvoiceStatus.DRAFT,
        },
      });

      if (!invoice) {
        return null;
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
        amountDue: input.totals.grandTotal,
        customerId: input.invoice.customerId ?? null,
        dueDate: input.invoice.dueDate ?? null,
        notes: input.invoice.notes ?? null,
        ...(input.invoice.verticalData ? { verticalData: input.invoice.verticalData as Prisma.InputJsonValue } : {}),
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

      for (const item of invoice.items) {
        const product = await tx.product.findFirst({
          where: {
            id: item.productId,
            tenantId,
            isActive: true,
          },
        });

        if (!product || product.currentStock.lt(item.quantity)) {
          throw new Error(`Insufficient stock for ${item.productName}`);
        }

        await tx.product.update({
          where: {
            id: item.productId,
          },
          data: {
            currentStock: {
              decrement: item.quantity,
            },
          },
        });
      }

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

const invoiceInclude = {
  customer: true,
  items: true,
  payments: true,
  delivery: true,
} satisfies Prisma.InvoiceInclude;
