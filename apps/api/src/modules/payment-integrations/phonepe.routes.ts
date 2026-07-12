import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { PaymentMethodType, Prisma, UserRole } from "@prisma/client";
import type { FastifyPluginCallback, FastifyReply } from "fastify";
import QRCode from "qrcode";
import { z } from "zod";

import {
  parseStoredPhonePeIntegrationConfig,
  PHONEPE_INTEGRATION_PROVIDER,
  type StoredPhonePeIntegrationConfig,
} from "./phonepe.config.js";
import { decryptPhonePeSecret } from "./phonepe.credentials.js";

const initSchema = z.object({
  payment_method_id: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
  channel: z.enum(["card", "upi"]).optional(),
  order_label: z.string().trim().min(1).max(64),
  invoice_date: z.coerce.date().optional(),
  invoice_name: z.string().trim().min(1).max(128).optional(),
});

const attemptParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const manualOverrideSchema = z.object({
  reference_number: z.string().trim().min(1).max(128),
  reason: z.string().trim().max(256).optional(),
});

const callbackQuerySchema = z.object({
  tenantId: z.string().trim().min(1),
  attemptId: z.string().trim().min(1),
});

type PhonePeChannel = "CARD" | "UPI";
type AttemptStatus = "PENDING" | "SUCCESS" | "FAILED" | "EXPIRED" | "MANUAL_OVERRIDE";

