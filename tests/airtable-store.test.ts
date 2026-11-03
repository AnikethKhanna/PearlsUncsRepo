/**
 * Exercises the real AirtableStore + AirtableClient against FakeAirtable.
 * This verifies request shapes, batching and field mapping, but NOT the real
 * Airtable service — run `npm run airtable:inspect` against NMU's base for that.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AirtableClient } from "@/lib/airtable/client";
import { AIRTABLE_SCHEMA as S } from "@/lib/airtable/schema";
import { AirtableStore } from "@/lib/data/airtable-store";
import { SAMPLE_TEMPLATES } from "@/lib/data/sample-data";
import { generateTaskDrafts } from "@/lib/domain/generate-tasks";
import { FakeAirtable } from "./fake-airtable";

let fake: FakeAirtable;
let store: AirtableStore;
let ids: { admin: string; staff: string; site: string; template: string };

beforeEach(() => {
  fake = new FakeAirtable([
    { table: S.tasks.table, field: S.tasks.fields.project, otherTable: S.projects.table, otherField: S.projects.fields.tasks },
    { table: S.tasks.table, field: S.tasks.fields.assignees, otherTable: S.users.table, otherField: S.users.fields.assignedTasks },
    { table: S.projects.table, field: S.projects.fields.team, otherTable: S.users.table, otherField: S.users.fields.projects },
    { table: S.steps.table, field: S.steps.fields.template, otherTable: S.templates.table, otherField: S.templates.fields.steps },
  ]);
  const U = S.users.fields;
  const admin = fake.seed(S.users.table, { [U.name]: "Avery Admin", [U.email]: " Admin@Example.org", [U.accessLevel]: "Admin", [U.active]: true });
  const staff = fake.seed(S.users.table, { [U.name]: "Sam Staff", [U.email]: "staff@example.org", [U.accessLevel]: "Staff", [U.active]: true });
  const site = fake.seed(S.sites.table, { [S.sites.fields.name]: "Sample University Pool" });

  // Copy the sample collegiate template into the fake base (steps first without deps, then deps)
  const tpl = SAMPLE_TEMPLATES[0];
  const template = fake.seed(S.templates.table, { [S.templates.fields.name]: tpl.name, [S.templates.fields.active]: true });
  const F = S.steps.fields;
  const stepIdMap = new Map<string, string>();
  for (const s of tpl.steps) {
    stepIdMap.set(s.id, fake.seed(S.steps.table, {
      [F.title]: s.title, [F.template]: [template], [F.order]: s.order, [F.phase]: s.phase,
      [F.offsetAmount]: s.offsetAmount, [F.offsetUnit]: s.offsetUnit, [F.timing]: s.timing, [F.anchor]: s.anchor,
      [F.defaultOwnerRole]: s.defaultOwnerRole,
    }));
  }
  for (const s of tpl.steps) fake.get(S.steps.table, stepIdMap.get(s.id)!)!.fields[F.dependsOn] = s.dependsOnStepIds.map((d) => stepIdMap.get(d)!);

  store = new AirtableStore(new AirtableClient({ token: "test-token", baseId: "appTEST", fetch: fake.fetch, minIntervalMs: 0, retryDelaysMs: [] }));
  ids = { admin, staff, site, template };
});

describe("AirtableStore", () => {
  it("finds users by email case-insensitively and maps access level", async () => {
    const u = await store.getUserByEmail("ADMIN@example.org");
    expect(u).toMatchObject({ id: ids.admin, accessLevel: "Admin", active: true, email: "admin@example.org" });
    expect(await store.getUserByEmail("nobody@example.org")).toBeNull();
  });

  it("loads templates with steps and dependencies", async () => {
    const t = await store.getTemplate(ids.template);
    expect(t?.steps).toHaveLength(SAMPLE_TEMPLATES[0].steps.length);
    const ship = t!.steps.find((s) => s.title === "Ship program supplies")!;
    expect(ship.dependsOnStepIds).toHaveLength(2);
    expect(ship).toMatchObject({ offsetAmount: 3, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start" });
  });

  it("creates a project with generated tasks, dependencies, and a status that persists", async () => {
    const template = (await store.getTemplate(ids.template))!;
    const { drafts } = generateTaskDrafts({
      steps: template.steps, startDate: "2027-04-15", endDate: "2027-05-20",
      roleAssignments: { "Program Manager": [ids.staff] },
    });

    const project = await store.createProjectWithTasks(
      { name: "Spring 2027 – Sample U", siteId: ids.site, templateId: ids.template, startDate: "2027-04-15", endDate: "2027-05-20", teamUserIds: [ids.staff], createdByUserId: ids.admin },
      drafts,
    );

    // Batching respected: 11 tasks → 2 create requests (10 + 1)
    const taskCreates = fake.requests.filter((r) => r.method === "POST" && r.table === S.tasks.table);
    expect(taskCreates.map((r) => r.count)).toEqual([10, 1]);

    expect(project).toMatchObject({ name: "Spring 2027 – Sample U", status: "Planning", siteName: "Sample University Pool", templateName: template.name, startDate: "2027-04-15" });
    expect(project.taskIds).toHaveLength(11);
    expect(project.teamUserIds.sort()).toEqual([ids.admin, ids.staff].sort());

    const tasks = await store.getTasksByIds(project.taskIds);
    const ship = tasks.find((t) => t.title === "Ship program supplies")!;
    expect(ship.dueDate).toBe("2027-03-25");
    expect(ship.status).toBe("Not Started");
    expect(ship.dependsOnTaskIds.map((id) => tasks.find((t) => t.id === id)!.title).sort()).toEqual(["Confirm participant quantities", "Confirm shipping address"]);
    expect(tasks.find((t) => t.title === "Open family registration (NMU-managed)")!.assigneeIds).toEqual([ids.staff]);

    // Staff user's inverse links now include the project and their tasks (used for access checks)
    const staff = (await store.getUser(ids.staff))!;
    expect(staff.projectIds).toEqual([project.id]);
    expect(staff.assignedTaskIds.length).toBeGreaterThan(0);

    // Status change persists (re-read from "Airtable")
    await store.updateTask(ship.id, { status: "Done" });
    const reread = (await store.getTask(ship.id))!;
    expect(reread.status).toBe("Done");
    expect(reread.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await store.updateTask(ship.id, { status: "In Progress" });
    expect((await store.getTask(ship.id))!.completedAt).toBeNull();
  });

  it("does not modify template records when creating projects", async () => {
    const before = JSON.stringify(fake.all(S.steps.table).map((r) => ({ ...r, fields: { ...r.fields } })));
    const template = (await store.getTemplate(ids.template))!;
    const { drafts } = generateTaskDrafts({ steps: template.steps, startDate: "2027-04-15", endDate: null });
    await store.createProjectWithTasks({ name: "P", siteId: ids.site, templateId: ids.template, startDate: "2027-04-15", endDate: null, teamUserIds: [], createdByUserId: ids.admin }, drafts);
    // Only inverse "Tasks generated from this step" style links could change; core step fields must not.
    expect(fake.requests.some((r) => r.method !== "GET" && r.table === S.steps.table)).toBe(false);
    expect(fake.requests.some((r) => r.method !== "GET" && r.table === S.templates.table)).toBe(false);
    expect(before.length).toBeGreaterThan(0);
  });

  it("leaves the project in 'Setting Up' if task creation fails", async () => {
    const template = (await store.getTemplate(ids.template))!;
    const { drafts } = generateTaskDrafts({ steps: template.steps, startDate: "2027-04-15", endDate: null });
    const failing = new AirtableStore(new AirtableClient({
      token: "t", baseId: "appTEST", minIntervalMs: 0, retryDelaysMs: [],
      fetch: async (url, init) =>
        init?.method === "POST" && url.includes(encodeURIComponent(S.tasks.table))
          ? new Response(JSON.stringify({ error: { type: "SERVER_ERROR" } }), { status: 500 })
          : fake.fetch(url, init),
    }));
    await expect(
      failing.createProjectWithTasks({ name: "Broken", siteId: ids.site, templateId: ids.template, startDate: "2027-04-15", endDate: null, teamUserIds: [], createdByUserId: ids.admin }, drafts),
    ).rejects.toThrow(/Airtable request failed \(500\)/);
    const projects = await store.listProjects();
    expect(projects.find((p) => p.name === "Broken")?.status).toBe("Setting Up");
  });
});

describe("AirtableClient", () => {
  it("retries on 429 and then succeeds", async () => {
    let calls = 0;
    const client = new AirtableClient({
      token: "t", baseId: "app", minIntervalMs: 0, retryDelaysMs: [1, 1],
      fetch: async () => (++calls < 3 ? new Response("{}", { status: 429 }) : new Response(JSON.stringify({ records: [] }), { status: 200 })),
    });
    expect(await client.list("Users")).toEqual([]);
    expect(calls).toBe(3);
  });

  it("never includes the token in error messages", async () => {
    const client = new AirtableClient({
      token: "patSECRET123", baseId: "app", minIntervalMs: 0, retryDelaysMs: [],
      fetch: async () => new Response(JSON.stringify({ error: { type: "INVALID_PERMISSIONS", message: "nope" } }), { status: 403 }),
    });
    const err = await client.list("Users").catch((e: Error) => e);
    expect(String(err)).not.toContain("patSECRET123");
    expect(String(err)).toContain("403");
  });
});
