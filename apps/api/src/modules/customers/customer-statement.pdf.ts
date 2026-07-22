import type { Tenant } from "@prisma/client";
import type { Client } from "minio";

export interface CustomerStatementData {
  customer: {
    id: string;
    name: string;
    phone: string;
  };
  entries: Array<{
    date: Date;
    invoiceNumber: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }>;
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
  const objectName = `customer-statements/${input.tenant.id}/${input.statement.customer.id}-${Date.now().toString()}.pdf`;
  const pdf = buildSimplePdf(statementLines(input.statement, input.tenant));
  await input.minio.putObject(input.bucket, objectName, pdf, pdf.length, {
    "Content-Type": "application/pdf",
  });

  return objectName;
}

function statementLines(statement: CustomerStatementData, tenant: Tenant): string[] {
  return [
    tenant.name,
    `Customer statement: ${statement.customer.name}`,
    `Phone: ${statement.customer.phone}`,
    `Period: ${formatDate(statement.from)} to ${formatDate(statement.to)}`,
    "",
    "Date        Invoice        Description          Debit      Credit     Balance",
    ...statement.entries.map((entry) => [
      formatDate(entry.date).padEnd(11),
      entry.invoiceNumber.padEnd(14),
      entry.description.padEnd(20),
      entry.debit.toFixed(2).padStart(9),
      entry.credit.toFixed(2).padStart(9),
      entry.balance.toFixed(2).padStart(10),
    ].join(" ")),
    "",
    `Total billed: ${statement.totalBilled.toFixed(2)}`,
    `Total paid: ${statement.totalPaid.toFixed(2)}`,
    `Outstanding due: ${statement.outstandingDue.toFixed(2)}`,
  ];
}

function buildSimplePdf(lines: string[]): Buffer {
  const escapedLines = lines.map((line, index) => `BT /F1 10 Tf 50 ${String(780 - index * 14)} Td (${escapePdf(line)}) Tj ET`).join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${String(Buffer.byteLength(escapedLines))} >> stream\n${escapedLines}\nendstream endobj`,
  ];
  let offset = "%PDF-1.4\n".length;
  const xref = ["0000000000 65535 f "];
  for (const object of objects) {
    xref.push(`${String(offset).padStart(10, "0")} 00000 n `);
    offset += Buffer.byteLength(`${object}\n`);
  }
  const body = objects.join("\n") + "\n";
  const startxref = "%PDF-1.4\n".length + Buffer.byteLength(body);
  return Buffer.from(`%PDF-1.4\n${body}xref\n0 ${String(objects.length + 1)}\n${xref.join("\n")}\ntrailer << /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(startxref)}\n%%EOF`);
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function formatDate(value: Date | undefined): string {
  return value ? value.toISOString().slice(0, 10) : "-";
}
