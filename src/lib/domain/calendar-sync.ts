/**
 * What a user's Google Calendar SHOULD contain, and how to get it there.
 *
 * Pure logic, no network: given the tasks a user is allowed to sync and their
 * settings, build the desired events; given what is already in the calendar,
 * plan the creates / updates / deletes. Running the same sync twice plans
 * nothing the second time, and the event ids are derived from (user, task)
 * so a task can never end up with two events.
 */
import { createHash } from "node:crypto";
import type { GoogleEvent } from "@/lib/google/google-api";
import { addDays, dayOfWeek, formatDisplayDate, isIsoDate } from "./dates";
import type { DashboardRow } from "./task-dashboard";
import { isComplete, isOverdue } from "./task-state";
import type { CalendarConnection, OverdueReminderMode } from "./types";

// ---- Settings ----

export const REMINDER_DAY_OPTIONS = [1, 2, 3, 7] as const;
export const REMINDER_TIME_OPTIONS = ["07:00", "08:00", "09:00", "10:00", "12:00", "15:00", "17:00"] as const;

export const DEFAULT_CALENDAR_SETTINGS = {
  syncEnabled: true,
  /** Sponsor suggestion: remind two days before the due date */
  reminderDays: [2],
  reminderTime: "09:00",
  /** At most one overdue pop-up per week by default, to avoid nagging */
  overdueReminders: "weekly" as OverdueReminderMode,
};

export type SyncSettings = Pick<CalendarConnection, "reminderDays" | "reminderTime" | "overdueReminders" | "calendarTimeZone">;

/** Keep only allowed reminder days, without duplicates (Google allows at most 5 reminders). */
export function cleanReminderDays(values: unknown[]): number[] {
  const allowed = new Set<number>(REMINDER_DAY_OPTIONS);
  return [...new Set(values.map(Number))].filter((n) => allowed.has(n)).sort((a, b) => a - b).slice(0, 5);
}

export function isValidReminderTime(value: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  return !!m && +m[1] < 24 && +m[2] < 60;
}

/**
 * Deadlines are all-day events, and Google measures an all-day event's
 * reminder in minutes before its start (midnight in the calendar's time zone).
 * "2 days before at 09:00" = 2 × 1440 − 540 = 2340 minutes.
 */
export function allDayReminderMinutes(daysBefore: number, time: string): number {
  const [h, m] = time.split(":").map(Number);
  return daysBefore * 1440 - (h * 60 + m);
}

// ---- Event identity ----

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Google event ids may use only base32hex characters (0-9, a-v), 5–1024 long.
 * Hex digits and the "nmu" prefix fit. Same user + task → same id, always.
 */
export function taskEventId(userId: string, taskId: string): string {
  return `nmut${sha256(`${userId}:task:${taskId}`)}`;
}

export function overdueEventId(userId: string): string {
  return `nmuo${sha256(`${userId}:overdue`)}`;
}

export function isAppEventId(id: string): boolean {
  return /^nmu[to][0-9a-f]{64}$/.test(id);
}

/** Private properties stamped on every event we create, used to find (only) our events again. */
export const appEventTag = (userId: string) => ({ nmuApp: "1", nmuUser: userId });

/** Fingerprint of an event's content, so unchanged events aren't rewritten on every sync. */
function withHash(event: GoogleEvent): GoogleEvent {
  const hash = sha256(JSON.stringify(event)).slice(0, 32);
  return {
    ...event,
    extendedProperties: { private: { ...event.extendedProperties?.private, nmuHash: hash } },
  };
}

// ---- Desired events ----

export interface BuildContext {
  userId: string;
  todayIso: string;
  settings: SyncSettings;
  /** Public app URL for links back to the task (optional) */
  appUrl?: string;
}

const FOOTER =
  "Added by NMU Onboarding. Changes made to this event in Google Calendar are overwritten; update the task in the app instead.";

/**
 * One all-day event on the due date for each open task with a valid due date.
 * Completed tasks and tasks without a due date get no event (and lose any old one).
 */
export function buildTaskEvent(row: DashboardRow, ctx: BuildContext): GoogleEvent | null {
  const t = row.task;
  if (isComplete(t) || !t.dueDate || !isIsoDate(t.dueDate)) return null;
  const overdue = isOverdue(t, ctx.todayIso);
  const link = ctx.appUrl ? `${ctx.appUrl}/projects/${t.projectId}/tasks/${t.id}` : null;
  return withHash({
    id: taskEventId(ctx.userId, t.id),
    summary: `${overdue ? "OVERDUE – " : ""}NMU task: ${t.title}`,
    description: [
      `Program: ${row.projectName}`,
      `Due: ${formatDisplayDate(t.dueDate)}`,
      `Status: ${t.status}${row.blocked ? " (waiting on another task)" : ""}`,
      link ? `Open in NMU Onboarding: ${link}` : null,
      "",
      FOOTER,
    ]
      .filter((x) => x !== null)
      .join("\n"),
    start: { date: t.dueDate },
    end: { date: addDays(t.dueDate, 1) },
    // A deadline is not a meeting: don't block the person's time.
    transparency: "transparent",
    reminders: {
      useDefault: false,
      // Past-due reminders would be pointless (and Google ignores them), so overdue tasks get none.
      overrides: overdue
        ? []
        : ctx.settings.reminderDays.map((d) => ({ method: "popup" as const, minutes: allDayReminderMinutes(d, ctx.settings.reminderTime) })),
    },
    ...(link ? { source: { title: "NMU Onboarding", url: link } } : {}),
    extendedProperties: { private: { ...appEventTag(ctx.userId), nmuTask: t.id } },
  });
}

