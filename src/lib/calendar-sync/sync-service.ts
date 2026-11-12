/**
 * Google Calendar sync for one user (and the daily run over everyone).
 *
 * Security rules, enforced here on every run:
 * - The user is re-read from the store (not the session cache), so a person
 *   who was deactivated or lost the "calendar.sync" permission gets nothing
 *   synced and their old events are removed.
 * - Only tasks ASSIGNED TO THAT USER, in programs they may see, are synced,
 *   via loadTasksInScope(…, "mine"), the same permission path as My Tasks.
 * - Only events this app created for this user (private tags + id format)
 *   are ever updated or deleted; nothing else in their calendar is touched.
 *
 * Takes its dependencies as parameters so it runs against mocks in tests.
 */
import { can } from "@/lib/auth/permissions";
import type { DataStore } from "@/lib/data/store";
import { loadTasksInScope } from "@/lib/data/task-scope";
import { appEventTag, desiredEvents, isAppEventId, planSync } from "@/lib/domain/calendar-sync";
import { today as todayIn } from "@/lib/domain/dates";
import type { CalendarConnection } from "@/lib/domain/types";
import {
  GoogleApiError,
  GoogleAuthRevokedError,
  GoogleCalendarClient,
  type GoogleOAuth,
} from "@/lib/google/google-api";
import { decryptToken } from "@/lib/google/token-crypto";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SyncDeps {
  store: DataStore;
  oauth: GoogleOAuth;
  encryptionKey: Buffer;
  appUrl?: string;
  /** Overrides for tests */
  calendarFetch?: FetchLike;
  retryDelaysMs?: number[];
  now?: () => Date;
}

export interface SyncResult {
  outcome: "synced" | "skipped" | "needs_reconnect" | "error";
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  failed: number;
  message: string;
}

const emptyResult = (outcome: SyncResult["outcome"], message: string): SyncResult => ({
  outcome, created: 0, updated: 0, deleted: 0, unchanged: 0, failed: 0, message,
});

// Short-lived access tokens, kept only in server memory (never stored or sent to the browser).
const g = globalThis as unknown as { __nmuGoogleTokens?: Map<string, { token: string; expiresAt: number }> };
const accessTokens = (g.__nmuGoogleTokens ??= new Map());

export function forgetAccessToken(userId: string) {
  accessTokens.delete(userId);
}

export function rememberAccessToken(userId: string, token: string, expiresInSeconds: number) {
  accessTokens.set(userId, { token, expiresAt: Date.now() + (expiresInSeconds - 60) * 1000 });
}

/** A Calendar API client acting as this user (refreshes the access token as needed). */
export function calendarClientFor(conn: CalendarConnection, deps: SyncDeps): GoogleCalendarClient {
  return new GoogleCalendarClient({
    fetch: deps.calendarFetch,
    retryDelaysMs: deps.retryDelaysMs,
    getAccessToken: async (forceRefresh) => {
      const cached = accessTokens.get(conn.userId);
      if (cached && !forceRefresh && cached.expiresAt > Date.now()) return cached.token;
      const refreshToken = decryptToken(conn.encryptedRefreshToken, deps.encryptionKey);
      if (!refreshToken) throw new GoogleAuthRevokedError("The saved Google connection can't be read (the encryption key changed?).");
      const { accessToken, expiresAt } = await deps.oauth.refresh(refreshToken);
      accessTokens.set(conn.userId, { token: accessToken, expiresAt });
      return accessToken;
    },
  });
}

