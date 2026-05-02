import { createHmac } from "node:crypto";

import type { Tenant, UserRole } from "@prisma/client";
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

  async createRazorpayOrder(input: RazorpayOrderInput) {
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

  verifyRazorpayWebhook(input: RazorpayWebhookInput) {
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

    return {
      received: true,
      event: readEventName(input.event),
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
