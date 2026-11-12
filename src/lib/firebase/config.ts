/**
 * Firebase configuration shared by browser and server code.
 *
 * Only the PUBLIC web-app config lives here (NEXT_PUBLIC_FIREBASE_*). Those
 * values identify the Firebase project and are designed to be shipped to the
 * browser; they are not secrets. Access is protected by Firebase Auth, by the
 * server-side checks in src/lib/auth/permissions.ts and by firestore.rules.
 *
 * Server credentials (service account) are read only in src/lib/config.ts,
 * which is server-only.
 *
 * Each NEXT_PUBLIC_ variable is referenced literally so Next.js can inline it
 * into the browser bundle at build time.
 */

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

const clean = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : undefined);

/** The Firebase web-app config, or null if Firebase sign-in isn't configured. */
export function getFirebaseWebConfig(): FirebaseWebConfig | null {
  const apiKey = clean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
  const authDomain = clean(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN);
  const projectId = clean(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
  const appId = clean(process.env.NEXT_PUBLIC_FIREBASE_APP_ID);
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    storageBucket: clean(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: clean(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
  };
}

/**
 * Browser-side Auth emulator host (e.g. "127.0.0.1:9099"), for local
 * development only. Ignored in production builds.
 */
export function getAuthEmulatorHostForBrowser(): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  return clean(process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST);
}

/** Firestore collection names. The ONE place to change them. */
export const FIRESTORE_COLLECTIONS = {
  users: "users",
  sites: "sites",
  templates: "templates",
  templateSteps: "templateSteps",
  projects: "projects",
  tasks: "tasks",
} as const;
