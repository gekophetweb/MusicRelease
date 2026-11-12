import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

function appSecret(): Buffer {
  const raw = process.env.APP_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error("APP_SECRET must be set to at least 32 characters (generate one with: openssl rand -base64 48)");
  }
  return Buffer.from(raw, "utf8");
}

function derive(purpose: string, length: number): Buffer {
  return Buffer.from(hkdfSync("sha256", appSecret(), Buffer.alloc(0), purpose, length));
}

/** AES-256-GCM. Envelope: v1:<iv b64>:<tag b64>:<ciphertext b64> */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive("settings", 32), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decrypt(envelope: string): string {
  const [version, iv, tag, ct] = envelope.split(":");
  if (version !== "v1" || !iv || !tag || ct === undefined) throw new Error("Unknown encrypted value format");
  const decipher = createDecipheriv("aes-256-gcm", derive("settings", 32), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

/** A stable secret for one purpose (e.g. 'better-auth'), derived from APP_SECRET. */
export function deriveSecret(purpose: string): string {
  return derive(`secret:${purpose}`, 32).toString("base64url");
}
