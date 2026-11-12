import { describe, expect, it, vi } from "vitest";
import { can } from "@/lib/auth/permissions";
import { AirtableClient } from "@/lib/airtable/client";
import { AIRTABLE_SCHEMA as S } from "@/lib/airtable/schema";
import { AirtableStore } from "@/lib/data/airtable-store";
import { MemoryStore } from "@/lib/data/memory-store";
import { loadWorkflowSettings, saveWorkflowSettings } from "@/lib/data/workflow-settings";
import { DEFAULT_WORKFLOW, canChoosePhase, phaseChoices, presetDate, validateWorkflow } from "@/lib/domain/workflow";
import { phasesOf, sortForDisplay } from "@/lib/domain/program-edit";
import { FakeAirtable } from "./fake-airtable";

const custom = () => ({ ...structuredClone(DEFAULT_WORKFLOW), phases: [...structuredClone(DEFAULT_WORKFLOW.phases), { name: "Partner coordination", active: true }] });
describe("workflow configuration", () => {
  it("lets only active admins configure workflows", async () => {
    const store = new MemoryStore(undefined, false);
    const { revision } = await loadWorkflowSettings(store);
    const spy = vi.spyOn(store, "saveWorkflowConfig");
    for (const id of ["usrSam", "usrPartner", "usrInactive"]) {
      const actor = await store.getUser(id);
      expect(can(actor, "workflow.manage")).toBe(false);
      await expect(saveWorkflowSettings(store, actor, custom(), revision)).rejects.toThrow("administrators");
    }
    await expect(saveWorkflowSettings(store, null, custom(), revision)).rejects.toThrow("administrators");
    expect(spy).not.toHaveBeenCalled();
    await saveWorkflowSettings(store, await store.getUser("usrJordan"), custom(), revision);
    expect((await store.getWorkflowConfig())?.phases.at(-1)?.name).toBe("Partner coordination");
  });
  it("rejects stale edits without overwriting another administrator's settings", async () => {
    const store = new MemoryStore(undefined, false);
    const original = await loadWorkflowSettings(store);
    const admin = await store.getUser("usrJordan");
    await saveWorkflowSettings(store, admin, custom(), original.revision);
    await expect(saveWorkflowSettings(store, admin, DEFAULT_WORKFLOW, original.revision)).rejects.toThrow("Reload");
    expect((await store.getWorkflowConfig())?.phases).toHaveLength(4);
  });
  it("protects system phases and rejects invalid settings and duplicate labels", () => {
    const c = custom();
    expect(() => validateWorkflow({ ...c, phases: c.phases.slice(1) })).toThrow("system phases");
    expect(() => validateWorkflow({ ...c, phases: c.phases.map((p) => ({ ...p, active: false })) })).toThrow("system phases");
    expect(() => validateWorkflow({ ...c, phases: [...c.phases, { name: "pre-LAUNCH", active: true }] })).toThrow("unique");
    expect(() => validateWorkflow({ ...c, statuses: ["Broken"] })).toThrow("Unsupported");
    expect(() => validateWorkflow({ ...c, deadlinePresets: [{ ...c.deadlinePresets[0], offsetAmount: -1 }] })).toThrow("whole numbers");
    expect(() => validateWorkflow({ ...c, deadlinePresets: [{ ...c.deadlinePresets[0], offsetUnit: "Hours" }] })).toThrow("supported date");
  });
  it("archives custom phases but preserves existing task labels, including legacy ones", () => {
    const old = custom();
    expect(() => validateWorkflow(DEFAULT_WORKFLOW, old)).toThrow("Archive");
    const config = validateWorkflow({ ...old, phases: old.phases.map((p) => ({ ...p, active: p.name !== "Partner coordination" })) }, old);
    expect(phaseChoices(config)).not.toContain("Partner coordination");
    expect(phaseChoices(config, "Old Airtable phase")).toContain("Old Airtable phase");
    expect(canChoosePhase(config, "Partner coordination")).toBe(false);
    expect(canChoosePhase(config, "Partner coordination", "Partner coordination")).toBe(true);
    expect(canChoosePhase(config, "", "")).toBe(true);
  });
  it("respects configured order without dropping unknown or archived phases", () => {
    const tasks = ["Pre-launch", "Legacy", "Post-program", "Partner coordination"].map((phase) => ({ phase, order: 1, dueDate: "2027-01-01" }));
    const order = ["Partner coordination", "Pre-launch", "During program", "Post-program"];
    expect(sortForDisplay(tasks, order).map((t) => t.phase)).toEqual(["Partner coordination", "Pre-launch", "Post-program", "Legacy"]);
    expect(phasesOf(tasks, order)).toEqual(["Partner coordination", "Pre-launch", "Post-program", "Legacy"]);
  });
  it("calculates presets with month clamping and refuses missing anchors", () => {
    const preset = { ...DEFAULT_WORKFLOW.deadlinePresets[0], offsetAmount: 1 };
    expect(presetDate(preset, "2027-03-31", null)).toBe("2027-02-28");
    expect(presetDate(preset, null, null)).toBeNull();
    expect(presetDate(DEFAULT_WORKFLOW.deadlinePresets[3], "2027-03-01", null)).toBeNull();
    expect(presetDate(DEFAULT_WORKFLOW.deadlinePresets[3], "2027-03-01", "2027-04-01")).toBe("2027-04-08");
  });
  it("does not modify existing tasks or source templates when configuration changes", async () => {
    const store = new MemoryStore();
    const before = await store.listProjects();
    const tasks = await store.getTasksByIds(before.flatMap((p) => p.taskIds));
    const templates = await store.listTemplates();
    await saveWorkflowSettings(store, await store.getUser("usrJordan"), custom(), (await loadWorkflowSettings(store)).revision);
    expect(await store.getTasksByIds(before.flatMap((p) => p.taskIds))).toEqual(tasks);
    expect(await store.listTemplates()).toEqual(templates);
  });
});

