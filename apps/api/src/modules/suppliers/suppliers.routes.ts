import type { FastifyPluginCallback, FastifyReply } from "fastify";

import { createSupplierSchema, supplierIdParamsSchema, supplierListQuerySchema, updateSupplierSchema } from "./suppliers.schema.js";
import { SuppliersError, SuppliersService } from "./suppliers.service.js";

export const suppliersRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new SuppliersService(fastify);

  fastify.get("/api/suppliers", async (request, reply) => {
    const query = supplierListQuerySchema.parse(request.query);
    return handleSuppliers(reply, () => Promise.resolve(service.listSuppliers(request.tenant, query)));
  });

  fastify.post("/api/suppliers", async (request, reply) => {
    const input = createSupplierSchema.parse(request.body);
    return handleSuppliers(reply, () => Promise.resolve(service.createSupplier(request.tenant, input)));
  });

  fastify.get("/api/suppliers/:id", async (request, reply) => {
    const params = supplierIdParamsSchema.parse(request.params);
    return handleSuppliers(reply, () => service.getSupplier(request.tenant, params.id));
  });

  fastify.put("/api/suppliers/:id", async (request, reply) => {
    const params = supplierIdParamsSchema.parse(request.params);
    const input = updateSupplierSchema.parse(request.body);
    return handleSuppliers(reply, () => service.updateSupplier(request.tenant, params.id, input));
  });

  done();
};

async function handleSuppliers<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof SuppliersError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    throw error;
  }
}
