/**
 * The real FirestoreStore against the Firestore emulator: the same workflow
 * the app runs (create project → tasks → status update → read back).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { FirestoreStore, MAX_WRITES_PER_BATCH } from "@/lib/data/firestore-store";
import { generateTaskDrafts, rolesForSteps } from "@/lib/domain/generate-tasks";
import { today } from "@/lib/domain/dates";
import type { TaskDraft } from "@/lib/domain/types";
import { admin, clearFirestore, seedReferenceData } from "./emulator-helpers";

let store: FirestoreStore;

beforeEach(async () => {
  await clearFirestore();
  await seedReferenceData();
  store = new FirestoreStore(admin().db);
});

async function createCollegiateProject() {
  const template = (await store.getTemplate("tplCollegiate"))!;
  const roleAssignments = Object.fromEntries(rolesForSteps(template.steps).map((r) => [r, ["usrSam"]]));
  const { drafts } = generateTaskDrafts({ steps: template.steps, startDate: "2027-04-15", endDate: "2027-04-19", roleAssignments });
  const project = await store.createProjectWithTasks(
    { name: "Fall Swim", siteId: "siteUW", templateId: "tplCollegiate", startDate: "2027-04-15", endDate: "2027-04-19", teamUserIds: ["usrSam"], createdByUserId: "usrJordan" },
    drafts,
  );
  return { project, drafts };
}

describe("FirestoreStore", () => {
  it("reads users by email (case-insensitive) with derived links", async () => {
    const { project } = await createCollegiateProject();
    const sam = await store.getUserByEmail(" SAM@example.org ");
    expect(sam).toMatchObject({ id: "usrSam", accessLevel: "Staff", active: true, projectIds: [project.id] });
    expect(sam!.assignedTaskIds).toHaveLength(project.taskIds.length);
    expect(await store.getUserByEmail("nobody@example.org")).toBeNull();
    const all = await store.listUsers();
    expect(all.find((u) => u.id === "usrSam")!.assignedTaskIds).toHaveLength(project.taskIds.length);
  });

  it("lists sites and templates with their steps in order", async () => {
    expect((await store.listSites()).map((s) => s.id).sort()).toEqual(["siteUW", "siteY"]);
    const templates = await store.listTemplates({ activeOnly: true });
    const collegiate = templates.find((t) => t.id === "tplCollegiate")!;
    expect(collegiate.steps.length).toBeGreaterThan(100);
    expect(collegiate.steps.map((s) => s.order)).toEqual([...collegiate.steps.map((s) => s.order)].sort((a, b) => a - b));
  });

  it("creates a project and all tasks atomically, with dependencies wired", async () => {
    const template = (await store.getTemplate("tplYmca"))!;
    const { drafts } = generateTaskDrafts({ steps: template.steps, startDate: "2027-04-15", endDate: "2027-05-20" });
    const project = await store.createProjectWithTasks(
      { name: "Learn to Swim", siteId: "siteY", templateId: "tplYmca", startDate: "2027-04-15", endDate: "2027-05-20", teamUserIds: [], createdByUserId: "usrJordan" },
      drafts,
    );
    expect(project).toMatchObject({ status: "Planning", siteName: "Sample YMCA Branch", templateName: template.name });
    expect(project.teamUserIds).toEqual(["usrJordan"]);
    const tasks = await store.getTasksByIds(project.taskIds);
    expect(tasks).toHaveLength(drafts.length);
    const byStep = new Map(tasks.map((t) => [t.templateStepId, t]));
    for (const d of drafts) {
      const t = byStep.get(d.templateStepId)!;
      expect(t).toMatchObject({ projectId: project.id, dueDate: d.dueDate, status: "Not Started" });
      expect(t.dependsOnTaskIds.sort()).toEqual(d.dependsOnKeys.map((k) => byStep.get(k)!.id).sort());
    }
  });

  it("denormalizes assignees on the project for the security rules", async () => {
    const { project } = await createCollegiateProject();
    const doc = (await admin().db.collection("projects").doc(project.id).get()).data()!;
    expect(doc.assigneeUserIds).toEqual(["usrSam"]);
  });

  it("splits very large projects into several batches and still finishes in Planning", async () => {
    const drafts: TaskDraft[] = Array.from({ length: MAX_WRITES_PER_BATCH + 20 }, (_, i) => ({
      key: `k${i}`, templateStepId: `s${i}`, title: `Task ${i}`, description: "", ownerRole: "", assigneeIds: [],
      phase: "", order: i, dueDate: "2027-01-01", dependsOnKeys: i ? [`k${i - 1}`] : [],
    }));
    const project = await store.createProjectWithTasks(
      { name: "Huge", siteId: "siteUW", templateId: "tplCollegiate", startDate: "2027-04-15", endDate: null, teamUserIds: [], createdByUserId: "usrJordan" },
      drafts,
    );
    expect(project.status).toBe("Planning");
    expect(await store.getTasksByIds(project.taskIds)).toHaveLength(drafts.length);
  });

  it("persists status changes and sets / clears the completion date", async () => {
    const { project } = await createCollegiateProject();
    const id = project.taskIds[0];
    const done = await store.updateTask(id, { status: "Done" });
    expect(done).toMatchObject({ status: "Done", completedAt: today() });
    expect(await store.getTask(id)).toMatchObject({ status: "Done" });
    expect(await store.updateTask(id, { status: "In Progress" })).toMatchObject({ completedAt: null });
  });

  it("fails loudly when updating a task that doesn't exist", async () => {
    await expect(store.updateTask("nope", { status: "Done" })).rejects.toThrow();
  });

  it("returns null / empty for missing records instead of throwing", async () => {
    expect(await store.getProject("missing")).toBeNull();
    expect(await store.getTemplate("missing")).toBeNull();
    expect(await store.getTasksByIds(["missing"])).toEqual([]);
  });
});
