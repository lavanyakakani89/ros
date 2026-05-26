import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

import { authPlugin } from "./plugins/auth.js";
import { metricsPlugin } from "./plugins/metrics.js";
import { minioPlugin } from "./plugins/minio.js";
import { prismaPlugin } from "./plugins/prisma.js";
import { redisPlugin } from "./plugins/redis.js";
import { tenantPlugin } from "./plugins/tenant.js";
import { scheduleCustomerEventReminders } from "./jobs/customer-events.job.js";
import { createExpiryAlertsWorker, scheduleExpiryAlerts } from "./jobs/expiry-alerts.job.js";
import { expireLoyaltyPoints } from "./jobs/loyalty-expiry.job.js";
import { createPdfGenerateWorker } from "./jobs/pdf-generate.job.js";
import { expireOverdueQuotations } from "./jobs/quotation-expiry.job.js";
import { createWhatsappCampaignWorker } from "./jobs/whatsapp-campaign.job.js";
import { createWhatsappInboundWorker } from "./jobs/whatsapp-inbound.job.js";
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
import { stockCountRoutes } from "./modules/inventory/stock-count.routes.js";
import { loyaltyRoutes } from "./modules/loyalty/loyalty.routes.js";
import { notificationsRoutes } from "./modules/notifications/notifications.routes.js";
import { paymentsRoutes } from "./modules/payments/payments.routes.js";
import { paymentMethodsRoutes } from "./modules/payment-methods/payment-methods.routes.js";
import { payrollRoutes } from "./modules/payroll/payroll.routes.js";
import { printerRoutes } from "./modules/printer/printer.routes.js";
import { purchaseOrdersRoutes } from "./modules/purchase-orders/purchase-orders.routes.js";
import { purchaseReturnsRoutes } from "./modules/purchase-returns/purchase-returns.routes.js";
import { quotationsRoutes } from "./modules/quotations/quotations.routes.js";
import { reportsRoutes } from "./modules/reports/reports.routes.js";
import { restaurantRoutes } from "./modules/restaurant/restaurant.routes.js";
import { settingsRoutes } from "./modules/settings/settings.routes.js";
import { storesRoutes } from "./modules/settings/stores.routes.js";
import { suppliersRoutes } from "./modules/suppliers/suppliers.routes.js";
import { superAdminAuthRoutes } from "./modules/superadmin/superadmin-auth.routes.js";
import { superAdminImpersonationRoutes } from "./modules/superadmin/superadmin-impersonation.routes.js";
import { superAdminShopsRoutes } from "./modules/superadmin/superadmin-shops.routes.js";
import { superAdminTemplatesRoutes } from "./modules/superadmin/superadmin-templates.routes.js";
import { templatesRoutes } from "./modules/templates/templates.routes.js";
import { verticalConfigRoutes } from "./modules/vertical-config/vertical-config.routes.js";
import { whatsappCampaignsRoutes } from "./modules/whatsapp/whatsapp-campaigns.routes.js";
import { whatsappRoutes } from "./modules/whatsapp/whatsapp.routes.js";

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
      const issues = error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }));

      return reply.status(400).send({
        error: validationIssueSummary(issues),
        issues,
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
  await fastify.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
    },
  });
  await fastify.register(authPlugin);
  await fastify.register(authRoutes);
  await fastify.register(superAdminAuthRoutes);
  await fastify.register(superAdminShopsRoutes);
  await fastify.register(superAdminTemplatesRoutes);
  await fastify.register(superAdminImpersonationRoutes);

  async function getHealth() {
    await Promise.all([fastify.prisma.$queryRaw`SELECT 1`, fastify.redis.ping()]);

    return {
      status: "ok",
      services: {
        database: "ok",
        redis: "ok",
      },
      build: getBuildInfo(),
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
  await fastify.register(stockCountRoutes);
  await fastify.register(billingRoutes);
  await fastify.register(templatesRoutes);
  await fastify.register(printerRoutes);
  await fastify.register(paymentsRoutes);
  await fastify.register(paymentMethodsRoutes);
  await fastify.register(payrollRoutes);
  await fastify.register(deliveryRoutes);
  await fastify.register(notificationsRoutes);
  await fastify.register(reportsRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(storesRoutes);
  await fastify.register(expensesRoutes);
  await fastify.register(creditNotesRoutes);
  await fastify.register(quotationsRoutes);
  await fastify.register(loyaltyRoutes);
  await fastify.register(couponsRoutes);
  await fastify.register(auditRoutes);
  await fastify.register(restaurantRoutes);
  await fastify.register(whatsappRoutes);
  await fastify.register(whatsappCampaignsRoutes);

  if (process.env.ENABLE_WORKERS !== "false") {
    const workers = [
      createExpiryAlertsWorker(),
      createPdfGenerateWorker(),
      createWhatsappNotifyWorker(),
      createWhatsappCampaignWorker(),
      createWhatsappInboundWorker(fastify),
    ];

    for (const worker of workers) {
      worker.on("failed", (job, error) => {
        fastify.log.error({ error, jobId: job?.id, queue: worker.name }, "Background job failed");
      });
    }

    await scheduleExpiryAlerts();
    await expireOverdueQuotations();
    await expireLoyaltyPoints();
    const customerEventsScheduler = scheduleCustomerEventReminders(fastify);
    const quotationExpiryTimer = setInterval(() => {
      void expireOverdueQuotations().catch((error: unknown) => {
        fastify.log.error({ error }, "Quotation auto-expiry failed");
      });
    }, 24 * 60 * 60 * 1000);
    quotationExpiryTimer.unref();
    const loyaltyExpiryTimer = setInterval(() => {
      void expireLoyaltyPoints().catch((error: unknown) => {
        fastify.log.error({ error }, "Loyalty points expiry failed");
      });
    }, 24 * 60 * 60 * 1000);
    loyaltyExpiryTimer.unref();

    fastify.addHook("onClose", async () => {
      clearInterval(quotationExpiryTimer);
      clearInterval(loyaltyExpiryTimer);
      customerEventsScheduler.close();
      await Promise.all(workers.map((worker) => worker.close()));
    });
  }

  return fastify;
}

function getBuildInfo() {
  return {
    commit: nonEmpty(process.env.RETAILOS_BUILD_SHA),
    branch: nonEmpty(process.env.RETAILOS_BUILD_BRANCH),
    builtAt: nonEmpty(process.env.RETAILOS_BUILD_TIME),
  };
}

function nonEmpty(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value : null;
}

function validationIssueSummary(issues: Array<{ field: string; message: string }>): string {
  if (issues.length === 0) {
    return "Validation failed";
  }

  return issues
    .slice(0, 3)
    .map((issue) => `${fieldLabel(issue.field)}: ${issue.message}`)
    .join("; ");
}

function fieldLabel(field: string): string {
  if (!field) {
    return "Request";
  }

  return field
    .replace(/\.(\d+)\./g, " $1 ")
    .replace(/\./g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
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

  if (target.includes("username")) {
    return "Username already exists. Use a different username.";
  }

  if (target.includes("phone")) {
    return "Phone number already exists. Use a different phone number.";
  }

  return "A record with these details already exists.";
}
