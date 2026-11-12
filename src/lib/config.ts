import "server-only";

/**
 * Server-side configuration. Secrets are read from environment variables
 * only (see .env.example). This module is marked "server-only" so a build
 * fails if any client component tries to import it.
 */

export type DataBackend = "airtable" | "memory" | "firestore";
export const DATA_BACKENDS: readonly DataBackend[] = ["airtable", "memory", "firestore"];

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
  if (!(DATA_BACKENDS as readonly string[]).includes(backend)) {
    throw new Error(`DATA_BACKEND must be "airtable", "firestore" or "memory" (got "${backend}").`);
  }
  if (backend === "memory" && isProductionDeployment()) {
    throw new Error("DATA_BACKEND=memory is a development placeholder and is refused in production.");
  }
  return backend as DataBackend;
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

/** Public base URL (e.g. https://nmu-onboarding.vercel.app), used to check request origins. */
export function getAppUrl(): string | undefined {
  return read("APP_URL");
}

export interface FirebaseAdminConfig {
  projectId: string;
  /** Set when talking to the local Firebase emulators instead of the real project. */
  emulator: boolean;
  /** Service-account credentials. Absent → emulator, or Application Default Credentials. */
  serviceAccount?: { clientEmail: string; privateKey: string };
}

/** True when the server-side SDK is pointed at the local emulators. */
export function usesFirebaseEmulators(): boolean {
  return !!(read("FIREBASE_AUTH_EMULATOR_HOST") || read("FIRESTORE_EMULATOR_HOST"));
}

/**
 * Server-side Firebase Admin credentials, or null if Firebase isn't configured.
 *
 * Preferred: FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 * (from a service-account key, stored ONLY in .env.local / Vercel).
 * Alternatively GOOGLE_APPLICATION_CREDENTIALS (Application Default Credentials).
 * Emulator hosts are refused in production so a misconfiguration can't
 * silently point a live deployment at a throwaway local database.
 */
export function getFirebaseAdminConfig(): FirebaseAdminConfig | null {
  const projectId = read("FIREBASE_PROJECT_ID") ?? read("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  if (usesFirebaseEmulators()) {
    if (isProductionDeployment()) throw new Error("Firebase emulator hosts are set, which is refused in production.");
    return { projectId: projectId ?? "demo-nmu-onboarding", emulator: true };
  }
  if (!projectId) return null;
  const clientEmail = read("FIREBASE_CLIENT_EMAIL");
  // Vercel and .env files usually store the key with literal "\n" sequences.
  const privateKey = read("FIREBASE_PRIVATE_KEY")?.replace(/\\n/g, "\n");
  if (clientEmail && privateKey) return { projectId, emulator: false, serviceAccount: { clientEmail, privateKey } };
  if (read("GOOGLE_APPLICATION_CREDENTIALS")) return { projectId, emulator: false };
  return null;
}
