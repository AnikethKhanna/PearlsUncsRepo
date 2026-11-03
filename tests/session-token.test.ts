import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session-token";

const secret = "x".repeat(40);

describe("session tokens", () => {
  it("round-trips a valid token", () => {
    expect(verifySessionToken(createSessionToken("rec123", secret, 60), secret)?.uid).toBe("rec123");
  });
  it("rejects tampered, foreign and expired tokens", () => {
    const token = createSessionToken("rec123", secret, 60);
    const [data, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "recADMIN", exp: 9999999999 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`, secret)).toBeNull();
    expect(verifySessionToken(`${data}.${sig}x`, secret)).toBeNull();
    expect(verifySessionToken(token, "y".repeat(40))).toBeNull();
    expect(verifySessionToken(token, secret, Date.now() + 61_000)).toBeNull();
    expect(verifySessionToken(undefined, secret)).toBeNull();
    expect(verifySessionToken("garbage", secret)).toBeNull();
  });
});
