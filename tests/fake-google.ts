/**
 * In-process imitation of the Google OAuth token endpoint and Calendar API v3,
 * for tests only. Mirrors the behaviour the sync depends on:
 * - client-chosen event ids; an id stays reserved after deletion (insert → 409);
 * - events.list filters by privateExtendedProperty and hides deleted events;
 * - pagination (small page size so paging is exercised);
 * - bearer-token checks (401 for unknown/expired tokens), invalid_grant for revoked refresh tokens;
 * - injectable failures (e.g. one 503) per request.
 */
import type { GoogleEvent } from "@/lib/google/google-api";

interface StoredEvent extends GoogleEvent {
  status: "confirmed" | "cancelled";
}

export class FakeGoogle {
  calendars = new Map<string, Map<string, StoredEvent>>([
    ["primary", new Map()],
    ["team-cal", new Map()],
  ]);
  calendarList = [
    { id: "primary", summary: "sam@example.org", primary: true, accessRole: "owner", timeZone: "America/Los_Angeles" },
    { id: "team-cal", summary: "NMU deadlines", accessRole: "owner", timeZone: "America/New_York" },
  ];
  validRefreshTokens = new Set<string>(["refresh-sam", "refresh-morgan", "refresh-admin"]);
  validAccessTokens = new Set<string>();
  revoked: string[] = [];
  requests: { method: string; path: string }[] = [];
  /** Respond to the next N matching requests with this status (then behave normally) */
  failures: { match: (method: string, path: string) => boolean; status: number; reason?: string; times: number }[] = [];
  pageSize = 3;
  private seq = 0;

  /** Events (not deleted) in a calendar */
  live(calendarId = "primary"): StoredEvent[] {
    return [...this.cal(calendarId).values()].filter((e) => e.status !== "cancelled");
  }
  /** Simulate the person deleting an event by hand in Google Calendar */
  userDeletes(calendarId: string, id: string) {
    this.cal(calendarId).get(id)!.status = "cancelled";
  }
  writes() {
    return this.requests.filter((r) => r.method !== "GET" && !r.path.startsWith("/token"));
  }

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    const path = u.pathname.replace(/^\/calendar\/v3/, "");
    this.requests.push({ method, path: u.hostname === "oauth2.googleapis.com" ? u.pathname : path });

    const failure = this.failures.find((f) => f.times > 0 && f.match(method, path));
    if (failure) {
      failure.times--;
      return json({ error: { code: failure.status, message: "injected", errors: [{ reason: failure.reason ?? "backendError" }] } }, failure.status);
    }

    if (u.hostname === "oauth2.googleapis.com") {
      const form = new URLSearchParams(String(init?.body ?? ""));
      if (u.pathname === "/revoke") {
        this.revoked.push(form.get("token")!);
        this.validRefreshTokens.delete(form.get("token")!);
        return json({});
      }
      const rt = form.get("refresh_token")!;
      if (!this.validRefreshTokens.has(rt)) return json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
      const at = `access-${rt}-${++this.seq}`;
      this.validAccessTokens.add(at);
      return json({ access_token: at, expires_in: 3599, token_type: "Bearer" });
    }

    const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
    if (!this.validAccessTokens.has(auth.replace(/^Bearer /, ""))) return json({ error: { code: 401, message: "Invalid Credentials" } }, 401);

    if (method === "GET" && path === "/users/me/calendarList") return json({ items: this.calendarList });

    const m = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path);
    if (!m) return json({ error: { code: 404, message: "Not Found" } }, 404);
    const calendarId = decodeURIComponent(m[1]);
    const eventId = m[2] ? decodeURIComponent(m[2]) : undefined;
    if (!this.calendars.has(calendarId)) return json({ error: { code: 404, message: "Not Found", errors: [{ reason: "notFound" }] } }, 404);
    const cal = this.cal(calendarId);
    const body = init?.body ? (JSON.parse(String(init.body)) as GoogleEvent) : undefined;

    if (method === "GET" && !eventId) {
      const filters = u.searchParams.getAll("privateExtendedProperty").map((p) => p.split("="));
      const showDeleted = u.searchParams.get("showDeleted") === "true";
      const all = [...cal.values()]
        .filter((e) => showDeleted || e.status !== "cancelled")
        .filter((e) => filters.every(([k, v]) => e.extendedProperties?.private?.[k] === v));
      const start = Number(u.searchParams.get("pageToken") ?? 0);
      const items = all.slice(start, start + this.pageSize);
      return json({ items: structuredClone(items), ...(start + this.pageSize < all.length ? { nextPageToken: String(start + this.pageSize) } : {}) });
    }
    if (method === "POST" && !eventId) {
      if (!/^[a-v0-9]{5,1024}$/.test(body!.id)) return json({ error: { code: 400, message: "Invalid resource id value." } }, 400);
      if (cal.has(body!.id)) return json({ error: { code: 409, message: "The requested identifier already exists.", errors: [{ reason: "duplicate" }] } }, 409);
      cal.set(body!.id, { ...structuredClone(body!), status: "confirmed" });
      return json(cal.get(body!.id));
    }
    if (method === "PUT" && eventId) {
      if (!cal.has(eventId)) return json({ error: { code: 404, message: "Not Found" } }, 404);
      cal.set(eventId, { ...structuredClone(body!), id: eventId, status: (body!.status as "confirmed") ?? "confirmed" });
      return json(cal.get(eventId));
    }
    if (method === "DELETE" && eventId) {
      const e = cal.get(eventId);
      if (!e) return json({ error: { code: 404, message: "Not Found" } }, 404);
      if (e.status === "cancelled") return json({ error: { code: 410, message: "Resource has been deleted" } }, 410);
      e.status = "cancelled";
      return new Response(null, { status: 204 });
    }
    return json({ error: { code: 400, message: "unsupported" } }, 400);
  };

  private cal(id: string) {
    return this.calendars.get(id) ?? new Map<string, StoredEvent>();
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