export const phonePeRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.post("/api/payment-integrations/phonepe/init", async (request, reply) => {
    const input = initSchema.parse(request.body);
    return handlePhonePe(reply, async () => {
      const method = await fastify.prisma.paymentMethod.findFirst({
        where: {
          id: input.payment_method_id,
          tenantId: request.tenant.id,
          isActive: true,
          deletedAt: null,
        },
      });
      if (!method) {
        throw new PhonePeError("Payment method not found", 404);
      }
      if (method.integrationProvider !== PHONEPE_INTEGRATION_PROVIDER) {
        throw new PhonePeError("Selected payment method is not configured for PhonePe", 400);
      }

      const config = readPhonePeConfig(method.integrationConfig);
      const channel = resolveChannel(input.channel, method.type);
      const amount = roundMoney(input.amount);
      const amountPaise = toPaise(amount);
      const transactionId = createTransactionId(channel);
      const orderId = createExternalOrderId(input.order_label);
      const expiresAt = new Date(Date.now() + (channel === "CARD" ? config.handoverTimeoutSeconds : config.qrExpirySeconds) * 1000);

      const pendingAttempt = await fastify.prisma.paymentIntegrationAttempt.create({
        data: {
          tenantId: request.tenant.id,
          storeId: method.storeId,
          paymentMethodId: method.id,
          provider: PHONEPE_INTEGRATION_PROVIDER,
          channel,
          externalOrderId: orderId,
          externalTransactionId: transactionId,
          amount,
          status: "PENDING",
          providerState: "INITIATED",
          expiresAt,
        },
      });

      try {
        const callbackUrl = buildCallbackUrl(request.tenant.id, pendingAttempt.id);
        const initResponse = channel === "CARD"
          ? await startEdcPayment(config, {
              amountPaise,
              orderId,
              transactionId,
              callbackUrl,
            })
          : await startDynamicQrPayment(config, {
              amountPaise,
              orderId,
              transactionId,
              callbackUrl,
              ...(input.invoice_date ? { invoiceDate: input.invoice_date } : {}),
              ...(input.invoice_name ? { invoiceName: input.invoice_name } : {}),
            });

        const initData = asRecord(initResponse.data);
        const qrString = channel === "UPI" ? readString(initData?.qrString) : null;
        const qrDataUrl = qrString ? await QRCode.toDataURL(qrString, {
          width: 320,
          margin: 2,
          color: { dark: "#000000", light: "#ffffff" },
        }) : null;

        const attempt = await fastify.prisma.paymentIntegrationAttempt.update({
          where: { id: pendingAttempt.id },
          data: {
            rawInitResponse: toJsonInput(initResponse),
            providerState: "AWAITING_CUSTOMER",
            qrString,
            qrDataUrl,
          },
        });

        return formatAttempt(attempt, method.manualOverrideAllowed);
      } catch (error) {
        await fastify.prisma.paymentIntegrationAttempt.update({
          where: { id: pendingAttempt.id },
          data: {
            status: "FAILED",
            providerState: "INIT_FAILED",
            responseCode: error instanceof PhonePeError ? error.code ?? "INIT_FAILED" : "INIT_FAILED",
            ...(error instanceof PhonePeError && error.details !== undefined ? { rawInitResponse: toJsonInput(error.details) } : {}),
            completedAt: new Date(),
          },
        });
        throw error;
      }
    });
  });

  fastify.get("/api/payment-integrations/phonepe/attempts/:id", async (request, reply) => {
    const { id } = attemptParamsSchema.parse(request.params);
    return handlePhonePe(reply, async () => {
      const attempt = await getAttemptForTenant(request.tenant.id, id);
      return formatAttempt(attempt, attempt.paymentMethod.manualOverrideAllowed);
    });
  });

  fastify.post("/api/payment-integrations/phonepe/attempts/:id/status-sync", async (request, reply) => {
    const { id } = attemptParamsSchema.parse(request.params);
    return handlePhonePe(reply, async () => {
      const attempt = await getAttemptForTenant(request.tenant.id, id);
      if (isTerminalAttemptStatus(attempt.status)) {
        return formatAttempt(attempt, attempt.paymentMethod.manualOverrideAllowed);
      }

      const config = readPhonePeConfig(attempt.paymentMethod.integrationConfig);
      const channel = toPhonePeChannel(attempt.channel);
      const providerResponse = channel === "CARD"
        ? await fetchEdcStatus(config, attempt.externalTransactionId)
        : await fetchUpiStatus(config, attempt.externalTransactionId);
      const updated = await updateAttemptFromProviderPayload(attempt.id, attempt.status, providerResponse, channel, "status");
      return formatAttempt(updated, attempt.paymentMethod.manualOverrideAllowed);
    });
  });

  fastify.post("/api/payment-integrations/phonepe/attempts/:id/manual-override", async (request, reply) => {
    const { id } = attemptParamsSchema.parse(request.params);
    const input = manualOverrideSchema.parse(request.body);
    return handlePhonePe(reply, async () => {
      const attempt = await getAttemptForTenant(request.tenant.id, id);
      if (request.user.role !== UserRole.OWNER && request.user.role !== UserRole.MANAGER) {
        throw new PhonePeError("Manual override requires owner or manager access", 403);
      }
      if (!attempt.paymentMethod.manualOverrideAllowed) {
        throw new PhonePeError("Manual override is disabled for this payment method", 403);
      }
      if (attempt.status === "MANUAL_OVERRIDE") {
        return formatAttempt(attempt, attempt.paymentMethod.manualOverrideAllowed);
      }
      if (attempt.status !== "PENDING" && attempt.status !== "FAILED" && attempt.status !== "EXPIRED") {
        throw new PhonePeError("Manual override is only allowed for pending, failed, or expired attempts", 409);
      }

      const updated = await fastify.prisma.paymentIntegrationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "MANUAL_OVERRIDE",
          providerState: "MANUAL_OVERRIDE",
          referenceNumber: input.reference_number.trim(),
          manualOverrideBy: request.user.userId,
          manualOverrideReason: input.reason?.trim() || null,
          completedAt: new Date(),
        },
      });

      return formatAttempt(updated, attempt.paymentMethod.manualOverrideAllowed);
    });
  });

  fastify.post("/api/public/payment-integrations/phonepe/callback", async (request, reply) => {
    const query = callbackQuerySchema.parse(request.query);
    return handlePhonePe(reply, async () => {
      await fastify.prisma.$executeRaw`SELECT set_config('app.tenant_id', ${query.tenantId}, FALSE)`;
      const attempt = await getAttemptForTenant(query.tenantId, query.attemptId);
      const config = readPhonePeConfig(attempt.paymentMethod.integrationConfig);
      const signature = readHeaderValue(request.headers["x-verify"]);
      const encodedPayload = extractEncodedCallbackPayload(request.body, request.rawBody ?? "");
      if (!signature || !encodedPayload) {
        throw new PhonePeError("Invalid PhonePe callback payload", 401);
      }
      if (!verifyCallbackSignature(signature, encodedPayload, config)) {
        throw new PhonePeError("Invalid PhonePe callback signature", 401);
      }

      const decodedPayload = decodeBase64Json(encodedPayload);
      await updateAttemptFromProviderPayload(attempt.id, attempt.status, decodedPayload, toPhonePeChannel(attempt.channel), "callback");
      return { received: true };
    });
  });

  async function getAttemptForTenant(tenantId: string, id: string) {
    const attempt = await fastify.prisma.paymentIntegrationAttempt.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        paymentMethod: true,
      },
    });
    if (!attempt) {
      throw new PhonePeError("PhonePe payment attempt not found", 404);
    }
    return attempt;
  }

  async function updateAttemptFromProviderPayload(
    attemptId: string,
    currentStatus: string,
    payload: unknown,
    channel: PhonePeChannel,
    source: "status" | "callback",
  ) {
    const next = mapProviderPayloadToAttempt(channel, payload);
    const updateData: Prisma.PaymentIntegrationAttemptUncheckedUpdateInput = {
      status: currentStatus === "MANUAL_OVERRIDE" ? "MANUAL_OVERRIDE" : next.status,
      providerState: next.providerState,
      referenceNumber: next.referenceNumber,
      providerReferenceId: next.providerReferenceId,
      responseCode: next.responseCode,
      ...(source === "status"
        ? { rawStatusResponse: toJsonInput(payload) }
        : { rawCallbackPayload: toJsonInput(payload) }),
      ...(currentStatus === "MANUAL_OVERRIDE" || next.status === "PENDING" ? {} : { completedAt: new Date() }),
    };
    return fastify.prisma.paymentIntegrationAttempt.update({
      where: { id: attemptId },
      data: updateData,
    });
  }

  done();
};

