import { PrismaClient } from "@prisma/client";
import { Worker, type Job } from "bullmq";

import { createQueueConnection } from "../../jobs/connection.js";
import type { DeliveryRouteJob } from "./delivery-route.queue.js";
import { DeliveryRouteService } from "./delivery-route.service.js";

export function createDeliveryRouteWorker() {
  const prisma = new PrismaClient();
  const service = new DeliveryRouteService(prisma);

  return new Worker<DeliveryRouteJob>(
    "delivery-route",
    async (job: Job<DeliveryRouteJob>) => {
      try {
        if (job.name === "submit-optimization") {
          await service.submitOptimizationForWorker(job.data.routePlanId);
          return;
        }

        if (job.name === "poll-optimization") {
          await service.pollOptimizationForWorker(job.data.routePlanId, job.data.pollCount ?? 0);
          return;
        }

        if (job.name === "generate-geometries") {
          await service.generateGeometriesForWorker(job.data.routePlanId);
        }
      } catch (error) {
        await service.failOptimizationForWorker(
          job.data.routePlanId,
          error instanceof Error ? error.message : "Delivery route job failed.",
        );
        throw error;
      }
    },
    {
      connection: createQueueConnection(),
    },
  );
}
