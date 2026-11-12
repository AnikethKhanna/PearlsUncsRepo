/**
 * "Continue with Google" logic without a browser: provider scopes, popup
 * outcomes (closed, blocked, network, provider conflicts) and the shared
 * session exchange. The real popup is replaced by a fake.
 */
import { describe, expect, it, vi } from "vitest";
import { initializeApp } from "firebase/app";
import { getAuth, type Auth, type User, type UserCredential } from "firebase/auth";
import { homePathFor } from "@/lib/auth/permissions";
import { startAppSession } from "@/lib/firebase/client";
import { GOOGLE_CALENDAR_SCOPES, GOOGLE_SIGN_IN_SCOPES, createGoogleSignInProvider, signInWithGoogle } from "@/lib/firebase/google";

const auth: Auth = getAuth(initializeApp({ apiKey: "demo-key", projectId: "demo-nmu-onboarding" }, "google-unit"));
const fakeUser = { uid: "u1", getIdToken: async () => "id-token" } as unknown as User;
const fails = (code: string, extra: object = {}) => () => Promise.reject(Object.assign(new Error(code), { code, ...extra }));

describe("Google provider", () => {
  it("asks only for basic profile at sign-in — never Calendar", () => {
    const provider = createGoogleSignInProvider();
    expect(provider.providerId).toBe("google.com");
    // Firebase adds "profile" itself (plus openid + email on the wire); nothing else.
    expect(provider.getScopes().every((s) => ["profile", "email", "openid"].includes(s))).toBe(true);
    expect(provider.getScopes().join(" ")).not.toMatch(/calendar/i);
    expect(GOOGLE_SIGN_IN_SCOPES.some((s) => s.includes("calendar"))).toBe(false);
    expect(GOOGLE_CALENDAR_SCOPES[0]).toContain("calendar");
  });

  it("always shows the account chooser", () => {
    expect(createGoogleSignInProvider().getCustomParameters()).toMatchObject({ prompt: "select_account" });
  });
});

describe("signInWithGoogle outcomes", () => {
  it("returns the Firebase user on success", async () => {
    const popup = vi.fn(async () => ({ user: fakeUser }) as UserCredential);
    expect(await signInWithGoogle(auth, popup)).toEqual({ kind: "signed-in", user: fakeUser });
    expect(popup).toHaveBeenCalledWith(auth, expect.objectContaining({ providerId: "google.com" }));
  });

  it.each(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"])(
    "treats %s as a quiet cancel, not an error",
    async (code) => {
      expect(await signInWithGoogle(auth, fails(code))).toEqual({ kind: "cancelled" });
    },
  );

  it.each([
    ["auth/popup-blocked", /blocked the Google sign-in window/],
    ["auth/network-request-failed", /Check your connection/],
    ["auth/unauthorized-domain", /authorized domains/],
    ["auth/operation-not-allowed", /isn't enabled/],
    ["auth/invalid-api-key", /isn't configured correctly/],
    ["auth/user-disabled", /disabled/],
    ["auth/internal-error", /didn't complete/],
  ])("explains %s in plain language", async (code, message) => {
    const outcome = await signInWithGoogle(auth, fails(code));
    expect(outcome).toMatchObject({ kind: "error", code });
    expect(outcome.kind === "error" && outcome.message).toMatch(message);
  });

  it("turns an existing-account conflict into a secure linking step (no access granted yet)", async () => {
    const conflict = fails("auth/account-exists-with-different-credential", {
      customData: {
        email: "sam@example.org",
        _tokenResponse: { providerId: "google.com", oauthIdToken: "google-id-token", oauthAccessToken: "google-access-token" },
      },
    });
    const outcome = await signInWithGoogle(auth, conflict);
    expect(outcome).toMatchObject({ kind: "needs-link", email: "sam@example.org", credential: { providerId: "google.com" } });
  });

  it("falls back to an error if a conflict carries no usable credential", async () => {
    const outcome = await signInWithGoogle(auth, fails("auth/account-exists-with-different-credential", { customData: {} }));
    expect(outcome).toMatchObject({ kind: "error", message: expect.stringMatching(/password first/) });
  });
});

describe("startAppSession", () => {
  const respond = (body: object) => vi.fn(async () => new Response(JSON.stringify(body)));

  it("sends the ID token once and follows the server's role-based redirect", async () => {
    const fetchFn = respond({ ok: true, redirectTo: "/projects" });
    expect(await startAppSession(auth, fakeUser, fetchFn)).toEqual({ ok: true, redirectTo: "/projects" });
    expect(fetchFn).toHaveBeenCalledWith("/auth/firebase/session", expect.objectContaining({ method: "POST", body: JSON.stringify({ idToken: "id-token" }) }));
  });

  it("passes on the server's reason when an account isn't approved", async () => {
    const result = await startAppSession(auth, fakeUser, respond({ ok: false, reason: "not-registered", message: "Ask an administrator" }));
    expect(result).toEqual({ ok: false, reason: "not-registered", message: "Ask an administrator" });
  });

  it("handles a network failure", async () => {
    const result = await startAppSession(auth, fakeUser, vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    expect(result).toMatchObject({ ok: false, reason: "network" });
  });
});

describe("homePathFor (same for every sign-in method)", () => {
  const actor = (accessLevel: "Admin" | "Staff" | "Partner", active = true) => ({ id: "u", accessLevel, active, assignedTaskIds: [] });
  it("sends admins to All Projects and everyone else to My Tasks", () => {
    expect(homePathFor(actor("Admin"))).toBe("/projects");
    expect(homePathFor(actor("Staff"))).toBe("/my-tasks");
    expect(homePathFor(actor("Partner"))).toBe("/my-tasks");
    expect(homePathFor(actor("Admin", false))).toBe("/my-tasks");
  });
});
