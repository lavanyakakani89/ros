import type { Customer, Tenant } from "@prisma/client";
import Handlebars from "handlebars";
import type { Client } from "minio";
import puppeteer from "puppeteer";

export interface CustomerStatementEntry {
  date: Date;
  invoiceNumber: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface CustomerStatementData {
  customer: Customer;
  entries: CustomerStatementEntry[];
  from?: Date | undefined;
  to?: Date | undefined;
  totalBilled: number;
  totalPaid: number;
  outstandingDue: number;
}

export async function generateCustomerStatementPdf(input: {
  statement: CustomerStatementData;
  tenant: Tenant;
  minio: Client;
  bucket: string;
}): Promise<string> {
  const html = Handlebars.compile(getTemplate())({
    tenant: input.tenant,
    customer: input.statement.customer,
    from: formatDate(input.statement.from),
    to: formatDate(input.statement.to),
    generatedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    entries: input.statement.entries.map((entry) => ({
      date: formatDate(entry.date),
      invoiceNumber: entry.invoiceNumber,
      description: entry.description,
      debit: money(entry.debit),
      credit: money(entry.credit),
      balance: money(entry.balance),
    })),
    totalBilled: money(input.statement.totalBilled),
    totalPaid: money(input.statement.totalPaid),
    outstandingDue: money(input.statement.outstandingDue),
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
    const dateKey = new Date().toISOString().slice(0, 10);
    const filename = `statements/${input.tenant.id}/${input.statement.customer.id}-${dateKey}.pdf`;
    await input.minio.putObject(input.bucket, filename, Buffer.from(pdfBuffer), pdfBuffer.length, {
      "Content-Type": "application/pdf",
    });

    return filename;
  } finally {
    await browser.close();
  }
}

function formatDate(value: Date | undefined): string {
  if (!value) {
    return "-";
  }

  return value.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

function money(value: number): string {
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
    </style>
  </head>
  <body>
    <section class="header">
      <div>
        <div class="tenant">{{tenant.name}}</div>
        <div class="muted">{{tenant.address}}</div>
        <div class="muted">Phone: {{tenant.phone}}</div>
      </div>
      <div>
        <div class="title">Customer Statement</div>
        <div class="muted">Period: {{from}} to {{to}}</div>
        <div class="muted">Generated: {{generatedAt}}</div>
      </div>
    </section>

    <section class="meta">
      <div class="box">
        <strong>Customer</strong><br />
        {{customer.name}}<br />
        {{customer.phone}}<br />
        <span class="muted">{{customer.address}}</span>
      </div>
      <div class="box">
        <strong>Summary</strong><br />
        Total billed: ₹{{totalBilled}}<br />
        Total paid: ₹{{totalPaid}}<br />
        Outstanding: ₹{{outstandingDue}}
      </div>
    </section>

    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Invoice No.</th>
          <th>Description</th>
          <th class="num">Debit</th>
          <th class="num">Credit</th>
          <th class="num">Balance</th>
        </tr>
      </thead>
      <tbody>
        {{#each entries}}
          <tr>
            <td>{{date}}</td>
            <td>{{invoiceNumber}}</td>
            <td>{{description}}</td>
            <td class="num">₹{{debit}}</td>
            <td class="num">₹{{credit}}</td>
            <td class="num">₹{{balance}}</td>
          </tr>
        {{/each}}
      </tbody>
    </table>

    <section class="totals">
      <div><span>Total billed</span><span>₹{{totalBilled}}</span></div>
      <div><span>Total paid</span><span>₹{{totalPaid}}</span></div>
      <div class="grand"><span>Outstanding due</span><span>₹{{outstandingDue}}</span></div>
    </section>
  </body>
</html>`;
}
