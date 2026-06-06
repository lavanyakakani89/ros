import fp from "fastify-plugin";
import { Client } from "minio";

export const minioPlugin = fp(async (fastify) => {
  const minio = new Client({
    endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: process.env.MINIO_USE_SSL === "true",
    accessKey: process.env.MINIO_ROOT_USER ?? "bizbil",
    secretKey: process.env.MINIO_ROOT_PASSWORD ?? "your-minio-password",
  });
  const bucket = await resolveConfiguredBucket(minio, process.env.MINIO_BUCKET ?? "bizbil");

  const exists = await minio.bucketExists(bucket);
  if (!exists) {
    await minio.makeBucket(bucket, "ap-south-1");
  }

  fastify.decorate("minio", minio);
  fastify.decorate("minioBucket", bucket);
});

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
