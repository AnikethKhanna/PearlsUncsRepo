import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { OAUTH_STATE_COOKIE } from "@/lib/auth/oauth";
import { getAppUrl, getGoogleOAuthConfig } from "@/lib/config";

/** Step 1 of "Sign in with Google": send the user to Google's consent screen. */
export async function GET(request: NextRequest) {
  const google = getGoogleOAuthConfig();
  if (!google) return NextResponse.redirect(new URL("/sign-in?error=google-not-configured", request.url));

  const state = randomBytes(24).toString("base64url");
  const origin = getAppUrl() ?? request.nextUrl.origin;
  const params = new URLSearchParams({
    client_id: google.clientId,
    redirect_uri: `${origin}/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  if (google.allowedDomain) params.set("hd", google.allowedDomain);

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/auth/google",
    maxAge: 600,
  });
  return res;
}
