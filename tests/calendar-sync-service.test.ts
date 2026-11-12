/**
 * End-to-end sync against a mocked Google API (tests/fake-google.ts) and the
 * in-memory store. Verifies duplicates, updates/removals, permissions and
 * error handling. It does NOT talk to the real Google service.
 */
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/data/memory-store";
import { AirtableClient } from "@/lib/airtable/client";
import { AIRTABLE_SCHEMA as S } from "@/lib/airtable/schema";
import { AirtableStore } from "@/lib/data/airtable-store";
import { StorageNotReadyError } from "@/lib/data/store";
import {
  forgetAccessToken,
  removeAppEvents,
  syncAllCalendars,
  syncCalendarsForUsers,
  syncUserCalendar,
  type SyncDeps,
} from "@/lib/calendar-sync/sync-service";
import { DEFAULT_CALENDAR_SETTINGS, overdueEventId, taskEventId } from "@/lib/domain/calendar-sync";
import type { CalendarConnection, TaskDraft } from "@/lib/domain/types";
import { GoogleAuthRevokedError, GoogleCalendarClient, GoogleOAuth } from "@/lib/google/google-api";
import { encryptToken } from "@/lib/google/token-crypto";
import { FakeAirtable } from "./fake-airtable";
import { FakeGoogle } from "./fake-google";

const ADMIN = "usrJordan";
const SAM = "usrSam"; // Staff
const MORGAN = "usrMorgan"; // Staff
const PARTNER = "usrPartner";
const NOW = new Date("2027-03-10T18:00:00Z"); // Wed Mar 10 in Los Angeles

const key = randomBytes(32);
let store: MemoryStore;
let google: FakeGoogle;
let deps: SyncDeps;
let taskId: Record<string, string>;

const draft = (key: string, assigneeIds: string[], dueDate: string): TaskDraft => ({
  key, templateStepId: key, title: key, description: "", ownerRole: "", assigneeIds, phase: "", order: 1, dueDate, dependsOnKeys: [],
});

const connection = (userId: string, refresh: string, over: Partial<CalendarConnection> = {}): CalendarConnection => ({
  userId, googleEmail: `${userId}@example.org`, encryptedRefreshToken: encryptToken(refresh, key),
  calendarId: "primary", calendarName: "Main", calendarTimeZone: "America/Los_Angeles",
  ...DEFAULT_CALENDAR_SETTINGS, overdueReminders: "off", status: "connected", lastSyncedAt: null, lastError: null, ...over,
});

beforeEach(async () => {
  for (const u of [SAM, MORGAN, ADMIN, PARTNER]) forgetAccessToken(u);
  store = new MemoryStore(undefined, false);
  const p = store.insertProject(
    { name: "Alpha", siteId: "siteUW", templateId: "tplCollegiate", startDate: "2027-04-01", endDate: "2027-04-05", teamUserIds: [SAM, MORGAN], createdByUserId: ADMIN },
    [
      draft("samTask", [SAM], "2027-03-20"),
      draft("samLate", [SAM], "2027-03-01"),
      draft("sharedTask", [SAM, MORGAN], "2027-03-25"),
      draft("morganTask", [MORGAN], "2027-03-22"),
      draft("partnerTask", [PARTNER], "2027-03-23"),
    ],
  );
  store.seedProjectStatus(p.id, "Active");
  const done = store.insertProject(
    { name: "Finished", siteId: "siteUW", templateId: "tplCollegiate", startDate: "2027-01-01", endDate: "2027-01-02", teamUserIds: [SAM], createdByUserId: ADMIN },
    [draft("oldSamTask", [SAM], "2027-03-21")],
  );
  store.seedProjectStatus(done.id, "Completed");
  taskId = Object.fromEntries([...store.tasksOf(p.id), ...store.tasksOf(done.id)].map((t) => [t.title, t.id]));

  google = new FakeGoogle();
  deps = {
    store,
    oauth: new GoogleOAuth({ clientId: "cid", clientSecret: "csecret" }, { fetch: google.fetch }),
    encryptionKey: key,
    appUrl: "https://nmu.example.org",
    calendarFetch: google.fetch,
    retryDelaysMs: [0, 0, 0],
    now: () => NOW,
  };
  await store.saveCalendarConnection(connection(SAM, "refresh-sam"));
});

const eventTasks = (cal = "primary", user = SAM) =>
  google.live(cal).filter((e) => e.extendedProperties?.private?.nmuUser === user).map((e) => e.extendedProperties?.private?.nmuTask).filter(Boolean).sort();
const ids = (...titles: string[]) => titles.map((t) => taskId[t]).sort();

