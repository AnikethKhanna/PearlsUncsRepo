import "server-only";

/**
 * Server-side configuration. Secrets are read from environment variables
 * only (see .env.example). This module is marked "server-only" so a build
 * fails if any client component tries to import it.
 */

export type DataBackend = "airtable" | "memory";

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export function isProductionDeployment(): boolean {
  // VERCEL_ENV is "production" | "preview" | "development" on Vercel.
  // Off Vercel, fall back to an explicit APP_ENV=production.
  return read("VERCEL_ENV") === "production" || read("APP_ENV") === "production";
}

export function getDataBackend(): DataBackend {
  const backend = read("DATA_BACKEND") ?? "airtable";
  if (backend !== "airtable" && backend !== "memory") {
    throw new Error(`DATA_BACKEND must be "airtable" or "memory" (got "${backend}").`);
  }
  if (backend === "memory" && isProductionDeployment()) {
    throw new Error("DATA_BACKEND=memory is a development placeholder and is refused in production.");
  }
  return backend;
}

export function getAirtableConfig(): { token: string; baseId: string } {
  const token = read("AIRTABLE_TOKEN");
  const baseId = read("AIRTABLE_BASE_ID");
  if (!token || !baseId) {
    throw new Error(
      "Airtable is not configured. Set AIRTABLE_TOKEN and AIRTABLE_BASE_ID (see .env.example).",
    );
  }
  return { token, baseId };
}

export function getSessionSecret(): string {
  const secret = read("SESSION_SECRET");
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters.");
  }
  return secret;
}

/**
 * Why email-only dev sign-in is off, in plain words, or null if it is on.
 * Accepts true / TRUE / 1 / yes so a capitalization slip doesn't lock people out.
 */
export function devSignInBlocker(): string | null {
  if (isProductionDeployment()) return "it is never allowed in production (VERCEL_ENV or APP_ENV is set to production)";
  const value = read("ALLOW_DEV_SIGN_IN");
  if (value === undefined) return "ALLOW_DEV_SIGN_IN is not set";
  if (!["true", "1", "yes"].includes(value.toLowerCase().replace(/^["']|["']$/g, "")))
    return `ALLOW_DEV_SIGN_IN is set to "${value}" instead of true`;
  return null;
}

/** Email-only sign-in for local development and demos. Never allowed in production. */
export function isDevSignInEnabled(): boolean {
  return devSignInBlocker() === null;
}

/** Problems that stop the app from working at all, for a friendly message instead of a crash. */
export function configProblems(): string[] {
  const problems: string[] = [];
  const secret = read("SESSION_SECRET");
  if (!secret) problems.push("SESSION_SECRET is not set");
  else if (secret.length < 32) problems.push("SESSION_SECRET is shorter than 32 characters");
  return problems;
}

export function getGoogleOAuthConfig():
  | { clientId: string; clientSecret: string; allowedDomain?: string }
  | null {
  const clientId = read("GOOGLE_CLIENT_ID");
  const clientSecret = read("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, allowedDomain: read("GOOGLE_ALLOWED_DOMAIN") };
}

export function getAppUrl(): string | undefined {
  return read("APP_URL");
}

/**
 * 32-byte key (base64) that encrypts Google refresh tokens before they are
 * stored in Airtable. Generate with: openssl rand -base64 32
 */
export function getTokenEncryptionKey(): Buffer | null {
  const raw = read("TOKEN_ENCRYPTION_KEY");
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).");
  return key;
}

/** Why Google Calendar sync can't be used yet, in plain words, or null if it can. */
export function calendarSyncBlocker(): string | null {
  const missing: string[] = [];
  if (!read("GOOGLE_CLIENT_ID")) missing.push("GOOGLE_CLIENT_ID");
  if (!read("GOOGLE_CLIENT_SECRET")) missing.push("GOOGLE_CLIENT_SECRET");
  if (!read("TOKEN_ENCRYPTION_KEY")) missing.push("TOKEN_ENCRYPTION_KEY");
  return missing.length ? `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set` : null;
}

/** Shared secret Vercel Cron sends as "Authorization: Bearer <CRON_SECRET>". */
export function getCronSecret(): string | undefined {
  const secret = read("CRON_SECRET");
  return secret && secret.length >= 16 ? secret : undefined;
}
