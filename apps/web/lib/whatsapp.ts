import type { InvoiceRecord } from "@/components/billing/invoice-history";

interface InvoiceShareInput {
  invoiceNumber: string;
  grandTotal: number;
  paymentMode: string;
  tenantName: string;
  customerName?: string | null | undefined;
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

export function formatInvoiceWhatsappMessage(input: InvoiceShareInput): string {
  const greeting = input.customerName ? `Hi ${input.customerName},` : "Hi,";
  const lines = [
    greeting,
    `Your invoice ${input.invoiceNumber} from ${input.tenantName} is ready.`,
    `Total: ₹${input.grandTotal.toFixed(2)}.`,
    `Payment: ${input.paymentMode}.`,
  ];
  const items = input.items?.slice(0, 8) ?? [];
  if (items.length > 0) {
    lines.push(
      "",
      "Items:",
      ...items.map((item) => `- ${item.productName} x ${formatQuantity(item.quantity)} = ₹${item.total.toFixed(2)}`),
    );
  }

  return lines.join("\n");
}

export function formatInvoiceRecordWhatsappMessage(invoice: InvoiceRecord, tenantName: string): string {
  return formatInvoiceWhatsappMessage({
    invoiceNumber: invoice.invoiceNumber,
    grandTotal: Number(invoice.grandTotal),
    paymentMode: invoice.paymentMode,
    tenantName,
    customerName: invoice.customer?.name,
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

  return [
    greeting,
    `${invoiceLine} from ${input.tenantName} is ${status}.`,
    amountLine,
    deliveryLine,
  ].filter(Boolean).join("\n");
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}
