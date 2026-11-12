import { describe, expect, it } from "vitest";
import {
  anchorForViewSwitch,
  buildCalendar,
  buildPreview,
  calendarDate,
  calendarHref,
  calendarState,
  milestoneProjects,
  parseCalendarParams,
  periodFor,
  periodTitle,
  placeOnDays,
  projectMilestones,
  shiftPeriod,
} from "@/lib/domain/calendar";
import { dayOfWeek, endOfMonth, startOfWeek } from "@/lib/domain/dates";
import { DEFAULT_FILTERS, type DashboardFilters, type DashboardRow } from "@/lib/domain/task-dashboard";
import type { Task } from "@/lib/domain/types";

const TODAY = "2027-03-10"; // a Wednesday
const task = (over: Partial<Task> & { id: string }): Task => ({
  projectId: "pA", templateStepId: null, title: over.id, description: "", assigneeIds: ["u1"], ownerRole: "", phase: "",
  order: 1, dueDate: "2027-03-20", status: "Not Started", dependsOnTaskIds: [], notes: "", documentLinks: [], completedAt: null, ...over,
});
const row = (t: Task): DashboardRow => ({ task: t, projectName: t.projectId === "pB" ? "Bravo" : "Alpha", blocked: false, assigneeNames: [] });
const f = (over: Partial<DashboardFilters> = {}): DashboardFilters => ({ ...DEFAULT_FILTERS, ...over });
const ids = (day: { entries: { row: DashboardRow }[] } | undefined) => day?.entries.map((e) => e.row.task.id);

const rows = [
  row(task({ id: "late", dueDate: "2027-03-01" })),
  row(task({ id: "today", dueDate: TODAY })),
  row(task({ id: "soon", dueDate: "2027-03-12", status: "In Progress" })),
  row(task({ id: "done", dueDate: "2027-03-12", status: "Done" })),
  row(task({ id: "skipped", dueDate: "2027-03-12", status: "Not Needed", order: 0 })),
  row(task({ id: "nodate", dueDate: null })),
  row(task({ id: "garbage", dueDate: "2027-02-30" })),
  row(task({ id: "april", dueDate: "2027-04-02" })),
  row(task({ id: "longago", dueDate: "2027-01-15" })),
];

describe("task state on the calendar", () => {
  it.each<[string, Partial<Task>, string]>([
    ["past due and open", { dueDate: "2027-03-09" }, "overdue"],
    ["in progress but past due", { dueDate: "2027-03-01", status: "In Progress" }, "overdue"],
    ["due today", { dueDate: TODAY }, "dueToday"],
    ["due later", { dueDate: "2027-03-11" }, "upcoming"],
    ["no due date", { dueDate: null }, "upcoming"],
    ["done, even if the date passed", { dueDate: "2027-03-01", status: "Done" }, "completed"],
    ["not needed", { dueDate: "2027-03-20", status: "Not Needed" }, "completed"],
  ])("%s", (_name, over, expected) => {
    expect(calendarState(task({ id: "x", ...over }), TODAY)).toBe(expected);
  });

  it("treats missing or impossible dates as unscheduled", () => {
    expect(calendarDate({ dueDate: null })).toBeNull();
    expect(calendarDate({ dueDate: "" })).toBeNull();
    expect(calendarDate({ dueDate: "2027-02-30" })).toBeNull();
    expect(calendarDate({ dueDate: "2027-3-5" })).toBeNull();
    expect(calendarDate({ dueDate: "2028-02-29" })).toBe("2028-02-29");
  });
});

