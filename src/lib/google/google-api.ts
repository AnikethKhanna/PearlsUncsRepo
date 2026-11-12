/**
 * Minimal Google OAuth + Calendar API v3 client (no SDK, like the Airtable client).
 *
 * - Server-only by design: the caller passes in client credentials and tokens.
 * - Retries 429 / 5xx / rate-limit 403s with backoff; on 401 it gets a fresh
 *   access token once and retries.
 * - Errors carry the HTTP status and Google's reason, never tokens or event contents.
 *
 * API reference: https://developers.google.com/workspace/calendar/api/v3/reference
 */

export const CALENDAR_SCOPES = [
  // See, create, change and delete events on calendars the user OWNS (not shared calendars).
  "https://www.googleapis.com/auth/calendar.events.owned",
  // See the list of calendars, so the user can pick which one to sync to.
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Google said the grant is gone (revoked, expired, password change…): the user must reconnect. */
export class GoogleAuthRevokedError extends Error {
  constructor(message = "Google access was revoked or has expired.") {
    super(message);
    this.name = "GoogleAuthRevokedError";
  }
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly reason?: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- OAuth

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

export class GoogleOAuth {
  private readonly fetchImpl: FetchLike;
  constructor(
    private readonly cfg: OAuthClientConfig,
    opts: { fetch?: FetchLike; tokenUrl?: string; revokeUrl?: string } = {},
  ) {
    this.fetchImpl = opts.fetch ?? ((i, init) => fetch(i, init));
    this.tokenUrl = opts.tokenUrl ?? "https://oauth2.googleapis.com/token";
    this.revokeUrl = opts.revokeUrl ?? "https://oauth2.googleapis.com/revoke";
  }
  private readonly tokenUrl: string;
  private readonly revokeUrl: string;

  async exchangeCode(code: string, redirectUri: string, codeVerifier?: string): Promise<TokenResponse> {
    return this.token({ code, redirect_uri: redirectUri, grant_type: "authorization_code", ...(codeVerifier ? { code_verifier: codeVerifier } : {}) });
  }

  /** New short-lived access token. Throws GoogleAuthRevokedError if the refresh token no longer works. */
  async refresh(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
    const t = await this.token({ refresh_token: refreshToken, grant_type: "refresh_token" });
    return { accessToken: t.access_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000 };
  }

  /** Revoke a token at Google (best effort: an already-revoked token is fine). */
  async revoke(token: string): Promise<void> {
    const res = await this.fetchImpl(this.revokeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      cache: "no-store",
    });
    if (!res.ok && res.status !== 400) throw new GoogleApiError(`Token revoke failed (${res.status})`, res.status);
  }

  private async token(params: Record<string, string>, attempt = 0): Promise<TokenResponse> {
    const res = await this.fetchImpl(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }),
      cache: "no-store",
    });
    if (res.ok) return (await res.json()) as TokenResponse;
    let error: string | undefined;
    try {
      error = ((await res.json()) as { error?: string }).error;
    } catch {
      /* not JSON */
    }
    if (error === "invalid_grant") throw new GoogleAuthRevokedError();
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await sleep(500 * 2 ** attempt);
      return this.token(params, attempt + 1);
    }
    throw new GoogleApiError(`Google token request failed (${res.status}${error ? `: ${error}` : ""})`, res.status, error);
  }
}

// ---------------------------------------------------------------- Calendar

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: "freeBusyReader" | "reader" | "writer" | "owner";
  timeZone?: string;
}

export interface GoogleEvent {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  transparency?: "opaque" | "transparent";
  reminders?: { useDefault: boolean; overrides?: { method: "popup" | "email"; minutes: number }[] };
  source?: { title: string; url: string };
  extendedProperties?: { private?: Record<string, string> };
}

export interface CalendarClientOptions {
  /** Returns a valid access token; `forceRefresh` after a 401 */
  getAccessToken: (forceRefresh: boolean) => Promise<string>;
  fetch?: FetchLike;
  retryDelaysMs?: number[];
  apiUrl?: string;
}

