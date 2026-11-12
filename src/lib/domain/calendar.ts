/**
 * Calendar view logic: which tasks and program dates land on which day.
 *
 * Pure functions over rows the caller is ALREADY allowed to see (the page
 * loads them with loadTasksInScope, the same as My Tasks). Nothing here
 * copies or stores task data; the calendar is just another view of it.
 *
 * Dates are "YYYY-MM-DD" calendar dates. A task due "2027-03-10" is shown on
 * March 10 for everyone, whatever their time zone, and "today" is NMU's date
 * (Pacific time, see dates.today()), the same "today" used for "Overdue" on
 * My Tasks.
 */
import {
  addDays,
  addMonths,
  datesBetween,
  endOfMonth,
  formatDate,
  isIsoDate,
  startOfMonth,
  startOfWeek,
} from "./dates";
import { DEFAULT_FILTERS, filtersToQuery, type DashboardFilters, type DashboardRow } from "./task-dashboard";
import { isComplete } from "./task-state";
import type { Project, Task } from "./types";

// ---- URL state ----

export const CALENDAR_VIEWS = ["month", "week"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export interface CalendarParams {
  view: CalendarView;
  /** Any date inside the period being shown */
  date: string;
}

type Params = Record<string, string | string[] | undefined>;

/** Read view + date from the URL; anything missing or invalid falls back to this month around today. */
export function parseCalendarParams(params: Params, todayIso: string): CalendarParams {
  const one = (k: string) => {
    const v = params[k];
    return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : "";
  };
  const view = (CALENDAR_VIEWS as readonly string[]).includes(one("view")) ? (one("view") as CalendarView) : "month";
  const date = one("date");
  // Keep navigation within a sane range so a hand-edited URL can't build a huge or broken grid.
  const valid = isIsoDate(date) && date >= "1900-01-01" && date <= "9999-11-30";
  return { view, date: valid ? date : todayIso };
}

/** Link to the calendar keeping the dashboard filters, leaving out defaults so links stay short. */
export function calendarHref(
  f: DashboardFilters,
  cal: CalendarParams,
  todayIso: string,
  overrides: Partial<CalendarParams> = {},
): string {
  const { view, date } = { ...cal, ...overrides };
  const params = new URLSearchParams(filtersToQuery(f).slice(1));
  if (view !== "month") params.set("view", view);
  if (date !== todayIso) params.set("date", date);
  const qs = params.toString();
  return `/calendar${qs ? `?${qs}` : ""}`;
}

// ---- Periods ----

export interface Period {
  start: string;
  end: string;
  /** First and last day of the month (month view) or the week (week view) */
  focusStart: string;
  focusEnd: string;
}

/** Month view shows whole weeks (Sun–Sat) covering the month; week view shows one Sun–Sat week. */
export function periodFor(view: CalendarView, anchor: string): Period {
  if (view === "week") {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 6), focusStart: start, focusEnd: addDays(start, 6) };
  }
  const focusStart = startOfMonth(anchor);
  const focusEnd = endOfMonth(anchor);
  return { start: startOfWeek(focusStart), end: addDays(startOfWeek(focusEnd), 6), focusStart, focusEnd };
}

/** The anchor date for the previous (-1) or next (+1) month/week. */
export function shiftPeriod(view: CalendarView, anchor: string, direction: -1 | 1): string {
  return view === "week" ? addDays(startOfWeek(anchor), 7 * direction) : addMonths(startOfMonth(anchor), direction);
}

/** When switching between month and week, stay on today if it is in view, otherwise on the period's first day. */
export function anchorForViewSwitch(current: CalendarParams, todayIso: string): string {
  const p = periodFor(current.view, current.date);
  return todayIso >= p.focusStart && todayIso <= p.focusEnd ? todayIso : p.focusStart;
}

