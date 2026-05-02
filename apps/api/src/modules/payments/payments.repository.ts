import { InvoiceStatus, type PrismaClient } from "@prisma/client";

import type { PaymentListQuery, RecordPaymentInput } from "./payments.types.js";

export class PaymentsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async recordPayment(tenantId: string, createdBy: string, input: RecordPaymentInput) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: {
          id: input.invoiceId,
          tenantId,
        },
      });

      if (!invoice || invoice.status === InvoiceStatus.CANCELLED || invoice.status === InvoiceStatus.DRAFT) {
        return null;
      }

      const amountDue = invoice.amountDue.toNumber();
      if (input.amount > amountDue) {
        throw new Error("Payment amount cannot exceed invoice amount due");
      }

      const nextAmountPaid = invoice.amountPaid.toNumber() + input.amount;
      const nextAmountDue = Math.max(invoice.grandTotal.toNumber() - nextAmountPaid, 0);
      const nextStatus = nextAmountDue === 0 ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL;

      const payment = await tx.payment.create({
        data: {
          tenantId,
          invoiceId: input.invoiceId,
          amount: input.amount,
          mode: input.mode,
          createdBy,
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
          paymentMode: input.mode,
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
              paidAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
      },
      include: {
        invoice: true,
      },
      orderBy: {
        paidAt: "desc",
      },
    });
  }
}
