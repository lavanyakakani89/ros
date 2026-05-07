import { PaymentMode, Prisma, type Product, type Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { BillingService } from "../billing/billing.service.js";
import { normalizeWhatsappPhone } from "./whatsapp.notifications.js";
import type { WhatsappOrdersQuery } from "./whatsapp.schema.js";

export interface InboundWhatsappMessage {
  provider: string;
  externalMessageId?: string | undefined;
  phone: string;
  customerName?: string | undefined;
  body: string;
  messageType?: string | undefined;
  receivedAt?: Date | undefined;
  payload?: unknown;
}

interface ParsedOrderLine {
  line: string;
  productId: string;
  productName: string;
  quantity: number;
  sellingPrice: number;
}

interface UnmatchedOrderLine {
  line: string;
  reason: string;
}

export class WhatsappIntegrationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export class WhatsappService {
  private readonly billingService: BillingService;

  constructor(private readonly fastify: FastifyInstance) {
    this.billingService = new BillingService(fastify);
  }

  async handleInboundMessage(tenant: Tenant, input: InboundWhatsappMessage) {
    const phone = normalizeWhatsappPhone(input.phone);
    if (!phone || phone.length < 10) {
      throw new WhatsappIntegrationError("WhatsApp sender phone is invalid", 400);
    }

    const body = input.body.trim();
    if (!body) {
      return this.createIgnoredMessage(tenant, input, phone, "Empty message");
    }

    const existing = input.externalMessageId
      ? await this.fastify.prisma.whatsappMessage.findUnique({
          where: {
            tenantId_externalMessageId: {
              tenantId: tenant.id,
              externalMessageId: input.externalMessageId,
            },
          },
        })
      : null;

    if (existing) {
      return {
        status: "duplicate",
        messageId: existing.id,
      };
    }

    const customer = await this.findOrCreateCustomer(tenant, {
      phone,
      rawOrder: body,
      ...(input.customerName ? { name: input.customerName } : {}),
    });
    const message = await this.fastify.prisma.whatsappMessage.create({
      data: {
        tenantId: tenant.id,
        direction: "INBOUND",
        phone,
        customerId: customer.id,
        customerName: customer.name,
        externalMessageId: input.externalMessageId ?? null,
        provider: input.provider,
        messageType: input.messageType ?? "text",
        body,
        payload: toJson(input.payload) ?? Prisma.JsonNull,
        receivedAt: input.receivedAt ?? new Date(),
        status: "RECEIVED",
      },
    });

    const products = await this.fastify.prisma.product.findMany({
      where: {
        tenantId: tenant.id,
        isActive: true,
      },
      orderBy: {
        name: "asc",
      },
    });
    const parsed = parseOrderText(body, products);
    const order = await this.fastify.prisma.whatsappOrder.create({
      data: {
        tenantId: tenant.id,
        messageId: message.id,
        customerId: customer.id,
        phone,
        customerName: customer.name,
        rawText: body,
        parsedItems: parsed.items as unknown as Prisma.InputJsonValue,
        unmatchedLines: parsed.unmatched as unknown as Prisma.InputJsonValue,
        status: parsed.items.length > 0 && parsed.unmatched.length === 0 ? "DRAFT_CREATED" : "NEEDS_REVIEW",
      },
    });

    if (parsed.items.length === 0) {
      await this.fastify.prisma.whatsappMessage.update({
        where: {
          id: message.id,
        },
        data: {
          status: "PARSED",
          error: "No product lines matched. Order kept for manual review.",
        },
      });

      return {
        status: "needs_review",
        orderId: order.id,
        messageId: message.id,
        unmatchedLines: parsed.unmatched,
      };
    }

    const invoice = await this.billingService.createInvoice(tenant, {
      customerId: customer.id,
      paymentMode: PaymentMode.CASH,
      billDiscount: 0,
      notes: buildInvoiceNotes(body, parsed.unmatched),
      verticalData: {
        source: "WHATSAPP",
        whatsappOrderId: order.id,
        whatsappMessageId: message.id,
        whatsappFrom: phone,
        whatsappUnmatchedLines: parsed.unmatched,
      },
      items: parsed.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        sellingPrice: item.sellingPrice,
      })),
    });

    await Promise.all([
      this.fastify.prisma.whatsappOrder.update({
        where: {
          id: order.id,
        },
        data: {
          invoiceId: invoice.id,
          status: parsed.unmatched.length > 0 ? "NEEDS_REVIEW" : "DRAFT_CREATED",
        },
      }),
      this.fastify.prisma.whatsappMessage.update({
        where: {
          id: message.id,
        },
        data: {
          status: "PARSED",
          invoiceId: invoice.id,
        },
      }),
    ]);

    return {
      status: "draft_created",
      orderId: order.id,
      messageId: message.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      unmatchedLines: parsed.unmatched,
    };
  }

  async listOrders(tenant: Tenant, query: WhatsappOrdersQuery) {
    const orders = await this.fastify.prisma.whatsappOrder.findMany({
      where: {
        tenantId: tenant.id,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: {
        createdAt: "desc",
      },
      take: query.limit,
    });
    const invoiceIds = orders.map((order) => order.invoiceId).filter(Boolean) as string[];
    const invoices = invoiceIds.length > 0
      ? await this.fastify.prisma.invoice.findMany({
          where: {
            tenantId: tenant.id,
            id: {
              in: invoiceIds,
            },
          },
          include: {
            customer: true,
            items: true,
            delivery: true,
          },
        })
      : [];
    const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));

    return orders.map((order) => ({
      ...order,
      invoice: order.invoiceId ? invoiceById.get(order.invoiceId) ?? null : null,
    }));
  }

  private async createIgnoredMessage(tenant: Tenant, input: InboundWhatsappMessage, phone: string, reason: string) {
    const message = await this.fastify.prisma.whatsappMessage.create({
      data: {
        tenantId: tenant.id,
        direction: "INBOUND",
        phone,
        customerName: input.customerName ?? null,
        externalMessageId: input.externalMessageId ?? null,
        provider: input.provider,
        messageType: input.messageType ?? "text",
        body: input.body,
        payload: toJson(input.payload) ?? Prisma.JsonNull,
        receivedAt: input.receivedAt ?? new Date(),
        status: "IGNORED",
        error: reason,
      },
    });

    return {
      status: "ignored",
      messageId: message.id,
      reason,
    };
  }

  private async findOrCreateCustomer(tenant: Tenant, input: { phone: string; name?: string; rawOrder: string }) {
    const possiblePhones = [...new Set([input.phone, input.phone.slice(-10)].filter((value) => value.length >= 10))];
    const existing = await this.fastify.prisma.customer.findFirst({
      where: {
        tenantId: tenant.id,
        phone: {
          in: possiblePhones,
        },
      },
    });

    if (existing) {
      return existing;
    }

    const name = normalizeCustomerName(input.name) ?? `WhatsApp ${input.phone.slice(-10)}`;
    const address = extractAddress(input.rawOrder) ?? "Address pending - WhatsApp order";
    const customerCode = await this.nextWhatsappCustomerCode(tenant.id, input.phone);

    return this.fastify.prisma.customer.create({
      data: {
        tenantId: tenant.id,
        customerCode,
        name,
        phone: input.phone.slice(-10),
        address,
        remarks: "Created automatically from WhatsApp order.",
      },
    });
  }

  private async nextWhatsappCustomerCode(tenantId: string, phone: string): Promise<string> {
    const base = `WA-${phone.slice(-10)}`;
    const existing = await this.fastify.prisma.customer.findFirst({
      where: {
        tenantId,
        customerCode: base,
      },
    });

    if (!existing) {
      return base;
    }

    return `${base}-${Date.now().toString(36).toUpperCase()}`;
  }
}

