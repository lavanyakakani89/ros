import { randomUUID } from "node:crypto";

import { DeliveryProofType, UserRole } from "@prisma/client";
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";

import {
  assignDeliverySchema,
  createDeliveryProofFieldsSchema,
  createDeliverySchema,
  deliveryAgentParamsSchema,
  deliveryIdParamsSchema,
  deliveryInvoiceParamsSchema,
  deliveryListQuerySchema,
  deliveryProofParamsSchema,
  notificationIdParamsSchema,
  syncInvoiceDeliverySchema,
  updateDeliveryStatusSchema,
  updateMyLocationSchema,
} from "./delivery.schema.js";
import { DeliveryError, DeliveryService, type DeliveryActor } from "./delivery.service.js";

const DELIVERY_PROOF_MAX_BYTES = 300 * 1024;

export const deliveryRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new DeliveryService(fastify);

  fastify.post("/api/delivery", async (request, reply) => {
    const input = createDeliverySchema.parse(request.body);
    return handleDelivery(reply, () => service.createDelivery(request.tenant, input));
  });

  fastify.get("/api/delivery", async (request, reply) => {
    const query = deliveryListQuerySchema.parse(request.query);
    return handleDelivery(reply, () => Promise.resolve(service.listDeliveries(request.tenant, query)));
  });

  fastify.get("/api/delivery/me", async (request, reply) => {
    return handleDelivery(reply, () => Promise.resolve(service.listMyDeliveries(request.tenant, getActor(request))));
  });

  fastify.get("/api/delivery/me/notifications", async (request, reply) => {
    return handleDelivery(reply, () => Promise.resolve(service.listMyNotifications(request.tenant, getActor(request))));
  });

  fastify.get("/api/delivery/me/depot", async (request, reply) => {
    return handleDelivery(reply, () => Promise.resolve(service.getMyDepot(request.tenant)));
  });

  fastify.post("/api/delivery/me/location", async (request, reply) => {
    const input = updateMyLocationSchema.parse(request.body);
    return handleDelivery(reply, () => service.updateMyLocation(request.tenant, getActor(request), input));
  });

  fastify.put("/api/delivery/invoice/:invoiceId", async (request, reply) => {
    const params = deliveryInvoiceParamsSchema.parse(request.params);
    const input = syncInvoiceDeliverySchema.parse(request.body);
    return handleDelivery(reply, () => service.syncInvoiceDelivery(request.tenant, { invoiceId: params.invoiceId, ...input }));
  });

  fastify.post("/api/delivery/notifications/:id/read", async (request, reply) => {
    const params = notificationIdParamsSchema.parse(request.params);
    return handleDelivery(reply, () => service.markNotificationRead(request.tenant, getActor(request), params.id));
  });

  fastify.post("/api/delivery/:id/assign", async (request, reply) => {
    const params = deliveryIdParamsSchema.parse(request.params);
    const input = assignDeliverySchema.parse(request.body);
    return handleDelivery(reply, () => service.assignDelivery(request.tenant, params.id, input));
  });

  fastify.put("/api/delivery/:id/status", async (request, reply) => {
    const params = deliveryIdParamsSchema.parse(request.params);
    const input = updateDeliveryStatusSchema.parse(request.body);
    return handleDelivery(reply, () => service.updateStatus(request.tenant, params.id, input, getActor(request)));
  });

  fastify.post("/api/delivery/:id/proofs", async (request, reply) => {
    const params = deliveryIdParamsSchema.parse(request.params);
    return handleDelivery(reply, async () => {
      const file = await request.file();
      if (!file) {
        throw new DeliveryError("Proof image file is required", 400);
      }

      const fields = createDeliveryProofFieldsSchema.parse({
        proofType: readMultipartField(file.fields, "proofType") || DeliveryProofType.DELIVERY_PHOTO,
        notes: readMultipartField(file.fields, "notes") || undefined,
        latitude: readMultipartField(file.fields, "latitude") || undefined,
        longitude: readMultipartField(file.fields, "longitude") || undefined,
      });

      if (!file.mimetype.startsWith("image/")) {
        throw new DeliveryError("Only image proof files are allowed", 400);
      }

      await service.ensureProofSlotAvailable(request.tenant.id, params.id, fields.proofType);

      const buffer = await file.toBuffer();
      if (buffer.length > DELIVERY_PROOF_MAX_BYTES) {
        throw new DeliveryError("Proof image is too large. Upload a compressed image under 300 KB.", 413);
      }

      const objectName = `delivery-proofs/${request.tenant.id}/${params.id}/${Date.now().toString()}-${randomUUID()}-${sanitizeFileName(file.filename)}`;
      await fastify.minio.putObject(fastify.minioBucket, objectName, buffer, buffer.length, {
        "Content-Type": file.mimetype,
      });

      return service.createProof(request.tenant, getActor(request), {
        deliveryId: params.id,
        uploadedBy: getActor(request).userId,
        proofType: fields.proofType,
        objectName,
        fileName: file.filename,
        mimeType: file.mimetype,
        sizeBytes: buffer.length,
        ...(fields.notes ? { notes: fields.notes } : {}),
        ...(fields.latitude !== undefined ? { latitude: fields.latitude } : {}),
        ...(fields.longitude !== undefined ? { longitude: fields.longitude } : {}),
      });
    });
  });

  fastify.get("/api/delivery/:id/proofs/:proofId/view", async (request, reply) => {
    const params = deliveryProofParamsSchema.parse(request.params);
    return handleDelivery(reply, async () => {
      const proof = await service.getProof(request.tenant, params.id, params.proofId, getActor(request));
      const stream = await fastify.minio.getObject(fastify.minioBucket, proof.objectName);
      reply
        .header("Content-Type", proof.mimeType)
        .header("Content-Disposition", `inline; filename="${proof.fileName}"`)
        .header("Cache-Control", "private, max-age=300");
      return reply.send(stream);
    });
  });

  fastify.get("/api/delivery/agent/:userId", async (request, reply) => {
    const params = deliveryAgentParamsSchema.parse(request.params);
    return handleDelivery(reply, () => Promise.resolve(service.listAgentDeliveries(request.tenant, params.userId)));
  });

  done();
};

function getActor(request: FastifyRequest): DeliveryActor {
  const user = request.user as { userId?: string; role?: UserRole } | undefined;
  return {
    userId: user?.userId ?? "",
    role: user?.role ?? UserRole.STAFF,
  };
}

function readMultipartField(fields: Record<string, unknown>, name: string): string | undefined {
  const field = fields[name];
  if (!field || typeof field !== "object" || !("value" in field)) {
    return undefined;
  }

  const value = (field as { value?: unknown }).value;
  return typeof value === "string" ? value : undefined;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "proof.jpg";
}

async function handleDelivery<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof DeliveryError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    throw error;
  }
}