/** Plain-language explanation of a Google error, safe to show and store (no tokens, no task data). */
export function describeGoogleError(err: unknown): { reconnect: boolean; message: string } {
  if (err instanceof GoogleAuthRevokedError)
    return { reconnect: true, message: "Google access was revoked or has expired. Reconnect Google Calendar to resume syncing." };
  if (err instanceof GoogleApiError) {
    if (err.status === 403 && (err.reason === "insufficientPermissions" || err.reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT"))
      return { reconnect: true, message: "Google Calendar permission was not granted. Reconnect and allow access to your calendars." };
    if (err.status === 404)
      return { reconnect: false, message: "The chosen calendar no longer exists or isn't yours. Choose another calendar." };
    if (err.status === 403 && (err.reason === "forbidden" || err.reason === "requiredAccessLevel"))
      return { reconnect: false, message: "NMU Onboarding can't add events to the chosen calendar. Choose a calendar you own." };
    if (err.status === 429 || err.status >= 500 || err.status === 403)
      return { reconnect: false, message: "Google Calendar was busy or unavailable. The next sync will try again." };
    return { reconnect: false, message: `Google Calendar returned an error (${err.status}). The next sync will try again.` };
  }
  return { reconnect: false, message: "Syncing failed unexpectedly. The next sync will try again." };
}

// One sync at a time per user in this server process (the deterministic event ids
// already make overlapping syncs on different servers harmless).
const running = new Map<string, Promise<SyncResult>>();

export function syncUserCalendar(userId: string, deps: SyncDeps): Promise<SyncResult> {
  const previous = running.get(userId) ?? Promise.resolve(null);
  const next = previous.then(() => runSync(userId, deps)).finally(() => {
    if (running.get(userId) === next) running.delete(userId);
  });
  running.set(userId, next);
  return next;
}

async function runSync(userId: string, deps: SyncDeps): Promise<SyncResult> {
  const { store } = deps;
  const conn = await store.getCalendarConnection(userId);
  if (!conn) return emptyResult("skipped", "Google Calendar is not connected.");
  if (conn.status === "needs_reconnect") return emptyResult("needs_reconnect", conn.lastError ?? "Reconnect Google Calendar.");
  if (!conn.syncEnabled) return emptyResult("skipped", "Syncing is turned off.");

  const now = deps.now?.() ?? new Date();
  const result = emptyResult("synced", "");
  try {
    // Fresh user record: a deactivated user, or one whose access level no longer
    // allows syncing, gets an empty desired set, so their synced events are removed.
    const user = await store.getUser(userId);
    const allowed = !!user && can(user, "calendar.sync");
    const rows = allowed ? (await loadTasksInScope(store, user, "mine")).rows : [];
    const desired = desiredEvents(rows, {
      userId,
      todayIso: safeToday(conn.calendarTimeZone, now),
      appUrl: deps.appUrl,
      settings: conn,
    });

    const client = calendarClientFor(conn, deps);
    const existing = await client.listAppEvents(conn.calendarId, appEventTag(userId));
    const plan = planSync(desired, existing);
    result.unchanged = plan.unchanged;

    let firstFailure: unknown = null;
    for (const event of plan.upsert) {
      try {
        result[(await client.upsertEvent(conn.calendarId, event)) === "created" ? "created" : "updated"]++;
      } catch (err) {
        if (err instanceof GoogleAuthRevokedError) throw err;
        result.failed++;
        firstFailure ??= err;
      }
    }
    for (const id of plan.remove) {
      if (!isAppEventId(id)) continue; // never delete anything we didn't create
      try {
        await client.deleteEvent(conn.calendarId, id);
        result.deleted++;
      } catch (err) {
        if (err instanceof GoogleAuthRevokedError) throw err;
        result.failed++;
        firstFailure ??= err;
      }
    }

    if (result.failed) {
      result.outcome = "error";
      result.message = `${result.failed} event${result.failed === 1 ? "" : "s"} couldn't be saved. ${describeGoogleError(firstFailure).message}`;
    } else {
      result.message = allowed ? "Synced." : "Your account can no longer sync tasks, so synced events were removed.";
    }
    await store.saveCalendarConnection({
      ...conn,
      status: result.failed ? "error" : "connected",
      lastSyncedAt: result.failed ? conn.lastSyncedAt : now.toISOString(),
      lastError: result.failed ? result.message : null,
    });
    return result;
  } catch (err) {
    const { reconnect, message } = describeGoogleError(err);
    if (reconnect) forgetAccessToken(userId);
    console.error(`Calendar sync failed for a user: ${err instanceof Error ? err.name : "unknown"} ${err instanceof GoogleApiError ? err.status : ""}`);
    await store
      .saveCalendarConnection({ ...conn, status: reconnect ? "needs_reconnect" : "error", lastError: message })
      .catch(() => {});
    return { ...result, outcome: reconnect ? "needs_reconnect" : "error", message };
  }
}

/** Remove every event this app created for the user in one calendar. Returns how many were removed. */
export async function removeAppEvents(conn: CalendarConnection, deps: SyncDeps, calendarId = conn.calendarId): Promise<number> {
  const client = calendarClientFor(conn, deps);
  const events = (await client.listAppEvents(calendarId, appEventTag(conn.userId))).filter((e) => isAppEventId(e.id));
  for (const e of events) await client.deleteEvent(calendarId, e.id);
  return events.length;
}

export interface SyncAllSummary {
  connections: number;
  synced: number;
  skipped: number;
  needsReconnect: number;
  errors: number;
  /** Users not reached before the time budget ran out (they are picked up next run) */
  deferred: number;
}

/** Daily run: sync everyone who has syncing on. Stops early (cleanly) if it runs out of time. */
export async function syncAllCalendars(deps: SyncDeps, opts: { timeBudgetMs?: number } = {}): Promise<SyncAllSummary> {
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? 240_000;
  const connections = (await deps.store.listCalendarConnections()).filter((c) => c.syncEnabled && c.status !== "needs_reconnect");
  const summary: SyncAllSummary = { connections: connections.length, synced: 0, skipped: 0, needsReconnect: 0, errors: 0, deferred: 0 };
  for (const [i, c] of connections.entries()) {
    if (Date.now() - started > budget) {
      summary.deferred = connections.length - i;
      break;
    }
    const r = await syncUserCalendar(c.userId, deps);
    if (r.outcome === "synced") summary.synced++;
    else if (r.outcome === "skipped") summary.skipped++;
    else if (r.outcome === "needs_reconnect") summary.needsReconnect++;
    else summary.errors++;
  }
  return summary;
}

/** After a task change: sync just the affected people who have a connection (errors are recorded, not thrown). */
export async function syncCalendarsForUsers(userIds: string[], deps: SyncDeps): Promise<void> {
  const wanted = new Set(userIds.filter(Boolean));
  if (wanted.size === 0) return;
  const connected = (await deps.store.listCalendarConnections()).filter((c) => wanted.has(c.userId) && c.syncEnabled);
  for (const c of connected) await syncUserCalendar(c.userId, deps).catch(() => {});
}

function safeToday(timeZone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return todayIn();
  }
}
