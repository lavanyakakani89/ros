import { createHmac } from "node:crypto";

import { InvoiceStatus, PaymentMode, StorefrontPaymentProvider, type Tenant, type UserRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import Razorpay from "razorpay";

import { PaymentsRepository } from "./payments.repository.js";
import type { PaymentListQuery, RazorpayOrderInput, RazorpayPaymentLinkInput, RazorpayVerifyInput, RecordPaymentInput } from "./payments.types.js";
import { decryptStorefrontSecret } from "../storefront/storefront.credentials.js";
import { queueWhatsappNotification } from "../whatsapp/whatsapp.notifications.js";
import { moneyForWhatsapp, renderWhatsappMessageTemplate } from "../whatsapp/whatsapp.templates.js";

interface RazorpayWebhookInput {
  rawBody: string;
  signature: string | undefined;
  event: unknown;
}

type RazorpayClient = InstanceType<typeof Razorpay>;

interface RazorpayPaymentLinkPayload {
  amount: number;
  currency: "INR";
  accept_partial: false;
  description: string;
  reference_id: string;
  customer: {
    name: string;
    email?: string;
    contact?: string | number;
  };
  notify: {
    email: false;
    sms: false;
    whatsapp: false;
  };
  reminder_enable: false;
  notes: Record<string, string>;
}

interface RazorpayPaymentLinkResult {
  id: string;
  short_url: string;
  amount: number | string;
  expire_by?: number | string | undefined;
}

interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  source: "tenant" | "platform";
}

export class PaymentsError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export class PaymentsService {
  private readonly repository: PaymentsRepository;

  constructor(private readonly fastify: FastifyInstance) {
    this.repository = new PaymentsRepository(fastify.prisma);
  }

  async recordPayment(tenant: Tenant, user: { userId: string; role: UserRole }, input: RecordPaymentInput) {
    try {
      const result = await this.repository.recordPayment(tenant.id, user.userId, input);
      if (!result) {
        throw new PaymentsError("Confirmed invoice not found", 404);
      }

      return result;
    } catch (error) {
      if (error instanceof PaymentsError) {
        throw error;
      }

      throw new PaymentsError(error instanceof Error ? error.message : "Unable to record payment", 409);
    }
  }

  listPayments(tenant: Tenant, query: PaymentListQuery) {
    return this.repository.listPayments(tenant.id, query);
  }

  async getRazorpayStatus(tenant: Tenant) {
    const config = await this.resolveRazorpayConfig(tenant);
    return {
      configured: Boolean(config),
      source: config?.source ?? null,
    };
  }

  async createRazorpayOrder(tenant: Tenant, input: RazorpayOrderInput) {
    const razorpay = await this.createRazorpayClient(tenant);

    return razorpay.orders.create({
      amount: Math.round(input.amount * 100),
      currency: "INR",
      ...(input.receipt ? { receipt: input.receipt } : {}),
      notes: {
        tenantId: tenant.id,
        ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
      },
    });
  }

  async createRazorpayPaymentLink(tenant: Tenant, input: RazorpayPaymentLinkInput) {
    const invoice = await this.repository.findInvoiceForPaymentLink(tenant.id, input.invoiceId);
    if (!invoice) {
      throw new PaymentsError("Invoice not found", 404);
    }

    if (invoice.status === InvoiceStatus.DRAFT || invoice.status === InvoiceStatus.PENDING_WHATSAPP || invoice.status === InvoiceStatus.CANCELLED) {
      throw new PaymentsError("Payment link can be created only for confirmed invoices", 400);
    }

    const amountDue = invoice.amountDue.toNumber();
    if (amountDue <= 0.01) {
      throw new PaymentsError("Invoice has no pending amount", 400);
    }

    if (input.amount > amountDue + 0.01) {
      throw new PaymentsError("Payment link amount cannot exceed invoice amount due", 400);
    }

    const requestedCustomer = input.customerId ? await this.repository.findCustomer(tenant.id, input.customerId) : null;
    if (input.customerId && !requestedCustomer) {
      throw new PaymentsError("Customer not found", 404);
    }

    const customer = requestedCustomer ?? invoice.customer;
    const razorpay = await this.createRazorpayClient(tenant);
    const linkCustomer: RazorpayPaymentLinkPayload["customer"] = {
      name: normalizeRazorpayCustomerName(customer?.name ?? tenant.name),
    };
    if (customer?.email) {
      linkCustomer.email = customer.email;
    }
    const contact = normalizeRazorpayContact(customer?.phone ?? tenant.phone);
    if (contact) {
      linkCustomer.contact = contact;
    }
    const link = await createPaymentLink(razorpay, {
      amount: Math.round(input.amount * 100),
      currency: "INR",
      accept_partial: false,
      description: input.description ?? `Payment for invoice ${invoice.invoiceNumber}`,
      reference_id: invoice.invoiceNumber,
      customer: linkCustomer,
      notify: {
        email: false,
        sms: false,
        whatsapp: false,
      },
      reminder_enable: false,
      notes: {
        tenantId: tenant.id,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      },
    });

    await this.repository.updateInvoicePaymentLinkId(tenant.id, invoice.id, link.id);

    return paymentLinkResponse(link);
  }

