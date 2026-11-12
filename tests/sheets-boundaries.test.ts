import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MemoryStore } from "@/lib/data/memory-store";
import type { User } from "@/lib/domain/types";
import { GoogleOAuth } from "@/lib/google/google-api";
import { SHEETS_SCOPE } from "@/lib/google/sheets-api";
import { newSheetsState, readSheetsCookie, sealSheetsCookie, SHEETS_STATE_COOKIE, SHEETS_TOKEN_COOKIE, type SheetsGrant } from "@/lib/google/sheets-session";

const secret = "test-session-secret-with-at-least-32-characters";
let actor: User | null;
let store: MemoryStore;
const jar = new Map<string, string>();
const cookieApi = { get: (key: string) => jar.has(key) ? { value: jar.get(key)! } : undefined, delete: vi.fn(), set: vi.fn() };
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: () => Promise.resolve(actor) }));
vi.mock("@/lib/data", () => ({ getStore: () => store }));
vi.mock("@/lib/config", () => ({ getSessionSecret: () => "test-session-secret-with-at-least-32-characters", getAppUrl: () => "https://nmu.example", getGoogleOAuthConfig: () => ({ clientId: "test-client", clientSecret: "private-secret" }) }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieApi), headers: () => Promise.resolve(new Headers({ origin: "https://nmu.example" })) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
import { GET as callback } from "@/app/auth/google/sheets/callback/route";
import { GET as csv } from "@/app/api/tasks/export/csv/route";
import { authorizeSheets, exportToSheets } from "@/app/(app)/my-tasks/export/actions";

beforeEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); jar.clear(); cookieApi.delete.mockClear(); cookieApi.set.mockClear();
  store = new MemoryStore(); actor = await store.getUser("usrSam");
});
const claims = (email: string) => "header." + Buffer.from(JSON.stringify({ aud: "test-client", email, email_verified: true, iss: "https://accounts.google.com", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url") + ".signature";
const form = (query = "scope=all") => { const f = new FormData(); f.set("query", query); return f; };
function authorizeCookie(user: User) {
  jar.set(SHEETS_TOKEN_COOKIE, sealSheetsCookie({ userId: user.id, email: user.email, accessToken: "sensitive-token", expiresAt: Date.now() + 60000 }, secret, "grant"));
}
function authRequest(state = newSheetsState(actor!.id, "?sort=title&status=open"), query = `code=code123&state=${state.nonce}`) {
  return new NextRequest(`https://nmu.example/auth/google/sheets/callback?${query}`, { headers: { cookie: `${SHEETS_STATE_COOKIE}=${encodeURIComponent(sealSheetsCookie(state, secret, "state"))}` } });
}

describe("Google authorization callback", () => {
  it("accepts a valid matching-account grant, preserves filters and keeps the token encrypted/HttpOnly", async () => {
    const exchange = vi.spyOn(GoogleOAuth.prototype, "exchangeCode").mockResolvedValue({ access_token: "sensitive-token", expires_in: 3600, scope: SHEETS_SCOPE, id_token: claims(actor!.email) });
    const state = newSheetsState(actor!.id, "?sort=title&status=open");
    const res = await callback(authRequest(state));
    expect(res.headers.get("location")).toBe("https://nmu.example/my-tasks/export?sort=title&status=open");
    expect(exchange).toHaveBeenCalledWith("code123", "https://nmu.example/auth/google/sheets/callback", state.verifier);
    const cookie = res.cookies.get(SHEETS_TOKEN_COOKIE)!;
    expect(cookie.httpOnly).toBe(true); expect(cookie.secure).toBe(true);
    expect(cookie.value).not.toContain("sensitive-token");
    expect(readSheetsCookie<SheetsGrant>(cookie.value, secret, "grant", actor!.id)?.accessToken).toBe("sensitive-token");
    expect(res.cookies.get(SHEETS_STATE_COOKIE)?.value).toBe("");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("rejects missing/mismatched/expired/cross-user state before exchanging codes", async () => {
    const exchange = vi.spyOn(GoogleOAuth.prototype, "exchangeCode");
    const cases = [
      new NextRequest("https://nmu.example/auth/google/sheets/callback?code=x&state=x"),
      authRequest(undefined, "code=x&state=wrong"),
      authRequest({ ...newSheetsState(actor!.id, ""), expiresAt: Date.now() - 1 }),
      authRequest(newSheetsState("other-user", "")),
    ];
    for (const request of cases) {
      expect((await callback(request)).headers.get("location")).toContain("error=state");
    }
    expect(exchange).not.toHaveBeenCalled();
  });
  it("handles user cancellation without exchanging a code", async () => {
    const exchange = vi.spyOn(GoogleOAuth.prototype, "exchangeCode");
    const state = newSheetsState(actor!.id, "?sort=title");
    expect((await callback(authRequest(state, `error=access_denied&state=${state.nonce}`))).headers.get("location")).toContain("error=denied");
    expect(exchange).not.toHaveBeenCalled();
  });
  it.each(["permission", "account", "failed"])("handles %s failures without issuing a token cookie", async (error) => {
    const exchange = vi.spyOn(GoogleOAuth.prototype, "exchangeCode");
    if (error === "failed") exchange.mockRejectedValue(new Error("private-token-error"));
    else exchange.mockResolvedValue({ access_token: "secret", expires_in: 3600, scope: error === "permission" ? "openid email" : SHEETS_SCOPE, id_token: claims("someone-else@example.org") });
    const res = await callback(authRequest());
    expect(res.headers.get("location")).toContain(`error=${error}`);
    expect(res.cookies.get(SHEETS_TOKEN_COOKIE)).toBeUndefined();
    expect(res.headers.get("location")).not.toContain("private-token-error");
  });
});

describe("export actions and CSV boundary", () => {
  it("requests only per-file scope plus identity, online access and PKCE", async () => {
    let target = "";
    try { await authorizeSheets({}, form()); } catch (error) { target = (error as Error).message.replace("REDIRECT:", ""); }
    const params = new URL(target).searchParams;
    expect(params.get("scope")).toBe(`openid email ${SHEETS_SCOPE}`);
    expect(params.get("access_type")).toBe("online");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("include_granted_scopes")).toBeNull();
    expect(cookieApi.set).toHaveBeenCalled();
  });
  it("exports only the server-reloaded staff task set despite a forged everyone filter", async () => {
    authorizeCookie(actor!);
    const fetcher = vi.fn(async () => Response.json({ spreadsheetId: "new-sheet" }));
    vi.stubGlobal("fetch", fetcher);
    const result = await exportToSheets({}, form());
    expect(result.url).toContain("new-sheet");
    const data = JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    const rows = data.sheets[0].data[0].rowData.slice(1);
    const authorized = await store.getTasksByIds(actor!.assignedTaskIds);
    expect(rows.every((r: { values: { userEnteredValue: { stringValue?: string } }[] }) => authorized.some((t) => t.title === r.values[0].userEnteredValue.stringValue))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("sensitive-token");
  });
  it("requires a current grant and reauthorizes after Google revokes access", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 401 })); vi.stubGlobal("fetch", fetcher);
    expect((await exportToSheets({}, form())).authorizeAgain).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    authorizeCookie(actor!);
    expect((await exportToSheets({}, form())).authorizeAgain).toBe(true);
    expect(cookieApi.delete).toHaveBeenCalled();
  });
  it("rechecks changed roles at export time and rejects partner/anonymous requests", async () => {
    authorizeCookie(actor!);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    vi.spyOn(store, "getUser").mockResolvedValue({ ...actor!, accessLevel: "Partner" });
    expect((await exportToSheets({}, form())).error).toContain("access changed");
    const response = await csv(new NextRequest("https://nmu.example/api/tasks/export/csv?scope=all"));
    expect(response.status).toBe(403);
    actor = null;
    expect((await exportToSheets({}, form())).error).toContain("permission");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("CSV respects staff permissions, stays private and gives an attachment", async () => {
    const res = await csv(new NextRequest("https://nmu.example/api/tasks/export/csv?scope=all&sort=title"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const text = await res.text();
    expect(text).toContain("Task Name");
    expect(text).not.toContain("sensitive-token");
  });
});
