import type { InvoiceRecord } from "@/components/billing/invoice-history";
import { createAuthenticatedApiClient } from "@/lib/api-client";

export const WHATSAPP_TEMPLATE_KEYS = [
  "invoiceReady",
  "paymentReminder",
  "deliveryOutForDelivery",
  "deliveryDelivered",
  "deliveryAssigned",
  "whatsappTest",
] as const;

export type WhatsappTemplateKey = (typeof WHATSAPP_TEMPLATE_KEYS)[number];

export interface WhatsappMessageTemplate {
  key: WhatsappTemplateKey;
  label: string;
  description: string;
  body: string;
  defaultBody: string;
  placeholders: string[];
}

export interface WhatsappMessageTemplatesResponse {
  templates: WhatsappMessageTemplate[];
}

interface InvoiceShareInput {
  invoiceNumber: string;
  grandTotal: number;
  paymentMode: string;
  tenantName: string;
  customerName?: string | null | undefined;
  templateBody?: string | null | undefined;
  items?: Array<{
    productName: string;
    quantity: number;
    total: number;
  }>;
}

interface DeliveryShareInput {
  tenantName: string;
  customerName?: string | null | undefined;
  invoiceNumber?: string | null | undefined;
  grandTotal?: string | number | null | undefined;
  status: string;
  address?: string | null | undefined;
  templateBody?: string | null | undefined;
}

interface PaymentReminderInput {
  invoiceNumber: string;
  amountDue: number;
  grandTotal: number;
  tenantName: string;
  customerName?: string | null | undefined;
  templateBody?: string | null | undefined;
}

export function normalizeWhatsappPhone(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const withoutLeadingZeros = digits.replace(/^0+/, "");
  if (withoutLeadingZeros.length === 10) return `91${withoutLeadingZeros}`;
  if (withoutLeadingZeros.length >= 11 && withoutLeadingZeros.length <= 15) return withoutLeadingZeros;
  return null;
}

export function buildWhatsappUrl(phone: string | null | undefined, message: string): string | null {
  const normalizedPhone = normalizeWhatsappPhone(phone);
  if (!normalizedPhone) return null;
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}

export function openWhatsappMessage(phone: string | null | undefined, message: string): boolean {
  const url = buildWhatsappUrl(phone, message);
  if (!url) return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

export function fetchWhatsappMessageTemplates(): Promise<WhatsappMessageTemplatesResponse> {
  return createAuthenticatedApiClient().get<WhatsappMessageTemplatesResponse>("/whatsapp/message-templates");
}

export function getWhatsappTemplateBody(
  response: WhatsappMessageTemplatesResponse | null | undefined,
  key: WhatsappTemplateKey,
): string | undefined {
  return response?.templates.find((template) => template.key === key)?.body;
}

export function formatInvoiceWhatsappMessage(input: InvoiceShareInput): string {
  const items = input.items?.slice(0, 8) ?? [];
  const itemsBlock = items.length > 0
    ? [
        "Items:",
        ...items.map((item) => `- ${item.productName} x ${formatQuantity(item.quantity)} = ₹${item.total.toFixed(2)}`),
      ].join("\n")
    : "";
  if (input.templateBody?.trim()) {
    return renderWhatsappTemplateBody(input.templateBody, {
      customerName: input.customerName ?? "Customer",
      tenantName: input.tenantName,
      invoiceNumber: input.invoiceNumber,
      grandTotal: input.grandTotal.toFixed(2),
      paymentMode: input.paymentMode,
      itemsBlock,
      pdfLine: "",
    });
  }

  const greeting = input.customerName ? `Hi ${input.customerName},` : "Hi,";
  const lines = [
    greeting,
    `Your invoice ${input.invoiceNumber} from ${input.tenantName} is ready.`,
    `Total: ₹${input.grandTotal.toFixed(2)}.`,
    `Payment: ${input.paymentMode}.`,
  ];
  if (items.length > 0) {
    lines.push(
      "",
      "Items:",
      ...items.map((item) => `- ${item.productName} x ${formatQuantity(item.quantity)} = ₹${item.total.toFixed(2)}`),
    );
  }

  return lines.join("\n");
}

export function formatInvoiceRecordWhatsappMessage(invoice: InvoiceRecord, tenantName: string, templateBody?: string): string {
  return formatInvoiceWhatsappMessage({
    invoiceNumber: invoice.invoiceNumber,
    grandTotal: Number(invoice.grandTotal),
    paymentMode: invoice.paymentMode,
    tenantName,
    customerName: invoice.customer?.name,
    templateBody,
    items: (invoice.items ?? []).map((item) => ({
      productName: item.productName,
      quantity: Number(item.quantity),
      total: Number(item.total),
    })),
  });
}

export function formatDeliveryWhatsappMessage(input: DeliveryShareInput): string {
  const status = input.status.replaceAll("_", " ").toLowerCase();
  const greeting = input.customerName ? `Hi ${input.customerName},` : "Hi,";
  const invoiceLine = input.invoiceNumber ? `Order ${input.invoiceNumber}` : "Your order";
  const amountLine = input.grandTotal !== null && input.grandTotal !== undefined ? `Total: ₹${Number(input.grandTotal).toFixed(2)}.` : null;
  const deliveryLine = input.status === "OUT_FOR_DELIVERY" && input.address ? `Delivery address: ${input.address}` : null;
  if (input.templateBody?.trim()) {
    return renderWhatsappTemplateBody(input.templateBody, {
      customerName: input.customerName ?? "Customer",
      tenantName: input.tenantName,
      invoiceNumber: input.invoiceNumber ?? "order",
      grandTotal: input.grandTotal !== null && input.grandTotal !== undefined ? Number(input.grandTotal).toFixed(2) : "",
      deliveryAddress: input.address ?? "",
    });
  }

  return [
    greeting,
    `${invoiceLine} from ${input.tenantName} is ${status}.`,
    amountLine,
    deliveryLine,
  ].filter(Boolean).join("\n");
}

export function formatPaymentReminderWhatsappMessage(input: PaymentReminderInput): string {
  if (input.templateBody?.trim()) {
    return renderWhatsappTemplateBody(input.templateBody, {
      customerName: input.customerName ?? "Customer",
      tenantName: input.tenantName,
      invoiceNumber: input.invoiceNumber,
      amountDue: input.amountDue.toFixed(2),
      grandTotal: input.grandTotal.toFixed(2),
    });
  }

  return [
    input.customerName ? `Hi ${input.customerName},` : "Hi,",
    `Payment reminder from ${input.tenantName} for invoice ${input.invoiceNumber}.`,
    `Due amount: ₹${input.amountDue.toFixed(2)}.`,
    "Please share the screenshot once the payment is done.  Thank you!",
  ].join("\n");
}

export function renderWhatsappTemplateBody(body: string, context: Record<string, string | number | null | undefined>): string {
  return body
    .replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => formatTemplateValue(context[key]))
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .filter((line, index, lines) => line.trim() || !isBlankLineAroundBlank(lines, index))
    .join("\n")
    .trim();
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function formatTemplateValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function isBlankLineAroundBlank(lines: string[], index: number): boolean {
  const previousBlank = index > 0 && !lines[index - 1]?.trim();
  const nextBlank = index < lines.length - 1 && !lines[index + 1]?.trim();
  return previousBlank || nextBlank;
}
