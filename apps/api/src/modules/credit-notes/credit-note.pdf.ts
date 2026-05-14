import type { CreditNote, CreditNoteItem, Customer, Invoice, Tenant } from "@prisma/client";
import Handlebars from "handlebars";
import type { Client } from "minio";
import puppeteer from "puppeteer";

export interface CreditNoteWithItems extends CreditNote {
  items: CreditNoteItem[];
  customer?: Customer | null;
  originalInvoice?: Invoice | null;
}

export async function generateCreditNotePdf(input: {
  creditNote: CreditNoteWithItems;
  tenant: Tenant;
  minio: Client;
  bucket: string;
}): Promise<string> {
  const html = Handlebars.compile(getTemplate())({
    tenant: input.tenant,
    creditNote: input.creditNote,
    customer: input.creditNote.customer ?? null,
    originalInvoice: input.creditNote.originalInvoice ?? null,
    creditNoteDate: input.creditNote.createdAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
    items: input.creditNote.items.map((item) => ({
      productName: item.productName,
      quantity: item.quantity.toString(),
      unit: item.unit,
      sellingPrice: money(item.sellingPrice),
      discount: money(item.discount),
      gstRate: item.gstRate.toString(),
      cgst: money(item.cgst),
      sgst: money(item.sgst),
      total: money(item.total),
    })),
    subtotal: money(input.creditNote.subtotal),
    totalDiscount: money(input.creditNote.totalDiscount),
    totalCgst: money(input.creditNote.totalCgst),
    totalSgst: money(input.creditNote.totalSgst),
    grandTotal: money(input.creditNote.grandTotal),
    generatedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
  });

  const browser = await puppeteer.launch({
    ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
    args: ["--no-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "10mm",
        right: "10mm",
        bottom: "10mm",
        left: "10mm",
      },
    });
    const filename = `credit-notes/${input.tenant.id}/${input.creditNote.id}.pdf`;
    await input.minio.putObject(input.bucket, filename, Buffer.from(pdfBuffer), pdfBuffer.length, {
      "Content-Type": "application/pdf",
    });

    return filename;
  } finally {
    await browser.close();
  }
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
      .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111827; padding-bottom: 16px; }
      .tenant { font-size: 24px; font-weight: 700; }
      .title { text-align: right; font-size: 22px; font-weight: 700; }
      .muted { color: #4b5563; font-size: 12px; line-height: 1.5; }
      .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 20px 0; font-size: 13px; }
      .box { border: 1px solid #d1d5db; border-radius: 6px; padding: 12px; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
      th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
      th { background: #f3f4f6; }
      .num { text-align: right; white-space: nowrap; }
      .totals { margin-left: auto; margin-top: 18px; width: 320px; font-size: 13px; }
      .totals div { display: flex; justify-content: space-between; padding: 5px 0; }
      .grand { border-top: 2px solid #111827; font-weight: 700; font-size: 16px; }
      .footer { margin-top: 28px; font-size: 12px; color: #4b5563; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <section class="header">
      <div>
        <div class="tenant">{{tenant.name}}</div>
        <div class="muted">{{tenant.address}}</div>
        <div class="muted">Phone: {{tenant.phone}}</div>
        {{#if tenant.gstNumber}}<div class="muted">GSTIN: {{tenant.gstNumber}}</div>{{/if}}
      </div>
      <div>
        <div class="title">Credit Note</div>
        <div class="muted">No: {{creditNote.creditNoteNumber}}</div>
        <div class="muted">Date: {{creditNoteDate}}</div>
        <div class="muted">Generated: {{generatedAt}}</div>
      </div>
    </section>

    <section class="meta">
      <div class="box">
        <strong>Customer</strong><br />
        {{#if customer}}
          {{customer.name}}<br />
          {{customer.phone}}<br />
          <span class="muted">{{customer.address}}</span>
        {{else}}
          Walk-in customer
        {{/if}}
      </div>
      <div class="box">
        <strong>Original invoice</strong><br />
        {{#if originalInvoice}}{{originalInvoice.invoiceNumber}}{{else}}-{{/if}}<br />
        <strong>Status</strong><br />
        {{creditNote.status}}
      </div>
    </section>

    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Qty</th>
          <th>Unit</th>
          <th class="num">Rate</th>
          <th class="num">Discount</th>
          <th class="num">GST %</th>
          <th class="num">CGST</th>
          <th class="num">SGST</th>
          <th class="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {{#each items}}
          <tr>
            <td>{{productName}}</td>
            <td>{{quantity}}</td>
            <td>{{unit}}</td>
            <td class="num">₹{{sellingPrice}}</td>
            <td class="num">₹{{discount}}</td>
            <td class="num">{{gstRate}}</td>
            <td class="num">₹{{cgst}}</td>
            <td class="num">₹{{sgst}}</td>
            <td class="num">₹{{total}}</td>
          </tr>
        {{/each}}
      </tbody>
    </table>

    <section class="totals">
      <div><span>Subtotal</span><span>₹{{subtotal}}</span></div>
      <div><span>Discount</span><span>₹{{totalDiscount}}</span></div>
      <div><span>CGST</span><span>₹{{totalCgst}}</span></div>
      <div><span>SGST</span><span>₹{{totalSgst}}</span></div>
      <div class="grand"><span>Grand total</span><span>₹{{grandTotal}}</span></div>
    </section>

    <section class="footer">
      {{#if creditNote.reason}}<div><strong>Reason:</strong> {{creditNote.reason}}</div>{{/if}}
      {{#if creditNote.notes}}<div><strong>Notes:</strong> {{creditNote.notes}}</div>{{/if}}
    </section>
  </body>
</html>`;
}
