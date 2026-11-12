import { NextResponse, type NextRequest } from "next/server";
import { sessionCookie } from "@/lib/auth/current-user";
import {
  FIREBASE_SIGN_IN_MESSAGES,
  firebaseClaimsFor,
  resolveFirebaseSignIn,
  type FirebaseIdentity,
} from "@/lib/auth/firebase-sign-in";
import { homePathFor } from "@/lib/auth/permissions";
import { configProblems, getAppUrl } from "@/lib/config";
import { getStore } from "@/lib/data";
import { getFirebaseAdmin, isFirebaseAdminConfigured } from "@/lib/firebase/server";

/**
 * Exchanges a fresh Firebase ID token (from Google or email/password sign-in
 * in the browser) for the app's own signed, httpOnly session cookie. Every
 * Firebase sign-in method goes through here, so they all get the same checks.
 *
 * The token is verified with the Firebase Admin SDK (signature, issuer,
 * audience, expiry, revocation). The person is let in ONLY if their verified
 * email belongs to an active user in the Users table; their access level
 * comes from that record, never from Firebase.
 */
export async function POST(request: NextRequest) {
  const fail = (reason: keyof typeof FIREBASE_SIGN_IN_MESSAGES, status: number) =>
    NextResponse.json({ ok: false, reason, message: FIREBASE_SIGN_IN_MESSAGES[reason] }, { status });

  // CSRF: only accept requests sent by our own sign-in page.
  const allowedOrigin = getAppUrl() ? new URL(getAppUrl()!).origin : request.nextUrl.origin;
  if (request.headers.get("origin") !== allowedOrigin) return fail("sign-in-failed", 403);

  if (configProblems().length > 0 || !isFirebaseAdminConfigured()) return fail("firebase-not-configured", 503);

  let idToken: unknown;
  try {
    ({ idToken } = await request.json());
  } catch {
    return fail("sign-in-failed", 400);
  }
  if (typeof idToken !== "string" || idToken.length === 0 || idToken.length > 8192) return fail("sign-in-failed", 400);

  const firebase = getFirebaseAdmin();
  let identity: FirebaseIdentity;
  try {
    identity = await firebase.auth.verifyIdToken(idToken, true);
  } catch {
    return fail("sign-in-failed", 401);
  }

  let result;
  try {
    result = await resolveFirebaseSignIn(identity, getStore());
  } catch (err) {
    console.error("Firebase sign-in lookup failed:", err instanceof Error ? err.message : "unknown error");
    return fail("sign-in-failed", 503);
  }
  if (!result.ok) return fail(result.reason, result.reason === "not-registered" ? 403 : 401);

  // Link the Firebase account to the Users record for firestore.rules.
  // Best effort: the app itself reads data through the server, not these claims.
  const claims = firebaseClaimsFor(result.user);
  if (identity.appUserId !== claims.appUserId) {
    try {
      const existing = (await firebase.auth.getUser(identity.uid)).customClaims ?? {};
      await firebase.auth.setCustomUserClaims(identity.uid, { ...existing, ...claims });
    } catch (err) {
      console.error("Couldn't set Firebase custom claims:", err instanceof Error ? err.message : "unknown error");
    }
  }

  const res = NextResponse.json({ ok: true, redirectTo: homePathFor(result.user) });
  res.cookies.set(sessionCookie(result.user.id));
  return res;
}
