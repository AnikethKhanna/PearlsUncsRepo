import { createHash, randomBytes } from "node:crypto";
import { decryptToken, encryptToken } from "./token-crypto";

export const SHEETS_AUTH_PATH = "/auth/google/sheets";
export const SHEETS_STATE_COOKIE = "nmu_sheets_state";
export const SHEETS_TOKEN_COOKIE = "nmu_sheets_token";
export const SHEETS_EXPORT_PATH = "/my-tasks/export";
export interface SheetsState { userId: string; expiresAt: number; nonce: string; query: string; verifier: string }
export interface SheetsGrant { userId: string; expiresAt: number; accessToken: string; email: string }

// Purpose-separated encryption, using the existing server session secret. Never public configuration.
const key = (secret: string, purpose: string) => createHash("sha256").update(`nmu-sheets:${purpose}:` + secret).digest();
export function sealSheetsCookie(value: SheetsState | SheetsGrant, secret: string, purpose: "state" | "grant") {
  return encryptToken(JSON.stringify(value), key(secret, purpose));
}
export function readSheetsCookie<T extends SheetsState | SheetsGrant>(value: string | undefined, secret: string, purpose: "state" | "grant", userId: string, now = Date.now()): T | null {
  try {
    const data = JSON.parse(decryptToken(value ?? "", key(secret, purpose)) ?? "null");
    if (!data || data.userId !== userId || !Number.isFinite(data.expiresAt) || data.expiresAt <= now) return null;
    if (purpose === "state" && (typeof data.nonce !== "string" || typeof data.verifier !== "string" || typeof data.query !== "string")) return null;
    if (purpose === "grant" && (typeof data.accessToken !== "string" || !data.accessToken || typeof data.email !== "string")) return null;
    return data as T;
  } catch { return null; }
}
export function newSheetsState(userId: string, query: string): SheetsState {
  return { userId, query, expiresAt: Date.now() + 600000, nonce: randomBytes(24).toString("base64url"), verifier: randomBytes(32).toString("base64url") };
}
export function pkceChallenge(verifier: string) { return createHash("sha256").update(verifier).digest("base64url"); }
