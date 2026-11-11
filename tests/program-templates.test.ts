/**
 * Acceptance tests for flexible program templates (sponsor feedback), run
 * against BOTH data stores: AirtableStore (through FakeAirtable) and the
 * in-memory development placeholder. The same behaviour is required of each.
 */
import { describe, expect, it } from "vitest";
import { AirtableClient } from "@/lib/airtable/client";
import { AIRTABLE_SCHEMA as S } from "@/lib/airtable/schema";
import { AirtableStore } from "@/lib/data/airtable-store";
import { MemoryStore } from "@/lib/data/memory-store";
import { SAMPLE_TEMPLATES } from "@/lib/data/sample-data";
import type { DataStore } from "@/lib/data/store";
import { generateTaskDrafts } from "@/lib/domain/generate-tasks";
import { nextOrder } from "@/lib/domain/program-edit";
import { buildTemplateFromProject } from "@/lib/domain/template-from-project";
import { FakeAirtable } from "./fake-airtable";

interface Setup {
  store: DataStore;
  ids: { admin: string; staff: string; site: string; template: string };
}

function airtableSetup(): Setup {
  const fake = new FakeAirtable([
    { table: S.tasks.table, field: S.tasks.fields.project, otherTable: S.projects.table, otherField: S.projects.fields.tasks },
    { table: S.tasks.table, field: S.tasks.fields.assignees, otherTable: S.users.table, otherField: S.users.fields.assignedTasks },
    { table: S.projects.table, field: S.projects.fields.team, otherTable: S.users.table, otherField: S.users.fields.projects },
    { table: S.steps.table, field: S.steps.fields.template, otherTable: S.templates.table, otherField: S.templates.fields.steps },
  ]);
  const U = S.users.fields;
  const admin = fake.seed(S.users.table, { [U.name]: "Jordan Ellis", [U.email]: "jordan@example.org", [U.accessLevel]: "Admin", [U.active]: true });
  const staff = fake.seed(S.users.table, { [U.name]: "Morgan Patel", [U.email]: "morgan@example.org", [U.accessLevel]: "Staff", [U.active]: true });
  const site = fake.seed(S.sites.table, { [S.sites.fields.name]: "Sample YMCA Branch" });
  const tpl = SAMPLE_TEMPLATES.find((t) => t.id === "tplYmca")!;
  const template = fake.seed(S.templates.table, { [S.templates.fields.name]: tpl.name, [S.templates.fields.active]: true });
  const F = S.steps.fields;
  const map = new Map<string, string>();
  for (const s of tpl.steps)
    map.set(s.id, fake.seed(S.steps.table, {
      [F.title]: s.title, [F.template]: [template], [F.order]: s.order, [F.phase]: s.phase, [F.offsetAmount]: s.offsetAmount,
      [F.offsetUnit]: s.offsetUnit, [F.timing]: s.timing, [F.anchor]: s.anchor, [F.defaultOwnerRoles]: s.defaultOwnerRoles,
    }));
  for (const s of tpl.steps) fake.get(S.steps.table, map.get(s.id)!)!.fields[F.dependsOn] = s.dependsOnStepIds.map((d) => map.get(d)!);
  const store = new AirtableStore(new AirtableClient({ token: "t", baseId: "appTEST", fetch: fake.fetch, minIntervalMs: 0, retryDelaysMs: [] }));
  return { store, ids: { admin, staff, site, template } };
}

function memorySetup(): Setup {
  return { store: new MemoryStore(undefined, false), ids: { admin: "usrJordan", staff: "usrMorgan", site: "siteY", template: "tplYmca" } };
}

