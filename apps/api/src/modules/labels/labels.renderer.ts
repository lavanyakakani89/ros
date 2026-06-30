import { Buffer } from "node:buffer";

import type { Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { Printer } from "@node-escpos/core";
import USB from "@node-escpos/usb-adapter";
import bwipjs from "bwip-js";
import puppeteer from "puppeteer";

import { generateQrDataUrl } from "../../lib/qr.js";
import type {
  LabelCanvasDefinition,
  LabelCanvasField,
  LabelLayoutMode,
  LabelPreviewField,
  LabelPreviewLabel,
  ResolvedLabelProduct,
} from "./labels.types.js";

const PRINTER_DPI = 203;

export interface ResolvedLabelSheet {
  index: number;
  width_mm: number;
  height_mm: number;
  layout_mode: LabelLayoutMode;
  labels: LabelPreviewLabel[];
}

export interface ResolvedLabelJob {
  templateId: string | null;
  templateName: string;
  width_mm: number;
  height_mm: number;
  layout_mode: LabelLayoutMode;
  sheets: ResolvedLabelSheet[];
  labels: LabelPreviewLabel[];
  totalLabels: number;
}

export async function resolveLabelJob(input: {
  fastify: FastifyInstance;
  tenant: Tenant;
  templateId: string | null;
  templateName: string;
  canvasJson: LabelCanvasDefinition;
  widthMm: number;
  heightMm: number;
  layoutMode: LabelLayoutMode;
  items: Array<{ product_id: string; quantity: number }>;
}): Promise<ResolvedLabelJob> {
  const productIds = [...new Set(input.items.map((item) => item.product_id))];
  const products = await input.fastify.prisma.product.findMany({
    where: {
      tenantId: input.tenant.id,
      isActive: true,
      id: { in: productIds },
    },
    include: {
      batches: {
        orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }],
        take: 1,
        select: {
          expiryDate: true,
          receivedAt: true,
        },
      },
    },
  });

  const productById = new Map(products.map((product) => [product.id, product]));
  const unresolvedIds = productIds.filter((id) => !productById.has(id));
  if (unresolvedIds.length > 0) {
    throw new Error("One or more selected products were not found.");
  }

  const labels: LabelPreviewLabel[] = [];
  for (const item of input.items) {
    const product = productById.get(item.product_id);
    if (!product) {
      continue;
    }

    for (let index = 0; index < item.quantity; index += 1) {
      const sheetIndex = input.layoutMode === "2up" ? Math.floor(labels.length / 2) : labels.length;
      const slotIndex = input.layoutMode === "2up" ? labels.length % 2 : 0;
      labels.push({
        product_id: product.id,
        product_name: product.name,
        sku: product.sku ?? null,
        quantity: item.quantity,
        sheet_index: sheetIndex,
        slot_index: slotIndex,
        fields: await resolveFields(input.fastify, input.canvasJson, product as ResolvedLabelProduct, item.quantity),
      });
    }
  }

  const sheets = groupLabelsIntoSheets(labels, input.widthMm, input.heightMm, input.layoutMode);
  return {
    templateId: input.templateId,
    templateName: input.templateName,
    width_mm: input.widthMm,
    height_mm: input.heightMm,
    layout_mode: input.layoutMode,
    sheets,
    labels,
    totalLabels: labels.length,
  };
}

export function renderLabelSheetsHtml(input: ResolvedLabelJob): string {
  const sheetWidthMm = input.layout_mode === "2up" ? input.width_mm * 2 : input.width_mm;
  const sheetsMarkup = input.sheets
    .map((sheet) => {
      const sheetLabelsMarkup = sheet.labels
        .map((label) => {
          const leftMm = label.slot_index === 1 ? input.width_mm : 0;
          return `
            <section class="label" style="left:${leftMm}mm; top:0mm; width:${input.width_mm}mm; height:${input.height_mm}mm;">
              ${renderLabelFieldMarkup(label.fields)}
            </section>
          `;
        })
        .join("");

      return `<section class="sheet">${sheetLabelsMarkup}</section>`;
    })
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @page {
        size: ${sheetWidthMm}mm ${input.height_mm}mm;
        margin: 0;
      }
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        width: ${sheetWidthMm}mm;
        color: #111827;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .sheet {
        position: relative;
        width: ${sheetWidthMm}mm;
        height: ${input.height_mm}mm;
        overflow: hidden;
        page-break-after: always;
      }
      .label {
        position: absolute;
        box-sizing: border-box;
        border: 0.1mm solid rgba(15, 23, 42, 0.08);
        overflow: hidden;
        background: #ffffff;
      }
      .field {
        position: absolute;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        white-space: pre-wrap;
        overflow: hidden;
        color: #111827;
        line-height: 1.1;
      }
      .field img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: block;
      }
      .field-text {
        width: 100%;
      }
    </style>
  </head>
  <body>${sheetsMarkup}</body>
