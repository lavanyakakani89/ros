import net from "node:net";

import { PaperSize, PrinterConn, RenderType, type InvoiceItem, type InvoiceTemplate, type PrinterConfig, type Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";

export type InvoiceForPrint = {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date;
  paymentMode: string;
  subtotal: { toNumber: () => number };
  totalDiscount: { toNumber: () => number };
  totalCgst: { toNumber: () => number };
  totalSgst: { toNumber: () => number };
  grandTotal: { toNumber: () => number };
  amountPaid: { toNumber: () => number };
  amountDue: { toNumber: () => number };
  customer?: { name: string; phone: string; address?: string | null } | null;
  items: InvoiceItem[];
};

const defaultTemplateByVertical: Record<Tenant["vertical"], PaperSize> = {
  GROCERY: PaperSize.THERMAL_2,
  RESTAURANT: PaperSize.THERMAL_2,
  PHARMACY: PaperSize.THERMAL_3,
  HARDWARE: PaperSize.THERMAL_3,
  FASHION: PaperSize.A5,
  ELECTRONICS: PaperSize.A5,
};

const paperColumns: Record<PaperSize, number> = {
  THERMAL_2: 32,
  THERMAL_3: 42,
  THERMAL_4: 56,
  A5: 42,
  A4: 56,
};

const thermalPaperSizes = new Set<PaperSize>([PaperSize.THERMAL_2, PaperSize.THERMAL_3, PaperSize.THERMAL_4]);

interface EscposTemplateConfig {
  columns: number;
  cut: boolean;
  feedLinesBeforeCut: number;
  showShopName: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showGstin: boolean;
  showCustomer: boolean;
  showSubtotal: boolean;
  showDiscount: boolean;
  showDiscountOnlyWhenPresent: boolean;
  showCgst: boolean;
  showSgst: boolean;
  showPaid: boolean;
  showDue: boolean;
  showDueOnlyWhenPresent: boolean;
  showBatch: boolean;
  layout: "STANDARD" | "SIVSAN_DETAILED_3IN";
  alternatePhone: string;
  fssaiNumber: string;
  logoText: string;
  note: string;
  currencyLabel: string;
  footerMessage: string;
  spacing: {
    headerBlankLines: number;
    itemSerialWidth: number;
    itemNameWidth: number;
    itemQtyWidth: number;
    itemPriceWidth: number;
    itemAmountWidth: number;
    lineGapBetweenItems: number;
    summaryItemWidth: number;
    summaryQtyWidth: number;
    summaryAmountLabelWidth: number;
    summaryAmountWidth: number;
    beforeFooterBlankLines: number;
  };
  labels: {
    invoice: string;
    date: string;
    customer: string;
    itemHeader: string;
    amountHeader: string;
    subtotal: string;
    discount: string;
    cgst: string;
    sgst: string;
    total: string;
    paid: string;
    due: string;
  };
}

export async function getEffectiveTemplate(fastify: FastifyInstance, tenant: Tenant): Promise<InvoiceTemplate | null> {
  const tenantDefault = await fastify.prisma.invoiceTemplate.findFirst({
    where: {
      tenantId: tenant.id,
      isDefault: true,
    },
  });

  if (tenantDefault) {
    return tenantDefault;
  }

  const paperSize = defaultTemplateByVertical[tenant.vertical];
  return fastify.prisma.invoiceTemplate.findFirst({
    where: {
      tenantId: null,
      paperSize,
      isSystem: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });
}

export async function printInvoiceForTenant(input: {
  fastify: FastifyInstance;
  tenant: Tenant;
  invoice: InvoiceForPrint;
}): Promise<PrinterDispatchResult> {
  const selectedTemplate = await getEffectiveTemplate(input.fastify, input.tenant);
  const printer = await input.fastify.prisma.printerConfig.findUnique({
    where: {
      tenantId: input.tenant.id,
    },
  });
  const template = await getEffectiveEscposTemplate(input.fastify, input.tenant, selectedTemplate, printer);

  if (!template) {
    return {
      status: "pdf_fallback",
      message: "No thermal ESC/POS template is available. Generate or open the invoice PDF to print.",
      template: selectedTemplate,
      printer,
    };
  }

  const receipt = buildEscposInvoice(input.tenant, input.invoice, template);
  const dispatch = await dispatchEscposReceipt(receipt.bytes, printer);

  return {
    ...dispatch,
    template,
    printer,
    previewText: receipt.text,
  };
}

export async function testPrinterForTenant(input: {
  fastify: FastifyInstance;
  tenant: Tenant;
}): Promise<PrinterDispatchResult> {
  const selectedTemplate = await getEffectiveTemplate(input.fastify, input.tenant);
  const printer = await input.fastify.prisma.printerConfig.findUnique({
    where: {
      tenantId: input.tenant.id,
    },
  });
  const template = await getEffectiveEscposTemplate(input.fastify, input.tenant, selectedTemplate, printer);
  const receipt = buildEscposText(
    [
      input.tenant.name,
      "BizBil printer test",
      new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      "If this prints, billing print is ready.",
    ],
    template?.paperSize ?? preferredEscposPaperSize(input.tenant, printer, selectedTemplate),
  );
  const dispatch = await dispatchEscposReceipt(receipt.bytes, printer);

  if (printer && dispatch.status !== "not_configured") {
    await input.fastify.prisma.printerConfig.update({
      where: {
        tenantId: input.tenant.id,
      },
      data: {
        lastTestedAt: new Date(),
      },
    });
  }

  return {
    ...dispatch,
    template,
    printer,
    previewText: receipt.text,
  };
}

export function buildEscposInvoice(tenant: Tenant, invoice: InvoiceForPrint, template: InvoiceTemplate): { bytes: Buffer; text: string } {
  const config = getEscposConfig(template);

  if (config.layout === "SIVSAN_DETAILED_3IN") {
    return buildSivsanDetailedInvoice(tenant, invoice, template, config);
  }

  const columns = config.columns;
  const lines: string[] = [
    config.showShopName ? center(tenant.name, columns) : "",
    config.showAddress && tenant.address ? center(tenant.address, columns) : "",
    config.showPhone ? center(`Phone: ${tenant.phone}`, columns) : "",
    config.showGstin && tenant.gstNumber ? center(`GSTIN: ${tenant.gstNumber}`, columns) : "",
    rule(columns),
    `${config.labels.invoice}: ${invoice.invoiceNumber}`,
    `${config.labels.date}: ${invoice.invoiceDate.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    config.showCustomer && invoice.customer ? `${config.labels.customer}: ${invoice.customer.name} ${invoice.customer.phone}`.trim() : "",
    rule(columns),
    twoCol(config.labels.itemHeader, config.labels.amountHeader, columns),
    rule(columns),
    ...invoice.items.flatMap((item) => itemLines(item, columns, config)),
    rule(columns),
    config.showSubtotal ? twoCol(config.labels.subtotal, money(invoice.subtotal), columns) : "",
    config.showDiscount && (!config.showDiscountOnlyWhenPresent || invoice.totalDiscount.toNumber() > 0) ? twoCol(config.labels.discount, money(invoice.totalDiscount), columns) : "",
    config.showCgst ? twoCol(config.labels.cgst, money(invoice.totalCgst), columns) : "",
    config.showSgst ? twoCol(config.labels.sgst, money(invoice.totalSgst), columns) : "",
    rule(columns),
    twoCol(config.labels.total, money(invoice.grandTotal), columns),
    config.showPaid ? twoCol(config.labels.paid, money(invoice.amountPaid), columns) : "",
    config.showDue && (!config.showDueOnlyWhenPresent || invoice.amountDue.toNumber() > 0) ? twoCol(config.labels.due, money(invoice.amountDue), columns) : "",
    rule(columns),
    config.footerMessage ? center(config.footerMessage, columns) : "",
  ].filter(Boolean);

  return buildEscposText(lines, template.paperSize, {
    columns,
    cut: config.cut,
    feedLinesBeforeCut: config.feedLinesBeforeCut,
  });
}

export function buildThermalReceipt(tenant: Tenant, invoice: InvoiceForPrint, template: InvoiceTemplate): { bytes: Buffer; text: string } {
  return buildEscposInvoice(tenant, invoice, template);
}

function buildSivsanDetailedInvoice(tenant: Tenant, invoice: InvoiceForPrint, template: InvoiceTemplate, config: EscposTemplateConfig): { bytes: Buffer; text: string } {
  const columns = config.columns;
  const totalQuantity = invoice.items.reduce((sum, item) => sum + item.quantity.toNumber(), 0);
  const phone = [tenant.phone, config.alternatePhone].filter(Boolean).join(" / ");
  const customerName = invoice.customer?.name ?? "Walk-in";
  const customerPhone = invoice.customer?.phone ?? "";
  const customerAddress = invoice.customer?.address ?? "";
  const itemWidths = normalizedColumnWidths(
    [
      config.spacing.itemSerialWidth,
      config.spacing.itemNameWidth,
      config.spacing.itemQtyWidth,
      config.spacing.itemPriceWidth,
      config.spacing.itemAmountWidth,
    ],
    columns,
    1,
    [3, 8, 5, 5, 6],
  );
  const summaryWidths = normalizedColumnWidths(
    [
      config.spacing.summaryItemWidth,
      config.spacing.summaryQtyWidth,
      config.spacing.summaryAmountLabelWidth,
      config.spacing.summaryAmountWidth,
    ],
    columns,
    0,
    [8, 8, 7, 7],
  );
  const lines: string[] = [
    ...(config.logoText ? wrapCentered(config.logoText, columns) : []),
    config.showShopName ? center(tenant.name, columns) : "",
    ...(config.showAddress && tenant.address ? wrapCentered(tenant.address, columns) : []),
    config.showPhone && phone ? center(`CALL : ${phone}`, columns) : "",
    config.fssaiNumber ? center(`FSSAI - ${config.fssaiNumber}`, columns) : "",
    ...blankLines(config.spacing.headerBlankLines),
    twoCol(`${config.labels.invoice} : ${invoice.invoiceNumber}`, `${config.labels.date} :${formatDateOnly(invoice.invoiceDate)}`, columns),
    ...(config.showCustomer ? wrapTextWithPrefix("Name : ", customerName, columns) : []),
    ...(config.showCustomer && customerPhone ? wrapTextWithPrefix("Ph No : ", customerPhone, columns) : []),
    ...(config.showCustomer && customerAddress ? wrapTextWithPrefix("Address : ", customerAddress, columns) : []),
    rule(columns),
    fixedColumns(["SR", "Item", "QTY.", "Price", "Amount"], itemWidths, [false, false, true, true, true]),
    rule(columns),
    ...invoice.items.flatMap((item, index) => detailedItemLines(item, index + 1, columns, itemWidths, config.spacing.lineGapBetweenItems)),
    rule(columns),
    fixedColumns(
      [`Item : ${String(invoice.items.length)}`, `QTY : ${formatSummaryQuantity(totalQuantity)}`, "AMOUNT :", money(invoice.subtotal)],
      summaryWidths,
      [false, false, true, true],
    ),
    rule(columns),
    twoCol("DISC. AMOUNT :", money(invoice.totalDiscount), columns),
    rule(columns),
    twoCol("GRAND TOTAL", `${config.currencyLabel} ${money(invoice.grandTotal)}`, columns),
    rule(columns),
    amountInWords(invoice.grandTotal.toNumber()),
    ...blankLines(config.spacing.beforeFooterBlankLines),
    ...(config.note ? wrapTextWithPrefix("Note: ", config.note, columns) : []),
    config.footerMessage ? center(config.footerMessage, columns) : "",
  ].filter((line) => line !== "");

  return buildEscposText(lines, template.paperSize, {
    columns,
    cut: config.cut,
    feedLinesBeforeCut: config.feedLinesBeforeCut,
  });
}

export function buildEscposText(lines: string[], paperSize: PaperSize, options: { columns?: number; cut?: boolean; feedLinesBeforeCut?: number } = {}): { bytes: Buffer; text: string } {
  const columns = options.columns ?? paperColumns[paperSize];
  const text = `${lines.map((line) => fit(line, columns)).join("\n")}\n`;
  const reset = Buffer.from([0x1b, 0x40]);
  const feedBeforeCut = Buffer.from([0x1b, 0x64, Math.max(Math.min(options.feedLinesBeforeCut ?? 6, 12), 0)]);
  const cut = Buffer.from([0x1d, 0x56, 0x00]);
  const ending = (options.cut ?? true) ? Buffer.concat([feedBeforeCut, cut]) : feedBeforeCut;

  return {
    text,
    bytes: Buffer.concat([reset, Buffer.from(text, "utf8"), ending]),
  };
}

async function getEffectiveEscposTemplate(
  fastify: FastifyInstance,
  tenant: Tenant,
  selectedTemplate: InvoiceTemplate | null,
  printer: PrinterConfig | null,
): Promise<InvoiceTemplate | null> {
  if (selectedTemplate?.renderType === RenderType.ESC_POS) {
    return selectedTemplate;
  }

  const paperSize = preferredEscposPaperSize(tenant, printer, selectedTemplate);
  const tenantEscposTemplate = await fastify.prisma.invoiceTemplate.findFirst({
    where: {
      tenantId: tenant.id,
      renderType: RenderType.ESC_POS,
      paperSize,
    },
    orderBy: [
      { isDefault: "desc" },
      { createdAt: "asc" },
    ],
  });

  if (tenantEscposTemplate) {
    return tenantEscposTemplate;
  }

  return fastify.prisma.invoiceTemplate.findFirst({
    where: {
      tenantId: null,
      paperSize,
      renderType: RenderType.ESC_POS,
      isSystem: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });
}

function preferredEscposPaperSize(tenant: Tenant, printer: PrinterConfig | null, selectedTemplate: InvoiceTemplate | null): PaperSize {
  if (isThermalPaperSize(printer?.paperSize)) {
    return printer.paperSize;
  }

  if (isThermalPaperSize(selectedTemplate?.paperSize)) {
    return selectedTemplate.paperSize;
  }

  const verticalDefault = defaultTemplateByVertical[tenant.vertical];
  return isThermalPaperSize(verticalDefault) ? verticalDefault : PaperSize.THERMAL_3;
}

function isThermalPaperSize(paperSize: PaperSize | null | undefined): paperSize is PaperSize {
  return Boolean(paperSize && thermalPaperSizes.has(paperSize));
}

async function dispatchEscposReceipt(bytes: Buffer, printer: PrinterConfig | null): Promise<Omit<PrinterDispatchResult, "template" | "printer">> {
  if (!printer || !printer.isActive || printer.connectionType === PrinterConn.NONE) {
    return {
      status: "not_configured",
      message: "No active printer is configured. Use the PDF fallback or set up a printer in Settings.",
      bytesBase64: bytes.toString("base64"),
    };
  }

  if (printer.connectionType === PrinterConn.BLUETOOTH) {
    return {
      status: "bluetooth_payload",
      message: "Send these ESC/POS bytes to the paired Bluetooth printer from the browser.",
      bytesBase64: bytes.toString("base64"),
      deviceId: printer.bluetoothDeviceId,
      deviceName: printer.bluetoothDeviceName,
    };
  }

  if (printer.connectionType === PrinterConn.LOCAL_AGENT) {
    return {
      status: "local_agent_payload",
      message: "Send these ESC/POS bytes to the BizBil Local Print Agent.",
      bytesBase64: bytes.toString("base64"),
      printerName: printer.localPrinterName ?? printer.labelPrinterName,
      agentUrl: printer.localAgentUrl ?? "http://127.0.0.1:9211",
    };
  }

  if (printer.connectionType === PrinterConn.NETWORK) {
    if (!printer.networkIp || !printer.networkPort) {
      return {
        status: "failed",
        message: "Network printer IP and port are required.",
      };
    }

    await sendTcp(printer.networkIp, printer.networkPort, bytes);
    return {
      status: "printed",
      message: `Sent to ${printer.networkIp}:${String(printer.networkPort)}`,
    };
  }

  if (!printer.printNodeApiKey || !printer.printNodePrinterId) {
    return {
      status: "failed",
      message: "PrintNode API key and printer id are required.",
    };
  }

  await sendPrintNode(printer.printNodeApiKey, printer.printNodePrinterId, bytes);
  return {
    status: "queued",
    message: "Queued in PrintNode.",
  };
}

export function sendToNetworkPrinter(host: string, port: number, bytes: Buffer): Promise<void> {
  return sendTcp(host, port, bytes);
}

function sendTcp(host: string, port: number, bytes: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port, timeout: 5000 }, () => {
      socket.write(bytes, (error) => {
        if (error) {
          reject(error);
          return;
        }
        socket.end();
      });
    });

    socket.once("timeout", () => {
      socket.destroy(new Error("Printer connection timed out"));
    });
    socket.once("error", reject);
    socket.once("close", (hadError) => {
      if (!hadError) {
        resolve();
      }
    });
  });
}

async function sendPrintNode(apiKey: string, printerId: string, bytes: Buffer): Promise<void> {
  const response = await fetch("https://api.printnode.com/printjobs", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      printerId: Number(printerId),
      title: "BizBil invoice",
      contentType: "raw_base64",
      content: bytes.toString("base64"),
      source: "BizBil",
    }),
  });

  if (!response.ok) {
    throw new Error(`PrintNode rejected job (${String(response.status)})`);
  }
}

function itemLines(item: InvoiceItem, columns: number, config: EscposTemplateConfig): string[] {
  const quantity = Number(item.quantity).toString();
  const rate = money(item.sellingPrice);
  const total = money(item.total);
  const first = fit(item.productName, columns);
  const second = twoCol(`${quantity} ${item.unit} x ${rate}`, total, columns);
  const batch = config.showBatch && item.batchNumber ? `Batch: ${item.batchNumber}` : "";

  return [first, second, batch].filter(Boolean);
}

function getEscposConfig(template: InvoiceTemplate): EscposTemplateConfig {
  const config = template.escposConfig;
  const record = config && typeof config === "object" && !Array.isArray(config) ? config as Record<string, unknown> : {};
  const labels = toRecord(record.labels);
  const columns = getColumns(template);

  return {
    columns,
    cut: booleanValue(record.cut, true),
    feedLinesBeforeCut: numberValue(record.feedLinesBeforeCut, 6, 0, 12),
    showShopName: booleanValue(record.showShopName, true),
    showAddress: booleanValue(record.showAddress, true),
    showPhone: booleanValue(record.showPhone, true),
    showGstin: booleanValue(record.showGstin, true),
    showCustomer: booleanValue(record.showCustomer, true),
    showSubtotal: booleanValue(record.showSubtotal, true),
    showDiscount: booleanValue(record.showDiscount, true),
    showDiscountOnlyWhenPresent: booleanValue(record.showDiscountOnlyWhenPresent, true),
    showCgst: booleanValue(record.showCgst, true),
    showSgst: booleanValue(record.showSgst, true),
    showPaid: booleanValue(record.showPaid, true),
    showDue: booleanValue(record.showDue, true),
    showDueOnlyWhenPresent: booleanValue(record.showDueOnlyWhenPresent, true),
    showBatch: booleanValue(record.showBatch, false),
    layout: stringValue(record.layout, "STANDARD") === "SIVSAN_DETAILED_3IN" ? "SIVSAN_DETAILED_3IN" : "STANDARD",
    alternatePhone: stringValue(record.alternatePhone, ""),
    fssaiNumber: stringValue(record.fssaiNumber, ""),
    logoText: stringValue(record.logoText, ""),
    note: stringValue(record.note, ""),
    currencyLabel: stringValue(record.currencyLabel, "Rs"),
    footerMessage: stringValue(record.footerMessage, "Thank you. Please visit again."),
    spacing: spacingConfig(record.spacing),
    labels: {
      invoice: stringValue(labels.invoice, "Invoice"),
      date: stringValue(labels.date, "Date"),
      customer: stringValue(labels.customer, "Customer"),
      itemHeader: stringValue(labels.itemHeader, "Item"),
      amountHeader: stringValue(labels.amountHeader, "Amount"),
      subtotal: stringValue(labels.subtotal, "Subtotal"),
      discount: stringValue(labels.discount, "Discount"),
      cgst: stringValue(labels.cgst, "CGST"),
      sgst: stringValue(labels.sgst, "SGST"),
      total: stringValue(labels.total, "TOTAL"),
      paid: stringValue(labels.paid, "Paid"),
      due: stringValue(labels.due, "Due"),
    },
  };
}

function getColumns(template: InvoiceTemplate): number {
  const config = template.escposConfig;
  if (config && typeof config === "object" && !Array.isArray(config) && "columns" in config) {
    const value = Number(config.columns);
    if (Number.isFinite(value) && value >= 24 && value <= 64) {
      return value;
    }
  }

  return paperColumns[template.paperSize];
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? Math.max(Math.min(Math.trunc(nextValue), max), min) : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function spacingConfig(value: unknown): EscposTemplateConfig["spacing"] {
  const spacing = toRecord(value);
  return {
    headerBlankLines: numberValue(spacing.headerBlankLines, 1, 0, 5),
    itemSerialWidth: numberValue(spacing.itemSerialWidth, 4, 3, 10),
    itemNameWidth: numberValue(spacing.itemNameWidth, 16, 8, 40),
    itemQtyWidth: numberValue(spacing.itemQtyWidth, 7, 5, 12),
    itemPriceWidth: numberValue(spacing.itemPriceWidth, 7, 5, 12),
    itemAmountWidth: numberValue(spacing.itemAmountWidth, 8, 6, 14),
    lineGapBetweenItems: numberValue(spacing.lineGapBetweenItems, 0, 0, 3),
    summaryItemWidth: numberValue(spacing.summaryItemWidth, 12, 8, 24),
    summaryQtyWidth: numberValue(spacing.summaryQtyWidth, 12, 8, 20),
    summaryAmountLabelWidth: numberValue(spacing.summaryAmountLabelWidth, 9, 7, 16),
    summaryAmountWidth: numberValue(spacing.summaryAmountWidth, 9, 7, 16),
    beforeFooterBlankLines: numberValue(spacing.beforeFooterBlankLines, 1, 0, 5),
  };
}

function money(value: { toNumber: () => number }): string {
  return value.toNumber().toFixed(2);
}

function detailedItemLines(item: InvoiceItem, serial: number, columns: number, widths: number[], lineGap: number): string[] {
  const itemPrefix = `${String(serial)}.  `;
  const itemLines = wrapTextWithPrefix(itemPrefix, item.productName, columns);
  const amountLine = fixedColumns(
    ["", formatItemQuantity(item.quantity.toNumber()), money(item.sellingPrice), money(item.total)],
    [(widths[0] ?? 4) + (widths[1] ?? 16), widths[2] ?? 7, widths[3] ?? 7, widths[4] ?? 8],
    [false, true, true, true],
  );

  return [...itemLines, amountLine, ...blankLines(lineGap)];
}

function fixedColumns(values: string[], widths: number[], rightAlign: boolean[]): string {
  return values.map((value, index) => {
    const width = widths[index] ?? value.length;
    const text = fit(value, width);
    return rightAlign[index] ? text.padStart(width, " ") : text.padEnd(width, " ");
  }).join("").trimEnd();
}

function normalizedColumnWidths(widths: number[], columns: number, flexibleIndex: number, minimums: number[]): number[] {
  const result = widths.map((width, index) => Math.max(Math.trunc(width), minimums[index] ?? 1));
  const total = result.reduce((sum, width) => sum + width, 0);

  if (total < columns) {
    result[flexibleIndex] = (result[flexibleIndex] ?? 1) + columns - total;
    return result;
  }

  let overflow = total - columns;
  for (const index of [flexibleIndex, ...result.map((_, itemIndex) => itemIndex).filter((itemIndex) => itemIndex !== flexibleIndex)]) {
    const min = minimums[index] ?? 1;
    const reducible = Math.max((result[index] ?? min) - min, 0);
    const reduction = Math.min(reducible, overflow);
    result[index] = (result[index] ?? min) - reduction;
    overflow -= reduction;
    if (overflow <= 0) break;
  }

  return result;
}

function blankLines(count: number): string[] {
  return Array.from({ length: Math.max(Math.min(Math.trunc(count), 5), 0) }, () => " ");
}

function formatDateOnly(value: Date): string {
  return value.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).replaceAll("/", "-");
}

function formatItemQuantity(value: number): string {
  return value.toFixed(3);
}

function formatSummaryQuantity(value: number): string {
  return value.toFixed(2);
}

function wrapCentered(value: string, columns: number): string[] {
  return wrapText(value, columns).map((line) => center(line, columns));
}

function wrapTextWithPrefix(prefix: string, value: string, columns: number): string[] {
  const available = Math.max(columns - prefix.length, 1);
  const wrapped = wrapText(value, available);

  if (wrapped.length === 0) {
    return [prefix.trimEnd()];
  }

  return wrapped.map((line, index) => index === 0 ? `${prefix}${line}` : `${" ".repeat(prefix.length)}${line}`);
}

function wrapText(value: string, columns: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > columns && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function amountInWords(value: number): string {
  const rounded = Math.round(value);
  if (rounded <= 0) {
    return "RUPEES ZERO ONLY";
  }

  return `RUPEES ${numberToIndianWords(rounded).toUpperCase()} ONLY`;
}

function numberToIndianWords(value: number): string {
  const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const twoDigitWords = (nextValue: number): string => {
    if (nextValue < 20) return ones[nextValue] ?? "";
    const ten = tens[Math.floor(nextValue / 10)] ?? "";
    const one = ones[nextValue % 10] ?? "";
    return `${ten}${nextValue % 10 ? ` ${one}` : ""}`.trim();
  };
  const threeDigitWords = (nextValue: number): string => {
    const hundred = Math.floor(nextValue / 100);
    const rest = nextValue % 100;
    const hundredWord = ones[hundred] ?? "";
    return [hundred ? `${hundredWord} hundred` : "", rest ? twoDigitWords(rest) : ""].filter(Boolean).join(" ");
  };
  const parts = [
    { label: "crore", value: Math.floor(value / 10000000) },
    { label: "lakh", value: Math.floor((value % 10000000) / 100000) },
    { label: "thousand", value: Math.floor((value % 100000) / 1000) },
    { label: "", value: value % 1000 },
  ];

  return parts
    .map((part) => part.value ? `${part.value < 100 ? twoDigitWords(part.value) : threeDigitWords(part.value)} ${part.label}`.trim() : "")
    .filter(Boolean)
    .join(" ");
}

function rule(columns: number): string {
  return "-".repeat(columns);
}

function center(value: string, columns: number): string {
  const text = fit(value, columns);
  const left = Math.max(Math.floor((columns - text.length) / 2), 0);
  return `${" ".repeat(left)}${text}`;
}

function twoCol(left: string, right: string, columns: number): string {
  const rightText = right.slice(0, Math.max(columns - 1, 0));
  const leftWidth = Math.max(columns - rightText.length - 1, 1);
  return `${fit(left, leftWidth)} ${rightText}`.padEnd(columns, " ");
}

function fit(value: string, columns: number): string {
  return value.length > columns ? value.slice(0, Math.max(columns - 1, 0)) : value;
}

export type PrinterDispatchResult = {
  status: "printed" | "queued" | "bluetooth_payload" | "local_agent_payload" | "pdf_fallback" | "not_configured" | "failed";
  message: string;
  bytesBase64?: string;
  deviceId?: string | null;
  deviceName?: string | null;
  printerName?: string | null;
  agentUrl?: string | null;
  previewText?: string;
  template?: InvoiceTemplate | null;
  printer?: PrinterConfig | null;
};