class PhonePeError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function handlePhonePe<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof PhonePeError) {
      return reply.status(error.statusCode).send({
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
      });
    }

    throw error;
  }
}

function resolveChannel(inputChannel: "card" | "upi" | undefined, type: PaymentMethodType): PhonePeChannel {
  if (inputChannel === "card" || type === PaymentMethodType.CARD) {
    return "CARD";
  }
  if (inputChannel === "upi" || type === PaymentMethodType.UPI) {
    return "UPI";
  }
  throw new PhonePeError("PhonePe integration is supported only for Card and UPI payment methods", 400);
}

function toPhonePeChannel(value: string): PhonePeChannel {
  return value === "CARD" ? "CARD" : "UPI";
}

function readPhonePeConfig(rawConfig: unknown): StoredPhonePeIntegrationConfig {
  const config = parseStoredPhonePeIntegrationConfig(rawConfig);
  if (!config) {
    throw new PhonePeError("PhonePe configuration is incomplete for this payment method", 400);
  }
  return config;
}

async function startEdcPayment(
  config: StoredPhonePeIntegrationConfig,
  input: {
    amountPaise: number;
    orderId: string;
    transactionId: string;
    callbackUrl: string | null;
  },
) {
  if (!config.terminalId) {
    throw new PhonePeError("PhonePe terminal ID is required for card payments", 400);
  }

  const payload = {
    merchantId: config.merchantId,
    storeId: config.storeId,
    terminalId: config.terminalId,
    orderId: input.orderId,
    transactionId: input.transactionId,
    amount: input.amountPaise,
    paymentModes: ["CARD"],
    timeAllowedForHandoverToTerminalSeconds: config.handoverTimeoutSeconds,
    integrationMappingType: "ONE_TO_ONE",
    autoAccept: config.autoAccept,
  };
  return callPhonePeApi(config, "/v1/edc/transaction/init", {
    method: "POST",
    callbackUrl: input.callbackUrl,
    payload,
  });
}

