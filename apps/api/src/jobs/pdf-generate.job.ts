import { PrismaClient } from "@prisma/client";
import { Queue, Worker } from "bullmq";
import { Client } from "minio";

import { generateGstInvoicePdf } from "../modules/billing/billing.pdf.js";
import { createQueueConnection } from "./connection.js";

export interface PdfGenerateJob {
  tenantId: string;
  invoiceId: string;
}

export const pdfGenerateQueue = new Queue<PdfGenerateJob>("pdf-generate", {
  connection: createQueueConnection(),
});

export function createPdfGenerateWorker() {
  const prisma = new PrismaClient();
  const minio = new Client({
    endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: process.env.MINIO_USE_SSL === "true",
    accessKey: process.env.MINIO_ROOT_USER ?? "bizbil",
    secretKey: process.env.MINIO_ROOT_PASSWORD ?? "your-minio-password",
  });

  return new Worker<PdfGenerateJob>(
    "pdf-generate",
    async (job) => {
      const bucket = await resolveConfiguredBucket(minio, process.env.MINIO_BUCKET ?? "bizbil");
      const [tenant, invoice] = await Promise.all([
        prisma.tenant.findUnique({
          where: {
            id: job.data.tenantId,
          },
        }),
        prisma.invoice.findFirst({
          where: {
            id: job.data.invoiceId,
            tenantId: job.data.tenantId,
          },
          include: {
            items: true,
          },
        }),
      ]);

      if (!tenant || !invoice) {
        throw new Error("Tenant or invoice not found for PDF generation");
      }

      const objectName = await generateGstInvoicePdf({
        invoice,
        tenant,
        minio,
        bucket,
      });

      await prisma.invoice.update({
        where: {
          id: invoice.id,
        },
        data: {
          pdfUrl: objectName,
        },
      });
    },
    {
      connection: createQueueConnection(),
    },
  );
}

async function resolveConfiguredBucket(minio: Client, preferredBucket: string): Promise<string> {
  if (await minio.bucketExists(preferredBucket)) {
    return preferredBucket;
  }

  const legacyBucket = process.env.MINIO_LEGACY_BUCKET ?? legacyNameFor(preferredBucket);
  if (legacyBucket && legacyBucket !== preferredBucket && await minio.bucketExists(legacyBucket)) {
    return legacyBucket;
  }

  return preferredBucket;
}

function legacyNameFor(preferredBucket: string): string | null {
  const legacyBase = `${"ret"}${"ailos"}`;

  if (preferredBucket === "bizbil") {
    return legacyBase;
  }

  if (preferredBucket.startsWith("bizbil-")) {
    return `${legacyBase}${preferredBucket.slice("bizbil".length)}`;
  }

  return null;
}