describe("creating events without duplicates", () => {
  it("creates one event per open, dated task assigned to the user, in active programs only", async () => {
    const r = await syncUserCalendar(SAM, deps);
    expect(r).toMatchObject({ outcome: "synced", created: 3, failed: 0 });
    expect(eventTasks()).toEqual(ids("samTask", "samLate", "sharedTask"));
    const e = google.live().find((x) => x.id === taskEventId(SAM, taskId.samTask))!;
    expect(e.start).toEqual({ date: "2027-03-20" });
    expect(e.reminders?.overrides).toEqual([{ method: "popup", minutes: 2340 }]);
    expect((await store.getCalendarConnection(SAM))).toMatchObject({ status: "connected", lastSyncedAt: NOW.toISOString(), lastError: null });
  });

  it("syncing again makes no changes at all", async () => {
    await syncUserCalendar(SAM, deps);
    const writesBefore = google.writes().length;
    const r = await syncUserCalendar(SAM, deps);
    expect(r).toMatchObject({ created: 0, updated: 0, deleted: 0, unchanged: 3 });
    expect(google.writes().length).toBe(writesBefore);
    expect(google.live()).toHaveLength(3);
  });

  it("concurrent syncs for the same user still leave exactly one event per task", async () => {
    await Promise.all([syncUserCalendar(SAM, deps), syncUserCalendar(SAM, deps), syncUserCalendar(SAM, deps)]);
    expect(google.live()).toHaveLength(3);
  });

  it("restores an event the person deleted by hand, reusing the same id (no duplicate)", async () => {
    await syncUserCalendar(SAM, deps);
    google.userDeletes("primary", taskEventId(SAM, taskId.samTask));
    const r = await syncUserCalendar(SAM, deps);
    expect(r.updated).toBe(1);
    expect(google.live().filter((e) => e.id === taskEventId(SAM, taskId.samTask))).toHaveLength(1);
  });

  it("never touches events it didn't create", async () => {
    google.calendars.get("primary")!.set("personalmeeting1", { id: "personalmeeting1", status: "confirmed", start: { date: "2027-03-20" }, end: { date: "2027-03-21" } });
    await syncUserCalendar(SAM, deps);
    await removeAppEvents((await store.getCalendarConnection(SAM))!, deps);
    expect(google.live().map((e) => e.id)).toEqual(["personalmeeting1"]);
  });
});

describe("keeping events up to date", () => {
  beforeEach(async () => {
    await syncUserCalendar(SAM, deps);
  });

  it("moves the event when the due date changes", async () => {
    const t = (await store.getTask(taskId.samTask))!;
    await store.updateTaskDetails(t.id, { ...t, dueDate: "2027-03-27" });
    expect(await syncUserCalendar(SAM, deps)).toMatchObject({ updated: 1, created: 0 });
    expect(google.live().find((e) => e.id === taskEventId(SAM, t.id))!.start).toEqual({ date: "2027-03-27" });
  });

  it("removes the event when the task is done, and brings it back if reopened", async () => {
    await store.updateTask(taskId.samTask, { status: "Done" });
    expect(await syncUserCalendar(SAM, deps)).toMatchObject({ deleted: 1 });
    expect(eventTasks()).toEqual(ids("samLate", "sharedTask"));
    await store.updateTask(taskId.samTask, { status: "In Progress" });
    await syncUserCalendar(SAM, deps);
    expect(eventTasks()).toEqual(ids("samTask", "samLate", "sharedTask"));
  });

  it("removes the event when the person is taken off the task or its due date is cleared", async () => {
    const shared = (await store.getTask(taskId.sharedTask))!;
    await store.updateTaskDetails(shared.id, { ...shared, assigneeIds: [MORGAN] });
    const late = (await store.getTask(taskId.samLate))!;
    await store.updateTaskDetails(late.id, { ...late, dueDate: null });
    await syncCalendarsForUsers([SAM, MORGAN], deps); // as the task-change hook does (Morgan isn't connected)
    expect(eventTasks()).toEqual(ids("samTask"));
  });

  it("removes the event when the task is deleted", async () => {
    await store.deleteTask(taskId.samTask);
    await syncUserCalendar(SAM, deps);
    expect(eventTasks()).toEqual(ids("samLate", "sharedTask"));
  });

  it("moves everything when the reminder settings change (updated in place, not duplicated)", async () => {
    await store.saveCalendarConnection({ ...(await store.getCalendarConnection(SAM))!, reminderDays: [1, 7] });
    expect(await syncUserCalendar(SAM, deps)).toMatchObject({ updated: 2, created: 0 }); // overdue task has no reminders → unchanged
    expect(google.live()).toHaveLength(3);
  });
});