const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"]);

export class GoogleCalendarClient {
  private readonly fetchImpl: FetchLike;
  private readonly retryDelaysMs: number[];
  private readonly base: string;

  constructor(private readonly opts: CalendarClientOptions) {
    this.fetchImpl = opts.fetch ?? ((i, init) => fetch(i, init));
    this.retryDelaysMs = opts.retryDelaysMs ?? [1000, 2000, 4000];
    this.base = `${opts.apiUrl ?? "https://www.googleapis.com"}/calendar/v3`;
  }

  async listCalendars(): Promise<GoogleCalendarListEntry[]> {
    const out: GoogleCalendarListEntry[] = [];
    let pageToken: string | undefined;
    do {
      const qs = new URLSearchParams({ maxResults: "250", minAccessRole: "owner" });
      if (pageToken) qs.set("pageToken", pageToken);
      const page = await this.request<{ items?: GoogleCalendarListEntry[]; nextPageToken?: string }>(
        "GET",
        `/users/me/calendarList?${qs}`,
      );
      out.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  /** Events this app created for this user (found by private extended properties). */
  async listAppEvents(calendarId: string, privateProps: Record<string, string>): Promise<GoogleEvent[]> {
    const out: GoogleEvent[] = [];
    let pageToken: string | undefined;
    do {
      const qs = new URLSearchParams({ maxResults: "250", showDeleted: "false" });
      for (const [k, v] of Object.entries(privateProps)) qs.append("privateExtendedProperty", `${k}=${v}`);
      if (pageToken) qs.set("pageToken", pageToken);
      const page = await this.request<{ items?: GoogleEvent[]; nextPageToken?: string }>(
        "GET",
        `/calendars/${encodeURIComponent(calendarId)}/events?${qs}`,
      );
      out.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  /**
   * Create an event with OUR id, or overwrite it if that id already exists
   * (including an event the user deleted earlier: Google keeps deleted ids
   * reserved, so insert returns 409 and we update it back to "confirmed").
   * Either way there is never more than one event per id.
   */
  async upsertEvent(calendarId: string, event: GoogleEvent): Promise<"created" | "updated"> {
    try {
      await this.request("POST", `/calendars/${encodeURIComponent(calendarId)}/events`, event);
      return "created";
    } catch (err) {
      if (!(err instanceof GoogleApiError) || err.status !== 409) throw err;
    }
    await this.updateEvent(calendarId, event);
    return "updated";
  }

  async updateEvent(calendarId: string, event: GoogleEvent): Promise<void> {
    await this.request(
      "PUT",
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}`,
      { ...event, status: "confirmed" },
    );
  }

  /** Delete an event; one that is already gone counts as deleted. */
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await this.request("DELETE", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    } catch (err) {
      if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return;
      throw err;
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.opts.getAccessToken(false);
      let res = await this.send(method, path, token, body);
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        res = await this.send(method, path, await this.opts.getAccessToken(true), body);
      }
      if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;

      let reason: string | undefined;
      let message = `Google Calendar request failed (${res.status})`;
      try {
        const data = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[]; status?: string } };
        reason = data.error?.errors?.[0]?.reason ?? data.error?.status;
        if (data.error?.message) message = `${message}: ${data.error.message}`;
      } catch {
        /* not JSON */
      }
      if (res.status === 401) throw new GoogleAuthRevokedError("Google rejected the access token.");
      const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && !!reason && RATE_LIMIT_REASONS.has(reason));
      if (retryable && attempt < this.retryDelaysMs.length) {
        await sleep(this.retryDelaysMs[attempt]);
        continue;
      }
      throw new GoogleApiError(message, res.status, reason);
    }
  }

  private send(method: string, path: string, token: string, body?: unknown): Promise<Response> {
    return this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  }
}
