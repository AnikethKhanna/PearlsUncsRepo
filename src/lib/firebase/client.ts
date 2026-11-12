"use client";

/**
 * Browser-side Firebase Auth (modular SDK).
 *
 * Firebase only PROVES WHO the person is (email + password). Right after a
 * successful sign-in, the ID token is exchanged once for the app's own
 * httpOnly session cookie (POST /auth/firebase/session), and the browser's
 * Firebase session is discarded. That keeps a single source of truth for
 * "who is signed in": server components and server actions read the cookie,
 * and role/permissions still come from the Users table.
 *
 * Persistence is in-memory on purpose: the login survives refreshes through
 * the session cookie, and no long-lived Firebase refresh token sits in
 * localStorage where page scripts could read it.
 */
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import { getAuthEmulatorHostForBrowser, getFirebaseWebConfig } from "./config";

let authPromise: Promise<Auth> | null = null;

/** Firebase Auth for this browser tab, or null if Firebase sign-in isn't configured. */
export function getBrowserAuth(): Promise<Auth> | null {
  const config = getFirebaseWebConfig();
  if (!config) return null;
  authPromise ??= (async () => {
    const app = getApps().length ? getApp() : initializeApp(config);
    const auth = getAuth(app);
    const emulator = getAuthEmulatorHostForBrowser();
    if (emulator && !auth.emulatorConfig) connectAuthEmulator(auth, `http://${emulator}`, { disableWarnings: true });
    await setPersistence(auth, inMemoryPersistence);
    return auth;
  })();
  return authPromise;
}

/** The Firebase error code ("auth/…"), or "" for anything else. */
export function firebaseErrorCode(err: unknown): string {
  return typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
}

/** Friendly messages for the Firebase Auth error codes people actually hit. */
export function describeFirebaseAuthError(err: unknown): string {
  switch (firebaseErrorCode(err)) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "That email and password don't match. If you usually use Google, choose “Continue with Google” instead.";
    case "auth/email-already-in-use":
      return "That email already has an account. Sign in (with your password or with Google), or use “Forgot password”.";
    case "auth/weak-password":
    case "auth/password-does-not-meet-requirements":
      return "Choose a stronger password (at least 8 characters, mixing letters and numbers).";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes, or reset your password.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact an administrator.";
    case "auth/network-request-failed":
      return "Couldn't reach the sign-in service. Check your connection and try again.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in window. Allow pop-ups for this site, then choose “Continue with Google” again.";
    case "auth/unauthorized-domain":
      return "Google sign-in isn't allowed from this web address yet. An administrator needs to add it to Firebase's authorized domains (see docs/firebase.md).";
    case "auth/account-exists-with-different-credential":
      return "That email already has an account with a different sign-in method. Sign in with your password first.";
    case "auth/credential-already-in-use":
      return "That Google account is already connected to a different account. Contact an administrator.";
    case "auth/operation-not-allowed":
      return "That sign-in method isn't enabled for this Firebase project yet (see docs/firebase.md).";
    case "auth/invalid-api-key":
    case "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
    case "auth/configuration-not-found":
    case "auth/not-configured":
      return "Sign-in isn't configured correctly for this site. An administrator needs to check the Firebase settings (see docs/firebase.md).";
    default:
      return "Sign-in didn't complete. Please try again.";
  }
}

export type AppSessionResult =
  | { ok: true; redirectTo: string }
  | { ok: false; reason: string; message: string };

/**
 * Exchanges a freshly signed-in Firebase user for the app's session cookie.
 * The SAME path for Google and for email/password, so both get identical
 * checks, roles and redirects. The browser's Firebase session is discarded
 * afterwards (except when the email still needs verifying, so "Resend" works).
 */
export async function startAppSession(auth: Auth, user: User, fetchFn: typeof fetch = fetch): Promise<AppSessionResult> {
  let body: { ok?: boolean; reason?: string; message?: string; redirectTo?: string };
  try {
    const res = await fetchFn("/auth/firebase/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: await user.getIdToken() }),
    });
    body = await res.json();
  } catch {
    await signOut(auth);
    return { ok: false, reason: "network", message: "Couldn't reach the server. Check your connection and try again." };
  }
  if (body.ok) {
    await signOut(auth); // the app session cookie is the login from here on
    return { ok: true, redirectTo: body.redirectTo ?? "/" };
  }
  if (body.reason !== "email-not-verified") await signOut(auth);
  return {
    ok: false,
    reason: body.reason ?? "sign-in-failed",
    message: body.message ?? "Sign-in didn't complete. Please try again.",
  };
}
