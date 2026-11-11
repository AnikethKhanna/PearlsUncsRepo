import { describe, expect, it } from "vitest";
import { moveTask, nextOrder, phasesOf, sortForDisplay, wouldCreateCycle } from "@/lib/domain/program-edit";
import { buildTemplateFromProject, deriveRule } from "@/lib/domain/template-from-project";
import { generateTaskDrafts } from "@/lib/domain/generate-tasks";
import { SAMPLE_TEMPLATES } from "@/lib/data/sample-data";
import type { Task } from "@/lib/domain/types";

const task = (over: Partial<Task> & { id: string }): Task => ({
  projectId: "p", templateStepId: null, title: over.id, description: "", assigneeIds: [], ownerRole: "", phase: "Pre-launch",
  order: 1, dueDate: "2027-01-01", status: "Not Started", dependsOnTaskIds: [], notes: "", documentLinks: [], completedAt: null, ...over,
});

describe("sortForDisplay / phasesOf / nextOrder", () => {
  const tasks = [
    task({ id: "post", phase: "Post-program", order: 1 }),
    task({ id: "b", order: 2 }),
    task({ id: "a", order: 1 }),
    task({ id: "during", phase: "During program", order: 1 }),
  ];
  it("orders by phase, then the program's own order", () => {
    expect(sortForDisplay(tasks).map((t) => t.id)).toEqual(["a", "b", "during", "post"]);
    expect(phasesOf(tasks)).toEqual(["Pre-launch", "During program", "Post-program"]);
  });
  it("appends new tasks after the highest order", () => {
    expect(nextOrder(tasks)).toBe(3);
    expect(nextOrder([])).toBe(1);
  });
});

