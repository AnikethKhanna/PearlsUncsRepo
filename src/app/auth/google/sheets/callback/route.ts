import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { getAppUrl, getGoogleOAuthConfig, getSessionSecret } from "@/lib/config";
import { GoogleOAuth } from "@/lib/google/google-api";
import { SHEETS_SCOPE } from "@/lib/google/sheets-api";
import { readSheetsCookie, sealSheetsCookie, SHEETS_AUTH_PATH, SHEETS_EXPORT_PATH, SHEETS_STATE_COOKIE, SHEETS_TOKEN_COOKIE, type SheetsState } from "@/lib/google/sheets-session";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  let query = "";
  const done = (error?: string) => {
    const target = new URL(SHEETS_EXPORT_PATH + query, request.url);
    if (error) target.searchParams.set("error", error);
    const res = NextResponse.redirect(target);
    res.cookies.delete({ name: SHEETS_STATE_COOKIE, path: SHEETS_AUTH_PATH });
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  };
  if (!user || !can(user, "task.export")) return done("not-allowed");
  const state = readSheetsCookie<SheetsState>(request.cookies.get(SHEETS_STATE_COOKIE)?.value, getSessionSecret(), "state", user.id);
  if (!state || request.nextUrl.searchParams.get("state") !== state.nonce) return done("state");
  query = state.query;
  if (request.nextUrl.searchParams.get("error")) return done("denied");
  const code = request.nextUrl.searchParams.get("code");
  const google = getGoogleOAuthConfig();
  if (!code || !google) return done("configuration");
  try {
    const origin = (getAppUrl() ?? request.nextUrl.origin).replace(/\/$/, "");
    const token = await new GoogleOAuth(google).exchangeCode(code, `${origin}${SHEETS_AUTH_PATH}/callback`, state.verifier);
    if (!(token.scope ?? "").split(" ").includes(SHEETS_SCOPE)) return done("permission");
    // Trusted token endpoint response over TLS. Never use an ID token supplied by the browser.
    const claims = JSON.parse(Buffer.from((token.id_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8"));
    if (claims.aud !== google.clientId || claims.email_verified !== true || typeof claims.email !== "string"
      || claims.email.toLowerCase() !== user.email.toLowerCase()
      || !["https://accounts.google.com", "accounts.google.com"].includes(claims.iss)
      || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()
      || (google.allowedDomain && claims.hd !== google.allowedDomain)) return done("account");
    const maxAge = Math.min(3600, Math.floor(token.expires_in) - 60);
    if (!token.access_token || !Number.isFinite(maxAge) || maxAge <= 0) return done("failed");
    const res = done();
    res.cookies.set(SHEETS_TOKEN_COOKIE, sealSheetsCookie({ userId: user.id, email: claims.email,
      accessToken: token.access_token, expiresAt: Date.now() + maxAge * 1000 }, getSessionSecret(), "grant"), {
      httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: SHEETS_EXPORT_PATH, maxAge,
    });
    return res;
  } catch { return done("failed"); }
}