async function startDynamicQrPayment(
  config: StoredPhonePeIntegrationConfig,
  input: {
    amountPaise: number;
    orderId: string;
    transactionId: string;
    invoiceDate?: Date;
    invoiceName?: string;
    callbackUrl: string | null;
  },
) {
  const payload = {
    merchantId: config.merchantId,
    transactionId: input.transactionId,
    merchantOrderId: input.orderId,
    amount: input.amountPaise,
    storeId: config.storeId,
    ...(config.terminalId ? { terminalId: config.terminalId } : {}),
    expiresIn: config.qrExpirySeconds,
    ...(input.invoiceDate || input.invoiceName
      ? {
          invoiceDetails: {
            ...(input.invoiceDate ? { invoiceDate: input.invoiceDate.toISOString() } : {}),
            ...(input.invoiceName ? { invoiceName: input.invoiceName } : {}),
            invoiceNumber: input.orderId,
          },
        }
      : {}),
  };
  return callPhonePeApi(config, "/v3/qr/init", {
    method: "POST",
    callbackUrl: input.callbackUrl,
    payload,
  });
}

async function fetchEdcStatus(config: StoredPhonePeIntegrationConfig, transactionId: string) {
  return callPhonePeApi(config, `/v1/edc/transaction/${config.merchantId}/${transactionId}/status`, {
    method: "POST",
  });
}

async function fetchUpiStatus(config: StoredPhonePeIntegrationConfig, transactionId: string) {
  return callPhonePeApi(config, `/v3/transaction/${config.merchantId}/${transactionId}/status`, {
    method: "GET",
  });
}

async function callPhonePeApi(
  config: StoredPhonePeIntegrationConfig,
  path: string,
  options: {
    method: "GET" | "POST";
    payload?: Record<string, unknown>;
    callbackUrl?: string | null;
  },
) {
  const secret = decryptPhonePeSecret(config.saltKey);
  if (!secret) {
    throw new PhonePeError("PhonePe secret could not be read", 500);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  let body: string | undefined;
  if (options.payload) {
    const encodedPayload = Buffer.from(JSON.stringify(options.payload)).toString("base64");
    headers["X-VERIFY"] = `${sha256(`${encodedPayload}${path}${secret}`)}###${String(config.saltIndex)}`;
    body = JSON.stringify({ request: encodedPayload });
    if (config.providerId) {
      headers["X-PROVIDER-ID"] = config.providerId;
    }
    if (options.callbackUrl) {
      headers["X-CALLBACK-URL"] = options.callbackUrl;
      headers["X-CALL-MODE"] = "POST";
    }
  } else {
    headers["X-VERIFY"] = `${sha256(`${path}${secret}`)}###${String(config.saltIndex)}`;
    if (config.providerId) {
      headers["X-PROVIDER-ID"] = config.providerId;
    }
  }

  const response = await fetch(`${baseUrlForEnvironment(config.environment)}${path}`, {
    method: options.method,
    headers,
    ...(body ? { body } : {}),
  });
  const text = await response.text();
  const parsed = tryParseJson(text);
  if (!response.ok) {
    throw new PhonePeError(providerErrorMessage(parsed, text, "PhonePe request failed"), response.status, parsed ?? text, readString(asRecord(parsed)?.code) ?? undefined);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new PhonePeError("PhonePe returned an unreadable response", 502, text);
  }

  const record = parsed as Record<string, unknown>;
  if (record.success === false) {
    throw new PhonePeError(providerErrorMessage(parsed, text, "PhonePe request failed"), 502, parsed, readString(record.code) ?? undefined);
  }

  return record;
}

function verifyCallbackSignature(signature: string, encodedPayload: string, config: StoredPhonePeIntegrationConfig): boolean {
  const secret = decryptPhonePeSecret(config.saltKey);
  if (!secret) {
    return false;
  }
  const expected = `${sha256(`${encodedPayload}${secret}`)}###${String(config.saltIndex)}`;
  return safeStringEqual(signature, expected);
}

function extractEncodedCallbackPayload(body: unknown, rawBody: string): string | null {
  if (typeof body === "string" && body.trim()) {
    return body.trim();
  }
  const record = asRecord(body);
  if (record) {
    const encoded = readString(record.response) ?? readString(record.request) ?? readString(record.payload);
    if (encoded) {
      return encoded;
    }
  }
  const parsed = tryParseJson(rawBody);
  if (parsed && typeof parsed === "object") {
    const encoded = readString((parsed as Record<string, unknown>).response) ?? readString((parsed as Record<string, unknown>).request);
    if (encoded) {
      return encoded;
    }
  }
  return null;
}

function decodeBase64Json(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as unknown;
  } catch {
    throw new PhonePeError("PhonePe callback payload could not be decoded", 400);
  }
}

