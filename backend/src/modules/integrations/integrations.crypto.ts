import crypto from "crypto";

const KEY_SALT = "mike-user-microsoft-v1";
const derivedKeys = new Map<string, Buffer>();

function encryptionSecret(): string {
  const secret = process.env.USER_API_KEYS_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("USER_API_KEYS_ENCRYPTION_SECRET is not configured");
  }
  return secret;
}

function encryptionKey(): Buffer {
  const secret = encryptionSecret();
  const cached = derivedKeys.get(secret);
  if (cached) return cached;
  const derived = crypto.scryptSync(secret, KEY_SALT, 32);
  derivedKeys.set(secret, derived);
  return derived;
}

export function encryptSecret(value: string): {
  encrypted: string;
  iv: string;
  tag: string;
} {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(
  encrypted: string | null | undefined,
  iv: string | null | undefined,
  tag: string | null | undefined,
): string | null {
  if (!encrypted || !iv || !tag) return null;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
