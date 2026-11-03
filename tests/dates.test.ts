import { describe, expect, it } from "vitest";
import { addMonths, calculateDueDate, describeRule, isIsoDate } from "@/lib/domain/dates";

describe("calculateDueDate", () => {
  const start = "2027-04-15";
  const end = "2027-05-20";

  it("handles months before start", () => {
    expect(calculateDueDate({ offsetAmount: 4, offsetUnit: "Months", timing: "Before", anchor: "Program Start" }, start, end)).toBe("2026-12-15");
  });
  it("handles weeks before start", () => {
    expect(calculateDueDate({ offsetAmount: 3, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start" }, start, end)).toBe("2027-03-25");
  });
  it("handles weeks after program end", () => {
    expect(calculateDueDate({ offsetAmount: 2, offsetUnit: "Weeks", timing: "After", anchor: "Program End" }, start, end)).toBe("2027-06-03");
  });
  it("falls back to start date when there is no end date", () => {
    expect(calculateDueDate({ offsetAmount: 3, offsetUnit: "Days", timing: "After", anchor: "Program End" }, start, null)).toBe("2027-04-18");
  });
  it("treats a negative amount the same as positive (timing decides direction)", () => {
    expect(calculateDueDate({ offsetAmount: -2, offsetUnit: "Days", timing: "Before", anchor: "Program Start" }, start, end)).toBe("2027-04-13");
  });
  it("crosses year boundaries and leap days", () => {
    expect(calculateDueDate({ offsetAmount: 1, offsetUnit: "Days", timing: "Before", anchor: "Program Start" }, "2028-03-01", null)).toBe("2028-02-29");
  });
});

describe("addMonths", () => {
  it("clamps to the end of shorter months", () => {
    expect(addMonths("2027-03-31", -1)).toBe("2027-02-28");
    expect(addMonths("2028-03-31", -1)).toBe("2028-02-29");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
  });
});

describe("isIsoDate / describeRule", () => {
  it("validates dates", () => {
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-1-01")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });
  it("describes rules in plain language", () => {
    expect(describeRule({ offsetAmount: 4, offsetUnit: "Months", timing: "Before", anchor: "Program Start" })).toBe("4 months before program start");
    expect(describeRule({ offsetAmount: 1, offsetUnit: "Weeks", timing: "After", anchor: "Program End" })).toBe("1 week after program end");
  });
});
