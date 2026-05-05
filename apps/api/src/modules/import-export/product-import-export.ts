import { Prisma, type Product, type ProductBatch, type Tenant } from "@prisma/client";
import { getVerticalConfig } from "@retailos/vertical-configs";
import type { FastifyInstance } from "fastify";

import {
  buildExcelHtml,
  getBoolean,
  getDate,
  getNumber,
  getString,
  parseWorkbookRows,
  sendExcelHtml,
  type ExcelColumn,
  type ExcelRow,
} from "./excel.js";

type ProductWithBatches = Product & { batches: ProductBatch[] };
type ProductImportData = Omit<Prisma.ProductUncheckedCreateInput, "tenantId">;

const commonColumns: readonly ExcelColumn[] = [
  { key: "sku", header: "Product ID", required: true, sample: "530" },
  { key: "name", header: "Product Name", required: true, sample: "Bajra Flour 1 KG" },
  { key: "legacySubCategoryId", header: "Sub Category ID", required: true, sample: "7" },
  { key: "verticalData.category", header: "Category", required: true, sample: "Cold Pressed Oils" },
  { key: "hsnCode", header: "HSN Code", required: false },
  { key: "partGroup", header: "Part / Group", required: false },
  { key: "description", header: "Description", required: false },
  { key: "purchasePrice", header: "Purchase Price", required: false, sample: 100 },
  { key: "sellingPrice", header: "Retail Sale Price", required: true, sample: 100 },
  { key: "defaultDiscountPercent", header: "Discount %", required: false, sample: 0 },
  { key: "cgst", header: "CGST %", required: false, sample: 0 },
  { key: "sgst", header: "SGST %", required: false, sample: 0 },
  { key: "cessRate", header: "CESS %", required: false, sample: 0 },
  { key: "wholesalePrice", header: "Wholesale Price", required: false, sample: 100 },
  { key: "purchaseUnit", header: "Purchase Unit", required: false, sample: "UNT" },
  { key: "salesUnit", header: "Sales Unit", required: true, sample: "UNT" },
  { key: "alternateUnit", header: "Alter Unit", required: false, sample: "UNT" },
  { key: "conversionValue", header: "Conversion Value", required: false, sample: 1 },
  { key: "reorderLevel", header: "Minimum Stock", required: false, sample: 0 },
  { key: "mrp", header: "MRP", required: true, sample: 100 },
  { key: "godown", header: "Godown", required: false },
  { key: "rack", header: "Rack", required: false },
  { key: "currentStock", header: "Opening Qty", required: false, sample: 6 },
  { key: "batchNumber", header: "Batch", required: false },
  { key: "mfgDate", header: "Mfg Date dd/mm/yyyy", required: false },
  { key: "expiryDate", header: "Exp Date dd/mm/yyyy", required: false },
  { key: "barcode", header: "Barcode", required: true, sample: "530" },
  { key: "defaultSaleQty", header: "Default Sale Qty", required: false, sample: 1 },
];

