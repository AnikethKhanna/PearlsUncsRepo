import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { CALENDAR_OAUTH_PATH, CALENDAR_OAUTH_STATE_COOKIE } from "@/lib/auth/oauth";
import { can } from "@/lib/auth/permissions";
import { calendarSyncBlocker, getAppUrl, getGoogleOAuthConfig } from "@/lib/config";
import { CALENDAR_SCOPES } from "@/lib/google/google-api";

/**
 * Step 1 of "Connect Google Calendar" (separate from sign-in, and optional).
 * Asks only for: your email (to show which account is connected), events on
 * calendars you own, and the list of your calendars (to pick one).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", request.url));
  const settings = new URL("/settings/calendar", request.url);
  if (!can(user, "calendar.sync")) return NextResponse.redirect(`${settings}?error=not-allowed`);
  const google = getGoogleOAuthConfig();
  if (!google || calendarSyncBlocker()) return NextResponse.redirect(`${settings}?error=not-configured`);

  const state = randomBytes(24).toString("base64url");
  const origin = getAppUrl() ?? request.nextUrl.origin;
  const params = new URLSearchParams({
    client_id: google.clientId,
    redirect_uri: `${origin}${CALENDAR_OAUTH_PATH}/callback`,
    response_type: "code",
    scope: ["openid", "email", ...CALENDAR_SCOPES].join(" "),
    state,
    // offline + consent: Google returns a refresh token, so syncing works without the user present.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    login_hint: user.email,
  });
  if (google.allowedDomain) params.set("hd", google.allowedDomain);

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  res.cookies.set(CALENDAR_OAUTH_STATE_COOKIE, `${state}.${user.id}`, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: CALENDAR_OAUTH_PATH,
    maxAge: 600,
  });
  return res;
}
