/**
 * Who may sign in with Firebase email/password, and as which user.
 * The rules that matter most: verified email only, existing active users
 * only, and access level always from the Users table (never Firebase).
 */
import { describe, expect, it } from "vitest";
import { MAX_SIGN_IN_AGE_SECONDS, firebaseClaimsFor, resolveFirebaseSignIn, type FirebaseIdentity } from "@/lib/auth/firebase-sign-in";
import { MemoryStore } from "@/lib/data/memory-store";

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
const store = new MemoryStore(undefined, false);
const identity = (over: Partial<FirebaseIdentity> = {}): FirebaseIdentity => ({
  uid: "firebase-uid-1",
  email: "sam@example.org",
  email_verified: true,
  auth_time: NOW / 1000 - 10,
  ...over,
});

describe("resolveFirebaseSignIn", () => {
  it("signs a verified, registered staff member in as their existing user and role", async () => {
    const r = await resolveFirebaseSignIn(identity(), store, NOW);
    expect(r).toMatchObject({ ok: true, user: { id: "usrSam", accessLevel: "Staff" } });
  });

  it("keeps an existing admin's access level", async () => {
    const r = await resolveFirebaseSignIn(identity({ email: "jordan@example.org" }), store, NOW);
    expect(r).toMatchObject({ ok: true, user: { id: "usrJordan", accessLevel: "Admin" } });
  });

  it("matches email case-insensitively", async () => {
    const r = await resolveFirebaseSignIn(identity({ email: "  SAM@Example.org " }), store, NOW);
    expect(r.ok && r.user.id).toBe("usrSam");
  });

  it("rejects an unverified email, even for a registered admin (prevents account squatting)", async () => {
    const r = await resolveFirebaseSignIn(identity({ email: "jordan@example.org", email_verified: false }), store, NOW);
    expect(r).toEqual({ ok: false, reason: "email-not-verified" });
  });

  it("never grants access to a brand-new Firebase account whose email isn't in the Users table", async () => {
    const r = await resolveFirebaseSignIn(identity({ email: "new.person@example.org" }), store, NOW);
    expect(r).toEqual({ ok: false, reason: "not-registered" });
  });

  it("ignores any access level a token claims for itself", async () => {
    const token = { ...identity(), accessLevel: "Admin", admin: true } as FirebaseIdentity;
    const r = await resolveFirebaseSignIn(token, store, NOW);
    expect(r.ok && r.user.accessLevel).toBe("Staff");
  });

  it("rejects deactivated users", async () => {
    const r = await resolveFirebaseSignIn(identity({ email: "former@example.org" }), store, NOW);
    expect(r).toEqual({ ok: false, reason: "not-registered" });
  });

  it("rejects tokens without an email", async () => {
    expect(await resolveFirebaseSignIn(identity({ email: undefined }), store, NOW)).toEqual({ ok: false, reason: "missing-email" });
  });

  it("rejects stale sign-ins so old tokens can't mint new sessions", async () => {
    const old = identity({ auth_time: NOW / 1000 - MAX_SIGN_IN_AGE_SECONDS - 1 });
    expect(await resolveFirebaseSignIn(old, store, NOW)).toEqual({ ok: false, reason: "stale-sign-in" });
  });

  it("propagates database failures so the route can answer with a friendly error", async () => {
    const broken = { getUserByEmail: async () => Promise.reject(new Error("Airtable down")) };
    await expect(resolveFirebaseSignIn(identity(), broken, NOW)).rejects.toThrow("Airtable down");
  });
});

describe("firebaseClaimsFor", () => {
  it("stores only the identity link, never the access level", () => {
    expect(firebaseClaimsFor({ id: "usrSam" })).toEqual({ appUserId: "usrSam" });
  });
});
