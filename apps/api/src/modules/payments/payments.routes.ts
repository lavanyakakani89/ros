import type { FastifyPluginCallback, FastifyReply } from "fastify";

import { PaymentsError, PaymentsService } from "./payments.service.js";
import { paymentListQuerySchema, razorpayOrderSchema, razorpayVerifySchema, recordPaymentSchema } from "./payments.schema.js";

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

  fastify.post("/api/payments/razorpay/order", async (request, reply) => {
    const input = razorpayOrderSchema.parse(request.body);
    return handlePayments(reply, () => service.createRazorpayOrder(input));
  });

  fastify.post("/api/payments/razorpay/verify", async (request, reply) => {
    const input = razorpayVerifySchema.parse(request.body);
    return handlePayments(reply, () => Promise.resolve(service.verifyRazorpayPayment(input)));
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
