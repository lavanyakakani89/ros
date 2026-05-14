import { InvoiceStatus, PaymentMode, Prisma, UserRole, WhatsappIntegrationStatus, WhatsappOrderStatus, type Product, type Tenant, type WhatsappOrder } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { BillingService } from "../billing/billing.service.js";
import { encryptWhatsappToken } from "./whatsapp.credentials.js";
import { normalizeWhatsappPhone, queueWhatsappNotification } from "./whatsapp.notifications.js";
import type { WhatsappEmbeddedSignupCompleteInput, WhatsappMessageTemplatesInput, WhatsappOrderItemsInput, WhatsappOrdersQuery, WhatsappPasteOrderInput, WhatsappTestMessageInput } from "./whatsapp.schema.js";
import { getWhatsappMessageTemplates, renderWhatsappMessageTemplate, saveWhatsappMessageTemplates } from "./whatsapp.templates.js";

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

    const isManualPaste = input.provider === "manual-paste";
    const invoice = await this.billingService.createInvoice(tenant, {
      customerId: customer.id,
      paymentMode: PaymentMode.CASH,
      billDiscount: 0,
      notes: buildInvoiceNotes(body, parsed.unmatched),
      verticalData: {
        source: isManualPaste ? "WHATSAPP_MANUAL" : "WHATSAPP",
        ...(isManualPaste ? { whatsappManual: true } : {}),
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
      parsedItems: readParsedOrderLines(order.parsedItems),
      unmatchedLines: readUnmatchedOrderLines(order.unmatchedLines),
      summary: summarizeParsedItems(readParsedOrderLines(order.parsedItems)),
      invoice: order.invoiceId ? invoiceById.get(order.invoiceId) ?? null : null,
    }));
  }

  async getOrder(tenant: Tenant, orderId: string) {
    const order = await this.findOrder(tenant, orderId);
    return this.buildOrderDetail(tenant, order);
  }

  async updateOrderItems(tenant: Tenant, currentUser: { role: UserRole }, orderId: string, input: WhatsappOrderItemsInput) {
    ensureManager(currentUser.role);
    const order = await this.findOrder(tenant, orderId);
    ensureReviewableOrder(order);
    const items = await this.normalizeOrderItems(tenant, input.items);
    const unmatched = readUnmatchedOrderLines(order.unmatchedLines);

    const updated = await this.fastify.prisma.whatsappOrder.update({
      where: {
        id: order.id,
      },
      data: {
        parsedItems: toJson(items) ?? Prisma.JsonNull,
        status: unmatched.length > 0 ? WhatsappOrderStatus.NEEDS_REVIEW : WhatsappOrderStatus.DRAFT_CREATED,
      },
    });

    return this.buildOrderDetail(tenant, updated);
  }

  async confirmOrder(tenant: Tenant, currentUser: { role: UserRole; userId: string }, orderId: string) {
    ensureManager(currentUser.role);
    const order = await this.findOrder(tenant, orderId);
    ensureReviewableOrder(order);
    const items = readParsedOrderLines(order.parsedItems);
    if (items.length === 0) {
      throw new WhatsappIntegrationError("Add at least one matched product before confirming this WhatsApp order", 400);
    }

    const customer = order.customerId
      ? await this.fastify.prisma.customer.findFirst({
          where: {
            id: order.customerId,
            tenantId: tenant.id,
          },
        })
      : await this.findOrCreateCustomer(tenant, {
          phone: order.phone,
          ...(order.customerName ? { name: order.customerName } : {}),
          rawOrder: order.rawText,
        });

    if (!customer) {
      throw new WhatsappIntegrationError("Customer not found for this WhatsApp order", 404);
    }

    const invoicePayload = {
      customerId: customer.id,
      paymentMode: PaymentMode.CASH,
      billDiscount: 0,
      notes: buildInvoiceNotes(order.rawText, readUnmatchedOrderLines(order.unmatchedLines)),
      verticalData: {
        source: "WHATSAPP",
        whatsappOrderId: order.id,
        ...(order.messageId ? { whatsappMessageId: order.messageId } : {}),
        whatsappFrom: order.phone,
        whatsappUnmatchedLines: readUnmatchedOrderLines(order.unmatchedLines),
      },
      items: items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        sellingPrice: item.sellingPrice,
      })),
    };

    const existingInvoice = order.invoiceId
      ? await this.fastify.prisma.invoice.findFirst({
          where: {
            id: order.invoiceId,
            tenantId: tenant.id,
          },
          select: {
            id: true,
            status: true,
          },
        })
      : null;

    const invoice = existingInvoice
      ? await this.updateLinkedDraftInvoice(tenant, existingInvoice, invoicePayload, currentUser.userId)
      : await this.billingService.createInvoice(tenant, invoicePayload);

    const updated = await this.fastify.prisma.whatsappOrder.update({
      where: {
        id: order.id,
      },
      data: {
        customerId: customer.id,
        customerName: customer.name,
        invoiceId: invoice.id,
        status: WhatsappOrderStatus.CONFIRMED,
      },
    });

    if (order.messageId) {
      await this.fastify.prisma.whatsappMessage.updateMany({
        where: {
          id: order.messageId,
          tenantId: tenant.id,
        },
        data: {
          invoiceId: invoice.id,
          status: "PARSED",
        },
      });
    }

    return this.buildOrderDetail(tenant, updated);
  }

  async dismissOrder(tenant: Tenant, currentUser: { role: UserRole }, orderId: string) {
    ensureManager(currentUser.role);
    const order = await this.findOrder(tenant, orderId);
    if (order.status === WhatsappOrderStatus.CONFIRMED) {
      throw new WhatsappIntegrationError("Confirmed WhatsApp orders cannot be dismissed", 409);
    }

    const updated = await this.fastify.prisma.whatsappOrder.update({
      where: {
        id: order.id,
      },
      data: {
        status: WhatsappOrderStatus.DISMISSED,
      },
    });

    return this.buildOrderDetail(tenant, updated);
  }

  async createManualPastedOrder(tenant: Tenant, input: WhatsappPasteOrderInput) {
    return this.handleInboundMessage(tenant, {
      provider: "manual-paste",
      phone: input.phone,
      ...(input.customerName ? { customerName: input.customerName } : {}),
      body: input.body,
      messageType: "text",
      receivedAt: new Date(),
      payload: {
        source: "retailos-manual-paste",
      },
    });
  }

  async getIntegration(tenant: Tenant) {
    const integration = await this.fastify.prisma.whatsappIntegration.findUnique({
      where: {
        tenantId: tenant.id,
      },
    });

    return toIntegrationResponse(integration);
  }

  getMessageTemplates(tenant: Tenant) {
    return getWhatsappMessageTemplates(this.fastify, tenant.id);
  }

  updateMessageTemplates(tenant: Tenant, currentUser: { role: UserRole }, input: WhatsappMessageTemplatesInput) {
    ensureManager(currentUser.role);
    return saveWhatsappMessageTemplates(this.fastify, tenant.id, input.templates);
  }

  getEmbeddedSignupConfig(tenant: Tenant) {
    const appId = process.env.WHATSAPP_EMBEDDED_APP_ID ?? process.env.META_APP_ID ?? null;
    const configurationId = process.env.WHATSAPP_EMBEDDED_CONFIG_ID ?? process.env.WHATSAPP_CONFIGURATION_ID ?? null;
    const appSecret = process.env.WHATSAPP_EMBEDDED_APP_SECRET ?? process.env.WHATSAPP_WEBHOOK_APP_SECRET ?? null;
    const apiVersion = getGraphApiVersion();
    const callbackUrl = `${getPublicAppUrl()}/api/public/whatsapp/inbound`;
    const missing = [
      ...(!appId ? ["WHATSAPP_EMBEDDED_APP_ID"] : []),
      ...(!configurationId ? ["WHATSAPP_EMBEDDED_CONFIG_ID"] : []),
      ...(!appSecret ? ["WHATSAPP_EMBEDDED_APP_SECRET"] : []),
      ...(!process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ? ["WHATSAPP_WEBHOOK_VERIFY_TOKEN"] : []),
    ];

    return {
      isConfigured: missing.length === 0,
      appId,
      configurationId,
      apiVersion,
      callbackUrl,
      legacyCallbackUrl: `${getPublicAppUrl()}/api/public/whatsapp/${tenant.slug}/inbound`,
      verifyTokenConfigured: Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
      missing,
    };
  }

  async completeEmbeddedSignup(
    tenant: Tenant,
    currentUser: { role: UserRole },
    input: WhatsappEmbeddedSignupCompleteInput,
  ) {
    ensureManager(currentUser.role);

    const appId = process.env.WHATSAPP_EMBEDDED_APP_ID ?? process.env.META_APP_ID;
    const appSecret = process.env.WHATSAPP_EMBEDDED_APP_SECRET ?? process.env.WHATSAPP_WEBHOOK_APP_SECRET;
    if (!appId || !appSecret) {
      throw new WhatsappIntegrationError("WhatsApp Embedded Signup is not configured on the server", 503);
    }

    const sessionData = toRecord(toRecord(input.sessionPayload).data);
    let phoneNumberId = input.phoneNumberId ?? stringValue(sessionData.phone_number_id);
    const wabaId = input.wabaId ?? stringValue(sessionData.waba_id);
    const businessId = input.businessId ?? stringValue(sessionData.business_id);
    const token = await exchangeEmbeddedSignupCode({
      appId,
      appSecret,
      code: input.code,
    });

    let phoneDetails: WhatsappPhoneDetails | null = null;
    const warnings: string[] = [];

    if (!phoneNumberId && wabaId) {
      const phoneNumbers = await listWabaPhoneNumbers(wabaId, token.accessToken).catch((error: unknown) => {
        warnings.push(`Unable to read WhatsApp phone numbers: ${errorMessage(error)}`);
        return [];
      });
      const firstPhoneNumber = phoneNumbers[0];
      if (firstPhoneNumber) {
        phoneNumberId = firstPhoneNumber.id;
        phoneDetails = firstPhoneNumber;
      }
    }

    if (!phoneNumberId) {
      throw new WhatsappIntegrationError("Meta signup did not return a WhatsApp phone number ID", 400);
    }

    phoneDetails ??= await getWhatsappPhoneDetails(phoneNumberId, token.accessToken).catch((error: unknown) => {
      warnings.push(`Unable to read WhatsApp phone details: ${errorMessage(error)}`);
      return null;
    });

    if (wabaId) {
      await subscribeWabaToApp(wabaId, token.accessToken).catch((error: unknown) => {
        warnings.push(`Webhook subscription could not be confirmed automatically: ${errorMessage(error)}`);
      });
    }

    const integration = await this.fastify.prisma.whatsappIntegration.upsert({
      where: {
        tenantId: tenant.id,
      },
      create: {
        tenantId: tenant.id,
        phoneNumberId,
        wabaId: wabaId || null,
        businessId: businessId || null,
        displayPhoneNumber: phoneDetails?.display_phone_number ?? null,
        verifiedName: phoneDetails?.verified_name ?? null,
        accessTokenCiphertext: encryptWhatsappToken(token.accessToken),
        tokenExpiresAt: token.expiresAt,
        status: WhatsappIntegrationStatus.CONNECTED,
        lastError: warnings.length > 0 ? warnings.join("\n") : null,
        connectedAt: new Date(),
        disconnectedAt: null,
        setupPayload: toJson(input.sessionPayload) ?? Prisma.JsonNull,
      },
      update: {
        phoneNumberId,
        wabaId: wabaId || null,
        businessId: businessId || null,
        displayPhoneNumber: phoneDetails?.display_phone_number ?? null,
        verifiedName: phoneDetails?.verified_name ?? null,
        accessTokenCiphertext: encryptWhatsappToken(token.accessToken),
        tokenExpiresAt: token.expiresAt,
        status: WhatsappIntegrationStatus.CONNECTED,
        lastError: warnings.length > 0 ? warnings.join("\n") : null,
        connectedAt: new Date(),
        disconnectedAt: null,
        setupPayload: toJson(input.sessionPayload) ?? Prisma.JsonNull,
      },
    });

    return {
      ...toIntegrationResponse(integration),
      warnings,
    };
  }

  async disconnectIntegration(tenant: Tenant, currentUser: { role: UserRole }) {
    ensureManager(currentUser.role);

    const integration = await this.fastify.prisma.whatsappIntegration.update({
      where: {
        tenantId: tenant.id,
      },
      data: {
        status: WhatsappIntegrationStatus.DISCONNECTED,
        accessTokenCiphertext: null,
        tokenExpiresAt: null,
        disconnectedAt: new Date(),
        lastError: null,
      },
    }).catch(() => null);

    return toIntegrationResponse(integration);
  }

  async sendTestMessage(tenant: Tenant, currentUser: { role: UserRole }, input: WhatsappTestMessageInput) {
    ensureManager(currentUser.role);

    await queueWhatsappNotification(this.fastify, {
      tenantId: tenant.id,
      phone: input.phone,
      message: await renderWhatsappMessageTemplate(this.fastify, tenant.id, "whatsappTest", {
        tenantName: tenant.name,
      }),
      jobName: "whatsapp-test",
    });

    return {
      status: "queued",
    };
  }

  private async findOrder(tenant: Tenant, orderId: string): Promise<WhatsappOrder> {
    const order = await this.fastify.prisma.whatsappOrder.findFirst({
      where: {
        id: orderId,
        tenantId: tenant.id,
      },
    });

    if (!order) {
      throw new WhatsappIntegrationError("WhatsApp order not found", 404);
    }

    return order;
  }

  private async buildOrderDetail(tenant: Tenant, order: WhatsappOrder) {
    const [customer, invoice] = await Promise.all([
      order.customerId
        ? this.fastify.prisma.customer.findFirst({
            where: {
              id: order.customerId,
              tenantId: tenant.id,
            },
          })
        : Promise.resolve(null),
      order.invoiceId
        ? this.fastify.prisma.invoice.findFirst({
            where: {
              id: order.invoiceId,
              tenantId: tenant.id,
            },
            include: {
              customer: true,
              items: true,
              delivery: true,
            },
          })
        : Promise.resolve(null),
    ]);
    const parsedItems = readParsedOrderLines(order.parsedItems);

    return {
      ...order,
      customer,
      invoice,
      parsedItems,
      unmatchedLines: readUnmatchedOrderLines(order.unmatchedLines),
      summary: summarizeParsedItems(parsedItems),
    };
  }

  private async normalizeOrderItems(tenant: Tenant, items: WhatsappOrderItemsInput["items"]): Promise<ParsedOrderLine[]> {
    const productIds = [...new Set(items.map((item) => item.productId))];
    const products = await this.fastify.prisma.product.findMany({
      where: {
        tenantId: tenant.id,
        id: {
          in: productIds,
        },
        isActive: true,
      },
    });
    const productById = new Map(products.map((product) => [product.id, product]));

    if (productById.size !== productIds.length) {
      throw new WhatsappIntegrationError("One or more selected products were not found", 400);
    }

    return items.map((item) => {
      const product = productById.get(item.productId);
      if (!product) {
        throw new WhatsappIntegrationError("Selected product was not found", 400);
      }

      return {
        line: `${product.name} x ${String(item.quantity)}`,
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        sellingPrice: item.sellingPrice,
      };
    });
  }

  private async updateLinkedDraftInvoice(
    tenant: Tenant,
    existingInvoice: { id: string; status: InvoiceStatus },
    invoicePayload: Parameters<BillingService["createInvoice"]>[1],
    userId: string,
  ) {
    if (existingInvoice.status !== InvoiceStatus.DRAFT) {
      throw new WhatsappIntegrationError("Linked invoice is already confirmed. Edit it from the billing screen.", 409);
    }

    return this.billingService.updateInvoice(tenant, existingInvoice.id, invoicePayload, userId);
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

function ensureReviewableOrder(order: WhatsappOrder): void {
  if (order.status === WhatsappOrderStatus.NEEDS_REVIEW || order.status === WhatsappOrderStatus.DRAFT_CREATED) {
    return;
  }

  throw new WhatsappIntegrationError("Only WhatsApp orders awaiting review can be changed", 409);
}

function readParsedOrderLines(value: unknown): ParsedOrderLine[] {
  return toArray(value).flatMap((entry) => {
    const record = toRecord(entry);
    const productId = stringValue(record.productId);
    const productName = stringValue(record.productName);
    const quantity = Number(record.quantity);
    const sellingPrice = Number(record.sellingPrice);
    const line = stringValue(record.line, productName);

    if (!productId || !productName || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(sellingPrice) || sellingPrice < 0) {
      return [];
    }

    return [{
      line,
      productId,
      productName,
      quantity,
      sellingPrice,
    }];
  });
}

function readUnmatchedOrderLines(value: unknown): UnmatchedOrderLine[] {
  return toArray(value).flatMap((entry) => {
    const record = toRecord(entry);
    const line = stringValue(record.line);
    const reason = stringValue(record.reason, "Needs review");

    return line ? [{ line, reason }] : [];
  });
}

function summarizeParsedItems(items: ParsedOrderLine[]) {
  return {
    itemCount: items.length,
    totalQuantity: roundOrderQuantity(items.reduce((sum, item) => sum + item.quantity, 0)),
    grandTotal: roundOrderMoney(items.reduce((sum, item) => sum + item.quantity * item.sellingPrice, 0)),
  };
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

function roundOrderMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundOrderQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return fallback;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value as Prisma.InputJsonValue;
}

interface WhatsappPhoneDetails {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
}

interface EmbeddedSignupToken {
  accessToken: string;
  expiresAt: Date | null;
}

async function exchangeEmbeddedSignupCode(input: { appId: string; appSecret: string; code: string }): Promise<EmbeddedSignupToken> {
  const params = new URLSearchParams({
    client_id: input.appId,
    client_secret: input.appSecret,
    code: input.code,
  });
  const redirectUri = process.env.WHATSAPP_EMBEDDED_REDIRECT_URI;
  if (redirectUri) {
    params.set("redirect_uri", redirectUri);
  }

  const response = await fetch(`${graphBaseUrl()}/oauth/access_token?${params.toString()}`);
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new WhatsappIntegrationError(`Meta token exchange failed: ${metaErrorMessage(body)}`, 502);
  }

  const accessToken = stringValue(body?.access_token);
  if (!accessToken) {
    throw new WhatsappIntegrationError("Meta token exchange did not return an access token", 502);
  }

  const expiresIn = Number(body?.expires_in);
  return {
    accessToken,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null,
  };
}

