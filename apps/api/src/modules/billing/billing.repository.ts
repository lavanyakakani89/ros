import { InvoiceStatus, PaymentMode, Prisma, type PrismaClient } from "@prisma/client";

import type { CreateInvoiceInput, InvoiceListQuery } from "./billing.types.js";

export interface StockWarning {
  productId: string;
  productName: string;
  available: number;
  requested: number;
  shortage: number;
}

interface SplitPaymentInput {
  mode: PaymentMode;
  amount: number;
}

interface ExistingPaymentInput {
  id: string;
  mode: PaymentMode | null;
  amount: Prisma.Decimal;
  cashierId: string | null;
}

interface EditedPaymentState {
  paymentMode: PaymentMode;
  amountPaid: number;
  amountDue: number;
  status: InvoiceStatus;
}

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
      ...(query.unpaid
        ? {
            amountDue: {
              gt: 0,
            },
            status: {
              notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED],
            },
          }
        : {}),
      ...(query.status ? { status: query.status as InvoiceStatus } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.from || query.to
        ? {
            invoiceDate: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
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
    updatedBy?: string;
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

      const paymentState = await reconcileEditedInvoicePayments(tx, {
        tenantId: input.tenantId,
        invoiceId: input.invoiceId,
        status: invoice.status,
        selectedPaymentMode: input.invoice.paymentMode,
        grandTotal: input.totals.grandTotal,
        verticalData: input.invoice.verticalData,
        existingPayments: invoice.payments,
        ...(input.updatedBy ? { updatedBy: input.updatedBy } : {}),
      });

      const stockWarnings: StockWarning[] = [];

      if (stockAffectsInvoice(paymentState.status)) {
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
          if (!product) {
            throw new Error("Product not found");
          }

          const available = product.currentStock.toNumber();
          if (available + 0.0005 < quantity) {
            stockWarnings.push({
              productId,
              productName: product.name,
              available,
              requested: quantity,
              shortage: roundQuantity(quantity - available),
            });
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
        paymentMode: paymentState.paymentMode,
        subtotal: input.totals.subtotal,
        totalDiscount: input.totals.totalDiscount,
        totalCgst: input.totals.totalCgst,
        totalSgst: input.totals.totalSgst,
        totalIgst: 0,
        grandTotal: input.totals.grandTotal,
        amountPaid: paymentState.amountPaid,
        amountDue: paymentState.amountDue,
        status: paymentState.status,
        customerId: input.invoice.customerId ?? null,
        dueDate: input.invoice.dueDate ?? null,
        notes: input.invoice.notes ?? null,
        pdfUrl: null,
        verticalData: input.invoice.verticalData ? input.invoice.verticalData as Prisma.InputJsonValue : Prisma.JsonNull,
        items: {
          create: input.items,
        },
      };

      const updatedInvoice = await tx.invoice.update({
        where: {
          id: input.invoiceId,
        },
        data,
        include: invoiceInclude,
      });

      return {
        ...updatedInvoice,
        stockWarnings,
      };
    });
  }

  async confirmInvoice(tenantId: string, invoiceId: string, confirmedBy = "system") {
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
      const stockWarnings: StockWarning[] = [];

      for (const item of invoice.items) {
        const product = productById.get(item.productId);
        if (!product) {
          throw new Error("Product not found");
        }

        const available = product.currentStock.toNumber();
        const requested = item.quantity.toNumber();
        if (available + 0.0005 < requested) {
          stockWarnings.push({
            productId: item.productId,
            productName: item.productName,
            available,
            requested,
            shortage: roundQuantity(requested - available),
          });
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

      const splitPayments = readSplitPayments(invoice.verticalData);
      const payableSplitPayments = splitPayments.filter((payment) => payment.mode !== PaymentMode.CREDIT);
      const splitAmountPaid = roundMoney(payableSplitPayments.reduce((sum, payment) => sum + payment.amount, 0));
      if (splitAmountPaid > invoice.grandTotal.toNumber() + 0.01) {
        throw new Error("Split payment amount cannot exceed invoice total");
      }

      if (payableSplitPayments.length > 0) {
        const paymentRows = [];
        for (const payment of payableSplitPayments) {
          const paymentMethod = await findDefaultMethodForMode(tx, tenantId, invoice.storeId, payment.mode);
          if (!paymentMethod) throw new Error(`Payment method ${payment.mode} not found`);
          paymentRows.push({
            tenantId,
            invoiceId,
            amount: payment.amount,
            paymentMethodId: paymentMethod.id,
            mode: payment.mode,
            createdBy: confirmedBy,
            cashierId: confirmedBy,
          });
        }
        await tx.payment.createMany({ data: paymentRows });
      }

      const splitPaymentMode = payableSplitPayments[0]?.mode ?? splitPayments[0]?.mode;
      const splitAmountDue = splitPayments.length > 0
        ? Math.max(roundMoney(invoice.grandTotal.toNumber() - splitAmountPaid), 0)
        : invoice.amountDue.toNumber();
      const nextStatus = splitPayments.length > 0
        ? splitAmountDue <= 0.01
          ? InvoiceStatus.PAID
          : splitAmountPaid > 0
            ? InvoiceStatus.PARTIAL
            : InvoiceStatus.CONFIRMED
        : InvoiceStatus.CONFIRMED;

      const updatedInvoice = await tx.invoice.update({
        where: {
          id: invoiceId,
        },
        data: {
          status: nextStatus,
          ...(splitPayments.length > 0
            ? {
                amountPaid: splitAmountPaid,
                amountDue: splitAmountDue,
                ...(splitPaymentMode ? { paymentMode: splitPaymentMode } : {}),
              }
            : {}),
        },
        include: invoiceInclude,
      });

      return {
        ...updatedInvoice,
        stockWarnings,
      };
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

function readSplitPayments(verticalData: unknown): SplitPaymentInput[] {
  const data = asRecord(verticalData);
  const rawPayments = Array.isArray(data?.splitPayments) ? data.splitPayments : [];
  return rawPayments.flatMap((payment): SplitPaymentInput[] => {
    const record = asRecord(payment);
    const mode = parsePaymentMode(record?.mode);
    const amount = typeof record?.amount === "number" ? record.amount : Number(record?.amount);
    if (!mode || !Number.isFinite(amount) || amount <= 0) {
      return [];
    }

    return [{
      mode,
      amount: roundMoney(amount),
    }];
  });
}

async function reconcileEditedInvoicePayments(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    invoiceId: string;
    status: InvoiceStatus;
    selectedPaymentMode: PaymentMode;
    grandTotal: number;
    verticalData: unknown;
    existingPayments: ExistingPaymentInput[];
    updatedBy?: string;
  },
): Promise<EditedPaymentState> {
  const existingAmountPaid = roundMoney(input.existingPayments.reduce((sum, payment) => sum + payment.amount.toNumber(), 0));

  if (input.status === InvoiceStatus.DRAFT || input.status === InvoiceStatus.CANCELLED) {
    return {
      paymentMode: input.selectedPaymentMode,
      amountPaid: existingAmountPaid,
      amountDue: Math.max(roundMoney(input.grandTotal - existingAmountPaid), 0),
      status: input.status,
    };
  }

  const splitPayments = readSplitPayments(input.verticalData);
  if (splitPayments.length > 0) {
    const payableSplitPayments = splitPayments.filter((payment) => payment.mode !== PaymentMode.CREDIT);
    const amountPaid = roundMoney(payableSplitPayments.reduce((sum, payment) => sum + payment.amount, 0));
    if (amountPaid > input.grandTotal + 0.01) {
      throw new Error("Split payment amount cannot exceed invoice total");
    }

    await tx.payment.deleteMany({
      where: {
        tenantId: input.tenantId,
        invoiceId: input.invoiceId,
      },
    });

    if (payableSplitPayments.length > 0) {
      await tx.payment.createMany({
        data: await Promise.all(payableSplitPayments.map(async (payment) => {
          const paymentMethod = await findDefaultMethodForMode(tx, input.tenantId, null, payment.mode);
          if (!paymentMethod) throw new Error(`Payment method ${payment.mode} not found`);
          return {
          tenantId: input.tenantId,
          invoiceId: input.invoiceId,
          amount: payment.amount,
          paymentMethodId: paymentMethod.id,
          mode: payment.mode,
          createdBy: input.updatedBy ?? input.existingPayments[0]?.cashierId ?? "system",
          cashierId: input.updatedBy ?? input.existingPayments[0]?.cashierId ?? null,
        };
        })),
      });
    }

    const amountDue = Math.max(roundMoney(input.grandTotal - amountPaid), 0);
    return {
      paymentMode: payableSplitPayments[0]?.mode ?? splitPayments[0]?.mode ?? input.selectedPaymentMode,
      amountPaid,
      amountDue,
      status: amountDue <= 0.01
        ? InvoiceStatus.PAID
        : amountPaid > 0
          ? InvoiceStatus.PARTIAL
          : InvoiceStatus.CONFIRMED,
    };
  }

  if (input.selectedPaymentMode === PaymentMode.CREDIT) {
    await tx.payment.deleteMany({
      where: {
        tenantId: input.tenantId,
        invoiceId: input.invoiceId,
      },
    });

    return {
      paymentMode: PaymentMode.CREDIT,
      amountPaid: 0,
      amountDue: input.grandTotal,
      status: InvoiceStatus.CONFIRMED,
    };
  }

  const amountPaid = roundMoney(input.grandTotal);
  if (input.existingPayments.length === 1 && input.existingPayments[0]) {
      const existingPayment = input.existingPayments[0];
      const paymentMethod = await findDefaultMethodForMode(tx, input.tenantId, null, input.selectedPaymentMode);
      if (!paymentMethod) throw new Error(`Payment method ${input.selectedPaymentMode} not found`);
      await tx.payment.update({
      where: {
        id: existingPayment.id,
      },
        data: {
          amount: amountPaid,
          paymentMethodId: paymentMethod.id,
          mode: input.selectedPaymentMode,
        ...(existingPayment.mode !== input.selectedPaymentMode
          ? {
              referenceNumber: null,
              razorpayId: null,
            }
          : {}),
      },
    });
  } else {
    await tx.payment.deleteMany({
      where: {
        tenantId: input.tenantId,
        invoiceId: input.invoiceId,
      },
    });
    const paymentMethod = await findDefaultMethodForMode(tx, input.tenantId, null, input.selectedPaymentMode);
    if (!paymentMethod) throw new Error(`Payment method ${input.selectedPaymentMode} not found`);
    await tx.payment.create({
      data: {
        tenantId: input.tenantId,
        invoiceId: input.invoiceId,
        amount: amountPaid,
        paymentMethodId: paymentMethod.id,
        mode: input.selectedPaymentMode,
        createdBy: input.updatedBy ?? input.existingPayments[0]?.cashierId ?? "system",
        cashierId: input.updatedBy ?? input.existingPayments[0]?.cashierId ?? null,
      },
    });
  }

  return {
    paymentMode: input.selectedPaymentMode,
    amountPaid,
    amountDue: 0,
    status: InvoiceStatus.PAID,
  };
}

function parsePaymentMode(value: unknown): PaymentMode | undefined {
  return typeof value === "string" && Object.values(PaymentMode).includes(value as PaymentMode)
    ? value as PaymentMode
    : undefined;
}

async function findDefaultMethodForMode(
  tx: Prisma.TransactionClient,
  tenantId: string,
  storeId: string | null,
  mode: PaymentMode,
) {
  const store = storeId
    ? { id: storeId }
    : await tx.store.findFirst({ where: { tenantId, isActive: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  if (!store?.id) return null;
  return tx.paymentMethod.findFirst({
    where: {
      tenantId,
      storeId: store.id,
      shortCode: mode === PaymentMode.CREDIT ? "CRED" : mode,
      isActive: true,
      deletedAt: null,
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
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
