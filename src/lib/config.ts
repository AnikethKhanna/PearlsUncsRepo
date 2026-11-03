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

/** Email-only sign-in for local development and demos. Never allowed in production. */
export function isDevSignInEnabled(): boolean {
  return read("ALLOW_DEV_SIGN_IN") === "true" && !isProductionDeployment();
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