describe("task placement", () => {
  const model = buildCalendar({ rows, milestones: [], cal: { view: "month", date: TODAY }, todayIso: TODAY });
  const day = (d: string) => model.days.find((x) => x.date === d);

  it("puts each dated task on its due date only", () => {
    expect(ids(day("2027-03-01"))).toEqual(["late"]);
    expect(ids(day(TODAY))).toEqual(["today"]);
    const placed = model.days.flatMap((d) => d.entries.map((e) => e.row.task.id));
    expect(new Set(placed).size).toBe(placed.length); // never on two days
  });

  it("orders a day's tasks by urgency, then program order", () => {
    expect(ids(day("2027-03-12"))).toEqual(["soon", "skipped", "done"]);
    expect(day("2027-03-12")!.entries.map((e) => e.state)).toEqual(["upcoming", "completed", "completed"]);
  });

  it("includes neighbouring-month days in whole weeks, and places tasks there too", () => {
    expect(model.period).toEqual({ start: "2027-02-28", end: "2027-04-03", focusStart: "2027-03-01", focusEnd: "2027-03-31" });
    expect(model.weeks).toHaveLength(5);
    expect(model.weeks.every((w) => w.length === 7 && dayOfWeek(w[0].date) === 0)).toBe(true);
    expect(day("2027-04-02")).toMatchObject({ inFocus: false });
    expect(ids(day("2027-04-02"))).toEqual(["april"]);
  });

  it("lists tasks without a valid due date separately instead of dropping them", () => {
    expect(model.unscheduled.map((r) => r.task.id)).toEqual(["nodate", "garbage"]);
  });

  it("counts open overdue tasks that fall before the visible range", () => {
    expect(model.overdueBefore).toBe(1); // "longago"; "late" is visible
  });

  it("marks today", () => {
    expect(model.days.filter((d) => d.isToday).map((d) => d.date)).toEqual([TODAY]);
  });

  it("week view shows just that Sunday–Saturday week", () => {
    const week = buildCalendar({ rows, milestones: [], cal: { view: "week", date: TODAY }, todayIso: TODAY });
    expect(week.days.map((d) => d.date)).toEqual([
      "2027-03-07", "2027-03-08", "2027-03-09", "2027-03-10", "2027-03-11", "2027-03-12", "2027-03-13",
    ]);
    expect(week.days.flatMap((d) => d.entries.map((e) => e.row.task.id))).toEqual(["today", "soon", "skipped", "done"]);
    expect(week.overdueBefore).toBe(2); // "late" and "longago"
  });
});

describe("date and time-zone boundaries", () => {
  it("a week that crosses a daylight-saving change still has 7 days (US DST starts 2027-03-14)", () => {
    expect(periodFor("week", "2027-03-15")).toMatchObject({ start: "2027-03-14", end: "2027-03-20" });
    const days = placeOnDays([], [], periodFor("week", "2027-11-07"), TODAY); // DST ends 2027-11-07
    expect(days.map((d) => d.date)).toEqual([
      "2027-11-07", "2027-11-08", "2027-11-09", "2027-11-10", "2027-11-11", "2027-11-12", "2027-11-13",
    ]);
  });

  it("handles year and leap-year boundaries", () => {
    expect(periodFor("week", "2027-01-01")).toMatchObject({ start: "2026-12-27", end: "2027-01-02" });
    expect(periodTitle("week", "2027-01-01")).toBe("Dec 27, 2026 – Jan 2, 2027");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
    expect(endOfMonth("2027-02-10")).toBe("2027-02-28");
    expect(periodFor("month", "2028-02-15")).toMatchObject({ focusEnd: "2028-02-29" });
    expect(shiftPeriod("month", "2027-01-31", 1)).toBe("2027-02-01"); // never skips February
    expect(shiftPeriod("month", "2027-01-15", -1)).toBe("2026-12-01");
    expect(shiftPeriod("week", "2027-03-10", 1)).toBe("2027-03-14");
  });

  it("a task due on the first or last of the month lands in that month, not the one before/after", () => {
    const edge = [row(task({ id: "first", dueDate: "2027-05-01" })), row(task({ id: "last", dueDate: "2027-05-31" }))];
    const may = buildCalendar({ rows: edge, milestones: [], cal: { view: "month", date: "2027-05-20" }, todayIso: TODAY });
    expect(may.days.find((d) => d.date === "2027-05-01")!.entries.map((e) => e.row.task.id)).toEqual(["first"]);
    expect(may.days.find((d) => d.date === "2027-05-31")!.entries.map((e) => e.row.task.id)).toEqual(["last"]);
    expect(may.days.find((d) => d.date === "2027-05-01")!.inFocus).toBe(true);
  });

  it("does not depend on the process time zone", () => {
    const before = process.env.TZ;
    try {
      for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
        process.env.TZ = tz;
        expect(startOfWeek("2027-03-10")).toBe("2027-03-07");
        expect(periodTitle("month", "2027-03-01")).toBe("March 2027");
      }
    } finally {
      process.env.TZ = before;
    }
  });
});

describe("titles", () => {
  it.each([
    ["month", "2027-03-10", "March 2027"],
    ["week", "2027-03-10", "Mar 7 – 13, 2027"],
    ["week", "2027-03-01", "Feb 28 – Mar 6, 2027"],
  ] as const)("%s of %s", (view, date, expected) => {
    expect(periodTitle(view, date)).toBe(expected);
  });
});

