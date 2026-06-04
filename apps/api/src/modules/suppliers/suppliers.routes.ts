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

  // Supplier payments (accounts payable)
  fastify.get("/api/suppliers/:id/payments", async (request, reply) => {
    const { id } = supplierIdParamsSchema.parse(request.params);
    return handleSuppliers(reply, async () => {
      const supplier = await fastify.prisma.supplier.findFirst({
        where: { tenantId: request.tenant.id, id },
        select: { id: true, name: true, phone: true },
      });
      if (!supplier) {
        throw new SuppliersError("Supplier not found", 404);
      }

      const [payments, totalPurchased] = await Promise.all([
        fastify.prisma.supplierPayment.findMany({
          where: { tenantId: request.tenant.id, supplierId: id },
          include: { purchaseOrder: { select: { poNumber: true } } },
          orderBy: { paidAt: "desc" },
        }),
        fastify.prisma.purchaseOrder.aggregate({
          where: { tenantId: request.tenant.id, supplierId: id, status: { in: ["PARTIAL", "RECEIVED"] } },
          _sum: { totalAmount: true },
        }),
      ]);
      const totalPaid = payments.reduce((s, p) => s + p.amount.toNumber(), 0);
      const totalBilled = totalPurchased._sum.totalAmount?.toNumber() ?? 0;
      return {
        supplier,
        payments,
        totalPaid,
        totalBilled,
        totalPurchased: totalBilled,
        outstanding: totalBilled - totalPaid,
        outstandingDue: totalBilled - totalPaid,
      };
    });
  });

  fastify.post("/api/suppliers/:id/payments", async (request) => {
    const { id } = supplierIdParamsSchema.parse(request.params);
    const { z } = await import("zod");
    const input = z.object({
      amount: z.coerce.number().positive(),
      mode: z.enum(["CASH", "UPI", "CARD", "NETBANKING"]).default("CASH"),
      purchaseOrderId: z.string().optional(),
      referenceNumber: z.string().optional(),
      notes: z.string().optional(),
      paidAt: z.coerce.date().default(() => new Date()),
    }).parse(request.body);

    return fastify.prisma.supplierPayment.create({
      data: {
        tenantId: request.tenant.id,
        supplierId: id,
        amount: input.amount,
        mode: input.mode,
        referenceNumber: input.referenceNumber ?? null,
        notes: input.notes ?? null,
        paidAt: input.paidAt,
        purchaseOrderId: input.purchaseOrderId ?? null,
        createdBy: request.user.userId,
      },
    });
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