/** "March 2027", or for a week "Mar 7 – 13, 2027" / "Feb 28 – Mar 6, 2027" / "Dec 27, 2026 – Jan 2, 2027". */
export function periodTitle(view: CalendarView, anchor: string): string {
  const p = periodFor(view, anchor);
  if (view === "month") return formatDate(p.focusStart, { month: "long", year: "numeric" });
  const [s, e] = [p.focusStart, p.focusEnd];
  const sameYear = s.slice(0, 4) === e.slice(0, 4);
  const sameMonth = s.slice(0, 7) === e.slice(0, 7);
  if (sameMonth) return `${formatDate(s, { month: "short", day: "numeric" })} – ${formatDate(e, { day: "numeric" })}, ${e.slice(0, 4)}`;
  if (sameYear) return `${formatDate(s, { month: "short", day: "numeric" })} – ${formatDate(e, { month: "short", day: "numeric", year: "numeric" })}`;
  return `${formatDate(s, { month: "short", day: "numeric", year: "numeric" })} – ${formatDate(e, { month: "short", day: "numeric", year: "numeric" })}`;
}

// ---- Task state shown on the calendar ----

export const CALENDAR_STATES = ["overdue", "dueToday", "upcoming", "completed"] as const;
export type CalendarState = (typeof CALENDAR_STATES)[number];

/** Text label + symbol for each state, so meaning never depends on colour alone. */
export const CALENDAR_STATE_META: Record<CalendarState, { label: string; symbol: string }> = {
  overdue: { label: "Overdue", symbol: "!" },
  dueToday: { label: "Due today", symbol: "●" },
  upcoming: { label: "Upcoming", symbol: "○" },
  completed: { label: "Completed", symbol: "✓" },
};

/** The task's valid due date, or null if it has none (or it isn't a real date). */
export function calendarDate(task: Pick<Task, "dueDate">): string | null {
  return task.dueDate && isIsoDate(task.dueDate) ? task.dueDate : null;
}

export function calendarState(task: Task, todayIso: string): CalendarState {
  if (isComplete(task)) return "completed";
  const due = calendarDate(task);
  if (due && due < todayIso) return "overdue";
  if (due === todayIso) return "dueToday";
  return "upcoming";
}

// ---- Program dates (start / end) ----

export interface Milestone {
  date: string;
  kind: "start" | "end";
  projectId: string;
  projectName: string;
}

export const MILESTONE_LABEL: Record<Milestone["kind"], string> = { start: "Program starts", end: "Program ends" };

export function projectMilestones(projects: Pick<Project, "id" | "name" | "startDate" | "endDate">[]): Milestone[] {
  return projects.flatMap((p) => {
    const out: Milestone[] = [];
    if (p.startDate && isIsoDate(p.startDate))
      out.push({ date: p.startDate, kind: "start", projectId: p.id, projectName: p.name });
    if (p.endDate && isIsoDate(p.endDate) && p.endDate !== p.startDate)
      out.push({ date: p.endDate, kind: "end", projectId: p.id, projectName: p.name });
    return out;
  });
}

/**
 * Which programs' start/end dates to show, honouring the same filters as the tasks:
 * - only programs the user can see (the caller passes those);
 * - "My tasks" shows programs the user has a task in or is on the team of; "Everyone's tasks" shows all;
 * - the Program filter narrows to that one program;
 * - hidden while a task-only filter (status, due, assignee, search) is on, because those filters
 *   are about tasks and program dates would just be noise.
 */
export function milestoneProjects<P extends Pick<Project, "id" | "teamUserIds">>(
  projects: P[],
  f: DashboardFilters,
  ctx: { userId: string; tasksInScope: Pick<Task, "projectId">[] },
): P[] {
  if (!milestonesShown(f)) return [];
  const withMyTasks = new Set(ctx.tasksInScope.map((t) => t.projectId));
  return projects.filter(
    (p) =>
      (f.project === "all" || f.project === p.id) &&
      (f.scope === "all" || withMyTasks.has(p.id) || p.teamUserIds.includes(ctx.userId)),
  );
}

export function milestonesShown(f: DashboardFilters): boolean {
  return (
    f.status === DEFAULT_FILTERS.status &&
    f.due === DEFAULT_FILTERS.due &&
    f.assignee === DEFAULT_FILTERS.assignee &&
    f.q === DEFAULT_FILTERS.q
  );
}