async function getWhatsappPhoneDetails(phoneNumberId: string, accessToken: string): Promise<WhatsappPhoneDetails> {
  const params = new URLSearchParams({
    fields: "id,display_phone_number,verified_name",
    access_token: accessToken,
  });
  const response = await fetch(`${graphBaseUrl()}/${phoneNumberId}?${params.toString()}`);
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(metaErrorMessage(body));
  }

  const details: WhatsappPhoneDetails = {
    id: stringValue(body?.id, phoneNumberId),
  };
  const displayPhoneNumber = stringValue(body?.display_phone_number);
  const verifiedName = stringValue(body?.verified_name);
  if (displayPhoneNumber) details.display_phone_number = displayPhoneNumber;
  if (verifiedName) details.verified_name = verifiedName;

  return details;
}

async function listWabaPhoneNumbers(wabaId: string, accessToken: string): Promise<WhatsappPhoneDetails[]> {
  const params = new URLSearchParams({
    fields: "id,display_phone_number,verified_name",
    access_token: accessToken,
  });
  const response = await fetch(`${graphBaseUrl()}/${wabaId}/phone_numbers?${params.toString()}`);
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(metaErrorMessage(body));
  }

  return toArray(body?.data).map((item) => {
    const record = toRecord(item);
    const details: WhatsappPhoneDetails = {
      id: stringValue(record.id),
    };
    const displayPhoneNumber = stringValue(record.display_phone_number);
    const verifiedName = stringValue(record.verified_name);
    if (displayPhoneNumber) details.display_phone_number = displayPhoneNumber;
    if (verifiedName) details.verified_name = verifiedName;

    return details;
  }).filter((item) => Boolean(item.id));
}

