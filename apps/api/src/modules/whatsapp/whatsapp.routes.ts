import { createHmac, timingSafeEqual } from "node:crypto";

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";

import { WhatsappIntegrationError, WhatsappService, type InboundWhatsappMessage } from "./whatsapp.service.js";
import { whatsappOrdersQuerySchema, whatsappTenantParamsSchema, whatsappWebhookQuerySchema } from "./whatsapp.schema.js";

export const whatsappRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new WhatsappService(fastify);

  fastify.get("/api/public/whatsapp/:tenantSlug/inbound", async (request, reply) => {
    const query = whatsappWebhookQuerySchema.parse(request.query);
    const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? process.env.WHATSAPP_WEBHOOK_SECRET;

    if (query["hub.mode"] === "subscribe" && verifyToken && query["hub.verify_token"] === verifyToken && query["hub.challenge"]) {
      return reply.type("text/plain").send(query["hub.challenge"]);
    }

    return reply.status(403).send({ error: "WhatsApp webhook verification failed" });
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

      const inboundMessages = extractInboundMessages(request.body);
      if (inboundMessages.length === 0) {
        return {
          status: "ignored",
          reason: "No supported text messages in payload",
        };
      }

      const results = [];
      for (const inboundMessage of inboundMessages) {
        results.push(await service.handleInboundMessage(tenant, inboundMessage));
      }

      return {
        status: "processed",
        count: results.length,
        results,
      };
    });
  });

  fastify.get("/api/whatsapp/orders", async (request, reply) => {
    const query = whatsappOrdersQuerySchema.parse(request.query);
    return handleWhatsapp(reply, () => service.listOrders(request.tenant, query));
  });

  done();
};

function verifyWebhookSignature(request: FastifyRequest): void {
  const appSecret = process.env.WHATSAPP_WEBHOOK_APP_SECRET;
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
    const headerSecret = String(request.headers["x-retailos-whatsapp-secret"] ?? "");
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

    throw error;
  }
}
