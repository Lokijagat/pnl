import crypto from "node:crypto";
import { env } from "../config/env";

const KEY = Buffer.from(env.ENCRYPTION_KEY, "hex");

/** AES-256-GCM. Output: iv.tag.ciphertext (base64) */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(".");
}

export function decrypt(payload: string): string {
  const [ivB, tagB, encB] = payload.split(".");
  if (!ivB || !tagB || !encB) throw new Error("Invalid encrypted payload");
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encB, "base64")), decipher.final()]).toString("utf8");
}

export function mask(value: string): string {
  if (value.length <= 4) return "••••";
  return "••••" + value.slice(-4);
}

export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString("hex");
