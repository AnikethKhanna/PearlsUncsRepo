/** Pure Google Calendar sync logic: ids, event contents, reminders, overdue reminder, plan. */
import { describe, expect, it } from "vitest";
import {
  allDayReminderMinutes,
  buildOverdueEvent,
  buildTaskEvent,
  cleanReminderDays,
  desiredEvents,
  isAppEventId,
  overdueEventId,
  overdueReminderDate,
  planSync,
  taskEventId,
  type BuildContext,
} from "@/lib/domain/calendar-sync";
import type { DashboardRow } from "@/lib/domain/task-dashboard";
import type { Task } from "@/lib/domain/types";
import { isAuthorizedCronRequest } from "@/lib/calendar-sync/cron-auth";
import { decryptToken, encryptToken } from "@/lib/google/token-crypto";
import { randomBytes } from "node:crypto";

const TODAY = "2027-03-10"; // Wednesday
const task = (over: Partial<Task> & { id: string }): Task => ({
  projectId: "pA", templateStepId: null, title: `Task ${over.id}`, description: "", assigneeIds: ["u1"], ownerRole: "", phase: "",
  order: 1, dueDate: "2027-03-20", status: "Not Started", dependsOnTaskIds: [], notes: "", documentLinks: [], completedAt: null, ...over,
});
const row = (t: Task, blocked = false): DashboardRow => ({ task: t, projectName: "Alpha", blocked, assigneeNames: [] });
const ctx = (over: Partial<BuildContext["settings"]> = {}): BuildContext => ({
  userId: "u1",
  todayIso: TODAY,
  appUrl: "https://nmu.example.org",
  settings: { reminderDays: [2], reminderTime: "09:00", overdueReminders: "weekly", calendarTimeZone: "America/Los_Angeles", ...over },
});

describe("event ids", () => {
  it("are stable per user + task, different across users and tasks, and valid Google ids", () => {
    expect(taskEventId("u1", "t1")).toBe(taskEventId("u1", "t1"));
    expect(taskEventId("u1", "t1")).not.toBe(taskEventId("u2", "t1"));
    expect(taskEventId("u1", "t1")).not.toBe(taskEventId("u1", "t2"));
    for (const id of [taskEventId("u1", "t1"), overdueEventId("u1")]) {
      expect(id).toMatch(/^[a-v0-9]{5,1024}$/); // Google's base32hex rule
      expect(isAppEventId(id)).toBe(true);
    }
    expect(isAppEventId("someoneelsesevent123")).toBe(false);
  });
});

describe("reminders", () => {
  it("converts 'N days before at HH:MM' into minutes before an all-day event", () => {
    expect(allDayReminderMinutes(2, "09:00")).toBe(2340); // the suggested default
    expect(allDayReminderMinutes(1, "17:00")).toBe(420);
    expect(allDayReminderMinutes(7, "07:00")).toBe(9660);
  });

  it("only accepts the offered reminder days", () => {
    expect(cleanReminderDays(["2", "2", "7", "0", "-1", "30", "x", 1])).toEqual([1, 2, 7]);
  });
});

describe("task events", () => {
  it("is an all-day event on the due date with the chosen reminders and a link back", () => {
    const e = buildTaskEvent(row(task({ id: "t1" })), ctx({ reminderDays: [1, 2] }))!;
    expect(e.id).toBe(taskEventId("u1", "t1"));
    expect(e.start).toEqual({ date: "2027-03-20" });
    expect(e.end).toEqual({ date: "2027-03-21" }); // all-day end date is exclusive
    expect(e.summary).toBe("NMU task: Task t1");
    expect(e.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 900 }, { method: "popup", minutes: 2340 }] });
    expect(e.transparency).toBe("transparent");
    expect(e.description).toContain("https://nmu.example.org/projects/pA/tasks/t1");
    expect(e.extendedProperties?.private).toMatchObject({ nmuApp: "1", nmuUser: "u1", nmuTask: "t1" });
  });

  it("is marked overdue (with no pointless past reminders) once the date has passed", () => {
    const e = buildTaskEvent(row(task({ id: "t1", dueDate: "2027-03-09", status: "In Progress" })), ctx())!;
    expect(e.summary).toBe("OVERDUE – NMU task: Task t1");
    expect(e.reminders?.overrides).toEqual([]);
  });

  it("is not created for completed tasks or tasks without a valid due date", () => {
    for (const t of [task({ id: "a", status: "Done" }), task({ id: "b", status: "Not Needed" }), task({ id: "c", dueDate: null }), task({ id: "d", dueDate: "2027-02-30" })])
      expect(buildTaskEvent(row(t), ctx())).toBeNull();
  });

  it("changes fingerprint only when something visible changes", () => {
    const hash = (t: Task, c = ctx()) => buildTaskEvent(row(t), c)!.extendedProperties!.private!.nmuHash;
    const base = task({ id: "t1" });
    expect(hash(base)).toBe(hash({ ...base }));
    expect(hash(base)).not.toBe(hash({ ...base, dueDate: "2027-03-21" }));
    expect(hash(base)).not.toBe(hash({ ...base, title: "Renamed" }));
    expect(hash(base)).not.toBe(hash(base, ctx({ reminderDays: [3] })));
  });
});

