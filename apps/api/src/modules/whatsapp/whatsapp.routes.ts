import { createHmac, timingSafeEqual } from "node:crypto";

import { WhatsappIntegrationStatus } from "@prisma/client";
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { WhatsappIntegrationError, WhatsappService, type InboundWhatsappMessage } from "./whatsapp.service.js";
import {
  whatsappEmbeddedSignupCompleteSchema,
  whatsappMessageTemplatesSchema,
  whatsappOrderIdParamsSchema,
  whatsappOrderItemsSchema,
  whatsappOrdersQuerySchema,
  whatsappPasteOrderSchema,
  whatsappTenantParamsSchema,
  whatsappTestMessageSchema,
  whatsappWebhookQuerySchema,
} from "./whatsapp.schema.js";
import { whatsappInboundQueue } from "../../jobs/whatsapp-inbound.job.js";

export const whatsappRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new WhatsappService(fastify);

  fastify.get("/api/public/whatsapp/inbound", async (request, reply) => {
    return verifyWebhookHandshake(request, reply);
  });

  fastify.get("/api/whatsapp/webhook", async (request, reply) => {
    return verifyWebhookHandshake(request, reply);
  });

  fastify.get("/api/public/whatsapp/:tenantSlug/inbound", async (request, reply) => {
    return verifyWebhookHandshake(request, reply);
  });

  fastify.post("/api/public/whatsapp/inbound", async (request, reply) => {
    return handleWhatsapp(reply, async () => {
      verifyWebhookSignature(request);
      const phoneNumberId = extractPhoneNumberId(request.body);
      if (!phoneNumberId) {
        throw new WhatsappIntegrationError("WhatsApp webhook payload did not include phone_number_id", 400);
      }

      const integration = await fastify.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.public_whatsapp_webhook', 'true', TRUE)`;
        return tx.whatsappIntegration.findFirst({
          where: {
            phoneNumberId,
            status: {
              in: [WhatsappIntegrationStatus.CONNECTED, WhatsappIntegrationStatus.ERROR],
            },
          },
        });
      });

      if (!integration) {
        throw new WhatsappIntegrationError("No BizBil shop is connected to this WhatsApp phone number", 404);
      }

      const tenant = await fastify.prisma.tenant.findUnique({
        where: {
          id: integration.tenantId,
        },
      });
      if (!tenant) {
        throw new WhatsappIntegrationError("Connected WhatsApp shop was not found", 404);
      }

      await fastify.prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, FALSE)`;

      return queueInboundPayload(tenant, request.body);
    });
  });

  fastify.post("/api/public/whatsapp/:tenantSlug/inbound", async (request, reply) => {
    return handleWhatsapp(reply, async () => {
      verifyWebhookSignature(request);
      const params = whatsappTenantParamsSchema.parse(request.params);
      const tenant = await fastify.prisma.tenant.findUnique({
        where: {
          slug: params.tenantSlug,
        },
      });

      if (!tenant) {
        throw new WhatsappIntegrationError("Shop not found for WhatsApp webhook", 404);
      }

      await fastify.prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, FALSE)`;

      return queueInboundPayload(tenant, request.body);
    });
  });

  fastify.post("/api/whatsapp/webhook", async (request, reply) => {
    return handleWhatsapp(reply, async () => {
      verifyWebhookSignature(request);
      const phoneNumberId = extractPhoneNumberId(request.body);
      if (!phoneNumberId) {
        throw new WhatsappIntegrationError("WhatsApp webhook payload did not include phone_number_id", 400);
      }

      const integration = await fastify.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.public_whatsapp_webhook', 'true', TRUE)`;
        return tx.whatsappIntegration.findFirst({
          where: {
            phoneNumberId,
            status: {
              in: [WhatsappIntegrationStatus.CONNECTED, WhatsappIntegrationStatus.ERROR],
            },
          },
        });
      });

      if (!integration) {
        throw new WhatsappIntegrationError("No BizBil shop is connected to this WhatsApp phone number", 404);
      }

      const tenant = await fastify.prisma.tenant.findUnique({
        where: {
          id: integration.tenantId,
        },
      });
      if (!tenant) {
        throw new WhatsappIntegrationError("Connected WhatsApp shop was not found", 404);
      }

      await fastify.prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, FALSE)`;
      return queueInboundPayload(tenant, request.body);
    });
  });

  fastify.get("/api/whatsapp/integration", async (request) => {
    return service.getIntegration(request.tenant);
  });

  fastify.get("/api/whatsapp/embedded-signup/config", (request) => {
    return service.getEmbeddedSignupConfig(request.tenant);
  });

  fastify.get("/api/whatsapp/message-templates", async (request, reply) => {
    return handleWhatsapp(reply, () => service.getMessageTemplates(request.tenant));
  });

  fastify.put("/api/whatsapp/message-templates", async (request, reply) => {
    const input = whatsappMessageTemplatesSchema.parse(request.body);
    return handleWhatsapp(reply, () => service.updateMessageTemplates(request.tenant, request.user, input));
  });

  fastify.post("/api/whatsapp/embedded-signup/complete", async (request, reply) => {
    const input = whatsappEmbeddedSignupCompleteSchema.parse(request.body);
    return handleWhatsapp(reply, () => service.completeEmbeddedSignup(request.tenant, request.user, input));
  });

  fastify.post("/api/whatsapp/integration/disconnect", async (request, reply) => {
    return handleWhatsapp(reply, () => service.disconnectIntegration(request.tenant, request.user));
  });

  fastify.post("/api/whatsapp/integration/test", async (request, reply) => {
    const input = whatsappTestMessageSchema.parse(request.body);
    return handleWhatsapp(reply, () => service.sendTestMessage(request.tenant, request.user, input));
  });

  fastify.get("/api/whatsapp/orders", async (request, reply) => {
    const query = whatsappOrdersQuerySchema.parse(request.query);
    return handleWhatsapp(reply, () => service.listOrders(request.tenant, query));
  });

  fastify.get("/api/whatsapp/orders/:id", async (request, reply) => {
    return handleWhatsapp(reply, () => {
      const { id } = whatsappOrderIdParamsSchema.parse(request.params);
      return service.getOrder(request.tenant, id);
    });
  });

  fastify.put("/api/whatsapp/orders/:id/items", async (request, reply) => {
    return handleWhatsapp(reply, async () => {
      const { id } = whatsappOrderIdParamsSchema.parse(request.params);
      const input = whatsappOrderItemsSchema.parse(request.body);
      const order = await service.updateOrderItems(request.tenant, request.user, id, input);
      await fastify.prisma.auditLog.create({
        data: {
          tenantId: request.tenant.id,
          userId: request.user.userId,
          action: "WHATSAPP_ORDER_ITEMS_UPDATED",
          entity: "WHATSAPP_ORDER",
          entityId: id,
          changes: input,
          ip: request.ip,
        },
      });

      return order;
    });
  });

  fastify.post("/api/whatsapp/orders/:id/confirm", async (request, reply) => {
    return handleWhatsapp(reply, async () => {
      const { id } = whatsappOrderIdParamsSchema.parse(request.params);
      const order = await service.confirmOrder(request.tenant, request.user, id);
      await fastify.prisma.auditLog.create({
        data: {
          tenantId: request.tenant.id,
          userId: request.user.userId,
          action: "WHATSAPP_ORDER_CONFIRMED",
          entity: "WHATSAPP_ORDER",
          entityId: id,
          changes: {
            invoiceId: order.invoice?.id ?? null,
            itemCount: order.summary.itemCount,
            grandTotal: order.summary.grandTotal,
          },
          ip: request.ip,
        },
      });

      return order;
    });
  });

  fastify.post("/api/whatsapp/orders/:id/dismiss", async (request, reply) => {
    return handleWhatsapp(reply, async () => {
      const { id } = whatsappOrderIdParamsSchema.parse(request.params);
      const order = await service.dismissOrder(request.tenant, request.user, id);
      await fastify.prisma.auditLog.create({
        data: {
          tenantId: request.tenant.id,
          userId: request.user.userId,
          action: "WHATSAPP_ORDER_DISMISSED",
          entity: "WHATSAPP_ORDER",
          entityId: id,
          changes: {
            status: order.status,
          },
          ip: request.ip,
        },
      });

      return order;
    });
  });

  fastify.post("/api/whatsapp/orders/paste", async (request, reply) => {
    const input = whatsappPasteOrderSchema.parse(request.body);
    return handleWhatsapp(reply, () => service.createManualPastedOrder(request.tenant, input));
  });

  done();
};

function verifyWebhookHandshake(request: FastifyRequest, reply: FastifyReply) {
  const query = whatsappWebhookQuerySchema.parse(request.query);
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? process.env.WHATSAPP_WEBHOOK_SECRET;

  if (query["hub.mode"] === "subscribe" && verifyToken && query["hub.verify_token"] === verifyToken && query["hub.challenge"]) {
    return reply.type("text/plain").send(query["hub.challenge"]);
  }

  return reply.status(403).send({ error: "WhatsApp webhook verification failed" });
}

async function queueInboundPayload(tenant: Parameters<WhatsappService["handleInboundMessage"]>[0], payload: unknown) {
  const inboundMessages = extractInboundMessages(payload);
  if (inboundMessages.length === 0) {
    return {
      status: "ignored",
      reason: "No supported text messages in payload",
    };
  }

  const jobIds: string[] = [];
  for (const inboundMessage of inboundMessages) {
    const job = await whatsappInboundQueue.add("inbound-message", {
      tenantId: tenant.id,
      message: inboundMessage,
    }, {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1_000,
      },
    });
    if (job.id) {
      jobIds.push(job.id);
    }
  }

  return {
    status: "queued",
    count: inboundMessages.length,
    jobIds,
  };
}

function verifyWebhookSignature(request: FastifyRequest): void {
  const appSecret = process.env.WHATSAPP_WEBHOOK_APP_SECRET ?? process.env.WHATSAPP_EMBEDDED_APP_SECRET;
  const sharedSecret = process.env.WHATSAPP_WEBHOOK_SECRET;

  if (appSecret) {
    const signature = String(request.headers["x-hub-signature-256"] ?? "");
    const expected = `sha256=${createHmac("sha256", appSecret).update(request.rawBody ?? "").digest("hex")}`;
    if (!safeEqual(signature, expected)) {
      throw new WhatsappIntegrationError("Invalid WhatsApp webhook signature", 401);
    }

    return;
  }

  if (sharedSecret) {
    const headerSecret = String(request.headers["x-bizbil-whatsapp-secret"] ?? "");
    const querySecret = typeof request.query === "object" && request.query ? stringValue((request.query as Record<string, unknown>).secret) : "";
    if (headerSecret !== sharedSecret && querySecret !== sharedSecret) {
      throw new WhatsappIntegrationError("Invalid WhatsApp webhook secret", 401);
    }

    return;
  }

  throw new WhatsappIntegrationError("WhatsApp webhook secret is not configured", 503);
}

function extractInboundMessages(payload: unknown): InboundWhatsappMessage[] {
  const direct = extractDirectInboundMessage(payload);
  if (direct) {
    return [direct];
  }

  const root = toRecord(payload);
  const entries = toArray(root.entry);
  const messages: InboundWhatsappMessage[] = [];

  for (const entry of entries) {
    const changes = toArray(toRecord(entry).changes);
    for (const change of changes) {
      const value = toRecord(toRecord(change).value);
      const contacts = toArray(value.contacts);
      const contactByPhone = new Map<string, string>();
      for (const contact of contacts) {
        const contactRecord = toRecord(contact);
        const profile = toRecord(contactRecord.profile);
        const phone = stringValue(contactRecord.wa_id);
        const name = stringValue(profile.name);
        if (phone && name) {
          contactByPhone.set(phone, name);
        }
      }

      for (const message of toArray(value.messages)) {
        const messageRecord = toRecord(message);
        const messageType = stringValue(messageRecord.type, "text");
        const from = stringValue(messageRecord.from);
        const body = messageType === "text" ? stringValue(toRecord(messageRecord.text).body) : "";
        if (!from || !body.trim()) {
          continue;
        }

        messages.push({
          provider: "whatsapp-cloud",
          externalMessageId: stringValue(messageRecord.id) || undefined,
          phone: from,
          customerName: contactByPhone.get(from),
          body,
          messageType,
          receivedAt: parseWhatsappTimestamp(messageRecord.timestamp),
          payload: messageRecord,
        });
      }
    }
  }

  return messages;
}

function extractPhoneNumberId(payload: unknown): string | null {
  const root = toRecord(payload);
  for (const entry of toArray(root.entry)) {
    const changes = toArray(toRecord(entry).changes);
    for (const change of changes) {
      const metadata = toRecord(toRecord(toRecord(change).value).metadata);
      const phoneNumberId = stringValue(metadata.phone_number_id);
      if (phoneNumberId) {
        return phoneNumberId;
      }
    }
  }

  return null;
}

function extractDirectInboundMessage(payload: unknown): InboundWhatsappMessage | null {
  const record = toRecord(payload);
  const phone = stringValue(record.phone) || stringValue(record.from);
  const body = stringValue(record.text) || stringValue(record.body) || stringValue(record.message);
  if (!phone || !body.trim()) {
    return null;
  }

  return {
    provider: stringValue(record.provider, "manual-webhook"),
    externalMessageId: typeof record.messageId === "string" ? record.messageId : undefined,
    phone,
    customerName: typeof record.name === "string" ? record.name : undefined,
    body,
    messageType: "text",
    receivedAt: new Date(),
    payload,
  };
}

function parseWhatsappTimestamp(value: unknown): Date | undefined {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }

  return new Date(seconds * 1000);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return fallback;
}

async function handleWhatsapp<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof WhatsappIntegrationError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: "Validation failed", issues: error.flatten() });
    }

    throw error;
  }
}