describe("permissions", () => {
  it("each person's calendar gets only their own tasks", async () => {
    google.calendars.set("morgan-cal", new Map());
    await store.saveCalendarConnection(connection(MORGAN, "refresh-morgan", { calendarId: "morgan-cal" }));
    await syncAllCalendars(deps);
    expect(eventTasks("primary", SAM)).toEqual(ids("samTask", "samLate", "sharedTask"));
    expect(eventTasks("morgan-cal", MORGAN)).toEqual(ids("sharedTask", "morganTask"));
    expect(google.live("primary").some((e) => e.extendedProperties?.private?.nmuUser === MORGAN)).toBe(false);
  });

  it("admins sync only tasks assigned to them, not everyone's", async () => {
    await store.saveCalendarConnection(connection(ADMIN, "refresh-admin", { calendarId: "team-cal" }));
    await syncUserCalendar(ADMIN, deps);
    expect(google.live("team-cal")).toHaveLength(0);
  });

  it("partners (no sync permission) get nothing, even with a connection record", async () => {
    google.validRefreshTokens.add("refresh-partner");
    google.calendars.set("partner-cal", new Map());
    await store.saveCalendarConnection(connection(PARTNER, "refresh-partner", { calendarId: "partner-cal" }));
    await syncUserCalendar(PARTNER, deps);
    expect(google.live("partner-cal")).toHaveLength(0);
  });

  it("a deactivated person's synced events are removed on the next sync", async () => {
    await syncUserCalendar(SAM, deps);
    const realGetUser = store.getUser.bind(store);
    store.getUser = async (id) => ({ ...(await realGetUser(id))!, active: false });
    await syncUserCalendar(SAM, deps);
    expect(google.live()).toHaveLength(0);
  });
});

describe("overdue reminders", () => {
  it("weekly: one event on Monday, unchanged by repeated daily syncs, removed when nothing is overdue", async () => {
    await store.saveCalendarConnection({ ...(await store.getCalendarConnection(SAM))!, overdueReminders: "weekly" });
    await syncUserCalendar(SAM, deps);
    const digest = () => google.live().filter((e) => e.id === overdueEventId(SAM));
    expect(digest()).toHaveLength(1);
    expect(digest()[0].start).toEqual({ dateTime: "2027-03-15T09:00:00", timeZone: "America/Los_Angeles" });
    expect(digest()[0].summary).toBe("NMU: 1 overdue task");

    for (const day of ["2027-03-11T18:00:00Z", "2027-03-12T18:00:00Z"]) {
      const writes = google.writes().length;
      await syncUserCalendar(SAM, { ...deps, now: () => new Date(day) });
      expect(google.writes().length).toBe(writes); // nothing rewritten → no repeat notification
    }
    expect(digest()).toHaveLength(1);

    await store.updateTask(taskId.samLate, { status: "Done" });
    await syncUserCalendar(SAM, deps);
    expect(digest()).toHaveLength(0);
  });
});

describe("errors, expiry and revocation", () => {
  it("refreshes an expired access token and retries", async () => {
    await syncUserCalendar(SAM, deps);
    google.validAccessTokens.clear(); // every cached access token now expired
    await store.updateTask(taskId.samTask, { status: "Done" });
    expect(await syncUserCalendar(SAM, deps)).toMatchObject({ outcome: "synced", deleted: 1 });
  });

  it("marks the connection 'needs reconnect' when Google access is revoked, and the daily run then skips it", async () => {
    google.validRefreshTokens.delete("refresh-sam");
    const r = await syncUserCalendar(SAM, deps);
    expect(r.outcome).toBe("needs_reconnect");
    expect(await store.getCalendarConnection(SAM)).toMatchObject({ status: "needs_reconnect", lastError: expect.stringContaining("Reconnect") });
    const tokenCalls = google.requests.filter((x) => x.path === "/token").length;
    expect(await syncAllCalendars(deps)).toMatchObject({ connections: 0 });
    expect(google.requests.filter((x) => x.path === "/token").length).toBe(tokenCalls);
  });

  it("retries temporary Google errors and succeeds", async () => {
    google.failures.push({ match: (m, p) => m === "POST" && p.includes("/events"), status: 503, times: 2 });
    google.failures.push({ match: (m, p) => m === "GET" && p.includes("/events"), status: 403, reason: "rateLimitExceeded", times: 1 });
    expect(await syncUserCalendar(SAM, deps)).toMatchObject({ outcome: "synced", created: 3 });
  });

  it("records a failure that outlasts the retries, keeps the other events, and recovers next time", async () => {
    google.failures.push({ match: (m, p) => m === "POST" && p.includes("/events"), status: 500, times: 4 });
    const r = await syncUserCalendar(SAM, deps);
    expect(r).toMatchObject({ outcome: "error", created: 2, failed: 1 });
    expect(await store.getCalendarConnection(SAM)).toMatchObject({ status: "error", lastSyncedAt: null });
    expect(await syncUserCalendar(SAM, deps)).toMatchObject({ outcome: "synced", created: 1 });
    expect(google.live()).toHaveLength(3);
  });

  it("explains a missing calendar instead of crashing", async () => {
    await store.saveCalendarConnection({ ...(await store.getCalendarConnection(SAM))!, calendarId: "deleted-cal" });
    const r = await syncUserCalendar(SAM, deps); // the fake returns 404 for a calendar it doesn't have
    expect(r.outcome).toBe("error");
    expect(r.message).toMatch(/calendar no longer exists/);
  });

  it("an unreadable stored token (e.g. key rotated) asks the person to reconnect", async () => {
    await store.saveCalendarConnection({ ...(await store.getCalendarConnection(SAM))!, encryptedRefreshToken: encryptToken("refresh-sam", randomBytes(32)) });
    expect((await syncUserCalendar(SAM, deps)).outcome).toBe("needs_reconnect");
  });

  it("skips people who turned syncing off", async () => {
    await store.saveCalendarConnection({ ...(await store.getCalendarConnection(SAM))!, syncEnabled: false });
    expect(await syncAllCalendars(deps)).toMatchObject({ connections: 0 });
    expect((await syncUserCalendar(SAM, deps)).outcome).toBe("skipped");
    expect(google.live()).toHaveLength(0);
  });
});

