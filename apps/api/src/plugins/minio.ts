import fp from "fastify-plugin";
import { Client } from "minio";

export const minioPlugin = fp(async (fastify) => {
  const bucket = process.env.MINIO_BUCKET ?? "retailos";
  const minio = new Client({
    endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: process.env.MINIO_USE_SSL === "true",
    accessKey: process.env.MINIO_ROOT_USER ?? "retailos",
    secretKey: process.env.MINIO_ROOT_PASSWORD ?? "your-minio-password",
  });

  const exists = await minio.bucketExists(bucket);
  if (!exists) {
    await minio.makeBucket(bucket, "ap-south-1");
  }

  fastify.decorate("minio", minio);
  fastify.decorate("minioBucket", bucket);
});
