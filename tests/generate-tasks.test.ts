import { describe, expect, it } from "vitest";
import { SAMPLE_TEMPLATES } from "@/lib/data/sample-data";
import { generateTaskDrafts, rolesForSteps } from "@/lib/domain/generate-tasks";
import type { TemplateStep } from "@/lib/domain/types";

const [collegiate, ymca] = SAMPLE_TEMPLATES;

describe("generateTaskDrafts", () => {
  it("creates one draft per step with calculated due dates, sorted by due date", () => {
    const { drafts, warnings } = generateTaskDrafts({ steps: collegiate.steps, startDate: "2027-04-15", endDate: "2027-05-20" });
    expect(warnings).toEqual([]);
    expect(drafts).toHaveLength(collegiate.steps.length);
    const dates = drafts.map((d) => d.dueDate);
    expect([...dates].sort()).toEqual(dates);
    expect(drafts[0]).toMatchObject({ title: "Confirm partnership agreement with campus partner", dueDate: "2026-12-15" });
    expect(drafts.at(-1)).toMatchObject({ title: "Compile completion report", dueDate: "2027-06-03" });
  });

  it("produces different task sets for different program profiles", () => {
    const a = generateTaskDrafts({ steps: collegiate.steps, startDate: "2027-04-15", endDate: null }).drafts.map((d) => d.title);
    const b = generateTaskDrafts({ steps: ymca.steps, startDate: "2027-04-15", endDate: null }).drafts.map((d) => d.title);
    expect(a).toContain("Open family registration (NMU-managed)");
    expect(b).not.toContain("Open family registration (NMU-managed)");
    expect(b).toContain("Confirm YMCA has opened registration");
  });

  it("keeps dependencies between included steps", () => {
    const { drafts } = generateTaskDrafts({ steps: collegiate.steps, startDate: "2027-04-15", endDate: null });
    const ship = drafts.find((d) => d.title === "Ship program supplies")!;
    const titles = ship.dependsOnKeys.map((k) => drafts.find((d) => d.key === k)!.title);
    expect(titles.sort()).toEqual(["Confirm participant quantities", "Confirm shipping address"]);
  });

  it("drops excluded steps and warns about broken dependencies", () => {
    const address = collegiate.steps.find((s) => s.title === "Confirm shipping address")!;
    const { drafts, warnings } = generateTaskDrafts({
      steps: collegiate.steps,
      startDate: "2027-04-15",
      endDate: null,
      excludedStepIds: [address.id],
    });
    expect(drafts.some((d) => d.key === address.id)).toBe(false);
    expect(drafts.find((d) => d.title === "Ship program supplies")!.dependsOnKeys).not.toContain(address.id);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Confirm shipping address");
  });

  it("assigns people by owner role", () => {
    const { drafts } = generateTaskDrafts({
      steps: ymca.steps,
      startDate: "2027-04-15",
      endDate: null,
      roleAssignments: { Operations: ["usrStaff2"] },
    });
    for (const d of drafts) expect(d.assigneeIds).toEqual(d.ownerRole === "Operations" ? ["usrStaff2"] : []);
  });

  it("detects circular dependencies", () => {
    const base = { templateId: "t", description: "", order: 1, phase: "", offsetAmount: 1, offsetUnit: "Days", timing: "Before", anchor: "Program Start", defaultOwnerRole: "" } as const;
    const steps: TemplateStep[] = [
      { ...base, id: "a", title: "A", dependsOnStepIds: ["b"] },
      { ...base, id: "b", title: "B", dependsOnStepIds: ["a"] },
    ];
    const { warnings } = generateTaskDrafts({ steps, startDate: "2027-01-10", endDate: null });
    expect(warnings.some((w) => w.includes("circular"))).toBe(true);
  });

  it("does not mutate the template", () => {
    const before = JSON.stringify(collegiate.steps);
    generateTaskDrafts({ steps: collegiate.steps, startDate: "2027-04-15", endDate: null, roleAssignments: { "Program Manager": ["x"] } });
    expect(JSON.stringify(collegiate.steps)).toBe(before);
  });
});

describe("rolesForSteps", () => {
  it("lists distinct roles in template order", () => {
    expect(rolesForSteps(collegiate.steps)).toEqual(["Program Manager", "Site Partner", "Operations"]);
  });
});
