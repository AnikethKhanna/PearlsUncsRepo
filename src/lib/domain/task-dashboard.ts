/**
 * Task dashboard logic (My Tasks): filters, sorting, sections and summary tiles.
 *
 * Pure functions over tasks the caller is ALREADY allowed to see; the page
 * applies permissions before calling these. Filters live in the URL so a
 * filtered view can be bookmarked or shared, and the browser's Back button works.
 */
import { addDays } from "./dates";
import { isComplete, isOverdue } from "./task-state";
import { TASK_STATUSES, type Task, type TaskStatus } from "./types";

export const SCOPES = ["mine", "all"] as const;
export const STATUS_FILTERS = ["all", "open", "blocked", ...TASK_STATUSES] as const;
export const DUE_FILTERS = ["any", "overdue", "next7", "next30", "none"] as const;
export const SORTS = ["due", "due-desc", "project", "title"] as const;

export type Scope = (typeof SCOPES)[number];
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export type DueFilter = (typeof DUE_FILTERS)[number];
export type SortKey = (typeof SORTS)[number];

export interface DashboardFilters {
  /** "all" (everyone's tasks) is only honoured for people allowed to see all tasks */
  scope: Scope;
  /** project ID or "all" */
  project: string;
  status: StatusFilter;
  due: DueFilter;
  /** user ID, "all" or "unassigned" — only honoured with scope "all" */
  assignee: string;
  /** case-insensitive text search in task titles */
  q: string;
  sort: SortKey;
}

export const DEFAULT_FILTERS: DashboardFilters = {
  scope: "mine",
  project: "all",
  status: "all",
  due: "any",
  assignee: "all",
  q: "",
  sort: "due",
};

export const LABELS = {
  status: {
    all: "All statuses",
    open: "Open (not done)",
    blocked: "Blocked",
    ...Object.fromEntries(TASK_STATUSES.map((s) => [s, s])),
  } as Record<StatusFilter, string>,
  due: {
    any: "Any time",
    overdue: "Overdue",
    next7: "Due in next 7 days",
    next30: "Due in next 30 days",
    none: "No due date",
  } as Record<DueFilter, string>,
  sort: {
    due: "Soonest due first",
    "due-desc": "Latest due first",
    project: "Program",
    title: "Task name (A–Z)",
  } as Record<SortKey, string>,
};

type Params = Record<string, string | string[] | undefined>;

