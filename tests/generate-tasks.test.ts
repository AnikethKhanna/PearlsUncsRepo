import { describe, expect, it } from "vitest";
import { SAMPLE_TEMPLATES } from "@/lib/data/sample-data";
import { generateTaskDrafts, rolesForSteps } from "@/lib/domain/generate-tasks";
import type { TemplateStep } from "@/lib/domain/types";

const collegiate = SAMPLE_TEMPLATES.find((t) => t.id === "tplCollegiate")!;
const ymca = SAMPLE_TEMPLATES.find((t) => t.id === "tplYmca")!;
const START = "2027-06-14";
const END = "2027-06-18";

describe("generateTaskDrafts (spreadsheet template)", () => {
  const { drafts, warnings } = generateTaskDrafts({ steps: collegiate.steps, startDate: START, endDate: END });

  it("creates one task per spreadsheet row, sorted by due date", () => {
    expect(warnings).toEqual([]);
    expect(drafts).toHaveLength(141);
    const dates = drafts.map((d) => d.dueDate);
    expect([...dates].sort()).toEqual(dates);
    expect(drafts[0]).toMatchObject({ title: "Reach out to partner contacts at the host site", dueDate: "2027-02-14", phase: "Pre-launch" });
    expect(drafts.at(-1)).toMatchObject({ title: "Reconnect with the host coach about running the program again", dueDate: "2027-08-18", phase: "Post-program" });
  });

  it("schedules program-day tasks on the right day", () => {
    expect(drafts.find((d) => d.title === "Check in with the host coach")).toMatchObject({ dueDate: "2027-06-16", phase: "During program" });
  });

  it("assigns every person for shared tasks", () => {
    const { drafts: assigned } = generateTaskDrafts({
      steps: collegiate.steps, startDate: START, endDate: END,
      roleAssignments: { "Program Manager": ["usrJordan"], "Executive Director": ["usrTaylor"] },
    });
    const shared = assigned.find((d) => d.title === "Select lead instructors")!;
    expect(shared.ownerRole).toBe("Program Manager, Executive Director");
    expect(shared.assigneeIds).toEqual(["usrJordan", "usrTaylor"]);
    expect(assigned.find((d) => d.title === "Research funding opportunities")!.assigneeIds).toEqual([]); // Grant Writer unassigned
  });

  it("does not mutate the template", () => {
    const before = JSON.stringify(collegiate.steps);
    generateTaskDrafts({ steps: collegiate.steps, startDate: START, endDate: null, roleAssignments: { "Program Manager": ["x"] } });
    expect(JSON.stringify(collegiate.steps)).toBe(before);
  });
});

describe("generateTaskDrafts (dependencies, illustrative YMCA template)", () => {
  it("produces a different task set for a different program profile", () => {
    const titles = generateTaskDrafts({ steps: ymca.steps, startDate: START, endDate: null }).drafts.map((d) => d.title);
    expect(titles).toContain("Confirm YMCA has opened registration");
    expect(titles).not.toContain("Test the registration system before it opens");
  });

  it("keeps dependencies between included steps", () => {
    const { drafts } = generateTaskDrafts({ steps: ymca.steps, startDate: START, endDate: null });
    const ship = drafts.find((d) => d.title === "Ship curriculum materials")!;
    expect(ship.dependsOnKeys.map((k) => drafts.find((d) => d.key === k)!.title)).toEqual(["Confirm shipping address"]);
  });

  it("drops excluded steps and warns about broken dependencies", () => {
    const address = ymca.steps.find((s) => s.title === "Confirm shipping address")!;
    const { drafts, warnings } = generateTaskDrafts({ steps: ymca.steps, startDate: START, endDate: null, excludedStepIds: [address.id] });
    expect(drafts.some((d) => d.key === address.id)).toBe(false);
    expect(drafts.find((d) => d.title === "Ship curriculum materials")!.dependsOnKeys).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Confirm shipping address");
  });

  it("detects circular dependencies", () => {
    const base = { templateId: "t", description: "", order: 1, phase: "", offsetAmount: 1, offsetUnit: "Days", timing: "Before", anchor: "Program Start", defaultOwnerRoles: [] } as const;
    const steps: TemplateStep[] = [
      { ...base, defaultOwnerRoles: [], id: "a", title: "A", dependsOnStepIds: ["b"] },
      { ...base, defaultOwnerRoles: [], id: "b", title: "B", dependsOnStepIds: ["a"] },
    ];
    expect(generateTaskDrafts({ steps, startDate: "2027-01-10", endDate: null }).warnings.some((w) => w.includes("circular"))).toBe(true);
  });
});

describe("rolesForSteps", () => {
  it("lists every distinct role from the spreadsheet, in order", () => {
    expect(rolesForSteps(collegiate.steps)).toEqual([
      "Program Manager", "Grant Writer", "Executive Director", "Program Assistant", "Operations Director", "Marketing Director", "Board Member",
    ]);
  });
});
