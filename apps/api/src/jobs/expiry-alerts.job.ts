import { PrismaClient } from "@prisma/client";
import { Queue, Worker } from "bullmq";

import { createQueueConnection } from "./connection.js";
import { whatsappNotifyQueue } from "./whatsapp-notify.job.js";
import { shouldSendNotificationForPrisma } from "../modules/whatsapp/whatsapp.notifications.js";

export const expiryAlertsQueue = new Queue("expiry-alerts", {
  connection: createQueueConnection(),
});

export async function scheduleExpiryAlerts(): Promise<void> {
  await expiryAlertsQueue.add(
    "check-expiry",
    {},
    {
      repeat: {
        pattern: "30 2 * * *",
      },
      jobId: "daily-expiry-alerts",
    },
  );
}

export function createExpiryAlertsWorker() {
  const prisma = new PrismaClient();

  return new Worker(
    "expiry-alerts",
    async () => {
      const tenants = await prisma.tenant.findMany({
        where: {
          vertical: "PHARMACY",
        },
      });

      for (const tenant of tenants) {
        const expiresBefore = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
        const batches = await prisma.productBatch.findMany({
          where: {
            tenantId: tenant.id,
            expiryDate: {
              not: null,
              lte: expiresBefore,
            },
          },
          include: {
            product: true,
          },
          orderBy: {
            expiryDate: "asc",
          },
        });

        if (batches.length === 0) {
          continue;
        }

        if (!(await shouldSendNotificationForPrisma(prisma, tenant.id, "expiryAlert"))) {
          continue;
        }

        const lines = batches.map((batch) => {
          const daysLeft = batch.expiryDate ? Math.ceil((batch.expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : 0;
          return `${batch.product.name} batch ${batch.batchNumber}: ${String(daysLeft)} days left, qty ${batch.quantity.toString()}`;
        });

        await whatsappNotifyQueue.add("send-expiry-alert", {
          tenantId: tenant.id,
          phone: tenant.phone,
          message: `RetailOS expiry alert for ${tenant.name}\n${lines.join("\n")}`,
        });
      }
    },
    {
      connection: createQueueConnection(),
    },
  );
}