describe("URL state", () => {
  it("defaults to this month and ignores invalid values", () => {
    expect(parseCalendarParams({}, TODAY)).toEqual({ view: "month", date: TODAY });
    expect(parseCalendarParams({ view: "year", date: "2027-02-30" }, TODAY)).toEqual({ view: "month", date: TODAY });
    expect(parseCalendarParams({ view: "week", date: "0001-01-01" }, TODAY)).toEqual({ view: "week", date: TODAY });
    expect(parseCalendarParams({ view: ["week", "month"], date: "2027-06-01" }, TODAY)).toEqual({ view: "week", date: "2027-06-01" });
  });

  it("keeps dashboard filters and leaves out defaults", () => {
    const cal = { view: "month" as const, date: TODAY };
    expect(calendarHref(f(), cal, TODAY)).toBe("/calendar");
    expect(calendarHref(f({ project: "pB", status: "open" }), cal, TODAY, { view: "week", date: "2027-04-01" })).toBe(
      "/calendar?project=pB&status=open&view=week&date=2027-04-01",
    );
  });

  it("switching views stays on today when it is in view", () => {
    expect(anchorForViewSwitch({ view: "month", date: "2027-03-25" }, TODAY)).toBe(TODAY);
    expect(anchorForViewSwitch({ view: "month", date: "2027-06-25" }, TODAY)).toBe("2027-06-01");
    expect(anchorForViewSwitch({ view: "week", date: "2027-06-25" }, TODAY)).toBe("2027-06-20");
  });
});

describe("program dates", () => {
  const projects = [
    { id: "pA", name: "Alpha", startDate: "2027-03-15", endDate: "2027-03-19", teamUserIds: ["u1"] },
    { id: "pB", name: "Bravo", startDate: "2027-03-20", endDate: null, teamUserIds: [] },
    { id: "pC", name: "Charlie", startDate: null, endDate: "bad", teamUserIds: [] },
    { id: "pD", name: "Delta", startDate: "2027-03-22", endDate: "2027-03-22", teamUserIds: [] },
  ];

  it("creates start/end milestones only for valid dates", () => {
    expect(projectMilestones(projects).map((m) => `${m.projectId}:${m.kind}:${m.date}`)).toEqual([
      "pA:start:2027-03-15", "pA:end:2027-03-19", "pB:start:2027-03-20", "pD:start:2027-03-22",
    ]);
  });

  it("follows scope and the program filter, and hides with task-only filters", () => {
    const ctx = { userId: "u1", tasksInScope: [{ projectId: "pB" }] };
    expect(milestoneProjects(projects, f(), ctx).map((p) => p.id)).toEqual(["pA", "pB"]); // team or has tasks
    expect(milestoneProjects(projects, f({ scope: "all" }), ctx).map((p) => p.id)).toEqual(["pA", "pB", "pC", "pD"]);
    expect(milestoneProjects(projects, f({ scope: "all", project: "pD" }), ctx).map((p) => p.id)).toEqual(["pD"]);
    for (const over of [{ status: "open" }, { due: "overdue" }, { q: "x" }, { scope: "all", assignee: "u1" }] as const)
      expect(milestoneProjects(projects, f(over), ctx)).toEqual([]);
  });

  it("are placed on their dates", () => {
    const m = buildCalendar({ rows: [], milestones: projectMilestones(projects), cal: { view: "week", date: "2027-03-15" }, todayIso: TODAY });
    expect(m.days.filter((d) => d.milestones.length).map((d) => [d.date, d.milestones.map((x) => x.kind)])).toEqual([
      ["2027-03-15", ["start"]], ["2027-03-19", ["end"]], ["2027-03-20", ["start"]],
    ]);
  });
});

describe("dashboard preview", () => {
  it("shows the next 7 days from today and counts what is off the strip", () => {
    const p = buildPreview(rows, [], TODAY);
    expect(p.days.map((d) => d.date)).toEqual([
      "2027-03-10", "2027-03-11", "2027-03-12", "2027-03-13", "2027-03-14", "2027-03-15", "2027-03-16",
    ]);
    expect(p.days[0].isToday).toBe(true);
    expect(ids(p.days[0])).toEqual(["today"]);
    expect(ids(p.days[2])).toEqual(["soon", "skipped", "done"]);
    expect(p.overdue).toBe(2);
    expect(p.unscheduled).toBe(2);
  });
});