describe.each([
  ["AirtableStore (fake API)", airtableSetup],
  ["MemoryStore (placeholder)", memorySetup],
])("flexible program templates — %s", (_name, setup) => {
  async function createProgram({ store, ids }: Setup, name: string, startDate: string) {
    const template = (await store.getTemplate(ids.template))!;
    const { drafts } = generateTaskDrafts({ steps: template.steps, startDate, endDate: null, roleAssignments: { "Operations Director": [ids.staff] } });
    return store.createProjectWithTasks({ name, siteId: ids.site, templateId: ids.template, startDate, endDate: null, teamUserIds: [ids.staff], createdByUserId: ids.admin }, drafts);
  }
  const snapshot = (x: unknown) => JSON.parse(JSON.stringify(x));

  it("two programs from one template get independent copies of every activity", async () => {
    const env = setup();
    const a = await createProgram(env, "Program A", "2027-04-15");
    const b = await createProgram(env, "Program B", "2027-09-01");
    expect(a.taskIds).toHaveLength(8);
    expect(b.taskIds).toHaveLength(8);
    expect(a.taskIds.some((id) => b.taskIds.includes(id))).toBe(false);
  });

  it("adding, editing, reordering and removing in Program A leaves Program B and the template unchanged", async () => {
    const env = setup();
    const { store, ids } = env;
    const a = await createProgram(env, "Program A", "2027-04-15");
    const b = await createProgram(env, "Program B", "2027-09-01");
    const templateBefore = snapshot(await store.getTemplate(ids.template));
    const bBefore = snapshot(await store.getTasksByIds(b.taskIds));

    const aTasks = await store.getTasksByIds(a.taskIds);
    const address = aTasks.find((t) => t.title === "Confirm shipping address")!;
    const ship = aTasks.find((t) => t.title === "Ship curriculum materials")!;

    // Add a task that depends on an existing one
    const added = await store.createTask({
      projectId: a.id, order: nextOrder(aTasks), title: "Book lifeguards for Program A", description: "Only this site needs it",
      phase: "Pre-launch", dueDate: "2027-04-01", ownerRole: "Operations Director", assigneeIds: [ids.staff], dependsOnTaskIds: [address.id],
    });
    // Edit an existing task
    await store.updateTaskDetails(ship.id, { ...ship, title: "Ship curriculum + caps", dueDate: "2027-03-20", dependsOnTaskIds: [address.id, added.id] });
    // Reorder
    await store.reorderTasks([{ id: ship.id, order: 1 }, { id: address.id, order: 2 }]);
    // Remove a task others depend on
    await store.deleteTask(address.id);

    const aAfter = await store.getTasksByIds((await store.getProject(a.id))!.taskIds);
    expect(aAfter).toHaveLength(8); // 8 + 1 added − 1 removed
    expect(aAfter.some((t) => t.id === address.id)).toBe(false);
    const shipAfter = aAfter.find((t) => t.id === ship.id)!;
    expect(shipAfter).toMatchObject({ title: "Ship curriculum + caps", dueDate: "2027-03-20", order: 1, status: "Not Started" });
    expect(shipAfter.dependsOnTaskIds).toEqual([added.id]); // link to the removed task was cleaned up
    expect(aAfter.find((t) => t.id === added.id)).toMatchObject({ assigneeIds: [ids.staff], dependsOnTaskIds: [] });

    // Program B and the template are untouched
    expect(snapshot(await store.getTasksByIds(b.taskIds))).toEqual(bBefore);
    expect(snapshot(await store.getTemplate(ids.template))).toEqual(templateBefore);
  });

  it("status, ownership, due dates and dependencies keep working after edits", async () => {
    const env = setup();
    const { store, ids } = env;
    const a = await createProgram(env, "Program A", "2027-04-15");
    const tasks = await store.getTasksByIds(a.taskIds);
    const ship = tasks.find((t) => t.title === "Ship curriculum materials")!;
    await store.updateTaskDetails(ship.id, { ...ship, assigneeIds: [ids.admin, ids.staff] });
    const done = await store.updateTask(ship.id, { status: "Done" });
    expect(done.status).toBe("Done");
    expect(done.completedAt).not.toBeNull();
    const reread = (await store.getTask(ship.id))!;
    expect(reread.assigneeIds.sort()).toEqual([ids.admin, ids.staff].sort());
    expect(reread.dependsOnTaskIds).toHaveLength(1);
    expect(reread.dueDate).toBe(ship.dueDate);
  });

  it("saves a program as a new template, which can then be reused", async () => {
    const env = setup();
    const { store, ids } = env;
    const a = await createProgram(env, "Program A", "2027-04-15");
    let aTasks = await store.getTasksByIds(a.taskIds);
    const address = aTasks.find((t) => t.title === "Confirm shipping address")!;
    await store.createTask({
      projectId: a.id, order: nextOrder(aTasks), title: "Book lifeguards", description: "", phase: "Pre-launch",
      dueDate: "2027-04-01", ownerRole: "Operations Director", assigneeIds: [ids.staff], dependsOnTaskIds: [address.id],
    });
    await store.updateTask(address.id, { notes: "Private note about the site contact" });
    const roster = aTasks.find((t) => t.title === "Receive final participant roster from YMCA")!;
    await store.updateTask(roster.id, { status: "Not Needed" });
    const templateBefore = snapshot(await store.getTemplate(ids.template));

    const project = (await store.getProject(a.id))!;
    aTasks = await store.getTasksByIds(project.taskIds);
    const original = (await store.getTemplate(ids.template))!;
    const { steps } = buildTemplateFromProject(project, aTasks, original.steps);
    const saved = await store.createTemplate({ name: "YMCA + lifeguards", programType: "Learn to Swim", description: "Saved from Program A" }, steps);

    expect(saved.id).not.toBe(ids.template);
    expect(saved.steps).toHaveLength(8); // 9 tasks − 1 Not Needed
    const lifeguards = saved.steps.find((s) => s.title === "Book lifeguards")!;
    expect(lifeguards).toMatchObject({ offsetAmount: 2, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start", defaultOwnerRoles: ["Operations Director"], defaultAssigneeIds: [] });
    expect(lifeguards.dependsOnStepIds.map((d) => saved.steps.find((s) => s.id === d)!.title)).toEqual(["Confirm shipping address"]);
    expect(JSON.stringify(saved)).not.toContain("Private note");
    // Original template untouched
    expect(snapshot(await store.getTemplate(ids.template))).toEqual(templateBefore);

    // Reuse it for a new program
    const { drafts } = generateTaskDrafts({ steps: saved.steps, startDate: "2028-01-10", endDate: null });
    const c = await store.createProjectWithTasks({ name: "Program C", siteId: ids.site, templateId: saved.id, startDate: "2028-01-10", endDate: null, teamUserIds: [], createdByUserId: ids.admin }, drafts);
    const cTasks = await store.getTasksByIds(c.taskIds);
    expect(cTasks).toHaveLength(8);
    const cLife = cTasks.find((t) => t.title === "Book lifeguards")!;
    expect(cLife.dueDate).toBe("2027-12-27");
    expect(cLife.dependsOnTaskIds.map((d) => cTasks.find((t) => t.id === d)!.title)).toEqual(["Confirm shipping address"]);
    expect(cTasks.every((t) => t.status === "Not Started" && t.notes === "")).toBe(true);
  });
});
