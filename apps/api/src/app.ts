import Fastify, { type FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

import { authPlugin } from "./plugins/auth.js";
import { metricsPlugin } from "./plugins/metrics.js";
import { minioPlugin } from "./plugins/minio.js";
import { prismaPlugin } from "./plugins/prisma.js";
import { redisPlugin } from "./plugins/redis.js";
import { tenantPlugin } from "./plugins/tenant.js";
import { createExpiryAlertsWorker, scheduleExpiryAlerts } from "./jobs/expiry-alerts.job.js";
import { createPdfGenerateWorker } from "./jobs/pdf-generate.job.js";
import { createWhatsappNotifyWorker } from "./jobs/whatsapp-notify.job.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { auditRoutes } from "./modules/audit/audit.routes.js";
import { billingRoutes } from "./modules/billing/billing.routes.js";
import { categoriesRoutes } from "./modules/categories/categories.routes.js";
import { couponsRoutes } from "./modules/coupons/coupons.routes.js";
import { creditNotesRoutes } from "./modules/credit-notes/credit-notes.routes.js";
import { customersRoutes } from "./modules/customers/customers.routes.js";
import { deliveryRoutes } from "./modules/delivery/delivery.routes.js";
import { expensesRoutes } from "./modules/expenses/expenses.routes.js";
import { inventoryRoutes } from "./modules/inventory/inventory.routes.js";
import { loyaltyRoutes } from "./modules/loyalty/loyalty.routes.js";
import { paymentsRoutes } from "./modules/payments/payments.routes.js";
import { purchaseOrdersRoutes } from "./modules/purchase-orders/purchase-orders.routes.js";
import { purchaseReturnsRoutes } from "./modules/purchase-returns/purchase-returns.routes.js";
import { quotationsRoutes } from "./modules/quotations/quotations.routes.js";
import { reportsRoutes } from "./modules/reports/reports.routes.js";
import { restaurantRoutes } from "./modules/restaurant/restaurant.routes.js";
import { settingsRoutes } from "./modules/settings/settings.routes.js";
import { suppliersRoutes } from "./modules/suppliers/suppliers.routes.js";
import { superAdminAuthRoutes } from "./modules/superadmin/superadmin-auth.routes.js";
import { superAdminShopsRoutes } from "./modules/superadmin/superadmin-shops.routes.js";
import { verticalConfigRoutes } from "./modules/vertical-config/vertical-config.routes.js";

export async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  fastify.removeContentTypeParser("application/json");
  fastify.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const rawBody = body.toString("utf8");
    request.rawBody = rawBody;

    if (rawBody.trim() === "") {
      done(null, null);
      return;
    }

    try {
      done(null, JSON.parse(rawBody) as unknown);
    } catch (error) {
      done(error as Error);
    }
  });

  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "Validation failed",
        issues: error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return reply.status(409).send({
        error: uniqueConstraintMessage(error),
      });
    }

    const statusCode = error.statusCode ?? 500;
    return reply.status(statusCode).send({
      error: statusCode >= 500 ? "Internal server error" : error.message,
    });
  });

  await fastify.register(prismaPlugin);
  await fastify.register(redisPlugin);
  await fastify.register(minioPlugin);
  await fastify.register(metricsPlugin);
  await fastify.register(authPlugin);
  await fastify.register(authRoutes);
  await fastify.register(superAdminAuthRoutes);
  await fastify.register(superAdminShopsRoutes);

  async function getHealth() {
    await Promise.all([fastify.prisma.$queryRaw`SELECT 1`, fastify.redis.ping()]);

    return {
      status: "ok",
      services: {
        database: "ok",
        redis: "ok",
      },
    };
  }

  fastify.get("/health", async () => {
    return getHealth();
  });

  fastify.get("/api/health", async () => {
    return getHealth();
  });

  await fastify.register(tenantPlugin);
  await fastify.register(verticalConfigRoutes);
  await fastify.register(categoriesRoutes);
  await fastify.register(customersRoutes);
  await fastify.register(suppliersRoutes);
  await fastify.register(purchaseOrdersRoutes);
  await fastify.register(purchaseReturnsRoutes);
  await fastify.register(inventoryRoutes);
  await fastify.register(billingRoutes);
  await fastify.register(paymentsRoutes);
  await fastify.register(deliveryRoutes);
  await fastify.register(reportsRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(expensesRoutes);
  await fastify.register(creditNotesRoutes);
  await fastify.register(quotationsRoutes);
  await fastify.register(loyaltyRoutes);
  await fastify.register(couponsRoutes);
  await fastify.register(auditRoutes);
  await fastify.register(restaurantRoutes);

  if (process.env.ENABLE_WORKERS !== "false") {
    const workers = [createExpiryAlertsWorker(), createPdfGenerateWorker(), createWhatsappNotifyWorker()];

    for (const worker of workers) {
      worker.on("failed", (job, error) => {
        fastify.log.error({ error, jobId: job?.id, queue: worker.name }, "Background job failed");
      });
    }

    await scheduleExpiryAlerts();

    fastify.addHook("onClose", async () => {
      await Promise.all(workers.map((worker) => worker.close()));
    });
  }

  return fastify;
}

function uniqueConstraintMessage(error: Prisma.PrismaClientKnownRequestError): string {
  const rawTarget = error.meta?.target;
  const target = Array.isArray(rawTarget) ? rawTarget.map((item) => String(item)).join(",") : "";

  if (target.includes("slug")) {
    return "Shop slug already exists. Use a different slug.";
  }

  if (target.includes("email")) {
    return "Email already exists. Use a different email.";
  }

  if (target.includes("phone")) {
    return "Phone number already exists. Use a different phone number.";
  }

  return "A record with these details already exists.";
}
