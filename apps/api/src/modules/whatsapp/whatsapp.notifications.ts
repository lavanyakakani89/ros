import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { whatsappNotifyQueue } from "../../jobs/whatsapp-notify.job.js";

export type WhatsappNotificationEventKey =
  | "invoiceConfirmed"
  | "deliveryAssigned"
  | "deliveryStatusUpdate"
  | "expiryAlert"
  | "paymentLink"
  | "quotationShared"
  | "creditNoteShared"
  | "birthdayGreeting"
  | "anniversaryGreeting";

export interface WhatsappNotificationSettings {
  invoiceConfirmed: boolean;
  deliveryAssigned: boolean;
  deliveryStatusUpdate: boolean;
  expiryAlert: boolean;
  paymentLink: boolean;
  quotationShared: boolean;
  creditNoteShared: boolean;
  birthdayGreeting: boolean;
  anniversaryGreeting: boolean;
}

export const defaultWhatsappNotificationSettings: WhatsappNotificationSettings = {
  invoiceConfirmed: true,
  deliveryAssigned: true,
  deliveryStatusUpdate: true,
  expiryAlert: true,
  paymentLink: true,
  quotationShared: true,
  creditNoteShared: true,
  birthdayGreeting: true,
  anniversaryGreeting: true,
};

export interface QueueWhatsappNotificationInput {
  tenantId: string;
  phone: string;
  message: string;
  customerId?: string | null;
  invoiceId?: string | null;
  deliveryId?: string | null;
  jobName: string;
  eventKey?: WhatsappNotificationEventKey;
}

export async function queueWhatsappNotification(
  fastify: FastifyInstance,
  input: QueueWhatsappNotificationInput,
): Promise<void> {
  if (!input.phone.trim()) {
    return;
  }

  if (input.eventKey && !(await shouldSendNotification(fastify, input.tenantId, input.eventKey))) {
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

export async function shouldSendNotification(
  fastify: FastifyInstance,
  tenantId: string,
  eventKey: WhatsappNotificationEventKey,
): Promise<boolean> {
  return shouldSendNotificationForPrisma(fastify.prisma, tenantId, eventKey);
}

export async function shouldSendNotificationForPrisma(
  prisma: PrismaClient,
  tenantId: string,
  eventKey: WhatsappNotificationEventKey,
): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { whatsappNotificationSettings: true },
  });

  return readNotificationSetting(tenant?.whatsappNotificationSettings, eventKey);
}

export function mergeWhatsappNotificationSettings(input: unknown): WhatsappNotificationSettings {
  return {
    invoiceConfirmed: readNotificationSetting(input, "invoiceConfirmed"),
    deliveryAssigned: readNotificationSetting(input, "deliveryAssigned"),
    deliveryStatusUpdate: readNotificationSetting(input, "deliveryStatusUpdate"),
    expiryAlert: readNotificationSetting(input, "expiryAlert"),
    paymentLink: readNotificationSetting(input, "paymentLink"),
    quotationShared: readNotificationSetting(input, "quotationShared"),
    creditNoteShared: readNotificationSetting(input, "creditNoteShared"),
    birthdayGreeting: readNotificationSetting(input, "birthdayGreeting"),
    anniversaryGreeting: readNotificationSetting(input, "anniversaryGreeting"),
  };
}

function readNotificationSetting(input: unknown, eventKey: WhatsappNotificationEventKey): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return defaultWhatsappNotificationSettings[eventKey];
  }

  for (const [key, value] of Object.entries(input)) {
    if (key === eventKey && typeof value === "boolean") {
      return value;
    }
  }

  return defaultWhatsappNotificationSettings[eventKey];
}

export function normalizeWhatsappPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) {
    return digits.slice(-10);
  }

  return digits;
}
