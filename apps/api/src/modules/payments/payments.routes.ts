import type { FastifyPluginCallback, FastifyReply } from "fastify";

import { PaymentsError, PaymentsService } from "./payments.service.js";
import { paymentListQuerySchema, razorpayOrderSchema, razorpayPaymentLinkParamsSchema, razorpayPaymentLinkSchema, razorpayVerifySchema, recordPaymentSchema } from "./payments.schema.js";

export const paymentsRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new PaymentsService(fastify);

  fastify.post("/api/payments", async (request, reply) => {
    const input = recordPaymentSchema.parse(request.body);
    return handlePayments(reply, () => service.recordPayment(request.tenant, request.user, input));
  });

  fastify.get("/api/payments", async (request, reply) => {
    const query = paymentListQuerySchema.parse(request.query);
    return handlePayments(reply, () => Promise.resolve(service.listPayments(request.tenant, query)));
  });

  fastify.get("/api/payments/razorpay/status", async (request, reply) => {
    return handlePayments(reply, () => service.getRazorpayStatus(request.tenant));
  });

  fastify.post("/api/payments/razorpay/order", async (request, reply) => {
    const input = razorpayOrderSchema.parse(request.body);
    return handlePayments(reply, () => service.createRazorpayOrder(request.tenant, input));
  });

  fastify.post("/api/payments/razorpay/payment-link", async (request, reply) => {
    const input = razorpayPaymentLinkSchema.parse(request.body);
    return handlePayments(reply, () => service.createRazorpayPaymentLink(request.tenant, input));
  });

  fastify.post("/api/payments/razorpay/payment-link/:linkId/share", async (request, reply) => {
    const params = razorpayPaymentLinkParamsSchema.parse(request.params);
    return handlePayments(reply, () => service.shareRazorpayPaymentLink(request.tenant, params.linkId));
  });

  fastify.post("/api/payments/razorpay/verify", async (request, reply) => {
    const input = razorpayVerifySchema.parse(request.body);
    return handlePayments(reply, () => Promise.resolve(service.verifyRazorpayPayment(input)));
  });

  fastify.post("/api/payments/razorpay/webhook", async (request, reply) => {
    const signature = request.headers["x-razorpay-signature"];
    const input = {
      rawBody: request.rawBody ?? "",
      signature: Array.isArray(signature) ? signature[0] : signature,
      event: request.body,
    };

    return handlePayments(reply, () => service.handleRazorpayWebhook(input));
  });

  done();
};

async function handlePayments<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof PaymentsError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    throw error;
  }
}
