import { describe, expect, it } from "vitest";
import { newSheetsState, pkceChallenge, readSheetsCookie, sealSheetsCookie, type SheetsState } from "@/lib/google/sheets-session";
const secret = "test-session-secret-32-characters-long";
describe("Sheets OAuth state and short-lived authorization", () => {
  it("binds encrypted state to the initiating user and preserves filters", () => {
    const state = newSheetsState("user1", "?scope=all&sort=title&q=swim");
    const cookie = sealSheetsCookie(state, secret, "state");
    expect(cookie).not.toContain("swim");
    expect(readSheetsCookie<SheetsState>(cookie, secret, "state", "user1")).toEqual(state);
    expect(readSheetsCookie(cookie, secret, "state", "user2")).toBeNull();
    expect(readSheetsCookie(cookie, secret, "grant", "user1")).toBeNull();
    expect(readSheetsCookie(cookie, "other-secret", "state", "user1")).toBeNull();
    expect(readSheetsCookie(cookie, secret, "state", "user1", state.expiresAt)).toBeNull();
    expect(readSheetsCookie(cookie.slice(0, -6) + "tamper", secret, "state", "user1")).toBeNull();
  });
  it("uses independent nonce/verifier and the standard PKCE SHA256 challenge", () => {
    const state = newSheetsState("a", "");
    expect(newSheetsState("a", "").nonce).not.toBe(state.nonce);
    expect(state.verifier).not.toBe(state.nonce);
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("fails closed on malformed cookies and expired grants", () => {
    expect(readSheetsCookie("nonsense", secret, "grant", "a")).toBeNull();
    const grant = { userId: "a", expiresAt: 100, accessToken: "sensitive", email: "a@example.org" };
    const encrypted = sealSheetsCookie(grant, secret, "grant");
    expect(encrypted).not.toContain("sensitive");
    expect(readSheetsCookie(encrypted, secret, "grant", "a", 101)).toBeNull();
  });
});
