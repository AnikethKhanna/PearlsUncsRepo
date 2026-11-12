/**
 * Signed session tokens (HMAC-SHA256). The cookie holds only the user's
 * record ID and an expiry; role and access are re-read from Airtable on
 * each request, so deactivating a user or changing their role takes effect
 * within a minute (see current-user.ts).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Name of the app's session cookie (shared with src/proxy.ts). */
export const SESSION_COOKIE = "nmu_session";

export interface SessionPayload {
  uid: string;
  /** Expiry, seconds since epoch */
  exp: number;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createSessionToken(uid: string, secret: string, ttlSeconds: number, now = Date.now()): string {
  const payload: SessionPayload = { uid, exp: Math.floor(now / 1000) + ttlSeconds };
  const data = b64(JSON.stringify(payload));
  return `${data}.${sign(data, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): SessionPayload | null {
  if (!token) return null;
  const [data, sig, extra] = token.split(".");
  if (!data || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(data, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 <= now) return null;
    return payload;
  } catch {
    return null;
  }
}
