import type { Customer, Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { buildExcelHtml, getBoolean, getNumber, getString, parseWorkbookRows, sendExcelHtml, type ExcelColumn, type ExcelRow } from "./excel.js";

const customerColumns: readonly ExcelColumn[] = [
  { key: "customerCode", header: "Customer ID", required: true, sample: "CUST-001" },
  { key: "name", header: "Customer Name", required: true, sample: "John Doe" },
  { key: "address", header: "Address", required: true, sample: "201, Main Road, Hyderabad, Telangana 500089" },
  { key: "phone", header: "Contact No.", required: true, sample: "9876543210" },
  { key: "email", header: "Email ID", required: false, sample: "customer@example.com" },
  { key: "remarks", header: "Remarks", required: false },
  { key: "accountNo", header: "Account No.", required: false },
  { key: "accountName", header: "Account Name", required: false },
  { key: "bank", header: "Bank", required: false },
  { key: "branch", header: "Branch", required: false },
  { key: "ifscCode", header: "IFSC Code", required: false },
  { key: "gstin", header: "GSTIN/UID", required: false },
  { key: "pan", header: "PAN", required: false },
  { key: "cin", header: "CIN", required: false },
  { key: "openingBalanceType", header: "Opening Balance Type", required: false, sample: "CR" },
  { key: "openingBalance", header: "Opening Balance", required: false, sample: 0 },
  { key: "tcsEnabled", header: "TCS", required: false, sample: "No" },
  { key: "creditLimit", header: "Credit Limit", required: false, sample: 10000 },
  { key: "creditLimitEnabled", header: "Limit Status", required: false, sample: "Yes" },
  { key: "creditDays", header: "Turn Around Day", required: false, sample: 1 },
  { key: "itemDiscountPercent", header: "Disc% on Item", required: false, sample: 0 },
  { key: "itemDiscountEnabled", header: "Discount Status on Item", required: false, sample: "No" },
];

export function sendCustomerTemplate(reply: Parameters<typeof sendExcelHtml>[0]): unknown {
  return sendExcelHtml(reply, "bizbil-customer-template.xls", buildExcelHtml({ title: "BizBil Customer Import Template", columns: customerColumns }));
}

export async function sendCustomerExport(fastify: FastifyInstance, tenant: Tenant, reply: Parameters<typeof sendExcelHtml>[0]): Promise<unknown> {
  const customers = await fastify.prisma.customer.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
  });

  return sendExcelHtml(reply, "bizbil-customers-export.xls", buildExcelHtml({
    title: "BizBil Customers Export",
    columns: customerColumns,
    rows: customers.map(customerToRow),
  }));
}

export async function importCustomers(fastify: FastifyInstance, tenant: Tenant, buffer: Buffer): Promise<{
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ row: number; error: string }>;
}> {
  const rows = parseWorkbookRows(buffer);
  let created = 0;
  let updated = 0;
  const errors: Array<{ row: number; error: string }> = [];

  for (const [index, row] of rows.entries()) {
    try {
      const data = parseCustomerRow(row);
      const existing = await findExistingCustomer(fastify, tenant.id, data.phone, data.customerCode);
      if (existing) {
        await fastify.prisma.customer.update({
          where: { id: existing.id },
          data,
        });
        updated++;
      } else {
        await fastify.prisma.customer.create({
          data: {
            tenantId: tenant.id,
            ...data,
          },
        });
        created++;
      }
    } catch (error) {
      errors.push({ row: index + 2, error: error instanceof Error ? error.message : "Unable to import row" });
    }
  }

  return {
    total: rows.length,
    created,
    updated,
    failed: errors.length,
    errors,
  };
}

function parseCustomerRow(row: ExcelRow) {
  const name = getString(row, ["Customer Name", "Name"]);
  const phone = getString(row, ["Contact No.", "Phone"]);
  const customerCode = getString(row, ["Customer ID"]);
  const address = getString(row, ["Address"]);
  if (!customerCode) {
    throw new Error("Customer ID is required");
  }
  if (!name) {
    throw new Error("Customer Name is required");
  }
  if (!address) {
    throw new Error("Address is required");
  }
  if (!phone) {
    throw new Error("Contact No. is required");
  }

  const openingBalanceType = getString(row, ["Opening Balance Type"])?.toUpperCase();

  return {
    customerCode,
    name,
    phone,
    email: getString(row, ["Email ID", "Email"]) ?? null,
    address,
    city: null,
    state: null,
    postalCode: null,
    remarks: getString(row, ["Remarks"]) ?? null,
    accountNo: getString(row, ["Account No."]) ?? null,
    accountName: getString(row, ["Account Name"]) ?? null,
    bank: getString(row, ["Bank"]) ?? null,
    branch: getString(row, ["Branch"]) ?? null,
    ifscCode: getString(row, ["IFSC Code"]) ?? null,
    gstin: getString(row, ["GSTIN/UID", "GSTIN"]) ?? null,
    pan: getString(row, ["PAN"]) ?? null,
    cin: getString(row, ["CIN"]) ?? null,
    openingBalanceType: openingBalanceType === "DR" || openingBalanceType === "CR" ? openingBalanceType : null,
    openingBalance: getNumber(row, ["Opening Balance"]) ?? 0,
    tcsEnabled: getBoolean(row, ["TCS"]) ?? false,
    creditLimit: getNumber(row, ["Credit Limit"]) ?? null,
    creditLimitEnabled: getBoolean(row, ["Limit Status"]) ?? false,
    creditDays: getNumber(row, ["Turn Around Day"]) ?? null,
    itemDiscountPercent: getNumber(row, ["Disc% on Item"]) ?? 0,
    itemDiscountEnabled: getBoolean(row, ["Discount Status on Item"]) ?? false,
  };
}

async function findExistingCustomer(fastify: FastifyInstance, tenantId: string, phone: string, customerCode: string | null): Promise<Customer | null> {
  return fastify.prisma.customer.findFirst({
    where: {
      tenantId,
      OR: [
        { phone },
        ...(customerCode ? [{ customerCode }] : []),
      ],
    },
  });
}

function customerToRow(customer: Customer): Record<string, unknown> {
  return {
    "Customer ID": customer.customerCode ?? "",
    "Customer Name": customer.name,
    Address: customer.address ?? "",
    "Contact No.": customer.phone,
    "Email ID": customer.email ?? "",
    Remarks: customer.remarks ?? "",
    "Account No.": customer.accountNo ?? "",
    "Account Name": customer.accountName ?? "",
    Bank: customer.bank ?? "",
    Branch: customer.branch ?? "",
    "IFSC Code": customer.ifscCode ?? "",
    "GSTIN/UID": customer.gstin ?? "",
    PAN: customer.pan ?? "",
    CIN: customer.cin ?? "",
    "Opening Balance Type": customer.openingBalanceType ?? "",
    "Opening Balance": customer.openingBalance.toNumber(),
    TCS: customer.tcsEnabled ? "Yes" : "No",
    "Credit Limit": customer.creditLimit?.toNumber() ?? "",
    "Limit Status": customer.creditLimitEnabled ? "Yes" : "No",
    "Turn Around Day": customer.creditDays ?? "",
    "Disc% on Item": customer.itemDiscountPercent.toNumber(),
    "Discount Status on Item": customer.itemDiscountEnabled ? "Yes" : "No",
  };
}
