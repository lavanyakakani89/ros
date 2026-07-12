import { z } from "zod";

import { encryptPhonePeSecret } from "./phonepe.credentials.js";

export const PHONEPE_INTEGRATION_PROVIDER = "PHONEPE" as const;

export type PhonePeEnvironment = "PRODUCTION" | "UAT";

export interface StoredPhonePeIntegrationConfig {
  environment: PhonePeEnvironment;
  merchantId: string;
  storeId: string;
  terminalId: string | null;
  providerId: string | null;
  saltIndex: number;
  saltKey: string;
  qrExpirySeconds: number;
  handoverTimeoutSeconds: number;
  autoAccept: boolean;
}

export const phonePeIntegrationProviderSchema = z.preprocess(
  (value) => value === "" || value === null ? null : typeof value === "string" ? value.toUpperCase() : value,
  z.literal(PHONEPE_INTEGRATION_PROVIDER).nullable(),
);

const phonePeEnvironmentSchema = z.preprocess(
  (value) => typeof value === "string" ? value.toUpperCase() : value,
  z.enum(["PRODUCTION", "UAT"]),
);

export const phonePeIntegrationConfigInputSchema = z.object({
  environment: phonePeEnvironmentSchema.optional(),
  merchant_id: z.string().trim().min(1).max(64).optional(),
  store_id: z.string().trim().min(1).max(64).optional(),
  terminal_id: z.string().trim().min(1).max(38).nullable().optional(),
  provider_id: z.string().trim().min(1).max(64).nullable().optional(),
  salt_index: z.coerce.number().int().min(1).max(99).optional(),
  salt_key: z.string().trim().min(1).max(256).nullable().optional(),
  qr_expiry_seconds: z.coerce.number().int().min(60).max(3600).optional(),
  handover_timeout_seconds: z.coerce.number().int().min(60).max(300).optional(),
  auto_accept: z.boolean().optional(),
}).strict();

export type PhonePeIntegrationConfigInput = z.infer<typeof phonePeIntegrationConfigInputSchema>;

export function parseStoredPhonePeIntegrationConfig(value: unknown): StoredPhonePeIntegrationConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const environment = record.environment === "UAT" ? "UAT" : record.environment === "PRODUCTION" ? "PRODUCTION" : null;
  const merchantId = readNonEmptyString(record.merchantId);
  const storeId = readNonEmptyString(record.storeId);
  const saltKey = readNonEmptyString(record.saltKey);
  const saltIndex = typeof record.saltIndex === "number" && Number.isInteger(record.saltIndex) ? record.saltIndex : null;
  if (!environment || !merchantId || !storeId || !saltKey || !saltIndex) {
    return null;
  }

  return {
    environment,
    merchantId,
    storeId,
    terminalId: readNullableString(record.terminalId),
    providerId: readNullableString(record.providerId),
    saltIndex,
    saltKey,
    qrExpirySeconds: typeof record.qrExpirySeconds === "number" && Number.isInteger(record.qrExpirySeconds) ? record.qrExpirySeconds : 180,
    handoverTimeoutSeconds: typeof record.handoverTimeoutSeconds === "number" && Number.isInteger(record.handoverTimeoutSeconds) ? record.handoverTimeoutSeconds : 60,
    autoAccept: record.autoAccept === true,
  };
}

export function buildStoredPhonePeIntegrationConfig(
  input: PhonePeIntegrationConfigInput | null | undefined,
  options: { existing?: StoredPhonePeIntegrationConfig | null; requiresTerminalId: boolean },
): StoredPhonePeIntegrationConfig {
  const next = input ?? {};
  const existing = options.existing ?? null;

  const environment = next.environment ?? existing?.environment ?? "PRODUCTION";
  const merchantId = next.merchant_id?.trim() || existing?.merchantId || "";
  const storeId = next.store_id?.trim() || existing?.storeId || "";
  const terminalId = next.terminal_id === undefined
    ? existing?.terminalId ?? null
    : next.terminal_id?.trim() || null;
  const providerId = next.provider_id === undefined
    ? existing?.providerId ?? null
    : next.provider_id?.trim() || null;
  const saltIndex = next.salt_index ?? existing?.saltIndex ?? 0;
  const rawSaltKey = next.salt_key === undefined
    ? null
    : next.salt_key?.trim() || null;
  const saltKey = rawSaltKey ? encryptPhonePeSecret(rawSaltKey) : existing?.saltKey ?? "";
  const qrExpirySeconds = next.qr_expiry_seconds ?? existing?.qrExpirySeconds ?? 180;
  const handoverTimeoutSeconds = next.handover_timeout_seconds ?? existing?.handoverTimeoutSeconds ?? 60;
  const autoAccept = next.auto_accept ?? existing?.autoAccept ?? false;

  if (!merchantId) {
    throw new Error("PhonePe merchant ID is required");
  }
  if (!storeId) {
    throw new Error("PhonePe store ID is required");
  }
  if (options.requiresTerminalId && !terminalId) {
    throw new Error("PhonePe terminal ID is required for card payments");
  }
  if (!saltIndex) {
    throw new Error("PhonePe salt index is required");
  }
  if (!saltKey) {
    throw new Error("PhonePe salt key is required");
  }

  return {
    environment,
    merchantId,
    storeId,
    terminalId,
    providerId,
    saltIndex,
    saltKey,
    qrExpirySeconds,
    handoverTimeoutSeconds,
    autoAccept,
  };
}

export function toPublicPhonePeIntegrationConfig(config: StoredPhonePeIntegrationConfig | null) {
  if (!config) {
    return null;
  }

  return {
    environment: config.environment.toLowerCase(),
    merchant_id: config.merchantId,
    store_id: config.storeId,
    terminal_id: config.terminalId,
    provider_id: config.providerId,
    salt_index: config.saltIndex,
    salt_key_configured: Boolean(config.saltKey),
    qr_expiry_seconds: config.qrExpirySeconds,
    handover_timeout_seconds: config.handoverTimeoutSeconds,
    auto_accept: config.autoAccept,
  };
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