describe("overdue reminder (deduplicated)", () => {
  it("weekly sits on the next Monday on or after today; daily on today; off never", () => {
    expect(overdueReminderDate("weekly", "2027-03-10")).toBe("2027-03-15"); // Wed → next Mon
    expect(overdueReminderDate("weekly", "2027-03-15")).toBe("2027-03-15"); // Monday itself
    expect(overdueReminderDate("weekly", "2027-03-14")).toBe("2027-03-15"); // Sunday
    expect(overdueReminderDate("daily", "2027-03-10")).toBe("2027-03-10");
    expect(overdueReminderDate("off", "2027-03-10")).toBeNull();
  });

  it("is ONE timed event listing all overdue tasks, in the calendar's time zone", () => {
    const rows = [
      row(task({ id: "late1", dueDate: "2027-03-01" })),
      row(task({ id: "late2", dueDate: "2027-02-20", status: "In Progress" })),
      row(task({ id: "done", dueDate: "2027-03-01", status: "Done" })),
      row(task({ id: "future" })),
    ];
    const e = buildOverdueEvent(rows, ctx({ calendarTimeZone: "America/New_York" }))!;
    expect(e.id).toBe(overdueEventId("u1"));
    expect(e.summary).toBe("NMU: 2 overdue tasks");
    expect(e.start).toEqual({ dateTime: "2027-03-15T09:00:00", timeZone: "America/New_York" });
    expect(e.end).toEqual({ dateTime: "2027-03-15T09:15:00", timeZone: "America/New_York" });
    expect(e.reminders?.overrides).toEqual([{ method: "popup", minutes: 0 }]);
    expect(e.description!.indexOf("Task late2")).toBeLessThan(e.description!.indexOf("Task late1")); // oldest first
    expect(e.description).not.toContain("Task done");
  });

  it("doesn't exist when nothing is overdue or it is turned off", () => {
    expect(buildOverdueEvent([row(task({ id: "future" }))], ctx())).toBeNull();
    expect(buildOverdueEvent([row(task({ id: "late", dueDate: "2027-03-01" }))], ctx({ overdueReminders: "off" }))).toBeNull();
  });

  it("re-syncing on the same days changes nothing, so it can't spam", () => {
    const rows = [row(task({ id: "late", dueDate: "2027-03-01" }))];
    const at = (d: string) => buildOverdueEvent(rows, { ...ctx(), todayIso: d })!;
    // Wed → Sun all point at the same Monday: identical event, so no new notification
    const hashes = ["2027-03-10", "2027-03-11", "2027-03-12", "2027-03-13", "2027-03-14"].map((d) => at(d).extendedProperties!.private!.nmuHash);
    expect(new Set(hashes).size).toBe(1);
  });
});

describe("sync plan", () => {
  const rows = [row(task({ id: "a" })), row(task({ id: "b", dueDate: "2027-03-25" }))];
  const desired = desiredEvents(rows, ctx());

  it("creates everything the first time and nothing the second time", () => {
    expect(planSync(desired, [])).toMatchObject({ upsert: desired, remove: [], unchanged: 0 });
    expect(planSync(desired, desired)).toEqual({ upsert: [], remove: [], unchanged: 2 });
  });

  it("updates changed events, re-creates ones the user deleted, and removes ones no longer wanted", () => {
    const changed = desiredEvents([row(task({ id: "a", dueDate: "2027-03-22" }))], ctx());
    const existing = [
      { ...desired[0] },
      { ...desired[1], status: "cancelled" as const },
      { ...desired[1], id: taskEventId("u1", "gone") },
      { id: "personal-meeting", start: {}, end: {} }, // not ours: never touched
    ];
    const plan = planSync([...changed, desired[1]], existing);
    expect(plan.upsert.map((e) => e.id)).toEqual([taskEventId("u1", "a"), taskEventId("u1", "b")]);
    expect(plan.remove).toEqual([taskEventId("u1", "gone")]);
  });
});

describe("token encryption", () => {
  const key = randomBytes(32);
  it("round-trips and never stores the plain token", () => {
    const enc = encryptToken("1//refresh-token", key);
    expect(enc).not.toContain("refresh-token");
    expect(enc).not.toBe(encryptToken("1//refresh-token", key)); // random IV
    expect(decryptToken(enc, key)).toBe("1//refresh-token");
  });
  it("rejects tampered values and the wrong key", () => {
    const enc = encryptToken("secret", key);
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(decryptToken(parts.join(":"), key)).toBeNull();
    expect(decryptToken(enc, randomBytes(32))).toBeNull();
    expect(decryptToken("garbage", key)).toBeNull();
  });
});

describe("cron authorization", () => {
  it("accepts only the exact bearer secret", () => {
    const secret = "s".repeat(32);
    expect(isAuthorizedCronRequest(`Bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorizedCronRequest(secret, secret)).toBe(false);
    expect(isAuthorizedCronRequest(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorizedCronRequest(null, secret)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer ", undefined)).toBe(false);
  });
});
