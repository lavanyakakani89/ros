import type { FastifyPluginCallback, FastifyReply } from "fastify";

import {
  createCustomerSchema,
  customerIdParamsSchema,
  customerListQuerySchema,
  updateCustomerSchema,
} from "./customers.schema.js";
import { CustomersError, CustomersService } from "./customers.service.js";

export const customersRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new CustomersService(fastify);

  fastify.get("/api/customers", async (request, reply) => {
    const query = customerListQuerySchema.parse(request.query);
    return handleCustomers(reply, () => Promise.resolve(service.listCustomers(request.tenant, query)));
  });

  fastify.post("/api/customers", async (request, reply) => {
    const input = createCustomerSchema.parse(request.body);
    return handleCustomers(reply, () => service.createCustomer(request.tenant, input));
  });

  fastify.get("/api/customers/:id", async (request, reply) => {
    const params = customerIdParamsSchema.parse(request.params);
    return handleCustomers(reply, () => service.getCustomer(request.tenant, params.id));
  });

  fastify.put("/api/customers/:id", async (request, reply) => {
    const params = customerIdParamsSchema.parse(request.params);
    const input = updateCustomerSchema.parse(request.body);
    return handleCustomers(reply, () => service.updateCustomer(request.tenant, params.id, input));
  });

  done();
};

async function handleCustomers<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof CustomersError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    throw error;
  }
}
