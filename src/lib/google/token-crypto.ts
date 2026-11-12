/**
 * Encrypts Google refresh tokens before they are stored (in Airtable), so a
 * person with access to the base, an export or a backup can't use them.
 * AES-256-GCM: authenticated, so a tampered value fails to decrypt instead of
 * producing garbage. Format: "v1:<iv>:<auth tag>:<ciphertext>" (base64url).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

export function encryptToken(plaintext: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
}

/** Returns null if the value is malformed, tampered with, or encrypted with a different key. */
export function decryptToken(value: string, key: Buffer): string | null {
  const [version, iv, tag, data] = value.split(":");
  if (version !== VERSION || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
