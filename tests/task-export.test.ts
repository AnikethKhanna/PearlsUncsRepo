import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/data/memory-store";
import { ExportAccessError, loadTaskExport, taskExportCsv } from "@/lib/data/task-export";
import { loadTasksInScope } from "@/lib/data/task-scope";
import { applyFilters, parseFilters, SORTS, sortRows } from "@/lib/domain/task-dashboard";
import type { TaskDraft, User } from "@/lib/domain/types";

let store: MemoryStore;
let alpha: string;
const now = "2027-03-15";
const draft = (title: string, assigneeIds: string[], dueDate: string, dependsOnKeys: string[] = []): TaskDraft => ({
  key: title, templateStepId: title, title, description: "Description", ownerRole: "Program Manager", assigneeIds,
  phase: "Pre-launch", order: 1, dueDate, dependsOnKeys,
});
const user = async (id = "usrJordan") => (await store.getUser(id)) as User;
beforeEach(() => {
  store = new MemoryStore(undefined, false);
  const make = (name: string, drafts: TaskDraft[]) => store.insertProject({ name, siteId: "siteUW", templateId: "tplCollegiate", startDate: "2027-04-01", endDate: "2027-05-01", teamUserIds: ["usrSam", "usrMorgan"], createdByUserId: "usrJordan" }, drafts);
  alpha = make("Alpha", [draft("Zebra public", ["usrSam"], "2027-03-10", ["Secret prerequisite"]), draft("Secret prerequisite", ["usrMorgan"], "2027-03-09"), draft("Apple public", ["usrSam"], "2027-03-16"), draft("Unassigned", [], "2027-04-01")]).id;
  make("Beta", [draft("Beta work", ["usrMorgan"], "2027-03-17")]);
  const closed = make("Closed program", [draft("Completed program secret", ["usrSam"], "2027-03-01")]);
  store.seedProjectStatus(closed.id, "Completed");
});

describe("task exports share the dashboard boundary", () => {
  it("exports all authorized active-program tasks with cleared filters and everyone scope", async () => {
    const { report } = await loadTaskExport(store, await user(), "scope=all", now);
    expect(report.rows).toHaveLength(5);
    expect(JSON.stringify(report)).not.toContain("Completed program secret");
    expect(report.headers).toContain("Days Overdue");
  });
  it("forces staff to own tasks even with tampered scope/assignee and never leaks prerequisite details", async () => {
    const { report, filters } = await loadTaskExport(store, await user("usrSam"), "scope=all&assignee=usrMorgan", now);
    expect(filters.scope).toBe("mine");
    expect(report.rows.map((r) => r[0])).toEqual(["Zebra public", "Apple public"]);
    expect(JSON.stringify(report)).not.toContain("Secret prerequisite");
    expect(report.rows[0][11]).toBe("Yes"); // state only, not the hidden prerequisite title
    expect(report.rows[0][5]).toBe(5);
    expect(report.rows[1][5]).toBe(0);
  });
  it.each(["usrPartner", "usrInactive"])("denies %s", async (id) => {
    await expect(loadTaskExport(store, await user(id), "scope=all", now)).rejects.toBeInstanceOf(ExportAccessError);
  });
  it("denies unauthenticated users", async () => {
    await expect(loadTaskExport(store, null, "", now)).rejects.toBeInstanceOf(ExportAccessError);
  });
  it("applies project, status, due, assignee and search together", async () => {
    const query = new URLSearchParams({ scope: "all", project: alpha, status: "blocked", due: "overdue", assignee: "usrSam", q: "PUBLIC", sort: "title" });
    expect((await loadTaskExport(store, await user(), query.toString(), now)).report.rows.map((r) => r[0])).toEqual(["Zebra public"]);
    expect((await loadTaskExport(store, await user("usrSam"), "project=unknown", now)).report.rows).toEqual([]);
  });
  it.each(SORTS)("preserves dashboard %s sort over the complete filtered result", async (sort) => {
    const actor = await user();
    const q = new URLSearchParams({ scope: "all", sort, status: "open" });
    const filters = parseFilters(Object.fromEntries(q), { canSeeEveryone: true });
    const scoped = await loadTasksInScope(store, actor, filters.scope);
    const expected = sortRows(applyFilters(scoped.rows, filters, now), sort).map((r) => r.task.title);
    expect((await loadTaskExport(store, actor, q.toString(), now)).report.rows.map((r) => r[0])).toEqual(expected);
  });
  it("exports missing dates and completed tasks without overdue days", async () => {
    const t = store.tasksOf(alpha)[0];
    await store.updateTask(t.id, { status: "Done" });
    const { report } = await loadTaskExport(store, await user(), "scope=all&status=Done", now);
    expect(report.rows[0][5]).toBe(0);
    await store.updateTaskDetails(t.id, { ...t, dueDate: null });
    expect((await loadTaskExport(store, await user(), "scope=all&due=none", now)).report.rows[0][4]).toBe("");
  });
  it("quotes CSV separators/newlines and neutralizes spreadsheet formulas", () => {
    const csv = taskExportCsv({ title: "x", headers: ["Name"], rows: [['=IMPORTXML("evil")'], ["  +cmd"], ['a,"b"\nc'], [5]] });
    expect(csv).toContain(`"'=IMPORTXML(""evil"")"`);
    expect(csv).toContain(`"'  +cmd"`);
    expect(csv).toContain('"a,""b""\nc"');
    expect(csv).toContain('"5"');
  });
});