  async shareRazorpayPaymentLink(tenant: Tenant, linkId: string) {
    const invoice = await this.repository.findInvoiceByPaymentLinkId(tenant.id, linkId);
    if (!invoice) {
      throw new PaymentsError("Payment link is not attached to an invoice", 404);
    }

    if (!invoice.customer?.phone) {
      throw new PaymentsError("Invoice customer phone number is required for WhatsApp sharing", 400);
    }

    const link = await fetchPaymentLink(await this.createRazorpayClient(tenant), linkId);
    const amount = Number(link.amount) / 100;
    const message = await renderWhatsappMessageTemplate(this.fastify, tenant.id, "paymentLink", {
      customerName: invoice.customer.name,
      tenantName: tenant.name,
      invoiceNumber: invoice.invoiceNumber,
      amount: moneyForWhatsapp(amount),
      paymentUrl: link.short_url,
    });

    await queueWhatsappNotification(this.fastify, {
      tenantId: tenant.id,
      phone: invoice.customer.phone,
      customerId: invoice.customer.id,
      invoiceId: invoice.id,
      message,
      jobName: `payment-link:${invoice.id}`,
      eventKey: "paymentLink",
    });

    return {
      queued: true,
      ...paymentLinkResponse(link),
    };
  }

  verifyRazorpayPayment(input: RazorpayVerifyInput) {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? process.env.RAZORPAY_KEY_SECRET;

    if (!webhookSecret) {
      throw new PaymentsError("Razorpay webhook secret is not configured", 501);
    }

    const expectedSignature = createHmac("sha256", webhookSecret)
      .update(`${input.orderId}|${input.paymentId}`)
      .digest("hex");

    return {
      verified: expectedSignature === input.signature,
    };
  }

  async handleRazorpayWebhook(input: RazorpayWebhookInput) {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      throw new PaymentsError("Razorpay webhook secret is not configured", 501);
    }

    if (!input.signature) {
      throw new PaymentsError("Missing Razorpay signature", 400);
    }

    const expectedSignature = createHmac("sha256", webhookSecret).update(input.rawBody).digest("hex");
    if (expectedSignature !== input.signature) {
      throw new PaymentsError("Invalid Razorpay webhook signature", 400);
    }

    const eventName = readEventName(input.event);
    if (eventName !== "payment.captured") {
      return {
        received: true,
        event: eventName,
      };
    }

    const payment = readRazorpayPayment(input.event);
    if (!payment?.id || !payment.invoiceId || !payment.tenantId || !payment.amount) {
      throw new PaymentsError("Razorpay webhook missing invoice payment metadata", 400);
    }

    await this.repository.setTenantContext(payment.tenantId);
    const existingPayment = await this.repository.findByRazorpayId(payment.tenantId, payment.id);
    if (existingPayment) {
      return {
        received: true,
        event: eventName,
        duplicate: true,
      };
    }

    const result = await this.repository.recordPayment(payment.tenantId, "razorpay-webhook", {
      invoiceId: payment.invoiceId,
      amount: payment.amount,
      mode: mapRazorpayMethod(payment.method),
      referenceNumber: payment.referenceNumber,
      razorpayId: payment.id,
    });

    if (!result) {
      throw new PaymentsError("Confirmed invoice not found for Razorpay payment", 404);
    }

    return {
      received: true,
      event: eventName,
      payment: result.payment,
      invoice: result.invoice,
    };
  }

  private async createRazorpayClient(tenant?: Tenant) {
    const config = tenant ? await this.resolveRazorpayConfig(tenant) : platformRazorpayConfig();
    if (!config) {
      throw new PaymentsError("Razorpay credentials are not configured. Configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the API server environment (.env.testing on test, .env.production on production).", 501);
    }

    return new Razorpay({
      key_id: config.keyId,
      key_secret: config.keySecret,
    });
  }

  private async resolveRazorpayConfig(tenant: Tenant): Promise<RazorpayConfig | null> {
    const settings = await this.fastify.prisma.storefrontSettings.findUnique({
      where: {
        tenantId: tenant.id,
      },
    });

    if (settings?.paymentProvider === StorefrontPaymentProvider.TENANT_RAZORPAY) {
      const keyId = settings.tenantRazorpayKeyId;
      const keySecret = decryptStorefrontSecret(settings.tenantRazorpayKeySecretCiphertext);
      if (keyId && keySecret && isConfiguredRazorpaySecret(keyId) && isConfiguredRazorpaySecret(keySecret)) {
        return {
          keyId,
          keySecret,
          source: "tenant",
        };
      }
    }

    return platformRazorpayConfig();
  }
}

