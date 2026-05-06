import net from "node:net";

import { PaperSize, PrinterConn, RenderType, type InvoiceItem, type InvoiceTemplate, type PrinterConfig, type Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";

type InvoiceForPrint = {
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
  customer?: { name: string; phone: string } | null;
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
  const template = await getEffectiveTemplate(input.fastify, input.tenant);
  const printer = await input.fastify.prisma.printerConfig.findUnique({
    where: {
      tenantId: input.tenant.id,
    },
  });

  if (!template || template.renderType === RenderType.HTML_PDF) {
    return {
      status: "pdf_fallback",
      message: "This invoice uses a PDF template. Generate or open the invoice PDF to print.",
      template,
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
  const template = await getEffectiveTemplate(input.fastify, input.tenant);
  const printer = await input.fastify.prisma.printerConfig.findUnique({
    where: {
      tenantId: input.tenant.id,
    },
  });
  const receipt = buildEscposText(
    [
      input.tenant.name,
      "RetailOS printer test",
      new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      "If this prints, billing print is ready.",
    ],
    template?.paperSize ?? printer?.paperSize ?? PaperSize.THERMAL_3,
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
  const columns = getColumns(template);
  const lines: string[] = [
    center(tenant.name, columns),
    tenant.address ? center(tenant.address, columns) : "",
    center(`Phone: ${tenant.phone}`, columns),
    tenant.gstNumber ? center(`GSTIN: ${tenant.gstNumber}`, columns) : "",
    rule(columns),
    `Invoice: ${invoice.invoiceNumber}`,
    `Date: ${invoice.invoiceDate.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    invoice.customer ? `Customer: ${invoice.customer.name} ${invoice.customer.phone}`.trim() : "",
    rule(columns),
    twoCol("Item", "Amount", columns),
    rule(columns),
    ...invoice.items.flatMap((item) => itemLines(item, columns)),
    rule(columns),
    twoCol("Subtotal", money(invoice.subtotal), columns),
    invoice.totalDiscount.toNumber() > 0 ? twoCol("Discount", money(invoice.totalDiscount), columns) : "",
    twoCol("CGST", money(invoice.totalCgst), columns),
    twoCol("SGST", money(invoice.totalSgst), columns),
    rule(columns),
    twoCol("TOTAL", money(invoice.grandTotal), columns),
    twoCol("Paid", money(invoice.amountPaid), columns),
    invoice.amountDue.toNumber() > 0 ? twoCol("Due", money(invoice.amountDue), columns) : "",
    rule(columns),
    center("Thank you. Please visit again.", columns),
  ].filter(Boolean);

  return buildEscposText(lines, template.paperSize);
}

export function buildEscposText(lines: string[], paperSize: PaperSize): { bytes: Buffer; text: string } {
  const columns = paperColumns[paperSize];
  const text = `${lines.map((line) => fit(line, columns)).join("\n")}\n\n\n`;
  const reset = Buffer.from([0x1b, 0x40]);
  const cut = Buffer.from([0x1d, 0x56, 0x00]);

  return {
    text,
    bytes: Buffer.concat([reset, Buffer.from(text, "utf8"), cut]),
  };
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
      message: "Send these ESC/POS bytes to the RetailOS Local Print Agent.",
      bytesBase64: bytes.toString("base64"),
      printerName: printer.localPrinterName,
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
      title: "RetailOS invoice",
      contentType: "raw_base64",
      content: bytes.toString("base64"),
      source: "RetailOS",
    }),
  });

  if (!response.ok) {
    throw new Error(`PrintNode rejected job (${String(response.status)})`);
  }
}

function itemLines(item: InvoiceItem, columns: number): string[] {
  const quantity = Number(item.quantity).toString();
  const rate = money(item.sellingPrice);
  const total = money(item.total);
  const first = fit(item.productName, columns);
  const second = twoCol(`${quantity} ${item.unit} x ${rate}`, total, columns);
  const batch = item.batchNumber ? `Batch: ${item.batchNumber}` : "";

  return [first, second, batch].filter(Boolean);
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

function money(value: { toNumber: () => number }): string {
  return value.toNumber().toFixed(2);
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
