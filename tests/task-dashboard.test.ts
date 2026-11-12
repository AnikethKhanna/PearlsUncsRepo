import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  activeFilterChips,
  applyFilters,
  buildSections,
  filtersToQuery,
  parseFilters,
  sectionOf,
  sortRows,
  summarize,
  type DashboardFilters,
  type DashboardRow,
} from "@/lib/domain/task-dashboard";
import type { Task } from "@/lib/domain/types";

const TODAY = "2027-03-10";
const task = (over: Partial<Task> & { id: string }): Task => ({
  projectId: "pA", templateStepId: null, title: over.id, description: "", assigneeIds: ["u1"], ownerRole: "", phase: "Pre-launch",
  order: 1, dueDate: "2027-04-01", status: "Not Started", dependsOnTaskIds: [], notes: "", documentLinks: [], completedAt: null, ...over,
});
const row = (t: Task, extra: Partial<DashboardRow> = {}): DashboardRow => ({
  task: t, projectName: t.projectId === "pB" ? "Bravo program" : "Alpha program", blocked: false, assigneeNames: [], ...extra,
});
const f = (over: Partial<DashboardFilters> = {}): DashboardFilters => ({ ...DEFAULT_FILTERS, ...over });

const rows: DashboardRow[] = [
  row(task({ id: "late", title: "Send insurance forms", dueDate: "2027-03-01", status: "In Progress" })),
  row(task({ id: "soon", title: "Order caps", dueDate: "2027-03-14" })),
  row(task({ id: "started", title: "Recruit volunteers", dueDate: "2027-05-01", status: "In Progress", projectId: "pB", assigneeIds: ["u2"] })),
  row(task({ id: "later", title: "Write report", dueDate: "2027-06-01", projectId: "pB" }), { blocked: true }),
  row(task({ id: "nodate", title: "Thank donors", dueDate: null, assigneeIds: [] })),
  row(task({ id: "done", title: "Sign agreement", dueDate: "2027-02-01", status: "Done" })),
  row(task({ id: "skip", title: "Optional flyer", dueDate: "2027-03-12", status: "Not Needed" })),
];
const ids = (rs: DashboardRow[]) => rs.map((r) => r.task.id);

describe("sections", () => {
  it("puts every task in exactly one section, urgency first", () => {
    expect(rows.map((r) => sectionOf(r.task, TODAY))).toEqual([
      "overdue", "dueSoon", "inProgress", "upcoming", "upcoming", "completed", "completed",
    ]);
  });

  it("opens urgent sections and collapses the rest when the list is long", () => {
    const many = Array.from({ length: 20 }, (_, i) => row(task({ id: `u${i}`, dueDate: "2027-09-01" })));
    const sections = buildSections([...rows, ...many], TODAY);
    expect(sections.map((s) => [s.key, s.open])).toEqual([
      ["overdue", true], ["dueSoon", true], ["inProgress", true], ["upcoming", false], ["completed", false],
    ]);
  });

  it("opens everything when the list is short, and drops empty sections", () => {
    const sections = buildSections(rows.slice(0, 2), TODAY);
    expect(sections.map((s) => [s.key, s.open])).toEqual([["overdue", true], ["dueSoon", true]]);
  });
});

describe("summary tiles", () => {
  it("counts open, overdue, due-soon and blocked tasks", () => {
    expect(summarize(rows, TODAY)).toEqual({ open: 5, overdue: 1, dueSoon: 1, blocked: 1 });
  });
});

describe("filters", () => {
  it.each<[string, Partial<DashboardFilters>, string[]]>([
    ["project", { project: "pB" }, ["started", "later"]],
    ["open status", { status: "open" }, ["late", "soon", "started", "later", "nodate"]],
    ["exact status", { status: "In Progress" }, ["late", "started"]],
    ["blocked", { status: "blocked" }, ["later"]],
    ["overdue", { due: "overdue" }, ["late"]],
    ["next 7 days (open and done)", { due: "next7" }, ["soon", "skip"]],
    ["no due date", { due: "none" }, ["nodate"]],
    ["assignee", { scope: "all", assignee: "u2" }, ["started"]],
    ["unassigned", { scope: "all", assignee: "unassigned" }, ["nodate"]],
    ["search (case-insensitive)", { q: "REPORT" }, ["later"]],
  ])("%s", (_name, over, expected) => {
    expect(ids(applyFilters(rows, f(over), TODAY))).toEqual(expected);
  });

  it("combines filters (AND) and then sorts", () => {
    const filtered = applyFilters(rows, f({ status: "open", project: "pA" }), TODAY);
    expect(ids(filtered)).toEqual(["late", "soon", "nodate"]);
    expect(ids(sortRows(filtered, "title"))).toEqual(["soon", "late", "nodate"]);
    expect(ids(sortRows(filtered, "due-desc"))).toEqual(["nodate", "soon", "late"]);
  });
});

describe("sorting", () => {
  it("sorts by due date, project and title; no-date tasks go last", () => {
    expect(ids(sortRows(rows, "due"))).toEqual(["done", "late", "skip", "soon", "started", "later", "nodate"]);
    expect(ids(sortRows(rows, "project")).slice(0, 2)).toEqual(["done", "late"]); // Alpha first, by date
    expect(ids(sortRows(rows, "project")).slice(-2)).toEqual(["started", "later"]); // then Bravo
  });
});

describe("URL state", () => {
  it("parses valid values and ignores junk", () => {
    expect(parseFilters({ status: "Done", due: "next7", sort: "title", q: "  caps ", project: "pA" }, { canSeeEveryone: false }))
      .toEqual({ ...DEFAULT_FILTERS, status: "Done", due: "next7", sort: "title", q: "caps", project: "pA" });
    expect(parseFilters({ status: "bogus", due: "x", sort: "y" }, { canSeeEveryone: true })).toEqual(DEFAULT_FILTERS);
  });

  it("never gives staff the 'everyone' scope or an assignee filter", () => {
    const staff = parseFilters({ scope: "all", assignee: "u2" }, { canSeeEveryone: false });
    expect(staff.scope).toBe("mine");
    expect(staff.assignee).toBe("all");
    const admin = parseFilters({ scope: "all", assignee: "u2" }, { canSeeEveryone: true });
    expect([admin.scope, admin.assignee]).toEqual(["all", "u2"]);
  });

  it("round-trips through the query string, omitting defaults", () => {
    const state = f({ scope: "all", status: "open", q: "caps & hats" });
    const qs = filtersToQuery(state);
    expect(qs).toBe("?scope=all&status=open&q=caps+%26+hats");
    expect(parseFilters(Object.fromEntries(new URLSearchParams(qs)), { canSeeEveryone: true })).toEqual(state);
    expect(filtersToQuery(DEFAULT_FILTERS)).toBe("");
  });

  it("lists active filters as chips that each remove only themselves", () => {
    const chips = activeFilterChips(f({ scope: "all", project: "pB", due: "overdue" }), { project: () => "Bravo program", user: () => "Sam" });
    expect(chips.map((c) => c.label)).toEqual(["Project: Bravo program", "Due: Overdue"]);
    expect(chips[0].removeHref).toBe("/my-tasks?scope=all&due=overdue");
    expect(activeFilterChips(DEFAULT_FILTERS, { project: String, user: String })).toEqual([]);
  });
});