function mapProviderPayloadToAttempt(channel: PhonePeChannel, payload: unknown): {
  status: AttemptStatus;
  providerState: string | null;
  referenceNumber: string | null;
  providerReferenceId: string | null;
  responseCode: string | null;
} {
  const record = asRecord(payload);
  const data = asRecord(record?.data);
  const referenceNumber = readString(data?.referenceNumber) ?? null;
  const providerReferenceId = readString(data?.providerReferenceId) ?? null;
  const responseCode = readString(data?.responseCode) ?? readString(data?.payResponseCode) ?? readString(record?.code) ?? null;

  if (channel === "CARD") {
    const providerState = readString(data?.status) ?? readString(record?.code) ?? null;
    return {
      status: mapCardAttemptStatus(providerState),
      providerState,
      referenceNumber,
      providerReferenceId,
      responseCode,
    };
  }

  const providerState = readString(data?.paymentState) ?? readString(record?.code) ?? null;
  return {
    status: mapUpiAttemptStatus(readString(record?.code), providerState),
    providerState,
    referenceNumber,
    providerReferenceId,
    responseCode,
  };
}

function mapCardAttemptStatus(providerState: string | null): AttemptStatus {
  const normalized = providerState?.toUpperCase() ?? "";
  if (normalized === "SUCCESS") return "SUCCESS";
  if (normalized === "FAILED") return "FAILED";
  if (normalized === "EXPIRED") return "EXPIRED";
  return "PENDING";
}

function mapUpiAttemptStatus(code: string | null, providerState: string | null): AttemptStatus {
  const normalizedCode = code?.toUpperCase() ?? "";
  const normalizedState = providerState?.toUpperCase() ?? "";
  if (normalizedCode === "PAYMENT_SUCCESS" || normalizedState === "COMPLETED" || normalizedState === "SUCCESS") {
    return "SUCCESS";
  }
  if (["PAYMENT_ERROR", "PAYMENT_CANCELLED", "PAYMENT_DECLINED", "BAD_REQUEST", "TRANSACTION_NOT_FOUND"].includes(normalizedCode) || ["FAILED", "DECLINED", "CANCELLED"].includes(normalizedState)) {
    return "FAILED";
  }
  if (normalizedState === "EXPIRED") {
    return "EXPIRED";
  }
  return "PENDING";
}

