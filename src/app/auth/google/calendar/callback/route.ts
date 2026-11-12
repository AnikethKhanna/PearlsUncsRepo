import { NextResponse, after, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { CALENDAR_OAUTH_PATH, CALENDAR_OAUTH_STATE_COOKIE } from "@/lib/auth/oauth";
import { can } from "@/lib/auth/permissions";
import { getAppUrl, getGoogleOAuthConfig } from "@/lib/config";
import { getStore } from "@/lib/data";
import { getSyncDeps } from "@/lib/calendar-sync";
import { rememberAccessToken, syncUserCalendar } from "@/lib/calendar-sync/sync-service";
import { DEFAULT_CALENDAR_SETTINGS } from "@/lib/domain/calendar-sync";
import { CALENDAR_SCOPES, GoogleOAuth } from "@/lib/google/google-api";
import { encryptToken } from "@/lib/google/token-crypto";

/**
 * Step 2 of "Connect Google Calendar": exchange the code (server to server),
 * check the person granted the calendar permissions, encrypt the refresh
 * token and save it. Tokens never reach the browser.
 */
export async function GET(request: NextRequest) {
  const done = (query: string) => {
    const res = NextResponse.redirect(new URL(`/settings/calendar?${query}`, request.url));
    res.cookies.delete({ name: CALENDAR_OAUTH_STATE_COOKIE, path: CALENDAR_OAUTH_PATH });
    return res;
  };

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", request.url));
  if (!can(user, "calendar.sync")) return done("error=not-allowed");
  const google = getGoogleOAuthConfig();
  const deps = getSyncDeps();
  if (!google || !deps) return done("error=not-configured");

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return done("error=denied"); // e.g. the person pressed Cancel
  const [expectedState, stateUserId] = (request.cookies.get(CALENDAR_OAUTH_STATE_COOKIE)?.value ?? "").split(".");
  const code = params.get("code");
  if (!code || !expectedState || params.get("state") !== expectedState || stateUserId !== user.id)
    return done("error=failed");

  const origin = getAppUrl() ?? request.nextUrl.origin;
  const oauth = new GoogleOAuth({ clientId: google.clientId, clientSecret: google.clientSecret });
  let tokens;
  try {
    tokens = await oauth.exchangeCode(code, `${origin}${CALENDAR_OAUTH_PATH}/callback`);
  } catch {
    return done("error=failed");
  }

  // People can untick permissions on Google's consent screen: require both calendar scopes.
  const granted = new Set((tokens.scope ?? "").split(" "));
  if (!CALENDAR_SCOPES.every((s) => granted.has(s))) {
    await oauth.revoke(tokens.refresh_token ?? tokens.access_token).catch(() => {});
    return done("error=missing-permission");
  }
  if (!tokens.refresh_token) return done("error=failed");

  // Which Google account this is (ID token from Google's token endpoint over TLS).
  let email = "";
  try {
    const claims = JSON.parse(Buffer.from((tokens.id_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8")) as {
      aud?: string; email?: string; email_verified?: boolean; hd?: string;
    };
    if (claims.aud === google.clientId && claims.email_verified) email = claims.email ?? "";
    if (google.allowedDomain && claims.hd !== google.allowedDomain) {
      await oauth.revoke(tokens.refresh_token).catch(() => {});
      return done("error=wrong-domain");
    }
  } catch {
    /* email is only shown to the user; not needed for syncing */
  }

  const store = getStore();
  const existing = await store.getCalendarConnection(user.id).catch(() => null);
  try {
    await store.saveCalendarConnection({
      userId: user.id,
      googleEmail: email,
      encryptedRefreshToken: encryptToken(tokens.refresh_token, deps.encryptionKey),
      // Reconnecting keeps the person's choices; a first connection uses the defaults.
      calendarId: existing?.calendarId ?? "primary",
      calendarName: existing?.calendarName ?? "Main calendar",
      calendarTimeZone: existing?.calendarTimeZone ?? "America/Los_Angeles",
      syncEnabled: existing?.syncEnabled ?? DEFAULT_CALENDAR_SETTINGS.syncEnabled,
      reminderDays: existing?.reminderDays ?? DEFAULT_CALENDAR_SETTINGS.reminderDays,
      reminderTime: existing?.reminderTime ?? DEFAULT_CALENDAR_SETTINGS.reminderTime,
      overdueReminders: existing?.overdueReminders ?? DEFAULT_CALENDAR_SETTINGS.overdueReminders,
      status: "connected",
      lastSyncedAt: existing?.lastSyncedAt ?? null,
      lastError: null,
    });
  } catch (err) {
    console.error("Saving the calendar connection failed:", err instanceof Error ? err.name : "unknown");
    await oauth.revoke(tokens.refresh_token).catch(() => {});
    return done("error=storage");
  }
  rememberAccessToken(user.id, tokens.access_token, tokens.expires_in);
  after(() => syncUserCalendar(user.id, deps).catch(() => {}));
  return done("connected=1");
}
