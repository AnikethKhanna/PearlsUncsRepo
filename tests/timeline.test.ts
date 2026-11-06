import { describe, expect, it } from "vitest";
import { SAMPLE_TEMPLATE_TASKS } from "@/lib/data/sample-template-tasks";
import { calculateDueDate } from "@/lib/domain/dates";
import { parseTimeline } from "@/lib/domain/timeline";

describe("parseTimeline", () => {
  it.each([
    ["4 months prior", { offsetAmount: 4, offsetUnit: "Months", timing: "Before", anchor: "Program Start", phase: "Pre-launch" }],
    ["6 weeks prior", { offsetAmount: 6, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start" }],
    ["1 week prior", { offsetAmount: 1, offsetUnit: "Weeks", timing: "Before" }],
    ["2 days prior", { offsetAmount: 2, offsetUnit: "Days", timing: "Before" }],
    ["Program day 1", { offsetAmount: 0, offsetUnit: "Days", timing: "After", anchor: "Program Start", phase: "During program" }],
    ["Program day 5", { offsetAmount: 4, offsetUnit: "Days", timing: "After", anchor: "Program Start" }],
    ["3 days post", { offsetAmount: 3, offsetUnit: "Days", timing: "After", anchor: "Program End", phase: "Post-program" }],
    ["2 months post", { offsetAmount: 2, offsetUnit: "Months", timing: "After", anchor: "Program End" }],
    ["  4  Weeks  Prior ", { offsetAmount: 4, offsetUnit: "Weeks", timing: "Before" }],
  ])("%s", (label, expected) => {
    expect(parseTimeline(label)).toMatchObject(expected);
  });

  it("rejects labels it doesn't understand", () => {
    expect(parseTimeline("ASAP")).toBeNull();
    expect(parseTimeline("Program day 0")).toBeNull();
    expect(parseTimeline("")).toBeNull();
  });

  it("schedules spreadsheet labels on the expected dates", () => {
    const due = (label: string) => calculateDueDate(parseTimeline(label)!, "2027-06-14", "2027-06-18");
    expect(due("4 months prior")).toBe("2027-02-14");
    expect(due("Program day 1")).toBe("2027-06-14");
    expect(due("Program day 3")).toBe("2027-06-16");
    expect(due("3 days post")).toBe("2027-06-21");
  });
});

describe("imported sample spreadsheet", () => {
  it("contains all 141 rows with parsed timelines and matching owners/roles", () => {
    expect(SAMPLE_TEMPLATE_TASKS).toHaveLength(141);
    for (const t of SAMPLE_TEMPLATE_TASKS) {
      expect(t.roles.length).toBeGreaterThan(0);
      expect(t.owners.length).toBe(t.roles.length);
    }
    const multi = SAMPLE_TEMPLATE_TASKS.find((t) => t.title === "Draft the post-program report")!;
    expect(multi.roles).toEqual(["Marketing Director", "Program Manager", "Operations Director", "Program Assistant"]);
  });
});
