/**
 * End to end against the Auth + Firestore emulators: a real email/password
 * account signs in with the modular client SDK, and the ID token goes through
 * the real POST /auth/firebase/session route handler.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from "firebase/auth";
import { verifySessionToken } from "@/lib/auth/session-token";
import { describeFirebaseAuthError } from "@/lib/firebase/client";
import { AUTH_HOST, PROJECT_ID, admin, clearAuth, clearFirestore, seedReferenceData } from "./emulator-helpers";

const SECRET = "test-session-secret-0123456789abcdef";
Object.assign(process.env, { DATA_BACKEND: "firestore", SESSION_SECRET: SECRET, APP_URL: "", FIREBASE_PROJECT_ID: PROJECT_ID });

const ORIGIN = "http://localhost:3000";
let POST: (req: NextRequest) => Promise<Response>;
let app: FirebaseApp;
let auth: Auth;

beforeAll(async () => {
  ({ POST } = await import("@/app/auth/firebase/session/route"));
  app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-key" }, "auth-test");
  auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  await clearFirestore();
  await seedReferenceData();
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  await signOut(auth);
  await clearAuth();
});

function exchange(idToken: unknown, origin = ORIGIN) {
  return POST(
    new NextRequest(`${ORIGIN}/auth/firebase/session`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    }),
  );
}

async function newAccount(email: string, verified: boolean) {
  const { user } = await createUserWithEmailAndPassword(auth, email, "correct-horse-battery-1");
  if (verified) await admin().auth.updateUser(user.uid, { emailVerified: true });
  return { user, idToken: await user.getIdToken(true) };
}

function sessionUserId(res: Response): string | null {
  const cookie = res.headers.get("set-cookie") ?? "";
  const value = /nmu_session=([^;]+)/.exec(cookie)?.[1];
  return verifySessionToken(value, SECRET)?.uid ?? null;
}

describe("email/password sign-in → app session", () => {
  it("signs a verified, registered user in with their existing user ID and role", async () => {
    const { user, idToken } = await newAccount("sam@example.org", true);
    const res = await exchange(idToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, redirectTo: "/my-tasks" });
    expect(sessionUserId(res)).toBe("usrSam");
    // Linked for firestore.rules — identity only, no access level.
    expect((await admin().auth.getUser(user.uid)).customClaims).toEqual({ appUserId: "usrSam" });
  });

  it("works again on a later sign-in with the password", async () => {
    await newAccount("sam@example.org", true);
    await signOut(auth);
    const { user } = await signInWithEmailAndPassword(auth, "sam@example.org", "correct-horse-battery-1");
    const res = await exchange(await user.getIdToken());
    expect(sessionUserId(res)).toBe("usrSam");
  });

  it("refuses unverified emails, so nobody can claim an admin's address", async () => {
    const { idToken } = await newAccount("jordan@example.org", false);
    const res = await exchange(idToken);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ reason: "email-not-verified" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("never creates or upgrades users: an unknown verified email gets no session", async () => {
    const { user, idToken } = await newAccount("stranger@example.org", true);
    const res = await exchange(idToken);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "not-registered" });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect((await admin().auth.getUser(user.uid)).customClaims ?? {}).toEqual({});
    expect((await admin().db.collection("users").where("email", "==", "stranger@example.org").get()).empty).toBe(true);
  });

  it("refuses deactivated users", async () => {
    const res = await exchange((await newAccount("former@example.org", true)).idToken);
    expect(res.status).toBe(403);
  });

  it("refuses revoked sessions", async () => {
    const { user, idToken } = await newAccount("sam@example.org", true);
    await new Promise((r) => setTimeout(r, 1100)); // revocation is second-granular: revoke strictly after the token was issued
    await admin().auth.revokeRefreshTokens(user.uid);
    expect((await exchange(idToken)).status).toBe(401);
  });

  it("refuses forged tokens, bad bodies and cross-site requests", async () => {
    expect((await exchange("not-a-token")).status).toBe(401);
    expect((await exchange(123)).status).toBe(400);
    const { idToken } = await newAccount("sam@example.org", true);
    expect((await exchange(idToken, "https://evil.example")).status).toBe(403);
  });

  it("turns a wrong password into a plain-language message", async () => {
    await newAccount("sam@example.org", true);
    await signOut(auth);
    const err = await signInWithEmailAndPassword(auth, "sam@example.org", "wrong-password-123").catch((e) => e);
    expect(describeFirebaseAuthError(err)).toMatch(/don't match/);
  });
});
