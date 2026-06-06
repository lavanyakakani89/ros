import fp from "fastify-plugin";

import { resolveConfiguredBucket, resolveMinioClient } from "../lib/minio-compat.js";

export const minioPlugin = fp(async (fastify) => {
  const minio = await resolveMinioClient();
  const bucket = await resolveConfiguredBucket(minio, process.env.MINIO_BUCKET ?? "bizbil");

  const exists = await minio.bucketExists(bucket);
  if (!exists) {
    await minio.makeBucket(bucket, "ap-south-1");
  }

  fastify.decorate("minio", minio);
  fastify.decorate("minioBucket", bucket);
});