const verticalColumnMap: Record<Tenant["vertical"], readonly ExcelColumn[]> = {
  GROCERY: [
    { key: "verticalData.brand", header: "Brand", required: false, sample: "Sivsan Oils" },
    { key: "verticalData.perishable", header: "Perishable", required: false, sample: "No" },
  ],
  PHARMACY: [
    { key: "verticalData.manufacturer", header: "Manufacturer", required: false },
    { key: "verticalData.drugSchedule", header: "Drug Schedule", required: false, sample: "None" },
    { key: "verticalData.prescriptionRequired", header: "Prescription Required", required: false, sample: "No" },
  ],
  FASHION: [
    { key: "verticalData.brand", header: "Brand", required: false },
    { key: "verticalData.season", header: "Season", required: false },
    { key: "verticalData.style", header: "Style", required: false },
    { key: "verticalData.size", header: "Size", required: false },
    { key: "verticalData.color", header: "Colour", required: false },
  ],
  HARDWARE: [
    { key: "verticalData.brand", header: "Brand", required: false },
    { key: "verticalData.grade", header: "Grade / Gauge", required: false },
  ],
  ELECTRONICS: [
    { key: "verticalData.brand", header: "Brand", required: false },
    { key: "verticalData.serialNumber", header: "Serial Number", required: false },
    { key: "verticalData.imei", header: "IMEI-1", required: false },
    { key: "verticalData.imei2", header: "IMEI-2", required: false },
    { key: "verticalData.warrantyMonths", header: "Warranty Months", required: false, sample: 12 },
  ],
  RESTAURANT: [
    { key: "verticalData.course", header: "Course", required: false, sample: "Main" },
    { key: "verticalData.foodType", header: "Food Type", required: false, sample: "Veg" },
    { key: "verticalData.prepTimeMinutes", header: "Prep Time Minutes", required: false, sample: 10 },
  ],
};

export function sendProductTemplate(tenant: Tenant, reply: Parameters<typeof sendExcelHtml>[0]): unknown {
  const config = getVerticalConfig(tenant.vertical);
  return sendExcelHtml(reply, `retailos-${tenant.vertical.toLowerCase()}-product-template.xls`, buildExcelHtml({
    title: `RetailOS ${config.displayName} Product Import Template`,
    columns: productColumns(tenant),
  }));
}

