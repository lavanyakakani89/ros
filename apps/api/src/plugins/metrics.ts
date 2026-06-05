import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

const registry = new Registry();
const requestStarts = new WeakMap<FastifyRequest, bigint>();

collectDefaultMetrics({
  prefix: "bizbil_",
  register: registry,
});

const httpRequestsTotal = new Counter({
  name: "bizbil_http_requests_total",
  help: "Total HTTP requests by method, route, and status.",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

const httpRequestDurationSeconds = new Histogram({
  name: "bizbil_http_request_duration_seconds",
  help: "HTTP request duration by method, route, and status.",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const processUptimeSeconds = new Gauge({
  name: "bizbil_process_uptime_seconds",
  help: "API process uptime in seconds.",
  registers: [registry],
});

const metricsPluginCallback: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.addHook("onRequest", (request, _reply, hookDone) => {
    requestStarts.set(request, process.hrtime.bigint());
    hookDone();
  });

  fastify.addHook("onResponse", (request, reply, hookDone) => {
    const start = requestStarts.get(request);
    requestStarts.delete(request);

    if (start) {
      const labels = {
        method: request.method,
        route: request.routeOptions.url ?? request.url.split("?")[0] ?? "unknown",
        status: String(reply.statusCode),
      };
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      httpRequestsTotal.inc(labels);
      httpRequestDurationSeconds.observe(labels, durationSeconds);
    }

    hookDone();
  });

  fastify.get("/metrics", async (_request, reply) => {
    processUptimeSeconds.set(process.uptime());
    reply.header("Content-Type", registry.contentType);
    return registry.metrics();
  });

  done();
};

export const metricsPlugin = fp(metricsPluginCallback);
