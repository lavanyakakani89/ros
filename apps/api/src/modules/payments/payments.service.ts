import { createHmac } from "node:crypto";

import { PaymentMode, type Tenant, type UserRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import Razorpay from "razorpay";

import { PaymentsRepository } from "./payments.repository.js";
import type { PaymentListQuery, RazorpayOrderInput, RazorpayVerifyInput, RecordPaymentInput } from "./payments.types.js";

interface RazorpayWebhookInput {
  rawBody: string;
  signature: string | undefined;
  event: unknown;
}

export class PaymentsError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export class PaymentsService {
  private readonly repository: PaymentsRepository;

  constructor(fastify: FastifyInstance) {
    this.repository = new PaymentsRepository(fastify.prisma);
  }

  async recordPayment(tenant: Tenant, user: { userId: string; role: UserRole }, input: RecordPaymentInput) {
    try {
      const result = await this.repository.recordPayment(tenant.id, user.userId, input);
      if (!result) {
        throw new PaymentsError("Confirmed invoice not found", 404);
      }

      return result;
    } catch (error) {
      if (error instanceof PaymentsError) {
        throw error;
      }

      throw new PaymentsError(error instanceof Error ? error.message : "Unable to record payment", 409);
    }
  }

  listPayments(tenant: Tenant, query: PaymentListQuery) {
    return this.repository.listPayments(tenant.id, query);
  }

  async createRazorpayOrder(tenant: Tenant, input: RazorpayOrderInput) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      throw new PaymentsError("Razorpay credentials are not configured", 501);
    }

    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    return razorpay.orders.create({
      amount: Math.round(input.amount * 100),
      currency: "INR",
      ...(input.receipt ? { receipt: input.receipt } : {}),
      notes: {
        tenantId: tenant.id,
        ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
      },
    });
  }

  verifyRazorpayPayment(input: RazorpayVerifyInput) {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? process.env.RAZORPAY_KEY_SECRET;

    if (!webhookSecret) {
      throw new PaymentsError("Razorpay webhook secret is not configured", 501);
    }

    const expectedSignature = createHmac("sha256", webhookSecret)
      .update(`${input.orderId}|${input.paymentId}`)
      .digest("hex");

    return {
      verified: expectedSignature === input.signature,
    };
  }

  async handleRazorpayWebhook(input: RazorpayWebhookInput) {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      throw new PaymentsError("Razorpay webhook secret is not configured", 501);
    }

    if (!input.signature) {
      throw new PaymentsError("Missing Razorpay signature", 400);
    }

    const expectedSignature = createHmac("sha256", webhookSecret).update(input.rawBody).digest("hex");
    if (expectedSignature !== input.signature) {
      throw new PaymentsError("Invalid Razorpay webhook signature", 400);
    }

    const eventName = readEventName(input.event);
    if (eventName !== "payment.captured") {
      return {
        received: true,
        event: eventName,
      };
    }

    const payment = readRazorpayPayment(input.event);
    if (!payment?.id || !payment.invoiceId || !payment.tenantId || !payment.amount) {
      throw new PaymentsError("Razorpay webhook missing invoice payment metadata", 400);
    }

    await this.repository.setTenantContext(payment.tenantId);
    const existingPayment = await this.repository.findByRazorpayId(payment.tenantId, payment.id);
    if (existingPayment) {
      return {
        received: true,
        event: eventName,
        duplicate: true,
      };
    }

    const result = await this.repository.recordPayment(payment.tenantId, "razorpay-webhook", {
      invoiceId: payment.invoiceId,
      amount: payment.amount,
      mode: mapRazorpayMethod(payment.method),
      referenceNumber: payment.referenceNumber,
      razorpayId: payment.id,
    });

    if (!result) {
      throw new PaymentsError("Confirmed invoice not found for Razorpay payment", 404);
    }

    return {
      received: true,
      event: eventName,
      payment: result.payment,
      invoice: result.invoice,
    };
  }
}

function readEventName(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null || !("event" in event)) {
    return undefined;
  }

  const eventName = event.event;
  return typeof eventName === "string" ? eventName : undefined;
}

function readRazorpayPayment(event: unknown): { id?: string; tenantId?: string; invoiceId?: string; amount?: number; method?: string; referenceNumber?: string } | undefined {
  const eventRecord = asRecord(event);
  const payload = asRecord(eventRecord?.payload);
  const paymentContainer = asRecord(payload?.payment);
  const entity = asRecord(paymentContainer?.entity);
  if (!entity) {
    return undefined;
  }

  const notes = asRecord(entity.notes);
  const amountPaise = typeof entity.amount === "number" ? entity.amount : Number(entity.amount);
  const id = typeof entity.id === "string" ? entity.id : undefined;
  const method = typeof entity.method === "string" ? entity.method : undefined;
  const tenantId = readString(notes, "tenantId") ?? readString(notes, "tenant_id");
  const invoiceId = readString(notes, "invoiceId") ?? readString(notes, "invoice_id");
  const referenceNumber = typeof entity.acquirer_data === "object" && entity.acquirer_data !== null
    ? Object.values(entity.acquirer_data as Record<string, unknown>).find((value): value is string => typeof value === "string")
    : id;

  return {
    ...(id ? { id } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(invoiceId ? { invoiceId } : {}),
    ...(Number.isFinite(amountPaise) ? { amount: amountPaise / 100 } : {}),
    ...(method ? { method } : {}),
    ...(referenceNumber ? { referenceNumber } : {}),
  };
}

function mapRazorpayMethod(method: string | undefined): PaymentMode {
  if (method === "card") return PaymentMode.CARD;
  if (method === "netbanking") return PaymentMode.NETBANKING;
  if (method === "upi") return PaymentMode.UPI;
  return PaymentMode.UPI;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}
