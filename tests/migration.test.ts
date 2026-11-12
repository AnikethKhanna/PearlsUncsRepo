import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/data/memory-store";
import {
  MIGRATION_FIELD,
  fingerprint,
  planMigration,
  verifyMigration,
  type SourceSnapshot,
} from "@/lib/migration/airtable-to-firestore";

async function snapshot(): Promise<SourceSnapshot> {
  const store = new MemoryStore(); // includes the three sample projects
  const projects = await store.listProjects();
  return {
    users: await store.listUsers(),
    sites: await store.listSites(),
    templates: await store.listTemplates(),
    projects,
    tasks: await store.getTasksByIds(projects.flatMap((p) => p.taskIds)),
  };
}

describe("planMigration (dry run)", () => {
  it("plans one document per record, keeping the original IDs", async () => {
    const src = await snapshot();
    const plan = planMigration(src);
    expect(plan.counts).toMatchObject({
      users: src.users.length,
      sites: src.sites.length,
      templates: src.templates.length,
      templateSteps: src.templates.reduce((n, t) => n + t.steps.length, 0),
      projects: src.projects.length,
      tasks: src.tasks.length,
    });
    expect(plan.writes.find((w) => w.collection === "users" && w.id === "usrJordan")?.data).toMatchObject({
      email: "jordan@example.org",
      accessLevel: "Admin",
    });
    expect(plan.problems.filter((p) => p.severity === "error")).toEqual([]);
  });

  it("blocks the migration when two active users share an email", async () => {
    const src = await snapshot();
    src.users.push({ ...src.users[0], id: "usrDuplicate" });
    const plan = planMigration(src);
    expect(plan.problems).toContainEqual(expect.objectContaining({ severity: "error", message: expect.stringContaining("share the email") }));
  });

  it("warns about dangling links instead of silently dropping them", async () => {
    const src = await snapshot();
    src.tasks[0] = { ...src.tasks[0], assigneeIds: ["recGone"], dependsOnTaskIds: ["recMissing"] };
    const messages = planMigration(src).problems.map((p) => p.message);
    expect(messages.some((m) => m.includes("missing user recGone"))).toBe(true);
    expect(messages.some((m) => m.includes("missing task recMissing"))).toBe(true);
  });
});

describe("verifyMigration", () => {
  it("passes when Firestore matches, ignoring migration tags and timestamps", async () => {
    const plan = planMigration(await snapshot());
    const actual = new Map(
      plan.writes.map((w) => [`${w.collection}/${w.id}`, { ...w.data, [MIGRATION_FIELD]: { runId: "r1" }, updatedAt: "now" }]),
    );
    expect(verifyMigration(plan, actual)).toMatchObject({ ok: true, missing: [], different: [] });
  });

  it("reports missing, changed and extra documents", async () => {
    const plan = planMigration(await snapshot());
    const actual = new Map(plan.writes.map((w) => [`${w.collection}/${w.id}`, { ...w.data }]));
    const [a, b] = plan.writes;
    actual.delete(`${a.collection}/${a.id}`);
    actual.set(`${b.collection}/${b.id}`, { ...b.data, name: "Changed" });
    actual.set("tasks/extra", { title: "new" });
    const report = verifyMigration(plan, actual);
    expect(report).toMatchObject({ ok: false, missing: [`${a.collection}/${a.id}`], different: [`${b.collection}/${b.id}`], extra: ["tasks/extra"] });
  });

  it("fingerprints are independent of key order", () => {
    expect(fingerprint({ a: 1, b: { y: 2, x: 1 } })).toBe(fingerprint({ b: { x: 1, y: 2 }, a: 1 }));
  });
});
