import type { Invoice, InvoiceItem, Tenant } from "@prisma/client";
import Handlebars from "handlebars";
import type { Client } from "minio";
import puppeteer from "puppeteer";

export interface InvoiceWithItems extends Invoice {
  items: InvoiceItem[];
}

export async function generateGstInvoicePdf(input: {
  invoice: InvoiceWithItems;
  tenant: Tenant;
  minio: Client;
  bucket: string;
}): Promise<string> {
  const template = Handlebars.compile(getTemplate());
  const html = template({
    invoice: input.invoice,
    tenant: input.tenant,
    items: input.invoice.items.map((item) => ({
      ...item,
      quantity: item.quantity.toString(),
      mrp: money(item.mrp),
      sellingPrice: money(item.sellingPrice),
      discount: money(item.discount),
      gstRate: item.gstRate.toString(),
      cgst: money(item.cgst),
      sgst: money(item.sgst),
      total: money(item.total),
    })),
    subtotal: money(input.invoice.subtotal),
    totalDiscount: money(input.invoice.totalDiscount),
    totalCgst: money(input.invoice.totalCgst),
    totalSgst: money(input.invoice.totalSgst),
    grandTotal: money(input.invoice.grandTotal),
    amountPaid: money(input.invoice.amountPaid),
    amountDue: money(input.invoice.amountDue),
    inWords: `${money(input.invoice.grandTotal)} rupees only`,
    generatedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
  });

  const browser = await puppeteer.launch({
    args: ["--no-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
    const filename = `invoices/${input.tenant.id}/${input.invoice.invoiceNumber}.pdf`;

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
        <div class="muted">GSTIN: {{tenant.gstNumber}}</div>
      </div>
      <div>
        <div class="title">GST Invoice</div>
        <div class="muted">Invoice: {{invoice.invoiceNumber}}</div>
        <div class="muted">Date: {{invoice.invoiceDate}}</div>
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
            <td class="num">{{sellingPrice}}</td>
            <td class="num">{{discount}}</td>
            <td class="num">{{gstRate}}</td>
            <td class="num">{{cgst}}</td>
            <td class="num">{{sgst}}</td>
            <td class="num">{{total}}</td>
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