function formatAttempt(
  attempt: {
    id: string;
    paymentMethodId: string;
    provider: string;
    channel: string;
    externalOrderId: string;
    externalTransactionId: string;
    amount: { toNumber: () => number };
    status: string;
    providerState: string | null;
    referenceNumber: string | null;
    providerReferenceId: string | null;
    responseCode: string | null;
    qrString: string | null;
    qrDataUrl: string | null;
    expiresAt: Date | null;
    createdAt: Date;
    completedAt: Date | null;
  },
  manualOverrideAllowed: boolean,
) {
  return {
    id: attempt.id,
    payment_method_id: attempt.paymentMethodId,
    provider: attempt.provider.toLowerCase(),
    channel: attempt.channel.toLowerCase(),
    amount: attempt.amount.toNumber(),
    status: attempt.status.toLowerCase(),
    provider_state: attempt.providerState,
    reference_number: attempt.referenceNumber,
    provider_reference_id: attempt.providerReferenceId,
    response_code: attempt.responseCode,
    qr_string: attempt.qrString,
    qr_data_url: attempt.qrDataUrl,
    external_order_id: attempt.externalOrderId,
    external_transaction_id: attempt.externalTransactionId,
    manual_override_allowed: manualOverrideAllowed,
    expires_at: attempt.expiresAt?.toISOString() ?? null,
    created_at: attempt.createdAt.toISOString(),
    completed_at: attempt.completedAt?.toISOString() ?? null,
    message: describeAttemptStatus(attempt.status, attempt.channel),
  };
}

function describeAttemptStatus(status: string, channel: string): string {
  const normalizedStatus = status.toUpperCase();
  if (normalizedStatus === "SUCCESS") {
    return channel === "CARD" ? "Card payment verified." : "UPI payment verified.";
  }
  if (normalizedStatus === "FAILED") {
    return channel === "CARD" ? "Card payment failed on PhonePe." : "UPI payment failed on PhonePe.";
  }
  if (normalizedStatus === "EXPIRED") {
    return channel === "CARD" ? "PhonePe terminal request expired." : "PhonePe QR request expired.";
  }
  if (normalizedStatus === "MANUAL_OVERRIDE") {
    return "Manual override recorded.";
  }
  return channel === "CARD" ? "Waiting for the PhonePe terminal to complete the card payment." : "Waiting for the customer to complete the PhonePe QR payment.";
}

function buildCallbackUrl(tenantId: string, attemptId: string): string | null {
  const baseUrl = publicBaseUrl();
  if (!baseUrl) {
    return null;
  }
  return `${baseUrl}/api/public/payment-integrations/phonepe/callback?tenantId=${encodeURIComponent(tenantId)}&attemptId=${encodeURIComponent(attemptId)}`;
}

function publicBaseUrl(): string | null {
  const baseUrl = process.env.PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? (process.env.APP_DOMAIN ? `https://${process.env.APP_DOMAIN}` : null);
  if (!baseUrl || !baseUrl.startsWith("https://")) {
    return null;
  }
  return baseUrl.replace(/\/+$/, "");
}

function createTransactionId(channel: PhonePeChannel): string {
  const prefix = channel === "CARD" ? "BBC" : "BBU";
  return `${prefix}_${Date.now().toString(36).toUpperCase()}_${randomBytes(3).toString("hex").toUpperCase()}`;
}

function createExternalOrderId(value: string): string {
  const sanitized = value.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^[-_]+|[-_]+$/g, "");
  return (sanitized || `POS-${Date.now().toString(36).toUpperCase()}`).slice(0, 64);
}

function baseUrlForEnvironment(environment: "PRODUCTION" | "UAT"): string {
  return environment === "UAT"
    ? "https://mercury-uat.phonepe.com/enterprise-sandbox"
    : "https://mercury-t2.phonepe.com";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isTerminalAttemptStatus(status: string): boolean {
  return ["SUCCESS", "FAILED", "EXPIRED", "MANUAL_OVERRIDE"].includes(status.toUpperCase());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function providerErrorMessage(parsed: unknown, raw: string, fallback: string): string {
  const record = asRecord(parsed);
  return readString(record?.message) ?? readString(record?.error) ?? (raw.trim() || fallback);
}

function tryParseJson(value: string): unknown {
  if (!value.trim()) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function toJsonInput(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function toPaise(value: number): number {
  return Math.round(value * 100);
}
