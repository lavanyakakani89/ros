import { PrismaClient } from "@prisma/client";
import { Queue, Worker } from "bullmq";

import { createQueueConnection } from "./connection.js";
import { sendWhatsAppMessage } from "./whatsapp-notify.job.js";

export interface WhatsappCampaignSendJob {
  tenantId: string;
  campaignId: string;
  recipientId: string;
}

export const whatsappCampaignQueue = new Queue<WhatsappCampaignSendJob>("whatsapp-campaign-send", {
  connection: createQueueConnection(),
});

export function createWhatsappCampaignWorker() {
  const prisma = new PrismaClient();

  return new Worker<WhatsappCampaignSendJob>(
    "whatsapp-campaign-send",
    async (job) => {
      await prisma.$executeRaw`SELECT set_config('app.tenant_id', ${job.data.tenantId}, TRUE)`;
      const campaign = await prisma.whatsappCampaign.findFirst({
        where: {
          id: job.data.campaignId,
          tenantId: job.data.tenantId,
        },
      });
      if (!campaign || campaign.status === "CANCELLED") {
        return;
      }

      const recipient = await prisma.whatsappCampaignRecipient.findFirst({
        where: {
          id: job.data.recipientId,
          tenantId: job.data.tenantId,
          campaignId: job.data.campaignId,
        },
      });
      if (!recipient || recipient.status === "SENT") {
        return;
      }

      const message = renderCampaignMessage(campaign.message, recipient.customerName, recipient.phone);
      const outbound = await prisma.whatsappMessage.create({
        data: {
          tenantId: job.data.tenantId,
          direction: "OUTBOUND",
          phone: recipient.phone,
          customerId: recipient.customerId,
          customerName: recipient.customerName,
          body: message,
          status: "QUEUED",
        },
      });

      try {
        await sendWhatsAppMessage(recipient.phone, message, {
          prisma,
          tenantId: job.data.tenantId,
        });
        await prisma.$transaction([
          prisma.whatsappMessage.update({
            where: { id: outbound.id },
            data: { status: "SENT", sentAt: new Date() },
          }),
          prisma.whatsappCampaignRecipient.update({
            where: { id: recipient.id },
            data: { status: "SENT", sentAt: new Date(), error: null },
          }),
          prisma.whatsappCampaign.update({
            where: { id: campaign.id },
            data: { sentCount: { increment: 1 } },
          }),
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "WhatsApp campaign send failed";
        await prisma.$transaction([
          prisma.whatsappMessage.update({
            where: { id: outbound.id },
            data: { status: "FAILED", error: message },
          }),
          prisma.whatsappCampaignRecipient.update({
            where: { id: recipient.id },
            data: { status: "FAILED", error: message },
          }),
          prisma.whatsappCampaign.update({
            where: { id: campaign.id },
            data: { failCount: { increment: 1 } },
          }),
        ]);
        throw error;
      } finally {
        await completeCampaignIfDone(prisma, job.data.tenantId, job.data.campaignId);
      }
    },
    {
      connection: createQueueConnection(),
    },
  );
}

function renderCampaignMessage(template: string, customerName: string | null, phone: string): string {
  return template
    .replaceAll("{{customerName}}", customerName ?? "Customer")
    .replaceAll("{{phone}}", phone);
}

async function completeCampaignIfDone(prisma: PrismaClient, tenantId: string, campaignId: string): Promise<void> {
  const pending = await prisma.whatsappCampaignRecipient.count({
    where: {
      tenantId,
      campaignId,
      status: {
        in: ["QUEUED", "SENDING"],
      },
    },
  });
  if (pending > 0) {
    return;
  }

  await prisma.whatsappCampaign.updateMany({
    where: {
      id: campaignId,
      tenantId,
      status: "SENDING",
    },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });
}