function platformRazorpayConfig(): RazorpayConfig | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!isConfiguredRazorpaySecret(keyId) || !isConfiguredRazorpaySecret(keySecret)) {
    return null;
  }

  return {
    keyId,
    keySecret,
    source: "platform",
  };
}

function createPaymentLink(client: RazorpayClient, payload: RazorpayPaymentLinkPayload): Promise<RazorpayPaymentLinkResult> {
  return new Promise((resolve, reject) => {
    client.paymentLink.create(payload, (error, data) => {
      if (error) {
        reject(new PaymentsError(razorpayErrorMessage(error), 502));
        return;
      }

      resolve(paymentLinkResult(data));
    });
  });
}

function fetchPaymentLink(client: RazorpayClient, linkId: string): Promise<RazorpayPaymentLinkResult> {
  return new Promise((resolve, reject) => {
    client.paymentLink.fetch(linkId, (error, data) => {
      if (error) {
        reject(new PaymentsError(razorpayErrorMessage(error), 502));
        return;
      }

      resolve(paymentLinkResult(data));
    });
  });
}

function paymentLinkResult(link: RazorpayPaymentLinkResult): RazorpayPaymentLinkResult {
  return {
    id: link.id,
    short_url: link.short_url,
    amount: link.amount,
    ...(link.expire_by !== undefined ? { expire_by: link.expire_by } : {}),
  };
}

function paymentLinkResponse(link: RazorpayPaymentLinkResult) {
  const expireBy = typeof link.expire_by === "number" ? link.expire_by : Number(link.expire_by);
  return {
    paymentLinkId: link.id,
    shortUrl: link.short_url,
    expiresAt: Number.isFinite(expireBy) && expireBy > 0 ? new Date(expireBy * 1000).toISOString() : null,
  };
}

function razorpayErrorMessage(error: unknown): string {
  const record = asRecord(error);
  const nested = asRecord(record?.error);
  const description = readString(nested, "description") ?? readString(record, "description") ?? readString(record, "message");
  const configHint = "Configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the API server environment (.env.testing on test, .env.production on production).";
  if (description && /authentication failed/i.test(description)) {
    return `Razorpay payment link failed: ${description}. ${configHint}`;
  }

  return description ? `Razorpay payment link failed: ${description}` : `Razorpay payment link failed. ${configHint}`;
}

function isConfiguredRazorpaySecret(value: string | undefined): value is string {
  if (!value?.trim()) {
    return false;
  }

  return !/^(replace-me|changeme|change-me|test-key|test-secret|xxxx|dummy)$/i.test(value.trim());
}

function normalizeRazorpayCustomerName(value: string): string {
  const trimmed = value.trim() || "RetailOS Customer";
  return trimmed.length < 3 ? "RetailOS Customer" : trimmed.slice(0, 50);
}

function normalizeRazorpayContact(value: string | null | undefined): string | undefined {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) {
    return undefined;
  }

  const localNumber = digits.length > 10 ? digits.slice(-10) : digits;
  return localNumber.length === 10 ? `91${localNumber}` : localNumber.slice(0, 15);
}

function readEventName(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null || !("event" in event)) {
    return undefined;
  }

  const eventName = event.event;
  return typeof eventName === "string" ? eventName : undefined;
}

function readRazorpayPayment(event: unknown): { id?: string; tenantId?: string; invoiceId?: string; amount?: number; method?: string; referenceNumber?: string } | undefined {
  const eventRecord = asRecord(event);
  const payload = asRecord(eventRecord?.payload);
  const paymentContainer = asRecord(payload?.payment);
  const entity = asRecord(paymentContainer?.entity);
  if (!entity) {
    return undefined;
  }

  const notes = asRecord(entity.notes);
  const amountPaise = typeof entity.amount === "number" ? entity.amount : Number(entity.amount);
  const id = typeof entity.id === "string" ? entity.id : undefined;
  const method = typeof entity.method === "string" ? entity.method : undefined;
  const tenantId = readString(notes, "tenantId") ?? readString(notes, "tenant_id");
  const invoiceId = readString(notes, "invoiceId") ?? readString(notes, "invoice_id");
  const referenceNumber = typeof entity.acquirer_data === "object" && entity.acquirer_data !== null
    ? Object.values(entity.acquirer_data as Record<string, unknown>).find((value): value is string => typeof value === "string")
    : id;

  return {
    ...(id ? { id } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(invoiceId ? { invoiceId } : {}),
    ...(Number.isFinite(amountPaise) ? { amount: amountPaise / 100 } : {}),
    ...(method ? { method } : {}),
    ...(referenceNumber ? { referenceNumber } : {}),
  };
}

function mapRazorpayMethod(method: string | undefined): PaymentMode {
  if (method === "card") return PaymentMode.CARD;
  if (method === "netbanking") return PaymentMode.NETBANKING;
  if (method === "upi") return PaymentMode.UPI;
  return PaymentMode.UPI;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}