describe("moveTask", () => {
  const tasks = [task({ id: "a", order: 1 }), task({ id: "b", order: 2 }), task({ id: "c", order: 3 }), task({ id: "x", phase: "Post-program", order: 4 })];
  it("swaps with the neighbour in the same phase", () => {
    expect(moveTask(tasks, "b", "up")).toEqual([{ id: "b", order: 1 }, { id: "a", order: 2 }]);
    expect(moveTask(tasks, "b", "down")).toEqual([{ id: "b", order: 3 }, { id: "c", order: 2 }]);
  });
  it("does nothing at the edge of a phase", () => {
    expect(moveTask(tasks, "a", "up")).toEqual([]);
    expect(moveTask(tasks, "c", "down")).toEqual([]); // "x" is in another phase
    expect(moveTask(tasks, "missing", "up")).toEqual([]);
  });
  it("renumbers when older data has equal orders", () => {
    const dup = [task({ id: "a", order: 5, dueDate: "2027-01-01" }), task({ id: "b", order: 5, dueDate: "2027-01-02" })];
    const updates = moveTask(dup, "b", "up");
    const applied = dup.map((t) => ({ ...t, order: updates.find((u) => u.id === t.id)?.order ?? t.order }));
    expect(sortForDisplay(applied).map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("wouldCreateCycle", () => {
  const tasks = [task({ id: "a" }), task({ id: "b", dependsOnTaskIds: ["a"] }), task({ id: "c", dependsOnTaskIds: ["b"] })];
  it("allows normal prerequisites", () => {
    expect(wouldCreateCycle(tasks, "c", ["a", "b"])).toBe(false);
  });
  it("blocks loops, including depending on itself", () => {
    expect(wouldCreateCycle(tasks, "a", ["c"])).toBe(true);
    expect(wouldCreateCycle(tasks, "a", ["a"])).toBe(true);
  });
});

describe("deriveRule", () => {
  const start = "2027-06-14";
  const end = "2027-06-18";
  it("keeps the original template rule when the date is unchanged", () => {
    const original = { offsetAmount: 4, offsetUnit: "Months", timing: "Before", anchor: "Program Start" } as const;
    expect(deriveRule("2027-02-14", start, end, original)).toEqual(original);
  });
  it("works the rule out from an edited or added date", () => {
    expect(deriveRule("2027-05-31", start, end)).toEqual({ offsetAmount: 2, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start" });
    expect(deriveRule("2027-06-11", start, end)).toEqual({ offsetAmount: 3, offsetUnit: "Days", timing: "Before", anchor: "Program Start" });
    expect(deriveRule("2027-06-16", start, end)).toEqual({ offsetAmount: 2, offsetUnit: "Days", timing: "After", anchor: "Program Start" });
    expect(deriveRule("2027-06-25", start, end)).toEqual({ offsetAmount: 1, offsetUnit: "Weeks", timing: "After", anchor: "Program End" });
  });
});

describe("buildTemplateFromProject", () => {
  const project = { startDate: "2027-06-14", endDate: "2027-06-18" };
  const tasks = [
    task({ id: "t1", title: "Confirm address", order: 1, dueDate: "2027-05-17", ownerRole: "Program Manager", assigneeIds: ["u1"], notes: "Private: call Dana" }),
    task({ id: "t2", title: "Ship supplies", order: 2, dueDate: "2027-05-24", ownerRole: "Operations Director, Program Manager", dependsOnTaskIds: ["t1"], status: "Done", completedAt: "2027-05-20" }),
    task({ id: "t3", title: "Skipped thing", order: 3, dueDate: "2027-05-25", status: "Not Needed" }),
    task({ id: "t4", title: "Waits on skipped", order: 4, dueDate: "2027-05-26", dependsOnTaskIds: ["t3"] }),
  ];

  it("copies reusable details and excludes dates, notes, people and Not Needed tasks by default", () => {
    const { steps, warnings, skippedNotNeeded } = buildTemplateFromProject(project, tasks, []);
    expect(skippedNotNeeded).toBe(1);
    expect(steps.map((s) => s.title)).toEqual(["Confirm address", "Ship supplies", "Waits on skipped"]);
    expect(steps[1]).toMatchObject({ order: 2, offsetAmount: 3, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start", defaultOwnerRoles: ["Operations Director", "Program Manager"], dependsOnKeys: ["t1"], defaultAssigneeIds: [] });
    expect(steps[0].description).not.toContain("Dana");
    expect(JSON.stringify(steps)).not.toMatch(/2027-/); // no program-specific dates
    expect(warnings.some((w) => w.includes("Waits on skipped"))).toBe(true);
  });

  it("includes notes, people and Not Needed tasks only when chosen", () => {
    const { steps } = buildTemplateFromProject(project, tasks, [], { includeNotes: true, includeAssignees: true, includeNotNeeded: true });
    expect(steps).toHaveLength(4);
    expect(steps[0].description).toContain("Private: call Dana");
    expect(steps[0].defaultAssigneeIds).toEqual(["u1"]);
    expect(steps[3].dependsOnKeys).toEqual(["t3"]);
  });

  it("round-trips: a template saved from a program regenerates the same due dates and dependencies", () => {
    const tpl = SAMPLE_TEMPLATES.find((t) => t.id === "tplCollegiate")!;
    const { drafts } = generateTaskDrafts({ steps: tpl.steps, startDate: project.startDate, endDate: project.endDate });
    const programTasks = drafts.map((d) =>
      task({ id: d.key, templateStepId: d.templateStepId, title: d.title, phase: d.phase, order: d.order, dueDate: d.dueDate, ownerRole: d.ownerRole, dependsOnTaskIds: d.dependsOnKeys }),
    );
    const { steps } = buildTemplateFromProject(project, programTasks, tpl.steps);
    const reused = steps.map((s) => ({ ...s, id: s.key, templateId: "new", dependsOnStepIds: s.dependsOnKeys }));
    // Reuse for a different program window
    const again = generateTaskDrafts({ steps: reused, startDate: "2028-03-06", endDate: "2028-03-10" });
    const original = generateTaskDrafts({ steps: tpl.steps, startDate: "2028-03-06", endDate: "2028-03-10" });
    expect(again.drafts.map((d) => [d.title, d.dueDate])).toEqual(original.drafts.map((d) => [d.title, d.dueDate]));
  });

  it("needs a program start date", () => {
    expect(() => buildTemplateFromProject({ startDate: null, endDate: null }, tasks, [])).toThrow(/start date/);
  });
});