/**
 * The day the single "overdue tasks" reminder sits on, or null when it is off.
 * daily: today. weekly: the next Monday on or after today. Because the event
 * only MOVES on those days (it is one event with a fixed id), a person gets at
 * most one overdue pop-up per day or per week, however often we sync.
 */
export function overdueReminderDate(mode: OverdueReminderMode, todayIso: string): string | null {
  if (mode === "off") return null;
  if (mode === "daily") return todayIso;
  return addDays(todayIso, (8 - dayOfWeek(todayIso)) % 7);
}

const MAX_LISTED = 15;

/** One short timed event that pops up once, listing the person's overdue tasks. Null if none or turned off. */
export function buildOverdueEvent(rows: DashboardRow[], ctx: BuildContext): GoogleEvent | null {
  const date = overdueReminderDate(ctx.settings.overdueReminders, ctx.todayIso);
  const overdue = rows
    .filter((r) => isOverdue(r.task, ctx.todayIso))
    .sort((a, b) => a.task.dueDate!.localeCompare(b.task.dueDate!));
  if (!date || overdue.length === 0) return null;
  const [h, m] = ctx.settings.reminderTime.split(":").map(Number);
  const endMinutes = Math.min(h * 60 + m + 15, 23 * 60 + 59);
  const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  const tz = ctx.settings.calendarTimeZone;
  const n = overdue.length;
  return withHash({
    id: overdueEventId(ctx.userId),
    summary: `NMU: ${n} overdue task${n === 1 ? "" : "s"}`,
    description: [
      `You have ${n} unfinished task${n === 1 ? "" : "s"} past the due date:`,
      ...overdue.slice(0, MAX_LISTED).map((r) => `• ${r.task.title} (${r.projectName}), due ${formatDisplayDate(r.task.dueDate)}`),
      n > MAX_LISTED ? `…and ${n - MAX_LISTED} more.` : null,
      ctx.appUrl ? `\nSee them in NMU Onboarding: ${ctx.appUrl}/my-tasks?due=overdue` : null,
      "",
      `This reminder repeats ${ctx.settings.overdueReminders === "daily" ? "daily" : "weekly on Mondays"} while tasks are overdue. Change it in NMU Onboarding → Calendar settings.`,
    ]
      .filter((x) => x !== null)
      .join("\n"),
    // Timed (not all-day) so the pop-up can fire at the chosen time on that day.
    start: { dateTime: `${date}T${ctx.settings.reminderTime}:00`, timeZone: tz },
    end: { dateTime: `${date}T${hhmm(endMinutes)}:00`, timeZone: tz },
    transparency: "transparent",
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
    extendedProperties: { private: { ...appEventTag(ctx.userId), nmuKind: "overdue" } },
  });
}

/** Everything that should be in the user's calendar, given the rows they are allowed to sync. */
export function desiredEvents(rows: DashboardRow[], ctx: BuildContext): GoogleEvent[] {
  const events = rows.map((r) => buildTaskEvent(r, ctx)).filter((e): e is GoogleEvent => !!e);
  const digest = buildOverdueEvent(rows, ctx);
  return digest ? [...events, digest] : events;
}

// ---- Plan ----

export interface SyncPlan {
  /** New or changed events (written with upsert, so a lost "create" can't duplicate) */
  upsert: GoogleEvent[];
  /** Ids of our events that should no longer exist */
  remove: string[];
  unchanged: number;
}

export function planSync(desired: GoogleEvent[], existing: GoogleEvent[]): SyncPlan {
  const current = new Map(existing.filter((e) => isAppEventId(e.id)).map((e) => [e.id, e]));
  const wanted = new Set(desired.map((e) => e.id));
  const upsert: GoogleEvent[] = [];
  let unchanged = 0;
  for (const e of desired) {
    const have = current.get(e.id);
    const same =
      have &&
      have.status !== "cancelled" &&
      have.extendedProperties?.private?.nmuHash === e.extendedProperties?.private?.nmuHash;
    if (same) unchanged++;
    else upsert.push(e);
  }
  const remove = [...current.keys()].filter((id) => !wanted.has(id));
  return { upsert, remove, unchanged };
}