</html>`;
}

export async function renderLabelPdfBuffer(input: ResolvedLabelJob): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const totalWidthMm = input.layout_mode === "2up" ? input.width_mm * 2 : input.width_mm;
    await page.setViewport({
      width: Math.max(1, Math.round((totalWidthMm * 96) / 25.4)),
      height: Math.max(1, Math.round((input.height_mm * 96) / 25.4)),
      deviceScaleFactor: 1,
    });
    await page.setContent(renderLabelSheetsHtml(input), { waitUntil: "networkidle0" });
    await page.emulateMediaType("print");
    const pdf = await page.pdf({
      width: `${String(totalWidthMm)}mm`,
      height: `${String(input.height_mm)}mm`,
      printBackground: true,
      margin: {
        top: "0mm",
        right: "0mm",
        bottom: "0mm",
        left: "0mm",
      },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export async function renderLabelSheetBitmaps(input: ResolvedLabelJob): Promise<Buffer[]> {
  const browser = await launchBrowser();
  try {
    const bitmaps: Buffer[] = [];
    for (const sheet of input.sheets) {
      const page = await browser.newPage();
      const sheetInput: ResolvedLabelJob = {
        ...input,
        labels: sheet.labels,
        sheets: [sheet],
        totalLabels: sheet.labels.length,
      };
      const totalWidthMm = input.layout_mode === "2up" ? input.width_mm * 2 : input.width_mm;
      await page.setViewport({
        width: Math.max(1, Math.round((totalWidthMm * PRINTER_DPI) / 25.4)),
        height: Math.max(1, Math.round((input.height_mm * PRINTER_DPI) / 25.4)),
        deviceScaleFactor: 1,
      });
      await page.setContent(renderLabelSheetsHtml(sheetInput), { waitUntil: "networkidle0" });
      const screenshot = await page.screenshot({
        type: "png",
        fullPage: true,
        omitBackground: false,
      });
      bitmaps.push(Buffer.from(screenshot));
      await page.close();
    }
    return bitmaps;
  } finally {
    await browser.close();
  }
}

export async function printLabelBitmaps(bitmaps: Buffer[]): Promise<void> {
  const device = new USB();
  await device.open();
  const printer = new Printer(device);

  try {
    for (const [index, bitmap] of bitmaps.entries()) {
      await printer.image(bitmap, "d24");
      if (index < bitmaps.length - 1) {
        await printer.feed(1);
      }
    }
    await printer.cut();
  } finally {
    await printer.close();
  }
}

export async function detectPrinterStatus(): Promise<{ connected: boolean; name: string | null }> {
  const device = new USB();
  try {
    await device.open();
    await device.close();
    return {
      connected: true,
      name: "ATPOS HQ450 L",
    };
  } catch {
    return {
      connected: false,
      name: null,
    };
  }
}

async function resolveFields(
  fastify: FastifyInstance,
  canvasJson: LabelCanvasDefinition,
  product: ResolvedLabelProduct,
  requestedQuantity: number,
): Promise<LabelPreviewField[]> {
  const packedDate = resolveDateLabel(product.verticalData, ["packedDate", "packed_date", "packDate"]) ?? formatDate(product.batches[0]?.receivedAt ?? null);
  const bestBefore = resolveDateLabel(product.verticalData, ["bestBefore", "best_before", "expiryDate"]) ?? formatDate(product.batches[0]?.expiryDate ?? null);
  const codePayload = product.sku?.trim() || product.barcode?.trim() || product.id;

  return Promise.all(
    canvasJson.fields.map(async (field) => {
      let resolvedContent = "";

      if (field.type === "product_name") {
        resolvedContent = product.name;
      } else if (field.type === "price") {
        resolvedContent = formatMoney(product.sellingPrice);
      } else if (field.type === "quantity") {
        resolvedContent = String(requestedQuantity);
      } else if (field.type === "packed_date") {
        resolvedContent = packedDate;
      } else if (field.type === "best_before") {
        resolvedContent = bestBefore;
      } else if (field.type === "static_text") {
        resolvedContent = field.textContent ?? "";
      } else if (field.type === "qr_code") {
        resolvedContent = await generateQrDataUrl(codePayload);
      } else if (field.type === "barcode") {
        resolvedContent = await generateBarcodeDataUrl(codePayload, field);
      } else if (field.type === "image") {
        resolvedContent = field.imageUrl ? await resolveImageDataUrl(fastify, field.imageUrl) : "";
      }

      return {
        ...field,
        resolved_content: resolvedContent,
      };
    }),
  );
}

async function resolveImageDataUrl(fastify: FastifyInstance, imageUrl: string): Promise<string> {
  if (imageUrl.startsWith("data:")) {
    return imageUrl;
  }

  const objectName = resolveObjectName(imageUrl);
  if (!objectName) {
    return "";
  }

  const stream = await fastify.minio.getObject(fastify.minioBucket, objectName);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const buffer = Buffer.concat(chunks);
  const contentType = inferImageContentType(objectName);
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function resolveObjectName(imageUrl: string): string | null {
  try {
    const parsed = new URL(imageUrl, "http://localhost");
    return parsed.searchParams.get("objectName") ?? decodeURIComponent(parsed.pathname.split("/").filter(Boolean).at(-1) ?? "");
  } catch {
    return imageUrl.trim() || null;
  }
}

function inferImageContentType(objectName: string): string {
  const lower = objectName.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}

async function generateBarcodeDataUrl(payload: string, field: LabelCanvasField): Promise<string> {
  const scale = Math.max(2, Math.round(Math.max(field.width, 1) * 2));
  const height = Math.max(12, Math.round(Math.max(field.height, 1) * 3));
  const buffer = await bwipjs.toBuffer({
    bcid: "code128",
    text: payload,
    scale,
    height,
    includetext: true,
    textxalign: "center",
    backgroundcolor: "FFFFFF",
  });

  return `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`;
}

function groupLabelsIntoSheets(labels: LabelPreviewLabel[], widthMm: number, heightMm: number, layoutMode: LabelLayoutMode): ResolvedLabelSheet[] {
  const sheets: ResolvedLabelSheet[] = [];
  if (layoutMode === "1up") {
    labels.forEach((label, index) => {
      sheets.push({
        index,
        width_mm: widthMm,
        height_mm: heightMm,
        layout_mode: layoutMode,
        labels: [label],
      });
    });
    return sheets;
  }

  for (let index = 0; index < labels.length; index += 2) {
    sheets.push({
      index: Math.floor(index / 2),
      width_mm: widthMm * 2,
      height_mm: heightMm,
      layout_mode: layoutMode,
      labels: labels.slice(index, index + 2),
    });
  }

  return sheets;
}

function renderLabelFieldMarkup(fields: LabelPreviewField[]): string {
  return fields
    .map((field) => {
      const style = [
        `left:${field.x}mm`,
        `top:${field.y}mm`,
        `width:${field.width}mm`,
        `height:${field.height}mm`,
        `transform: rotate(${field.rotation}deg)`,
        `font-size:${field.fontSize ?? 10}pt`,
        `font-weight:${field.fontWeight ?? "normal"}`,
      ].join(";");

      if (field.type === "image" || field.type === "qr_code" || field.type === "barcode") {
        const src = field.resolved_content || placeholderDataUrl(field.type);
        return `<div class="field" style="${style};"><img alt="${escapeHtml(field.type)}" src="${escapeHtml(src)}" /></div>`;
      }

      const text = escapeHtml(field.resolved_content || field.textContent || "");
      return `<div class="field field-text" style="${style};">${text}</div>`;
    })
    .join("");
}

function placeholderDataUrl(type: LabelCanvasField["type"]): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="#f8fafc"/><text x="50%" y="50%" font-family="Arial, sans-serif" font-size="24" fill="#94a3b8" text-anchor="middle" dominant-baseline="middle">${type === "image" ? "Image" : type === "barcode" ? "Barcode" : "QR"}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function formatMoney(value: string | number): string {
  return `₹${Number(value).toFixed(2)}`;
}

function formatDate(value: Date | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.toLocaleDateString("en-IN");
}

function resolveDateLabel(verticalData: Record<string, unknown> | null, keys: string[]): string {
  if (!verticalData) {
    return "";
  }

  for (const key of keys) {
    const value = verticalData[key];
    if (typeof value === "string" && value.trim()) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleDateString("en-IN");
      }
      return value;
    }
  }

  return "";
}

async function launchBrowser() {
  return puppeteer.launch({
    ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
    args: ["--no-sandbox"],
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