describe("Google API client", () => {
  it("pages through events and filters by our private tags", async () => {
    await syncUserCalendar(SAM, deps); // 3 events; page size 2 forces a second page
    google.pageSize = 2;
    const client = new GoogleCalendarClient({ fetch: google.fetch, retryDelaysMs: [], getAccessToken: async () => {
      const { accessToken } = await deps.oauth.refresh("refresh-sam");
      return accessToken;
    } });
    expect(await client.listAppEvents("primary", { nmuApp: "1", nmuUser: SAM })).toHaveLength(3);
    expect(await client.listAppEvents("primary", { nmuApp: "1", nmuUser: MORGAN })).toHaveLength(0);
  });

  it("turns invalid_grant into GoogleAuthRevokedError, and revoke() reaches Google", async () => {
    await expect(deps.oauth.refresh("not-a-token")).rejects.toBeInstanceOf(GoogleAuthRevokedError);
    await deps.oauth.revoke("refresh-sam");
    expect(google.revoked).toEqual(["refresh-sam"]);
  });

  it("only lists calendars, never writes, when the settings page loads them", async () => {
    const client = new GoogleCalendarClient({ fetch: google.fetch, getAccessToken: async () => (await deps.oauth.refresh("refresh-sam")).accessToken });
    expect((await client.listCalendars()).map((c) => c.id)).toEqual(["primary", "team-cal"]);
    expect(google.writes()).toHaveLength(0);
  });
});

describe("Airtable storage of connections", () => {
  it("saves, updates, finds by user and deletes one row per user, with the token stored encrypted", async () => {
    const fake = new FakeAirtable();
    const at = new AirtableStore(new AirtableClient({ token: "t", baseId: "app1", fetch: fake.fetch, minIntervalMs: 0, retryDelaysMs: [] }));
    const c = connection("recSam0000000001", "refresh-sam", { reminderDays: [1, 7], overdueReminders: "daily" });
    await at.saveCalendarConnection(c);
    await at.saveCalendarConnection({ ...c, calendarName: "Renamed" });
    const rows = fake.all(S.calendarConnections.table);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].fields)).not.toContain("refresh-sam");
    expect(rows[0].fields[S.calendarConnections.fields.user]).toEqual(["recSam0000000001"]);
    expect(await at.getCalendarConnection("recSam0000000001")).toEqual({ ...c, calendarName: "Renamed" });
    expect(await at.getCalendarConnection("recOther")).toBeNull();
    await at.deleteCalendarConnection("recSam0000000001");
    expect(await at.listCalendarConnections()).toEqual([]);
  });

  it("explains a missing Airtable table clearly", async () => {
    const at = new AirtableStore(new AirtableClient({ token: "t", baseId: "app1", minIntervalMs: 0, retryDelaysMs: [],
      fetch: async () => new Response(JSON.stringify({ error: { type: "TABLE_NOT_FOUND" } }), { status: 404 }) }));
    await expect(at.getCalendarConnection("recX")).rejects.toBeInstanceOf(StorageNotReadyError);
  });
});
