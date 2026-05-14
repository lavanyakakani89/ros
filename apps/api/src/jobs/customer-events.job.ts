import type { FastifyInstance } from "fastify";

import { queueWhatsappNotification } from "../modules/whatsapp/whatsapp.notifications.js";
import { renderWhatsappMessageTemplate } from "../modules/whatsapp/whatsapp.templates.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CUSTOMER_EVENT_HOUR_IST = 9;

export interface CustomerEventReminderScheduler {
  close(): void;
}

export function scheduleCustomerEventReminders(fastify: FastifyInstance): CustomerEventReminderScheduler {
  let dailyInterval: NodeJS.Timeout | undefined;
  const firstRunTimer = setTimeout(() => {
    void sendCustomerEventReminders(fastify).catch((error: unknown) => {
      fastify.log.error({ error }, "Customer event reminder job failed");
    });

    dailyInterval = setInterval(() => {
      void sendCustomerEventReminders(fastify).catch((error: unknown) => {
        fastify.log.error({ error }, "Customer event reminder job failed");
      });
    }, DAY_MS);
    dailyInterval.unref();
  }, millisecondsUntilNextIstHour(CUSTOMER_EVENT_HOUR_IST));
  firstRunTimer.unref();

  return {
    close() {
      clearTimeout(firstRunTimer);
      if (dailyInterval) {
        clearInterval(dailyInterval);
      }
    },
  };
}

export async function sendCustomerEventReminders(fastify: FastifyInstance): Promise<void> {
  const today = monthDayKey(new Date());
  const tenants = await fastify.prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
    },
  });

  for (const tenant of tenants) {
    const customers = await fastify.prisma.customer.findMany({
      where: {
        tenantId: tenant.id,
        phone: {
          not: "",
        },
        OR: [
          {
            birthday: {
              not: null,
            },
          },
          {
            anniversary: {
              not: null,
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        phone: true,
        birthday: true,
        anniversary: true,
        loyaltyAccount: {
          select: {
            points: true,
          },
        },
      },
    });

    for (const customer of customers) {
      const context = {
        customerName: customer.name,
        tenantName: tenant.name,
        loyaltyPoints: customer.loyaltyAccount?.points ?? 0,
      };

      if (customer.birthday && monthDayKey(customer.birthday) === today) {
        const message = await renderWhatsappMessageTemplate(fastify, tenant.id, "birthdayGreeting", context);
        await queueWhatsappNotification(fastify, {
          tenantId: tenant.id,
          customerId: customer.id,
          phone: customer.phone,
          message,
          jobName: "send-birthday-greeting",
          eventKey: "birthdayGreeting",
        });
      }

      if (customer.anniversary && monthDayKey(customer.anniversary) === today) {
        const message = await renderWhatsappMessageTemplate(fastify, tenant.id, "anniversaryGreeting", context);
        await queueWhatsappNotification(fastify, {
          tenantId: tenant.id,
          customerId: customer.id,
          phone: customer.phone,
          message,
          jobName: "send-anniversary-greeting",
          eventKey: "anniversaryGreeting",
        });
      }
    }
  }
}

function monthDayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${month}-${day}`;
}

function millisecondsUntilNextIstHour(hour: number): number {
  const now = new Date();
  const istParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const value = (type: string) => Number(istParts.find((part) => part.type === type)?.value ?? 0);
  const istNowAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  let nextRunAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), hour, 0, 0);

  if (nextRunAsUtc <= istNowAsUtc) {
    nextRunAsUtc += DAY_MS;
  }

  return Math.max(nextRunAsUtc - istNowAsUtc, 1_000);
}
