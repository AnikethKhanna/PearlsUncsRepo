/**
 * Decides whether a verified Firebase identity may sign in to the app, and
 * as which existing user.
 *
 * Rules (security-critical, unit-tested in tests/firebase-sign-in.test.ts):
 * - The email must be VERIFIED. Anyone can create a Firebase email/password
 *   account for any address; only a verified email proves they own it.
 * - The email must belong to an ACTIVE user in the Users table. Firebase
 *   never creates app users, and access level always comes from the Users
 *   table, so a new Firebase account can never grant itself Admin (or any)
 *   access.
 * - The sign-in must be recent (≤ 5 minutes), so an old leaked ID token
 *   can't be replayed to mint a fresh session.
 *
 * Pure apart from the injected user lookup, so it needs no Firebase server.
 */
import type { DataStore } from "@/lib/data/store";
import type { User } from "@/lib/domain/types";

export const MAX_SIGN_IN_AGE_SECONDS = 5 * 60;

/** The fields of a decoded Firebase ID token this check relies on. */
export interface FirebaseIdentity {
  uid: string;
  email?: string;
  email_verified?: boolean;
  /** Seconds since epoch when the person actually entered their password. */
  auth_time: number;
  /** Custom claim linking the Firebase account to a Users record (set by the server). */
  appUserId?: unknown;
}

export type FirebaseSignInFailure = "missing-email" | "email-not-verified" | "stale-sign-in" | "not-registered";

export type FirebaseSignInResult = { ok: true; user: User } | { ok: false; reason: FirebaseSignInFailure };

export async function resolveFirebaseSignIn(
  identity: FirebaseIdentity,
  users: Pick<DataStore, "getUserByEmail">,
  now = Date.now(),
): Promise<FirebaseSignInResult> {
  const email = identity.email?.trim().toLowerCase();
  if (!email) return { ok: false, reason: "missing-email" };
  if (identity.email_verified !== true) return { ok: false, reason: "email-not-verified" };
  if (!Number.isFinite(identity.auth_time) || now / 1000 - identity.auth_time > MAX_SIGN_IN_AGE_SECONDS)
    return { ok: false, reason: "stale-sign-in" };

  const user = await users.getUserByEmail(email);
  if (!user || !user.active) return { ok: false, reason: "not-registered" };
  return { ok: true, user };
}

/**
 * Custom claims to store on the Firebase account. Only the IDENTITY link
 * (which Users record this login belongs to) — never the access level, which
 * firestore.rules reads live from the user's document so role changes and
 * deactivation take effect immediately.
 */
export function firebaseClaimsFor(user: Pick<User, "id">): { appUserId: string } {
  return { appUserId: user.id };
}

/** Plain-language messages for the sign-in page. */
export const FIREBASE_SIGN_IN_MESSAGES: Record<FirebaseSignInFailure | "sign-in-failed" | "firebase-not-configured", string> = {
  "missing-email": "That account has no email address. Sign in with your NMU email.",
  "email-not-verified": "Please verify your email first. We sent a link to your inbox; open it, then sign in again.",
  "stale-sign-in": "Your sign-in took too long. Please sign in again.",
  "not-registered":
    "That account isn't on the NMU staff list yet, so it can't see any program data. Ask an administrator to add your email; you'll have access as soon as they do.",
  "sign-in-failed": "Sign-in didn't complete. Please try again.",
  "firebase-not-configured": "Sign-in hasn't been set up on the server yet (see docs/firebase.md).",
};