function parseOrderText(rawText: string, products: Product[]): { items: ParsedOrderLine[]; unmatched: UnmatchedOrderLine[] } {
  const lines = rawText
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean);
  const items: ParsedOrderLine[] = [];
  const unmatched: UnmatchedOrderLine[] = [];

  for (const line of lines) {
    if (isMetadataLine(line)) {
      continue;
    }

    const parsed = parseLineQuantity(line);
    const product = matchProduct(products, parsed.productText);
    if (!product) {
      unmatched.push({ line, reason: "Product not found" });
      continue;
    }

    items.push({
      line,
      productId: product.id,
      productName: product.name,
      quantity: parsed.quantity,
      sellingPrice: product.sellingPrice.toNumber(),
    });
  }

  return { items, unmatched };
}

function parseLineQuantity(line: string): { productText: string; quantity: number } {
  const normalized = line.replace(/\s+/g, " ").trim();
  const qtySuffix = normalized.match(/^(.+?)\s+(?:qty|quantity)\s*[:=-]?\s*(\d+(?:\.\d+)?)$/i);
  if (qtySuffix) {
    return { productText: qtySuffix[1]?.trim() ?? normalized, quantity: toPositiveQuantity(qtySuffix[2]) };
  }

  const xSuffix = normalized.match(/^(.+?)\s*[x*]\s*(\d+(?:\.\d+)?)$/i);
  if (xSuffix) {
    return { productText: xSuffix[1]?.trim() ?? normalized, quantity: toPositiveQuantity(xSuffix[2]) };
  }

  const xPrefix = normalized.match(/^(\d+(?:\.\d+)?)\s*[x*]\s+(.+)$/i);
  if (xPrefix) {
    return { productText: xPrefix[2]?.trim() ?? normalized, quantity: toPositiveQuantity(xPrefix[1]) };
  }

  const numberPrefix = normalized.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
  if (numberPrefix) {
    return { productText: numberPrefix[2]?.trim() ?? normalized, quantity: toPositiveQuantity(numberPrefix[1]) };
  }

  const numberSuffix = normalized.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);
  if (numberSuffix) {
    return { productText: numberSuffix[1]?.trim() ?? normalized, quantity: toPositiveQuantity(numberSuffix[2]) };
  }

  return { productText: normalized, quantity: 1 };
}

