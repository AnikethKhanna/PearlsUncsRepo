import { NextResponse, type NextRequest } from "next/server";
import { sessionCookie } from "@/lib/auth/current-user";
import { getAppUrl, getGoogleOAuthConfig } from "@/lib/config";
import { getStore } from "@/lib/data";
import { OAUTH_STATE_COOKIE } from "@/lib/auth/oauth";

/**
 * Step 2 of "Sign in with Google": Google redirects back here with a code.
 * We exchange it (server-to-server, over TLS) for an ID token, read the
 * verified email, and sign the person in ONLY if that email belongs to an
 * active user in the Airtable Users table.
 */
export async function GET(request: NextRequest) {
  const fail = (reason: string) => {
    const res = NextResponse.redirect(new URL(`/sign-in?error=${reason}`, request.url));
    res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/auth/google" });
    return res;
  };

  const google = getGoogleOAuthConfig();
  if (!google) return fail("google-not-configured");

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) return fail("sign-in-failed");

  const origin = getAppUrl() ?? request.nextUrl.origin;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: google.clientId,
      client_secret: google.clientSecret,
      redirect_uri: `${origin}/auth/google/callback`,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!tokenRes.ok) return fail("sign-in-failed");
  const { id_token } = (await tokenRes.json()) as { id_token?: string };
  if (!id_token) return fail("sign-in-failed");

  // The ID token came directly from Google's token endpoint over TLS, so per
  // OpenID Connect Core §3.1.3.7 its signature need not be re-verified; we
  // still check issuer, audience, expiry and email verification.
  let claims: { iss?: string; aud?: string; exp?: number; email?: string; email_verified?: boolean; hd?: string };
  try {
    claims = JSON.parse(Buffer.from(id_token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return fail("sign-in-failed");
  }
  const validIssuer = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!validIssuer || claims.aud !== google.clientId || !claims.exp || claims.exp * 1000 < Date.now())
    return fail("sign-in-failed");
  if (!claims.email || claims.email_verified !== true) return fail("sign-in-failed");
  if (google.allowedDomain && claims.hd !== google.allowedDomain) return fail("not-registered");

  const user = await getStore().getUserByEmail(claims.email);
  if (!user || !user.active) return fail("not-registered");

  const res = NextResponse.redirect(new URL("/my-tasks", request.url));
  res.cookies.set(sessionCookie(user.id));
  res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/auth/google" });
  return res;
}
