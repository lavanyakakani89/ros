import type { FastifyInstance } from "fastify";

import { whatsappNotifyQueue } from "../../jobs/whatsapp-notify.job.js";

export interface QueueWhatsappNotificationInput {
  tenantId: string;
  phone: string;
  message: string;
  customerId?: string | null;
  invoiceId?: string | null;
  deliveryId?: string | null;
  jobName: string;
}

export async function queueWhatsappNotification(
  fastify: FastifyInstance,
  input: QueueWhatsappNotificationInput,
): Promise<void> {
  if (!input.phone.trim()) {
    return;
  }

  const outbound = await fastify.prisma.whatsappMessage.create({
    data: {
      tenantId: input.tenantId,
      direction: "OUTBOUND",
      phone: normalizeWhatsappPhone(input.phone),
      customerId: input.customerId ?? null,
      invoiceId: input.invoiceId ?? null,
      deliveryId: input.deliveryId ?? null,
      body: input.message,
      status: "QUEUED",
    },
  });

  await whatsappNotifyQueue.add(input.jobName, {
    tenantId: input.tenantId,
    whatsappMessageId: outbound.id,
    phone: outbound.phone,
    message: input.message,
  });
}

export function normalizeWhatsappPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) {
    return digits.slice(-10);
  }

  return digits;
}