/** Read filters from the URL, ignoring anything invalid or not allowed for this person. */
export function parseFilters(params: Params, opts: { canSeeEveryone: boolean }): DashboardFilters {
  const one = (k: string) => {
    const v = params[k];
    return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : "";
  };
  const pick = <T extends string>(value: string, allowed: readonly T[], fallback: T): T =>
    (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

  const scope = opts.canSeeEveryone ? pick(one("scope"), SCOPES, "mine") : "mine";
  return {
    scope,
    project: one("project") || "all",
    status: pick(one("status"), STATUS_FILTERS, "all"),
    due: pick(one("due"), DUE_FILTERS, "any"),
    assignee: scope === "all" ? one("assignee") || "all" : "all",
    q: one("q").trim().slice(0, 100),
    sort: pick(one("sort"), SORTS, "due"),
  };
}

/** URL query for a filter state, leaving out defaults so links stay short. */
export function filtersToQuery(f: DashboardFilters, overrides: Partial<DashboardFilters> = {}): string {
  const merged = { ...f, ...overrides };
  const params = new URLSearchParams();
  for (const key of Object.keys(DEFAULT_FILTERS) as (keyof DashboardFilters)[]) {
    if (merged[key] !== DEFAULT_FILTERS[key]) params.set(key, merged[key]);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export interface DashboardRow {
  task: Task;
  projectName: string;
  /** Has prerequisites that aren't finished */
  blocked: boolean;
  /** Display names of the people assigned */
  assigneeNames: string[];
}

export function applyFilters(rows: DashboardRow[], f: DashboardFilters, todayIso: string): DashboardRow[] {
  const in7 = addDays(todayIso, 7);
  const in30 = addDays(todayIso, 30);
  const q = f.q.toLowerCase();
  return rows.filter(({ task: t, blocked }) => {
    if (f.project !== "all" && t.projectId !== f.project) return false;
    if (f.status === "open" && isComplete(t)) return false;
    if (f.status === "blocked" && (isComplete(t) || !blocked)) return false;
    if ((TASK_STATUSES as readonly string[]).includes(f.status) && t.status !== (f.status as TaskStatus)) return false;
    if (f.due === "overdue" && !isOverdue(t, todayIso)) return false;
    if (f.due === "next7" && !(t.dueDate && t.dueDate >= todayIso && t.dueDate <= in7)) return false;
    if (f.due === "next30" && !(t.dueDate && t.dueDate >= todayIso && t.dueDate <= in30)) return false;
    if (f.due === "none" && t.dueDate) return false;
    if (f.assignee === "unassigned" && t.assigneeIds.length > 0) return false;
    if (f.assignee !== "all" && f.assignee !== "unassigned" && !t.assigneeIds.includes(f.assignee)) return false;
    if (q && !t.title.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function sortRows(rows: DashboardRow[], sort: SortKey): DashboardRow[] {
  const due = (r: DashboardRow) => r.task.dueDate ?? "9999-12-31";
  const byDue = (a: DashboardRow, b: DashboardRow) => due(a).localeCompare(due(b)) || a.task.order - b.task.order;
  const cmp: Record<SortKey, (a: DashboardRow, b: DashboardRow) => number> = {
    due: byDue,
    "due-desc": (a, b) => -byDue(a, b),
    project: (a, b) => a.projectName.localeCompare(b.projectName) || byDue(a, b),
    title: (a, b) => a.task.title.localeCompare(b.task.title) || byDue(a, b),
  };
  return [...rows].sort(cmp[sort]);
}

export const SECTIONS = [
  { key: "overdue", title: "Overdue", hint: "Past their due date and not done", urgent: true },
  { key: "dueSoon", title: "Due in the next 7 days", hint: "Not done, due within a week", urgent: true },
  { key: "inProgress", title: "In progress", hint: "Started, due later", urgent: false },
  { key: "upcoming", title: "Upcoming", hint: "Not started, due later or no date", urgent: false },
  { key: "completed", title: "Completed", hint: "Done or not needed", urgent: false },
] as const;
export type SectionKey = (typeof SECTIONS)[number]["key"];

/** Each task belongs to exactly one section; urgency wins (an overdue In Progress task is "Overdue"). */
export function sectionOf(t: Task, todayIso: string): SectionKey {
  if (isComplete(t)) return "completed";
  if (isOverdue(t, todayIso)) return "overdue";
  if (t.dueDate && t.dueDate <= addDays(todayIso, 7)) return "dueSoon";
  if (t.status === "In Progress") return "inProgress";
  return "upcoming";
}

export interface Section {
  key: SectionKey;
  title: string;
  hint: string;
  urgent: boolean;
  rows: DashboardRow[];
  /** Collapsed sections stay one line tall until opened */
  open: boolean;
}

/** Up to this many rows are shown when everything fits on screen; otherwise only urgent sections start open. */
const SHOW_ALL_OPEN_BELOW = 15;

export function buildSections(rows: DashboardRow[], todayIso: string): Section[] {
  const fewRows = rows.length <= SHOW_ALL_OPEN_BELOW;
  return SECTIONS.map((s) => {
    const sectionRows = rows.filter((r) => sectionOf(r.task, todayIso) === s.key);
    return { ...s, rows: sectionRows, open: sectionRows.length > 0 && (s.urgent || fewRows || s.key === "inProgress") };
  }).filter((s) => s.rows.length > 0);
}

export interface Summary {
  open: number;
  overdue: number;
  dueSoon: number;
  blocked: number;
}

/** Summary tiles: counted over everything in scope, before filters, so they always show the full picture. */
export function summarize(rows: DashboardRow[], todayIso: string): Summary {
  const in7 = addDays(todayIso, 7);
  const open = rows.filter((r) => !isComplete(r.task));
  return {
    open: open.length,
    overdue: open.filter((r) => isOverdue(r.task, todayIso)).length,
    dueSoon: open.filter((r) => r.task.dueDate && r.task.dueDate >= todayIso && r.task.dueDate <= in7).length,
    blocked: open.filter((r) => r.blocked).length,
  };
}

export interface FilterChip {
  key: keyof DashboardFilters;
  label: string;
  /** Link that removes just this filter */
  removeHref: string;
}

/** The filters currently narrowing the list, for display as removable chips. */
export function activeFilterChips(
  f: DashboardFilters,
  names: { project: (id: string) => string; user: (id: string) => string },
): FilterChip[] {
  const chips: FilterChip[] = [];
  const add = (key: keyof DashboardFilters, label: string) =>
    chips.push({ key, label, removeHref: `/my-tasks${filtersToQuery(f, { [key]: DEFAULT_FILTERS[key] })}` });
  if (f.project !== "all") add("project", `Project: ${names.project(f.project)}`);
  if (f.status !== "all") add("status", `Status: ${LABELS.status[f.status]}`);
  if (f.due !== "any") add("due", `Due: ${LABELS.due[f.due]}`);
  if (f.assignee !== "all")
    add("assignee", `Assignee: ${f.assignee === "unassigned" ? "Unassigned" : names.user(f.assignee)}`);
  if (f.q) add("q", `Search: “${f.q}”`);
  return chips;
}