describe("Airtable workflow settings", () => {
  const make = (fake: FakeAirtable) => new AirtableStore(new AirtableClient({ token: "test", baseId: "appTest", fetch: fake.fetch, minIntervalMs: 0, retryDelaysMs: [] }));
  it("round trips a single versioned config and changes only the additive settings table", async () => {
    const fake = new FakeAirtable();
    const store = make(fake);
    expect(await store.getWorkflowConfig()).toBeNull();
    await store.saveWorkflowConfig(custom());
    await store.saveWorkflowConfig(custom());
    expect(await store.getWorkflowConfig()).toEqual(custom());
    expect(fake.all(S.workflowSettings.table)).toHaveLength(1);
    expect(fake.requests.every((r) => r.table === S.workflowSettings.table)).toBe(true);
  });
  it("keeps defaults usable when optional storage is absent, and refuses a pretend save", async () => {
    const store = new AirtableStore(new AirtableClient({ token: "test", baseId: "appTest", fetch: async () => Response.json({ error: "NOT_FOUND" }, { status: 404 }), minIntervalMs: 0, retryDelaysMs: [] }));
    const loaded = await loadWorkflowSettings(store);
    expect(loaded.config).toEqual(DEFAULT_WORKFLOW);
    expect(loaded.writable).toBe(false);
  });
  it("never overwrites corrupt or duplicate settings with defaults", async () => {
    const fake = new FakeAirtable();
    fake.seed(S.workflowSettings.table, { Name: "workflow", Value: "broken json" });
    const store = make(fake);
    expect((await loadWorkflowSettings(store)).writable).toBe(false);
    expect(fake.requests.every((r) => r.method === "GET")).toBe(true);
    fake.seed(S.workflowSettings.table, { Name: "workflow", Value: JSON.stringify(DEFAULT_WORKFLOW) });
    expect((await loadWorkflowSettings(store)).writable).toBe(false);
  });
});