export async function sendProductExport(fastify: FastifyInstance, tenant: Tenant, reply: Parameters<typeof sendExcelHtml>[0]): Promise<unknown> {
  const products = await fastify.prisma.product.findMany({
    where: { tenantId: tenant.id, isActive: true },
    include: {
      batches: {
        orderBy: { receivedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { name: "asc" },
  });

  return sendExcelHtml(reply, `retailos-${tenant.vertical.toLowerCase()}-products-export.xls`, buildExcelHtml({
    title: "RetailOS Products Export",
    columns: productColumns(tenant),
    rows: products.map(productToRow),
  }));
}

export async function importProducts(fastify: FastifyInstance, tenant: Tenant, buffer: Buffer): Promise<{
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
      const parsed = parseProductRow(tenant, row);
      const existing = await findExistingProduct(fastify, tenant.id, parsed.data.barcode ?? null, parsed.data.sku ?? null);
      if (existing) {
        await fastify.prisma.product.update({
          where: { id: existing.id },
          data: parsed.data,
        });
        await maybeCreateBatch(fastify, tenant.id, existing.id, parsed);
        updated++;
      } else {
        const product = await fastify.prisma.product.create({
          data: {
            tenantId: tenant.id,
            ...parsed.data,
          },
        });
        await maybeCreateBatch(fastify, tenant.id, product.id, parsed);
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

function productColumns(tenant: Tenant): readonly ExcelColumn[] {
  return [...commonColumns, ...verticalColumnMap[tenant.vertical]];
}

function parseProductRow(tenant: Tenant, row: ExcelRow): {
  data: ProductImportData;
  batchNumber: string | undefined;
  mfgDate: Date | undefined;
  expiryDate: Date | undefined;
  batchQuantity: number | undefined;
  batchPurchasePrice: number | undefined;
} {
  const name = getString(row, ["Product Name", "Menu Item Name"]);
  const sku = getString(row, ["Product ID", "Item Code"]);
  const barcode = getString(row, ["Barcode"]);
  const legacySubCategoryId = getString(row, ["Sub Category ID"]);
  const category = getString(row, ["Category"]);
  const salesUnit = getString(row, ["Sales Unit", "Unit"]);
  if (!name) {
    throw new Error("Product Name is required");
  }
  if (!sku) {
    throw new Error("Product ID is required");
  }
  if (!legacySubCategoryId) {
    throw new Error("Sub Category ID is required");
  }
  if (!salesUnit) {
    throw new Error("Sales Unit is required");
  }
  if (!barcode) {
    throw new Error("Barcode is required");
  }
  if (!category) {
    throw new Error("Category is required");
  }

  const sellingPrice = getNumber(row, ["Retail Sale Price", "Menu Price"]);
  const mrp = getNumber(row, ["MRP", "Menu Price"]) ?? sellingPrice;
  if (sellingPrice === undefined) {
    throw new Error("Retail Sale Price is required");
  }
  if (mrp === undefined) {
    throw new Error("MRP is required");
  }

  const verticalData = parseVerticalData(tenant, row, category);
  const cgst = getNumber(row, ["CGST %"]) ?? 0;
  const sgst = getNumber(row, ["SGST %"]) ?? 0;
  const gstRate = tenant.gstEnabled ? cgst + sgst : 0;

  return {
    data: {
      name,
      sku,
      barcode,
      description: getString(row, ["Description"]) ?? null,
      partGroup: getString(row, ["Part / Group"]) ?? null,
      legacySubCategoryId,
      unit: salesUnit,
      mrp,
      sellingPrice,
      purchasePrice: getNumber(row, ["Purchase Price", "Food Cost"]) ?? null,
      wholesalePrice: getNumber(row, ["Wholesale Price"]) ?? null,
      defaultDiscountPercent: getNumber(row, ["Discount %"]) ?? null,
      gstRate,
      cessRate: getNumber(row, ["CESS %"]) ?? 0,
      hsnCode: getString(row, ["HSN Code", "SAC/HSN Code"]) ?? null,
      currentStock: getNumber(row, ["Opening Qty"]) ?? 0,
      reorderLevel: getNumber(row, ["Minimum Stock"]) ?? null,
      purchaseUnit: getString(row, ["Purchase Unit"]) ?? null,
      salesUnit,
      alternateUnit: getString(row, ["Alter Unit"]) ?? null,
      conversionValue: getNumber(row, ["Conversion Value"]) ?? null,
      godown: getString(row, ["Godown"]) ?? null,
      rack: getString(row, ["Rack"]) ?? null,
      defaultSaleQty: getNumber(row, ["Default Sale Qty"]) ?? null,
      verticalData: Object.keys(verticalData).length > 0 ? verticalData as Prisma.InputJsonValue : Prisma.JsonNull,
    },
    batchNumber: getString(row, ["Batch"]),
    mfgDate: getDate(row, ["Mfg Date dd/mm/yyyy"]),
    expiryDate: getDate(row, ["Exp Date dd/mm/yyyy"]),
    batchQuantity: getNumber(row, ["Opening Qty"]),
    batchPurchasePrice: getNumber(row, ["Purchase Price", "Food Cost"]),
  };
}

function parseVerticalData(tenant: Tenant, row: ExcelRow, category: string): Record<string, unknown> {
  const data: Record<string, unknown> = { category };
  for (const column of verticalColumnMap[tenant.vertical]) {
    const key = column.key.replace("verticalData.", "");
    const value = column.header.toLowerCase().includes("required") || column.header === "Perishable"
      ? getBoolean(row, [column.header])
      : getString(row, [column.header]) ?? getNumber(row, [column.header]);
    if (value !== undefined) {
      data[key] = value;
    }
  }

  return data;
}

async function findExistingProduct(fastify: FastifyInstance, tenantId: string, barcode: string | null, sku: string | null): Promise<Product | null> {
  if (!barcode && !sku) {
    return null;
  }

  return fastify.prisma.product.findFirst({
    where: {
      tenantId,
      isActive: true,
      OR: [
        ...(barcode ? [{ barcode }] : []),
        ...(sku ? [{ sku }] : []),
      ],
    },
  });
}

async function maybeCreateBatch(
  fastify: FastifyInstance,
  tenantId: string,
  productId: string,
  parsed: ReturnType<typeof parseProductRow>,
): Promise<void> {
  if (!parsed.batchNumber || !parsed.expiryDate || !parsed.batchQuantity || parsed.batchPurchasePrice === undefined) {
    return;
  }

  await fastify.prisma.productBatch.create({
    data: {
      tenantId,
      productId,
      batchNumber: parsed.batchNumber,
      ...(parsed.mfgDate ? { mfgDate: parsed.mfgDate } : {}),
      expiryDate: parsed.expiryDate,
      quantity: parsed.batchQuantity,
      purchasePrice: parsed.batchPurchasePrice,
    },
  });
}

function productToRow(product: ProductWithBatches): Record<string, unknown> {
  const batch = product.batches[0];
  const verticalData = readVerticalData(product.verticalData);
  const gstRate = product.gstRate.toNumber();
  return {
    "Product ID": product.sku ?? "",
    "Item Code": product.sku ?? "",
    "Product Name": product.name,
    "Menu Item Name": product.name,
    "Sub Category ID": product.legacySubCategoryId ?? "",
    "HSN Code": product.hsnCode ?? "",
    "SAC/HSN Code": product.hsnCode ?? "",
    "Part / Group": product.partGroup ?? "",
    Description: product.description ?? "",
    "Purchase Price": product.purchasePrice?.toNumber() ?? "",
    "Food Cost": product.purchasePrice?.toNumber() ?? "",
    "Retail Sale Price": product.sellingPrice.toNumber(),
    "Menu Price": product.mrp.toNumber(),
    "Discount %": product.defaultDiscountPercent?.toNumber() ?? "",
    "CGST %": gstRate / 2,
    "SGST %": gstRate / 2,
    "CESS %": product.cessRate.toNumber(),
    "Wholesale Price": product.wholesalePrice?.toNumber() ?? "",
    "Purchase Unit": product.purchaseUnit ?? "",
    "Sales Unit": product.salesUnit ?? product.unit,
    Unit: product.unit,
    "Alter Unit": product.alternateUnit ?? "",
    "Conversion Value": product.conversionValue?.toNumber() ?? "",
    "Minimum Stock": product.reorderLevel?.toNumber() ?? "",
    MRP: product.mrp.toNumber(),
    Godown: product.godown ?? "",
    Rack: product.rack ?? "",
    "Opening Qty": product.currentStock.toNumber(),
    Batch: batch?.batchNumber ?? "",
    "Mfg Date dd/mm/yyyy": batch?.mfgDate?.toLocaleDateString("en-IN") ?? "",
    "Exp Date dd/mm/yyyy": batch?.expiryDate?.toLocaleDateString("en-IN") ?? "",
    Barcode: product.barcode ?? "",
    "Default Sale Qty": product.defaultSaleQty?.toNumber() ?? "",
    Brand: readText(verticalData, "brand"),
    Category: readText(verticalData, "category"),
    Perishable: readBool(verticalData, "perishable"),
    Manufacturer: readText(verticalData, "manufacturer"),
    "Drug Schedule": readText(verticalData, "drugSchedule"),
    "Prescription Required": readBool(verticalData, "prescriptionRequired"),
    Season: readText(verticalData, "season"),
    Style: readText(verticalData, "style"),
    Size: readText(verticalData, "size"),
    Colour: readText(verticalData, "color"),
    "Grade / Gauge": readText(verticalData, "grade"),
    "Serial Number": readText(verticalData, "serialNumber"),
    "IMEI-1": readText(verticalData, "imei"),
    "IMEI-2": readText(verticalData, "imei2"),
    "Warranty Months": readText(verticalData, "warrantyMonths"),
    Course: readText(verticalData, "course"),
    "Food Type": readText(verticalData, "foodType"),
    "Prep Time Minutes": readText(verticalData, "prepTimeMinutes"),
  };
}

function readVerticalData(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readText(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value.toString();
  }

  return "";
}

function readBool(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return value === true ? "Yes" : value === false ? "No" : "";
}
