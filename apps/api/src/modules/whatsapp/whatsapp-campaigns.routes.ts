import { UserRole, type PrismaClient } from "@prisma/client";
import type { FastifyPluginCallback, FastifyReply } from "fastify";
import { z } from "zod";

import { whatsappCampaignQueue } from "../../jobs/whatsapp-campaign.job.js";
import { normalizeWhatsappPhone } from "./whatsapp.notifications.js";

export class WhatsappCampaignError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

const campaignTargetType = z.enum(["ALL", "TAG", "OUTSTANDING", "LOYALTY_TIER"]);
const campaignStatus = z.enum(["DRAFT", "SENDING", "COMPLETED", "CANCELLED"]);
const createCampaignSchema = z.object({
  name: z.string().trim().min(1),
  message: z.string().trim().min(1).max(4096),
  targetType: campaignTargetType.default("ALL"),
  targetValue: z.string().trim().optional(),
  scheduledAt: z.coerce.date().optional(),
});
const listCampaignsSchema = z.object({
  status: campaignStatus.optional(),
});
const campaignIdParamsSchema = z.object({
  id: z.string().min(1),
});
const audienceCountSchema = z.object({
  targetType: campaignTargetType.default("ALL"),
  targetValue: z.string().trim().optional(),
});

export const whatsappCampaignsRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/whatsapp/campaigns", async (request, reply) => handleCampaign(reply, async () => {
    const query = listCampaignsSchema.parse(request.query);
    return fastify.prisma.whatsappCampaign.findMany({
      where: {
        tenantId: request.tenant.id,
        ...(query.status ? { status: query.status } : {}),
      },
      include: {
        _count: {
          select: {
            recipients: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }));

  fastify.get("/api/whatsapp/campaigns/audience-count", async (request, reply) => handleCampaign(reply, async () => {
    const query = audienceCountSchema.parse(request.query);
    const customers = await findCampaignAudience(fastify.prisma, request.tenant.id, query.targetType, query.targetValue);
    return { count: customers.length };
  }));

  fastify.post("/api/whatsapp/campaigns", async (request, reply) => handleCampaign(reply, async () => {
    ensureCampaignManager(request.user.role);
    const input = createCampaignSchema.parse(request.body);
    ensureTargetValue(input.targetType, input.targetValue);
    const campaign = await fastify.prisma.whatsappCampaign.create({
      data: {
        tenantId: request.tenant.id,
        name: input.name,
        message: input.message,
        targetType: input.targetType,
        targetValue: input.targetValue ?? null,
        scheduledAt: input.scheduledAt ?? null,
        createdBy: request.user.userId,
      },
    });
    await fastify.prisma.auditLog.create({
      data: {
        tenantId: request.tenant.id,
        userId: request.user.userId,
        action: "WHATSAPP_CAMPAIGN_CREATED",
        entity: "WHATSAPP_CAMPAIGN",
        entityId: campaign.id,
        changes: input,
        ip: request.ip,
      },
    });

    return campaign;
  }));

  fastify.get("/api/whatsapp/campaigns/:id", async (request, reply) => handleCampaign(reply, async () => {
    const { id } = campaignIdParamsSchema.parse(request.params);
    const campaign = await fastify.prisma.whatsappCampaign.findFirst({
      where: { id, tenantId: request.tenant.id },
      include: {
        recipients: {
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!campaign) {
      throw new WhatsappCampaignError("Campaign not found", 404);
    }

    return campaign;
  }));

  fastify.post("/api/whatsapp/campaigns/:id/send", async (request, reply) => handleCampaign(reply, async () => {
    ensureCampaignManager(request.user.role);
    const { id } = campaignIdParamsSchema.parse(request.params);
    const campaign = await fastify.prisma.whatsappCampaign.findFirst({
      where: { id, tenantId: request.tenant.id },
    });
    if (!campaign) {
      throw new WhatsappCampaignError("Campaign not found", 404);
    }
    if (!["DRAFT", "SENDING"].includes(campaign.status)) {
      throw new WhatsappCampaignError("Only draft or sending campaigns can be sent", 409);
    }

    const customers = await findCampaignAudience(fastify.prisma, request.tenant.id, campaign.targetType, campaign.targetValue);
    await fastify.prisma.whatsappCampaignRecipient.createMany({
      data: customers.map((customer) => ({
        tenantId: request.tenant.id,
        campaignId: campaign.id,
        customerId: customer.id,
        customerName: customer.name,
        phone: normalizeWhatsappPhone(customer.phone),
      })),
      skipDuplicates: true,
    });

    const recipients = await fastify.prisma.whatsappCampaignRecipient.findMany({
      where: {
        tenantId: request.tenant.id,
        campaignId: campaign.id,
        status: {
          in: ["QUEUED", "FAILED"],
        },
      },
    });

    if (recipients.length === 0) {
      return fastify.prisma.whatsappCampaign.update({
        where: { id: campaign.id },
        data: {
          status: "COMPLETED",
          startedAt: campaign.startedAt ?? new Date(),
          completedAt: new Date(),
        },
      });
    }

    const updatedCampaign = await fastify.prisma.whatsappCampaign.update({
      where: { id: campaign.id },
      data: {
        status: "SENDING",
        startedAt: campaign.startedAt ?? new Date(),
        completedAt: null,
      },
    });
    for (const recipient of recipients) {
      await whatsappCampaignQueue.add("send-campaign-message", {
        tenantId: request.tenant.id,
        campaignId: campaign.id,
        recipientId: recipient.id,
      });
    }

    await fastify.prisma.auditLog.create({
      data: {
        tenantId: request.tenant.id,
        userId: request.user.userId,
        action: "WHATSAPP_CAMPAIGN_SEND_STARTED",
        entity: "WHATSAPP_CAMPAIGN",
        entityId: campaign.id,
        changes: {
          recipientCount: recipients.length,
          targetType: campaign.targetType,
          targetValue: campaign.targetValue,
        },
        ip: request.ip,
      },
    });

    return { ...updatedCampaign, queuedRecipients: recipients.length };
  }));

  fastify.post("/api/whatsapp/campaigns/:id/cancel", async (request, reply) => handleCampaign(reply, async () => {
    ensureCampaignManager(request.user.role);
    const { id } = campaignIdParamsSchema.parse(request.params);
    const campaign = await fastify.prisma.whatsappCampaign.findFirst({
      where: { id, tenantId: request.tenant.id },
    });
    if (!campaign) {
      throw new WhatsappCampaignError("Campaign not found", 404);
    }
    if (!["DRAFT", "SENDING"].includes(campaign.status)) {
      throw new WhatsappCampaignError("Only draft or sending campaigns can be cancelled", 409);
    }

    const cancelled = await fastify.prisma.whatsappCampaign.update({
      where: { id: campaign.id },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
    await fastify.prisma.auditLog.create({
      data: {
        tenantId: request.tenant.id,
        userId: request.user.userId,
        action: "WHATSAPP_CAMPAIGN_CANCELLED",
        entity: "WHATSAPP_CAMPAIGN",
        entityId: campaign.id,
        changes: { previousStatus: campaign.status },
        ip: request.ip,
      },
    });

    return cancelled;
  }));

  done();
};

async function handleCampaign<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof WhatsappCampaignError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: "Validation failed", issues: error.flatten() });
    }

    throw error;
  }
}

function ensureCampaignManager(role: UserRole): void {
  if (role !== UserRole.OWNER && role !== UserRole.MANAGER) {
    throw new WhatsappCampaignError("Insufficient permissions", 403);
  }
}

function ensureTargetValue(targetType: z.infer<typeof campaignTargetType>, targetValue: string | undefined): void {
  if ((targetType === "TAG" || targetType === "LOYALTY_TIER") && !targetValue?.trim()) {
    throw new WhatsappCampaignError("Target value is required for this audience", 400);
  }
}

async function findCampaignAudience(
  prisma: PrismaClient,
  tenantId: string,
  targetType: string,
  targetValue: string | null | undefined,
) {
  return findCustomers(prisma, tenantId, targetType, targetValue);
}

async function findCustomers(
  prisma: PrismaClient,
  tenantId: string,
  targetType: string,
  targetValue: string | null | undefined,
) {
  const baseWhere = {
    tenantId,
    phone: {
      not: "",
    },
  };

  if (targetType === "OUTSTANDING") {
    return prisma.customer.findMany({
      where: {
        ...baseWhere,
        outstandingDue: {
          gt: 0,
        },
      },
      select: { id: true, name: true, phone: true },
    });
  }

  if (targetType === "LOYALTY_TIER" && targetValue) {
    return prisma.customer.findMany({
      where: {
        ...baseWhere,
        tier: {
          name: targetValue,
        },
      },
      select: { id: true, name: true, phone: true },
    });
  }

  if (targetType === "TAG" && targetValue) {
    return prisma.customer.findMany({
      where: {
        ...baseWhere,
        remarks: {
          contains: targetValue,
          mode: "insensitive",
        },
      },
      select: { id: true, name: true, phone: true },
    });
  }

  return prisma.customer.findMany({
    where: baseWhere,
    select: { id: true, name: true, phone: true },
  });
}
