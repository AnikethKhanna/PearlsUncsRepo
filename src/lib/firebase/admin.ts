/**
 * Firebase Admin SDK factory. Server code only (it needs service-account
 * credentials). Kept free of "server-only" so the migration script and the
 * emulator tests can reuse it; app code should import ./server instead.
 */
import { applicationDefault, cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { FirebaseAdminConfig } from "@/lib/config";

export interface FirebaseAdmin {
  app: App;
  auth: Auth;
  db: Firestore;
}

const APP_NAME = "nmu-admin";

/** Returns the (single) Admin app for this config, creating it on first use. */
export function createFirebaseAdmin(config: FirebaseAdminConfig): FirebaseAdmin {
  const existing = getApps().find((a) => a.name === APP_NAME);
  const app =
    existing ??
    initializeApp(
      {
        projectId: config.projectId,
        // Emulators accept any credentials; FIREBASE_AUTH_EMULATOR_HOST and
        // FIRESTORE_EMULATOR_HOST are picked up by the SDK automatically.
        ...(config.emulator
          ? {}
          : {
              credential: config.serviceAccount
                ? cert({ projectId: config.projectId, ...config.serviceAccount })
                : applicationDefault(),
            }),
      },
      APP_NAME,
    );
  const db = getFirestore(app);
  if (!existing) db.settings({ ignoreUndefinedProperties: true });
  return { app, auth: getAuth(app), db };
}
