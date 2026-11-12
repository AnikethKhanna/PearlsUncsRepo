/**
 * Permissions for dashboard-style views (My Tasks and the Calendar both load
 * through loadTasksInScope), checked against the in-memory store.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/data/memory-store";
import { loadTasksInScope } from "@/lib/data/task-scope";
import { buildCalendar, milestoneProjects, projectMilestones } from "@/lib/domain/calendar";
import { DEFAULT_FILTERS, parseFilters } from "@/lib/domain/task-dashboard";
import type { TaskDraft, User } from "@/lib/domain/types";

const ADMIN = "usrJordan";
const SAM = "usrSam"; // Staff
const MORGAN = "usrMorgan"; // Staff
const PARTNER = "usrPartner";
const INACTIVE = "usrInactive";

const draft = (key: string, assigneeIds: string[], dueDate: string): TaskDraft => ({
  key, templateStepId: key, title: key, description: "", ownerRole: "", assigneeIds, phase: "", order: 1, dueDate, dependsOnKeys: [],
});

let store: MemoryStore;
let taskId: Record<string, string>;

beforeEach(() => {
  store = new MemoryStore(undefined, false);
  const make = (name: string, start: string, team: string[], drafts: TaskDraft[]) =>
    store.insertProject(
      { name, siteId: "siteUW", templateId: "tplCollegiate", startDate: start, endDate: "2027-03-28", teamUserIds: team, createdByUserId: ADMIN },
      drafts,
    );
  const a = make("Alpha", "2027-03-25", [SAM, MORGAN], [
    draft("samA", [SAM], "2027-03-10"),
    draft("morganA", [MORGAN], "2027-03-12"),
    draft("sharedA", [SAM, MORGAN], "2027-03-15"),
    draft("partnerA", [PARTNER], "2027-03-16"),
    draft("nobodyA", [], "2027-03-17"),
  ]);
  const b = make("Bravo (finished)", "2027-01-01", [SAM], [draft("samB", [SAM], "2027-03-11")]);
  store.seedProjectStatus(b.id, "Completed");
  const c = make("Charlie", "2027-03-26", [MORGAN], [draft("morganC", [MORGAN], "2027-03-13")]);
  const all = [...store.tasksOf(a.id), ...store.tasksOf(b.id), ...store.tasksOf(c.id)];
  taskId = Object.fromEntries(all.map((t) => [t.title, t.id]));
});

const userFor = async (id: string) => (await store.getUser(id)) as User;
const titles = async (id: string, scope: "mine" | "all") =>
  (await loadTasksInScope(store, await userFor(id), scope)).tasks.map((t) => t.title).sort();

describe("which tasks each person gets", () => {
  it("staff get only tasks assigned to them, in active programs", async () => {
    expect(await titles(SAM, "mine")).toEqual(["sharedA", "samA"].sort());
    expect(await titles(MORGAN, "mine")).toEqual(["morganA", "morganC", "sharedA"]);
  });

  it("staff can't widen the scope by editing the URL", async () => {
    const sam = await userFor(SAM);
    expect(parseFilters({ scope: "all" }, { canSeeEveryone: false }).scope).toBe("mine");
    // even if "all" reached the loader, per-task permission checks still apply
    expect(await titles(SAM, "all")).toEqual(["sharedA", "samA"].sort());
    expect((await loadTasksInScope(store, sam, "all")).projects.map((p) => p.name)).toEqual(["Alpha"]);
  });

  it("staff don't see programs they only have tasks in after they're finished", async () => {
    expect((await titles(SAM, "mine")).includes("samB")).toBe(false);
  });

  it("admins see everyone's tasks in every active program, or just their own", async () => {
    expect(await titles(ADMIN, "all")).toEqual(["morganA", "morganC", "nobodyA", "partnerA", "samA", "sharedA"]);
    expect(await titles(ADMIN, "mine")).toEqual([]);
  });

  it("partners and inactive users get nothing, even when assigned", async () => {
    expect(await titles(PARTNER, "mine")).toEqual([]);
    expect(await titles(PARTNER, "all")).toEqual([]);
    const inactive = { ...(await userFor(INACTIVE)), assignedTaskIds: [taskId.samA] };
    expect((await loadTasksInScope(store, inactive, "all")).tasks).toEqual([]);
  });
});

describe("calendar respects permissions", () => {
  const calendarFor = async (id: string, scope: "mine" | "all") => {
    const user = await userFor(id);
    const scoped = await loadTasksInScope(store, user, scope);
    const f = { ...DEFAULT_FILTERS, scope };
    const milestones = projectMilestones(milestoneProjects(scoped.projects, f, { userId: user.id, tasksInScope: scoped.tasks }));
    return buildCalendar({ rows: scoped.rows, milestones, cal: { view: "month", date: "2027-03-01" }, todayIso: "2027-03-01" });
  };
  const placed = (m: Awaited<ReturnType<typeof calendarFor>>) =>
    Object.fromEntries(m.days.filter((d) => d.entries.length).map((d) => [d.date, d.entries.map((e) => e.row.task.title)]));
  const programDates = (m: Awaited<ReturnType<typeof calendarFor>>) =>
    m.days.flatMap((d) => d.milestones.map((x) => `${x.projectName} ${x.kind}`));

  it("a staff member's calendar shows only their tasks and their programs' dates", async () => {
    const m = await calendarFor(SAM, "mine");
    expect(placed(m)).toEqual({ "2027-03-10": ["samA"], "2027-03-15": ["sharedA"] });
    expect(programDates(m)).toEqual(["Alpha start", "Alpha end"]);
  });

  it("an admin's everyone view shows every visible task on its date", async () => {
    const m = await calendarFor(ADMIN, "all");
    expect(placed(m)).toEqual({
      "2027-03-10": ["samA"], "2027-03-12": ["morganA"], "2027-03-13": ["morganC"],
      "2027-03-15": ["sharedA"], "2027-03-16": ["partnerA"], "2027-03-17": ["nobodyA"],
    });
    expect(programDates(m)).toEqual(["Alpha start", "Charlie start", "Alpha end", "Charlie end"]);
    expect(programDates(m).some((x) => x.startsWith("Bravo"))).toBe(false); // finished program
  });

  it("shows a task with its due date cleared under 'No due date', with the same permissions", async () => {
    const t = (await store.getTask(taskId.samA))!;
    await store.updateTaskDetails(t.id, { ...t, dueDate: null });
    expect((await calendarFor(SAM, "mine")).unscheduled.map((r) => r.task.title)).toEqual(["samA"]);
    expect((await calendarFor(MORGAN, "mine")).unscheduled).toEqual([]);
  });
});