async function subscribeWabaToApp(wabaId: string, accessToken: string): Promise<void> {
  const params = new URLSearchParams({
    access_token: accessToken,
  });
  const response = await fetch(`${graphBaseUrl()}/${wabaId}/subscribed_apps?${params.toString()}`, {
    method: "POST",
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(metaErrorMessage(body));
  }
}

function toIntegrationResponse(integration: {
  id: string;
  provider: string;
  phoneNumberId: string | null;
  wabaId: string | null;
  businessId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  accessTokenCiphertext: string | null;
  tokenExpiresAt: Date | null;
  status: WhatsappIntegrationStatus;
  lastError: string | null;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  updatedAt: Date;
} | null) {
  const fallbackConfigured = Boolean(process.env.WHATSAPP_CLOUD_ACCESS_TOKEN && process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID);
  if (!integration) {
    return {
      status: "NOT_CONNECTED",
      provider: "whatsapp-cloud",
      fallbackConfigured,
      isConnected: false,
      phoneNumberId: null,
      wabaId: null,
      businessId: null,
      displayPhoneNumber: null,
      verifiedName: null,
      tokenExpiresAt: null,
      lastError: null,
      connectedAt: null,
      disconnectedAt: null,
      updatedAt: null,
    };
  }

  return {
    status: integration.status,
    provider: integration.provider,
    fallbackConfigured,
    isConnected: integration.status === WhatsappIntegrationStatus.CONNECTED && Boolean(integration.accessTokenCiphertext),
    phoneNumberId: integration.phoneNumberId,
    wabaId: integration.wabaId,
    businessId: integration.businessId,
    displayPhoneNumber: integration.displayPhoneNumber,
    verifiedName: integration.verifiedName,
    tokenExpiresAt: integration.tokenExpiresAt,
    lastError: integration.lastError,
    connectedAt: integration.connectedAt,
    disconnectedAt: integration.disconnectedAt,
    updatedAt: integration.updatedAt,
  };
}

function ensureManager(role: UserRole): void {
  if (role !== UserRole.OWNER && role !== UserRole.MANAGER) {
    throw new WhatsappIntegrationError("Only owners and managers can manage WhatsApp", 403);
  }
}

function getGraphApiVersion(): string {
  return process.env.WHATSAPP_CLOUD_API_VERSION ?? "v23.0";
}

function graphBaseUrl(): string {
  return `https://graph.facebook.com/${getGraphApiVersion()}`;
}

function getPublicAppUrl(): string {
  const explicit = process.env.PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  return process.env.APP_DOMAIN ? `https://${process.env.APP_DOMAIN}` : "http://localhost:3000";
}

function metaErrorMessage(body: Record<string, unknown> | null): string {
  const error = toRecord(body?.error);
  return stringValue(error.message) || stringValue(body?.error_description) || "Unknown Meta API error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
