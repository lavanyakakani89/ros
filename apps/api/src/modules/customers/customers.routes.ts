import type { FastifyPluginCallback, FastifyReply } from "fastify";

import {
  createCustomerSchema,
  customerIdParamsSchema,
  customerListQuerySchema,
  updateCustomerSchema,
} from "./customers.schema.js";
import { CustomersError, CustomersService } from "./customers.service.js";
import { importCustomers, sendCustomerExport, sendCustomerTemplate } from "../import-export/customer-import-export.js";

export const customersRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new CustomersService(fastify);

  fastify.get("/api/customers", async (request, reply) => {
    const query = customerListQuerySchema.parse(request.query);
    return handleCustomers(reply, () => service.listCustomers(request.tenant, query, request.user?.role));
  });

  fastify.get("/api/customers/template", async (_request, reply) => {
    return sendCustomerTemplate(reply);
  });

  fastify.get("/api/customers/export", async (request, reply) => {
    return sendCustomerExport(fastify, request.tenant, reply);
  });

  fastify.post("/api/customers/import", async (request, reply) => {
    return handleCustomers(reply, async () => {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ error: "Upload an Excel file." });
      }

      const buffer = await file.toBuffer();
      return importCustomers(fastify, request.tenant, buffer);
    });
  });

  fastify.post("/api/customers", async (request, reply) => {
    const input = createCustomerSchema.parse(request.body);
    return handleCustomers(reply, () => service.createCustomer(request.tenant, input, request.user?.role));
  });

  fastify.get("/api/customers/:id", async (request, reply) => {
    const params = customerIdParamsSchema.parse(request.params);
    return handleCustomers(reply, () => service.getCustomer(request.tenant, params.id, request.user?.role));
  });

  fastify.put("/api/customers/:id", async (request, reply) => {
    const params = customerIdParamsSchema.parse(request.params);
    const input = updateCustomerSchema.parse(request.body);
    return handleCustomers(reply, () => service.updateCustomer(request.tenant, params.id, input, request.user?.role));
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
