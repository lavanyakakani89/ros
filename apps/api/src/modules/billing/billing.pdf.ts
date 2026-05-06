import { PaperSize, RenderType, type Customer, type Invoice, type InvoiceItem, type InvoiceTemplate, type Tenant } from "@prisma/client";
import Handlebars from "handlebars";
import type { Client } from "minio";
import puppeteer from "puppeteer";

import { buildEscposInvoice } from "../printer/printer.service.js";

export interface InvoiceWithItems extends Invoice {
  items: InvoiceItem[];
  customer?: Customer | null;
}

export async function generateGstInvoicePdf(input: {
  invoice: InvoiceWithItems;
  tenant: Tenant;
  minio: Client;
  bucket: string;
  template?: InvoiceTemplate | null;
}): Promise<string> {
  registerInvoiceTemplateHelpers();
  const gstEnabled = input.tenant.gstEnabled;
  const templateData = {
    invoice: input.invoice,
    tenant: input.tenant,
    shop: input.tenant,
    business: input.tenant,
    customer: input.invoice.customer ?? null,
    gstEnabled,
    invoiceTitle: gstEnabled ? "GST Invoice" : "Sales Invoice",
    invoiceDate: input.invoice.invoiceDate.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
    items: input.invoice.items.map((item) => ({
      ...item,
      quantity: item.quantity.toString(),
      mrp: money(item.mrp),
      sellingPrice: money(item.sellingPrice),
      discount: money(item.discount),
      gstRate: gstEnabled ? item.gstRate.toString() : "",
      cgst: gstEnabled ? money(item.cgst) : "",
      sgst: gstEnabled ? money(item.sgst) : "",
      total: money(item.total),
    })),
    lines: input.invoice.items,
    invoiceItems: input.invoice.items,
    subtotal: money(input.invoice.subtotal),
    totalDiscount: money(input.invoice.totalDiscount),
    totalCgst: gstEnabled ? money(input.invoice.totalCgst) : "",
    totalSgst: gstEnabled ? money(input.invoice.totalSgst) : "",
    grandTotal: money(input.invoice.grandTotal),
    amountPaid: money(input.invoice.amountPaid),
    amountDue: money(input.invoice.amountDue),
    totals: {
      subtotal: money(input.invoice.subtotal),
      discount: money(input.invoice.totalDiscount),
      totalDiscount: money(input.invoice.totalDiscount),
      cgst: gstEnabled ? money(input.invoice.totalCgst) : "0.00",
      sgst: gstEnabled ? money(input.invoice.totalSgst) : "0.00",
      grandTotal: money(input.invoice.grandTotal),
      amountPaid: money(input.invoice.amountPaid),
      amountDue: money(input.invoice.amountDue),
    },
    inWords: `${money(input.invoice.grandTotal)} rupees only`,
    generatedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
  };
  const html = input.template?.renderType === RenderType.ESC_POS
    ? getEscposPreviewTemplate(input.tenant, input.invoice, input.template)
    : Handlebars.compile(input.template?.htmlSource ?? getTemplate())(templateData);

  const browser = await puppeteer.launch({
    ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
    args: ["--no-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf(input.template?.renderType === RenderType.ESC_POS
      ? { printBackground: true, preferCSSPageSize: true }
      : { format: pdfFormat(input.template?.paperSize), printBackground: true });
    const templateKey = input.template
      ? `${input.template.id}-v${String(input.template.version)}`
      : "retailos-default";
    const filename = `invoices/${input.tenant.id}/${input.invoice.invoiceNumber}-${templateKey}.pdf`;

    await input.minio.putObject(input.bucket, filename, Buffer.from(pdfBuffer), pdfBuffer.length, {
      "Content-Type": "application/pdf",
    });

    return filename;
  } finally {
    await browser.close();
  }
}

function pdfFormat(paperSize: PaperSize | undefined): "A4" | "A5" {
  return paperSize === PaperSize.A5 ? "A5" : "A4";
}

function getEscposPreviewTemplate(tenant: Tenant, invoice: InvoiceWithItems, template: InvoiceTemplate): string {
  const receipt = buildEscposInvoice(tenant, invoice, template);
  const width = template.paperSize === PaperSize.THERMAL_2 ? "58mm" : template.paperSize === PaperSize.THERMAL_3 ? "76mm" : "102mm";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @page { size: ${width} auto; margin: 4mm; }
      body { margin: 0; background: #ffffff; color: #111827; }
      .receipt { width: ${width}; font-family: "Courier New", monospace; font-size: 10px; line-height: 1.25; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <pre class="receipt">${escapeHtml(receipt.text)}</pre>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

let invoiceTemplateHelpersRegistered = false;

function registerInvoiceTemplateHelpers() {
  if (invoiceTemplateHelpersRegistered) {
    return;
  }

  invoiceTemplateHelpersRegistered = true;

  const moneyHelper = (value: unknown) => toNumber(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const dateHelper = (value: unknown) => formatDate(value, false);
  const dateTimeHelper = (value: unknown) => formatDate(value, true);

  Handlebars.registerHelper("fmtMoney", moneyHelper);
  Handlebars.registerHelper("formatMoney", moneyHelper);
  Handlebars.registerHelper("money", moneyHelper);
  Handlebars.registerHelper("currency", (value: unknown) => `₹${moneyHelper(value)}`);
  Handlebars.registerHelper("fmtCurrency", (value: unknown) => `₹${moneyHelper(value)}`);
  Handlebars.registerHelper("formatCurrency", (value: unknown) => `₹${moneyHelper(value)}`);
  Handlebars.registerHelper("fmtNumber", (value: unknown) => toNumber(value).toLocaleString("en-IN"));
  Handlebars.registerHelper("formatNumber", (value: unknown) => toNumber(value).toLocaleString("en-IN"));
  Handlebars.registerHelper("formatNum", (value: unknown) => toNumber(value).toLocaleString("en-IN"));
  Handlebars.registerHelper("fmtNum", (value: unknown) => toNumber(value).toLocaleString("en-IN"));
  Handlebars.registerHelper("number", (value: unknown) => toNumber(value).toLocaleString("en-IN"));
  Handlebars.registerHelper("qty", (value: unknown) => toNumber(value).toLocaleString("en-IN", { maximumFractionDigits: 3 }));
  Handlebars.registerHelper("fmtQty", (value: unknown) => toNumber(value).toLocaleString("en-IN", { maximumFractionDigits: 3 }));
  Handlebars.registerHelper("formatQty", (value: unknown) => toNumber(value).toLocaleString("en-IN", { maximumFractionDigits: 3 }));
  Handlebars.registerHelper("percent", (value: unknown) => `${toNumber(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`);
  Handlebars.registerHelper("fmtPercent", (value: unknown) => `${toNumber(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`);
  Handlebars.registerHelper("formatPercent", (value: unknown) => `${toNumber(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`);
  Handlebars.registerHelper("fmtDate", dateHelper);
  Handlebars.registerHelper("formatDate", dateHelper);
  Handlebars.registerHelper("fmtDateTime", dateTimeHelper);
  Handlebars.registerHelper("formatDateTime", dateTimeHelper);
  Handlebars.registerHelper("inc", (value: unknown) => toNumber(value) + 1);
  Handlebars.registerHelper("add", (left: unknown, right: unknown) => toNumber(left) + toNumber(right));
  Handlebars.registerHelper("subtract", (left: unknown, right: unknown) => toNumber(left) - toNumber(right));
  Handlebars.registerHelper("multiply", (left: unknown, right: unknown) => toNumber(left) * toNumber(right));
  Handlebars.registerHelper("divide", (left: unknown, right: unknown) => {
    const divisor = toNumber(right);
    return divisor === 0 ? 0 : toNumber(left) / divisor;
  });
  Handlebars.registerHelper("upper", (value: unknown) => stringifyTemplateValue(value).toUpperCase());
  Handlebars.registerHelper("lower", (value: unknown) => stringifyTemplateValue(value).toLowerCase());
  Handlebars.registerHelper("default", (value: unknown, fallback: unknown) => value || fallback);
  Handlebars.registerHelper("json", (value: unknown) => JSON.stringify(value));

  registerComparisonHelper("eq", (left, right) => left === right);
  registerComparisonHelper("ne", (left, right) => left !== right);
  registerComparisonHelper("gt", (left, right) => toNumber(left) > toNumber(right));
  registerComparisonHelper("gte", (left, right) => toNumber(left) >= toNumber(right));
  registerComparisonHelper("lt", (left, right) => toNumber(left) < toNumber(right));
  registerComparisonHelper("lte", (left, right) => toNumber(left) <= toNumber(right));
  registerComparisonHelper("and", (left, right) => Boolean(left && right));
  registerComparisonHelper("or", (left, right) => Boolean(left || right));
}

function registerComparisonHelper(name: string, predicate: (left: unknown, right: unknown) => boolean) {
  Handlebars.registerHelper(name, function comparisonHelper(this: unknown, left: unknown, right: unknown, options: Handlebars.HelperOptions) {
    const result = predicate(left, right);
    return typeof options.fn === "function"
      ? result ? options.fn(this) : options.inverse(this)
      : result;
  });
}

function formatDate(value: unknown, includeTime: boolean): string {
  const date = value instanceof Date ? value : new Date(stringifyTemplateValue(value));
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return includeTime
    ? date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })
    : date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

function toNumber(value: unknown): number {
  if (value && typeof value === "object" && "toNumber" in value) {
    const decimal = value as { toNumber?: () => number };
    if (typeof decimal.toNumber === "function") {
      return decimal.toNumber();
    }
  }

  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function stringifyTemplateValue(value: unknown): string {
  if (value == null) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  if (typeof value === "object" && "toString" in value) {
    const toString = (value as { toString?: () => string }).toString;
    if (typeof toString === "function" && toString !== Object.prototype.toString) {
      return toString.call(value);
    }
  }

  return "";
}

function money(value: { toNumber: () => number }): string {
  return value.toNumber().toFixed(2);
}

function getTemplate(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: Arial, sans-serif; color: #111827; margin: 32px; }
      .header { display: flex; justify-content: space-between; border-bottom: 2px solid #111827; padding-bottom: 16px; }
      .tenant { font-size: 24px; font-weight: 700; }
      .muted { color: #4b5563; font-size: 12px; line-height: 1.5; }
      .title { text-align: right; font-size: 20px; font-weight: 700; }
      .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 20px 0; font-size: 13px; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
      th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; }
      th { background: #f3f4f6; }
      .num { text-align: right; }
      .totals { margin-left: auto; margin-top: 18px; width: 320px; font-size: 13px; }
      .totals div { display: flex; justify-content: space-between; padding: 5px 0; }
      .grand { border-top: 2px solid #111827; font-weight: 700; font-size: 16px; }
      .footer { margin-top: 28px; font-size: 12px; color: #4b5563; }
    </style>
  </head>
  <body>
    <section class="header">
      <div>
        <div class="tenant">{{tenant.name}}</div>
        <div class="muted">{{tenant.address}}</div>
        <div class="muted">Phone: {{tenant.phone}}</div>
        {{#if gstEnabled}}<div class="muted">GSTIN: {{tenant.gstNumber}}</div>{{/if}}
      </div>
      <div>
        <div class="title">{{invoiceTitle}}</div>
        <div class="muted">Invoice: {{invoice.invoiceNumber}}</div>
        <div class="muted">Date: {{invoiceDate}}</div>
        <div class="muted">Generated: {{generatedAt}}</div>
      </div>
    </section>

    <section class="meta">
      <div><strong>Status:</strong> {{invoice.status}}</div>
      <div><strong>Payment mode:</strong> {{invoice.paymentMode}}</div>
    </section>

    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Qty</th>
          <th>Unit</th>
          <th class="num">Rate</th>
          <th class="num">Discount</th>
          {{#if gstEnabled}}<th class="num">GST %</th>{{/if}}
          {{#if gstEnabled}}<th class="num">CGST</th>{{/if}}
          {{#if gstEnabled}}<th class="num">SGST</th>{{/if}}
          <th class="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {{#each items}}
          <tr>
            <td>{{productName}}</td>
            <td>{{quantity}}</td>
            <td>{{unit}}</td>
            <td class="num">{{sellingPrice}}</td>
            <td class="num">{{discount}}</td>
            {{#if ../gstEnabled}}<td class="num">{{gstRate}}</td>{{/if}}
            {{#if ../gstEnabled}}<td class="num">{{cgst}}</td>{{/if}}
            {{#if ../gstEnabled}}<td class="num">{{sgst}}</td>{{/if}}
            <td class="num">{{total}}</td>
          </tr>
        {{/each}}
      </tbody>
    </table>

    <section class="totals">
      <div><span>Subtotal</span><span>₹{{subtotal}}</span></div>
      <div><span>Discount</span><span>₹{{totalDiscount}}</span></div>
      {{#if gstEnabled}}<div><span>CGST</span><span>₹{{totalCgst}}</span></div>{{/if}}
      {{#if gstEnabled}}<div><span>SGST</span><span>₹{{totalSgst}}</span></div>{{/if}}
      <div class="grand"><span>Grand total</span><span>₹{{grandTotal}}</span></div>
      <div><span>Paid</span><span>₹{{amountPaid}}</span></div>
      <div><span>Due</span><span>₹{{amountDue}}</span></div>
    </section>

    <section class="footer">
      <div>Amount in words: {{inWords}}</div>
      <div>This is a computer-generated invoice.</div>
    </section>
  </body>
</html>`;
}