// ---- Placing items on days ----

export interface CalendarEntry {
  row: DashboardRow;
  state: CalendarState;
}

export interface CalendarDay {
  date: string;
  /** False for the leading/trailing days from neighbouring months in month view */
  inFocus: boolean;
  isToday: boolean;
  entries: CalendarEntry[];
  milestones: Milestone[];
}

export interface CalendarModel {
  title: string;
  period: Period;
  days: CalendarDay[];
  /** days split into Sun–Sat weeks */
  weeks: CalendarDay[][];
  /** Tasks with no (valid) due date; they can't go on a day, so they're listed separately */
  unscheduled: DashboardRow[];
  /** Open tasks overdue from before the first day shown */
  overdueBefore: number;
}

const STATE_RANK: Record<CalendarState, number> = { overdue: 0, dueToday: 1, upcoming: 2, completed: 3 };

/** Within a day: most urgent first, then the program's task order, then title. */
function compareEntries(a: CalendarEntry, b: CalendarEntry): number {
  return (
    STATE_RANK[a.state] - STATE_RANK[b.state] ||
    a.row.projectName.localeCompare(b.row.projectName) ||
    a.row.task.order - b.row.task.order ||
    a.row.task.title.localeCompare(b.row.task.title)
  );
}

/** Place rows and milestones on each day from start to end (inclusive). */
export function placeOnDays(
  rows: DashboardRow[],
  milestones: Milestone[],
  range: { start: string; end: string; focusStart?: string; focusEnd?: string },
  todayIso: string,
): CalendarDay[] {
  const byDate = new Map<string, CalendarDay>();
  const days = datesBetween(range.start, range.end).map((date) => {
    const day: CalendarDay = {
      date,
      inFocus: date >= (range.focusStart ?? range.start) && date <= (range.focusEnd ?? range.end),
      isToday: date === todayIso,
      entries: [],
      milestones: [],
    };
    byDate.set(date, day);
    return day;
  });
  for (const row of rows) {
    const due = calendarDate(row.task);
    if (due) byDate.get(due)?.entries.push({ row, state: calendarState(row.task, todayIso) });
  }
  for (const m of milestones) byDate.get(m.date)?.milestones.push(m);
  for (const d of days) {
    d.entries.sort(compareEntries);
    d.milestones.sort((a, b) => a.projectName.localeCompare(b.projectName) || a.kind.localeCompare(b.kind));
  }
  return days;
}

export function buildCalendar(input: {
  rows: DashboardRow[];
  milestones: Milestone[];
  cal: CalendarParams;
  todayIso: string;
}): CalendarModel {
  const { rows, milestones, cal, todayIso } = input;
  const period = periodFor(cal.view, cal.date);
  const days = placeOnDays(rows, milestones, period, todayIso);
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return {
    title: periodTitle(cal.view, cal.date),
    period,
    days,
    weeks,
    unscheduled: rows
      .filter((r) => !calendarDate(r.task))
      .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.task.order - b.task.order),
    overdueBefore: rows.filter((r) => {
      const due = calendarDate(r.task);
      return !!due && due < period.start && calendarState(r.task, todayIso) === "overdue";
    }).length,
  };
}

// ---- Dashboard preview ----

export const PREVIEW_DAYS = 7;
/** Tasks listed per day in the dashboard preview before "+N more". */
export const PREVIEW_ITEMS_PER_DAY = 2;

export interface CalendarPreview {
  days: CalendarDay[];
  /** Open tasks overdue before today (not on the strip, which starts today) */
  overdue: number;
  unscheduled: number;
}

/** A compact strip of the next 7 days, starting today. */
export function buildPreview(rows: DashboardRow[], milestones: Milestone[], todayIso: string): CalendarPreview {
  const days = placeOnDays(rows, milestones, { start: todayIso, end: addDays(todayIso, PREVIEW_DAYS - 1) }, todayIso);
  return {
    days,
    overdue: rows.filter((r) => calendarState(r.task, todayIso) === "overdue").length,
    unscheduled: rows.filter((r) => !calendarDate(r.task)).length,
  };
}
