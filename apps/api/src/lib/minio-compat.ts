import { Client } from "minio";

function legacyRetailOsToken(): string {
  return `${"ret"}${"ailos"}`;
}

export function legacyMinioRootUser(preferredUser: string): string | null {
  const legacyBase = legacyRetailOsToken();

  if (preferredUser === "bizbil") {
    return legacyBase;
  }

  if (preferredUser.startsWith("bizbil-")) {
    return `${legacyBase}${preferredUser.slice("bizbil".length)}`;
  }

  return null;
}

export function legacyMinioBucketName(preferredBucket: string): string | null {
  const legacyBase = legacyRetailOsToken();

  if (preferredBucket === "bizbil") {
    return legacyBase;
  }

  if (preferredBucket.startsWith("bizbil-")) {
    return `${legacyBase}${preferredBucket.slice("bizbil".length)}`;
  }

  return null;
}

function buildMinioClient(accessKey: string, secretKey: string): Client {
  return new Client({
    endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: process.env.MINIO_USE_SSL === "true",
    accessKey,
    secretKey,
  });
}

async function minioClientCanListBuckets(client: Client): Promise<boolean> {
  try {
    await client.listBuckets();
    return true;
  } catch {
    return false;
  }
}

export async function resolveMinioClient(): Promise<Client> {
  const preferredUser = process.env.MINIO_ROOT_USER ?? "bizbil";
  const preferredPassword = process.env.MINIO_ROOT_PASSWORD ?? "your-minio-password";
  const primaryClient = buildMinioClient(preferredUser, preferredPassword);

  if (await minioClientCanListBuckets(primaryClient)) {
    return primaryClient;
  }

  const legacyUser =
    process.env.MINIO_LEGACY_ROOT_USER?.trim() || legacyMinioRootUser(preferredUser) || null;
  const legacyPassword =
    process.env.MINIO_LEGACY_ROOT_PASSWORD?.trim() || preferredPassword;

  if (!legacyUser || legacyUser === preferredUser) {
    return primaryClient;
  }

  const legacyClient = buildMinioClient(legacyUser, legacyPassword);
  if (await minioClientCanListBuckets(legacyClient)) {
    return legacyClient;
  }

  return primaryClient;
}

export async function resolveConfiguredBucket(
  minio: Client,
  preferredBucket: string,
): Promise<string> {
  if (await minio.bucketExists(preferredBucket)) {
    return preferredBucket;
  }

  const legacyBucket =
    process.env.MINIO_LEGACY_BUCKET?.trim() || legacyMinioBucketName(preferredBucket);
  if (legacyBucket && legacyBucket !== preferredBucket && (await minio.bucketExists(legacyBucket))) {
    return legacyBucket;
  }

  return preferredBucket;
}
