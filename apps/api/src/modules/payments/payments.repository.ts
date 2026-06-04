import { InvoiceStatus, PaymentMethodType, PaymentMode, type Prisma, type PrismaClient } from "@prisma/client";

import type { PaymentListQuery, RecordPaymentInput } from "./payments.types.js";

export class PaymentsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  setTenantContext(tenantId: string) {
    return this.prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, FALSE)`;
  }

  findByRazorpayId(tenantId: string, razorpayId: string) {
    return this.prisma.payment.findFirst({
      where: {
        tenantId,
        razorpayId,
      },
    });
  }

  async recordPayment(tenantId: string, createdBy: string, input: RecordPaymentInput) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: {
          id: input.invoiceId,
          tenantId,
        },
        include: { store: true },
      });

      if (
        !invoice ||
        invoice.status === InvoiceStatus.CANCELLED ||
        invoice.status === InvoiceStatus.DRAFT ||
        invoice.status === InvoiceStatus.PENDING_WHATSAPP
      ) {
        return null;
      }

      const amountDue = invoice.amountDue.toNumber();
      if (input.amount > amountDue) {
        const existingPayment = await tx.payment.findFirst({
          where: {
            tenantId,
            invoiceId: input.invoiceId,
            amount: input.amount,
            ...(input.mode ? { mode: input.mode } : {}),
          },
        });

        if (existingPayment && amountDue <= 0.01) {
          return {
            payment: existingPayment,
            invoice,
          };
        }

        throw new Error("Payment amount cannot exceed invoice amount due");
      }

      const paymentMethod = input.payment_method_id
        ? await tx.paymentMethod.findFirst({
            where: { id: input.payment_method_id, tenantId, isActive: true, deletedAt: null },
          })
        : await findDefaultMethodForMode(tx, tenantId, invoice.storeId, input.mode ?? PaymentMode.CASH);
      if (!paymentMethod) {
        throw new Error("Payment method not found");
      }
      if (paymentMethod.type === PaymentMethodType.CREDIT) {
        throw new Error("Credit is not a received payment. Keep the invoice unpaid or use split payment with a credit balance.");
      }
      if (paymentMethod.requiresReference && !input.referenceNumber) {
        throw new Error(`Reference required for ${paymentMethod.name}`);
      }

      const nextAmountPaid = invoice.amountPaid.toNumber() + input.amount;
      const nextAmountDue = Math.max(invoice.grandTotal.toNumber() - nextAmountPaid, 0);
      const nextStatus = nextAmountDue <= 0.01 ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL;

      const payment = await tx.payment.create({
        data: {
          tenantId,
          invoiceId: input.invoiceId,
          amount: input.amount,
          paymentMethodId: paymentMethod.id,
          mode: input.mode ?? legacyMode(paymentMethod.type),
          createdBy,
          cashierId: createdBy,
          ...(input.referenceNumber ? { referenceNumber: input.referenceNumber } : {}),
          ...(input.razorpayId ? { razorpayId: input.razorpayId } : {}),
        },
      });

      const updatedInvoice = await tx.invoice.update({
        where: {
          id: input.invoiceId,
        },
        data: {
          amountPaid: nextAmountPaid,
          amountDue: nextAmountDue,
          status: nextStatus,
          paymentMode: input.mode ?? legacyMode(paymentMethod.type),
          paymentMethodId: paymentMethod.id,
        },
      });

      return {
        payment,
        invoice: updatedInvoice,
      };
    });
  }

  async listPayments(tenantId: string, query: PaymentListQuery) {
    return this.prisma.payment.findMany({
      where: {
        tenantId,
        ...(query.from || query.to
          ? {
              recordedAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
      },
      include: {
        invoice: true,
        paymentMethod: true,
      },
      orderBy: {
        recordedAt: "desc",
      },
    });
  }

  findInvoiceForPaymentLink(tenantId: string, invoiceId: string) {
    return this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        tenantId,
      },
      include: {
        customer: true,
      },
    });
  }

  findInvoiceByPaymentLinkId(tenantId: string, paymentLinkId: string) {
    return this.prisma.invoice.findFirst({
      where: {
        tenantId,
        paymentLinkId,
      },
      include: {
        customer: true,
      },
    });
  }

  findCustomer(tenantId: string, customerId: string) {
    return this.prisma.customer.findFirst({
      where: {
        id: customerId,
        tenantId,
      },
    });
  }

  updateInvoicePaymentLinkId(tenantId: string, invoiceId: string, paymentLinkId: string) {
    return this.prisma.invoice.updateMany({
      where: {
        id: invoiceId,
        tenantId,
      },
      data: {
        paymentLinkId,
      },
    });
  }
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

function legacyMode(type: PaymentMethodType) {
  if (type === PaymentMethodType.UPI) return PaymentMode.UPI;
  if (type === PaymentMethodType.CARD) return PaymentMode.CARD;
  if (type === PaymentMethodType.CREDIT) return PaymentMode.CREDIT;
  return PaymentMode.CASH;
}
