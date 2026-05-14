import { UserRole } from "@prisma/client";
import type { FastifyPluginCallback, FastifyReply } from "fastify";
import { z } from "zod";

import { changePasswordSchema, createUserSchema, updateTenantSchema, updateUserSchema, userIdParamsSchema } from "./settings.schema.js";
import { SettingsError, SettingsService } from "./settings.service.js";
import { mergeWhatsappNotificationSettings } from "../whatsapp/whatsapp.notifications.js";

export const settingsRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new SettingsService(fastify);

  fastify.get("/api/settings/current", async (request) => {
    return service.getCurrentTenant(request.tenant);
  });

  fastify.put("/api/settings/tenant", async (request, reply) => {
    const input = updateTenantSchema.parse(request.body);
    return handleSettings(reply, () => service.updateTenant(request.tenant, input));
  });

  fastify.get("/api/settings/users", async (request) => {
    return service.listUsers(request.tenant);
  });

  fastify.post("/api/settings/users", async (request, reply) => {
    const input = createUserSchema.parse(request.body);
    return handleSettings(reply, () => service.createUser(request.tenant, request.user, input));
  });

  fastify.put("/api/settings/users/:id", async (request, reply) => {
    const params = userIdParamsSchema.parse(request.params);
    const input = updateUserSchema.parse(request.body);
    return handleSettings(reply, () => service.updateUser(request.tenant, request.user, params.id, input));
  });

  fastify.put("/api/settings/password", async (request, reply) => {
    const input = changePasswordSchema.parse(request.body);
    return handleSettings(reply, () => service.changePassword(request.tenant, request.user, input));
  });

  fastify.get("/api/settings/logo/view", async (request, reply) => {
    return handleSettings(reply, async () => {
      const tenant = await fastify.prisma.tenant.findUnique({
        where: { id: request.tenant.id },
        select: { logoUrl: true },
      });

      if (!tenant?.logoUrl) {
        throw new SettingsError("Shop logo not found", 404);
      }

      const stream = await fastify.minio.getObject(fastify.minioBucket, tenant.logoUrl);
      reply.header("Cache-Control", "private, max-age=300");
      reply.type(contentTypeForObject(tenant.logoUrl));
      return reply.send(stream);
    });
  });

  fastify.post("/api/settings/logo", async (request, reply) => {
    return handleSettings(reply, async () => {
      ensureOwner(request.user.role);
      const file = await request.file();
      if (!file) {
        throw new SettingsError("Logo file is required", 400);
      }

      const contentType = file.mimetype.toLowerCase();
      if (!allowedLogoTypes.has(contentType)) {
        throw new SettingsError("Upload a JPG, PNG, or WEBP image", 400);
      }

      const buffer = await file.toBuffer();
      if (buffer.length > maxLogoBytes) {
        throw new SettingsError("Logo must be 2 MB or smaller", 400);
      }

      const extension = extensionForContentType(contentType);
      const objectName = `logos/${request.tenant.id}/logo.${extension}`;
      await fastify.minio.putObject(fastify.minioBucket, objectName, buffer, buffer.length, {
        "Content-Type": contentType,
      });

      const tenant = await fastify.prisma.tenant.update({
        where: { id: request.tenant.id },
        data: { logoUrl: objectName },
      });
      await fastify.redis.del(`tenant:${request.tenant.id}`);

      return {
        logoUrl: logoViewUrl(tenant.logoUrl),
      };
    });
  });

  fastify.delete("/api/settings/logo", async (request, reply) => {
    return handleSettings(reply, async () => {
      ensureOwner(request.user.role);
      const tenant = await fastify.prisma.tenant.findUnique({
        where: { id: request.tenant.id },
        select: { logoUrl: true },
      });

      if (tenant?.logoUrl) {
        await fastify.minio.removeObject(fastify.minioBucket, tenant.logoUrl);
      }

      await fastify.prisma.tenant.update({
        where: { id: request.tenant.id },
        data: { logoUrl: null },
      });
      await fastify.redis.del(`tenant:${request.tenant.id}`);

      return {
        logoUrl: null,
      };
    });
  });

  fastify.get("/api/settings/whatsapp-notifications", async (request, reply) => {
    return handleSettings(reply, async () => {
      ensureManager(request.user.role);
      const tenant = await fastify.prisma.tenant.findUnique({
        where: { id: request.tenant.id },
        select: { whatsappNotificationSettings: true },
      });

      return mergeWhatsappNotificationSettings(tenant?.whatsappNotificationSettings);
    });
  });

  fastify.put("/api/settings/whatsapp-notifications", async (request, reply) => {
    return handleSettings(reply, async () => {
      ensureManager(request.user.role);
      const input = whatsappNotificationSettingsSchema.parse(request.body);
      const current = await fastify.prisma.tenant.findUnique({
        where: { id: request.tenant.id },
        select: { whatsappNotificationSettings: true },
      });
      const next = {
        ...mergeWhatsappNotificationSettings(current?.whatsappNotificationSettings),
        ...input,
      };

      await fastify.prisma.tenant.update({
        where: { id: request.tenant.id },
        data: { whatsappNotificationSettings: next },
      });
      await fastify.redis.del(`tenant:${request.tenant.id}`);

      return next;
    });
  });

  done();
};

async function handleSettings<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof SettingsError) {
      return reply.status(error.statusCode).send({
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
      });
    }

    throw error;
  }
}

const maxLogoBytes = 2 * 1024 * 1024;
const allowedLogoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const whatsappNotificationSettingsSchema = z.object({
  invoiceConfirmed: z.boolean().optional(),
  deliveryAssigned: z.boolean().optional(),
  deliveryStatusUpdate: z.boolean().optional(),
  expiryAlert: z.boolean().optional(),
  paymentLink: z.boolean().optional(),
  quotationShared: z.boolean().optional(),
  creditNoteShared: z.boolean().optional(),
  birthdayGreeting: z.boolean().optional(),
  anniversaryGreeting: z.boolean().optional(),
}).strict();

function ensureOwner(role: UserRole): void {
  if (role !== UserRole.OWNER) {
    throw new SettingsError("Only owners can update the shop logo", 403);
  }
}

function ensureManager(role: UserRole): void {
  if (role !== UserRole.OWNER && role !== UserRole.MANAGER) {
    throw new SettingsError("Only owners and managers can manage WhatsApp notification settings", 403);
  }
}

function extensionForContentType(contentType: string): "jpg" | "png" | "webp" {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function contentTypeForObject(objectName: string): string {
  if (objectName.endsWith(".png")) return "image/png";
  if (objectName.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function logoViewUrl(logoUrl: string | null): string | null {
  return logoUrl ? "/api/settings/logo/view" : null;
}
