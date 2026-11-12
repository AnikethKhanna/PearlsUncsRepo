import "server-only";
import { getFirebaseAdminConfig } from "@/lib/config";
import { createFirebaseAdmin, type FirebaseAdmin } from "./admin";

/** Whether the server has Firebase Admin credentials (or emulators) configured. */
export function isFirebaseAdminConfigured(): boolean {
  return getFirebaseAdminConfig() !== null;
}

/** The server's Firebase Admin handles. Throws a clear error if Firebase isn't configured. */
export function getFirebaseAdmin(): FirebaseAdmin {
  const config = getFirebaseAdminConfig();
  if (!config) {
    throw new Error(
      "Firebase Admin is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (see docs/firebase.md).",
    );
  }
  return createFirebaseAdmin(config);
}