function matchProduct(products: Product[], productText: string): Product | undefined {
  const term = normalizeSearch(productText);
  const compactTerm = compact(term);
  const exactIdentifier = products.find((product) =>
    normalizeSearch(product.barcode ?? "") === term ||
    compact(normalizeSearch(product.barcode ?? "")) === compactTerm ||
    normalizeSearch(product.sku ?? "") === term ||
    compact(normalizeSearch(product.sku ?? "")) === compactTerm);

  if (exactIdentifier) {
    return exactIdentifier;
  }

  const exactName = products.find((product) => normalizeSearch(product.name) === term || compact(normalizeSearch(product.name)) === compactTerm);
  if (exactName) {
    return exactName;
  }

  return products.find((product) => {
    const name = normalizeSearch(product.name);
    return name.includes(term) || term.includes(name) || compact(name).includes(compactTerm) || compactTerm.includes(compact(name));
  });
}

function isMetadataLine(line: string): boolean {
  return /^(hi|hello|order|please|pls|thanks|thank you)$/i.test(line) ||
    /^(name|customer|phone|mobile|address|addr|delivery address|note|notes)\s*[:=-]/i.test(line);
}

function extractAddress(rawText: string): string | undefined {
  const line = rawText.split(/\r?\n/).find((item) => /^(address|addr|delivery address)\s*[:=-]/i.test(item.trim()));
  return line?.replace(/^(address|addr|delivery address)\s*[:=-]\s*/i, "").trim() || undefined;
}

function normalizeCustomerName(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized && normalized.length >= 2 ? normalized : undefined;
}

function buildInvoiceNotes(rawText: string, unmatched: UnmatchedOrderLine[]): string {
  const notes = ["WhatsApp order. Review before confirmation.", rawText];
  if (unmatched.length > 0) {
    notes.push(`Unmatched lines: ${unmatched.map((item) => item.line).join("; ")}`);
  }

  return notes.join("\n\n").slice(0, 2000);
}

function toPositiveQuantity(value: string | undefined): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 1;
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, " ").replace(/\s+/g, " ").trim();
}

function compact(value: string): string {
  return value.replace(/\s+/g, "");
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value as Prisma.InputJsonValue;
}
