import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

interface HttpMetric {
  count: number;
  totalSeconds: number;
  maxSeconds: number;
}

const requestStarts = new WeakMap<FastifyRequest, bigint>();
const httpMetrics = new Map<string, HttpMetric>();

const metricsPluginCallback: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.addHook("onRequest", (request, _reply, done) => {
    requestStarts.set(request, process.hrtime.bigint());
    done();
  });

  fastify.addHook("onResponse", (request, reply, done) => {
    recordHttpMetric(request, reply);
    done();
  });

  fastify.get("/metrics", (_request, reply) => {
    reply.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return renderMetrics();
  });

  done();
};

export const metricsPlugin = fp(metricsPluginCallback);

function recordHttpMetric(request: FastifyRequest, reply: FastifyReply): void {
  const start = requestStarts.get(request);
  if (!start) {
    return;
  }

  requestStarts.delete(request);
  const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
  const route = request.routeOptions.url ?? request.url.split("?")[0] ?? "unknown";
  const key = `${request.method} ${route} ${String(reply.statusCode)}`;
  const current = httpMetrics.get(key) ?? { count: 0, totalSeconds: 0, maxSeconds: 0 };

  httpMetrics.set(key, {
    count: current.count + 1,
    totalSeconds: current.totalSeconds + durationSeconds,
    maxSeconds: Math.max(current.maxSeconds, durationSeconds),
  });
}

function renderMetrics(): string {
  const lines = [
    "# HELP retailos_process_uptime_seconds API process uptime in seconds.",
    "# TYPE retailos_process_uptime_seconds gauge",
    `retailos_process_uptime_seconds ${process.uptime().toFixed(3)}`,
    "# HELP retailos_http_requests_total Total HTTP requests by method, route, and status.",
    "# TYPE retailos_http_requests_total counter",
  ];

  for (const [key, metric] of httpMetrics) {
    const [method, route, status] = key.split(" ");
    const labels = formatLabels({ method, route, status });
    lines.push(`retailos_http_requests_total${labels} ${String(metric.count)}`);
  }

  lines.push(
    "# HELP retailos_http_request_duration_seconds_sum Total HTTP request duration by method, route, and status.",
    "# TYPE retailos_http_request_duration_seconds_sum counter",
  );

  for (const [key, metric] of httpMetrics) {
    const [method, route, status] = key.split(" ");
    const labels = formatLabels({ method, route, status });
    lines.push(`retailos_http_request_duration_seconds_sum${labels} ${metric.totalSeconds.toFixed(6)}`);
  }

  lines.push(
    "# HELP retailos_http_request_duration_seconds_max Slowest observed HTTP request duration by method, route, and status.",
    "# TYPE retailos_http_request_duration_seconds_max gauge",
  );

  for (const [key, metric] of httpMetrics) {
    const [method, route, status] = key.split(" ");
    const labels = formatLabels({ method, route, status });
    lines.push(`retailos_http_request_duration_seconds_max${labels} ${metric.maxSeconds.toFixed(6)}`);
  }

  return `${lines.join("\n")}\n`;
}

function formatLabels(labels: Record<string, string | undefined>): string {
  const entries = Object.entries(labels)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => `${key}="${escapeLabel(value)}"`);

  return `{${entries.join(",")}}`;
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}
