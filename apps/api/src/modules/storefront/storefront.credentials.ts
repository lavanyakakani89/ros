import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";
const secretPrefix = "v1";

export function encryptStorefrontSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [secretPrefix, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptStorefrontSecret(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) {
    return null;
  }

  const [version, iv, tag, encrypted] = ciphertext.split(":");
  if (version !== secretPrefix || !iv || !tag || !encrypted) {
    return ciphertext;
  }

  const decipher = createDecipheriv(algorithm, getEncryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function getEncryptionKey(): Buffer {
  const source =
    process.env.STOREFRONT_SECRET_ENCRYPTION_KEY ??
    process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY ??
    process.env.JWT_SECRET ??
    "retailos-local-storefront-secret-key";
  return createHash("sha256").update(source).digest();
}
