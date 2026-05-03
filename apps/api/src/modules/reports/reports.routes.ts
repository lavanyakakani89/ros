import { z } from "zod";
import type { FastifyPluginCallback } from "fastify";

import { reportDateRangeSchema } from "./reports.schema.js";
import { ReportsService } from "./reports.service.js";

export const reportsRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new ReportsService(fastify);

  fastify.get("/api/reports/summary", async (request) => {
    const query = reportDateRangeSchema.parse(request.query);
    return service.getSalesSummary(request.tenant, query);
  });

  fastify.get("/api/reports/daily-sales", async (request) => {
    const query = reportDateRangeSchema.parse(request.query);
    const summary = await service.getSalesSummary(request.tenant, query);
    return summary.dailySales;
  });

  fastify.get("/api/reports/gst", async (request) => {
    const query = reportDateRangeSchema.parse(request.query);
    const summary = await service.getSalesSummary(request.tenant, query);
    return { gstByRate: summary.gstByRate, hsnSummary: summary.hsnSummary, totalCgst: summary.totalCgst, totalSgst: summary.totalSgst };
  });

  fastify.get("/api/reports/moving-items", async (request) => {
    const query = reportDateRangeSchema.parse(request.query);
    const summary = await service.getSalesSummary(request.tenant, query);
    return summary.movingItems;
  });

  fastify.get("/api/reports/inventory", async (request) => {
    return service.getInventorySummary(request.tenant);
  });

  fastify.get("/api/reports/pnl", async (request) => {
    const query = reportDateRangeSchema.parse(request.query);
    return service.getPnlReport(request.tenant, query);
  });

  fastify.get("/api/reports/day-end", async (request) => {
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(request.query);
    return service.getDayEndReport(request.tenant, date);
  });

  done();
};
