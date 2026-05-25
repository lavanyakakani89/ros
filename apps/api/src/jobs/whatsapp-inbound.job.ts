import { UserRole } from "@prisma/client";
import { Queue, Worker } from "bullmq";
import type { FastifyInstance } from "fastify";

import { createQueueConnection } from "./connection.js";
import { sendPushToTenant } from "../lib/push-notifications.js";
import { WhatsappService, type InboundWhatsappMessage } from "../modules/whatsapp/whatsapp.service.js";

export interface WhatsappInboundJob {
  tenantId: string;
  message: InboundWhatsappMessage;
}

export const whatsappInboundQueue = new Queue<WhatsappInboundJob>("whatsapp-inbound", {
  connection: createQueueConnection(),
});

export function createWhatsappInboundWorker(fastify: FastifyInstance) {
  const service = new WhatsappService(fastify);

  return new Worker<WhatsappInboundJob>(
    "whatsapp-inbound",
    async (job) => {
      await fastify.prisma.$executeRaw`SELECT set_config('app.tenant_id', ${job.data.tenantId}, TRUE)`;
      const tenant = await fastify.prisma.tenant.findUnique({
        where: { id: job.data.tenantId },
      });
      if (!tenant) {
        throw new Error("WhatsApp inbound tenant not found");
      }

      await service.handleInboundMessage(tenant, job.data.message);
      await sendPushToTenant(fastify.prisma, tenant.id, [UserRole.OWNER, UserRole.MANAGER], {
        title: "New WhatsApp Order",
        body: "A WhatsApp order is waiting for review",
        data: { type: "WHATSAPP_ORDER" },
      });
    },
    {
      connection: createQueueConnection(),
    },
  );
}
