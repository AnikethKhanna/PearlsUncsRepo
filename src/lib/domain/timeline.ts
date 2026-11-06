/**
 * Parses NMU's spreadsheet timeline labels into scheduling rules.
 *
 *   "4 months prior"  → 4 Months Before Program Start
 *   "6 weeks prior"   → 6 Weeks Before Program Start
 *   "2 days prior"    → 2 Days Before Program Start
 *   "Program day 1"   → on the program start date
 *   "Program day 3"   → 2 Days After Program Start
 *   "3 days post"     → 3 Days After Program End
 *   "1 week post"     → 1 Week After Program End
 *
 * Keep this file free of non-type imports: scripts/import-sample-template.mjs loads it directly.
 */
import type { Anchor, OffsetUnit, Timing } from "./types";

export interface ParsedTimeline {
  offsetAmount: number;
  offsetUnit: OffsetUnit;
  timing: Timing;
  anchor: Anchor;
  phase: "Pre-launch" | "During program" | "Post-program";
}

const UNITS: Record<string, OffsetUnit> = {
  day: "Days",
  days: "Days",
  week: "Weeks",
  weeks: "Weeks",
  month: "Months",
  months: "Months",
};

export function parseTimeline(label: string): ParsedTimeline | null {
  const text = label.trim().toLowerCase().replace(/\s+/g, " ");

  const day = /^program day (\d+)$/.exec(text);
  if (day) {
    const n = Number(day[1]);
    if (n < 1) return null;
    // Day 1 is the start date; assumes consecutive calendar days.
    return { offsetAmount: n - 1, offsetUnit: "Days", timing: "After", anchor: "Program Start", phase: "During program" };
  }

  const rel = /^(\d+) (days?|weeks?|months?) (prior|before|post|after)$/.exec(text);
  if (rel) {
    const before = rel[3] === "prior" || rel[3] === "before";
    return {
      offsetAmount: Number(rel[1]),
      offsetUnit: UNITS[rel[2]],
      timing: before ? "Before" : "After",
      anchor: before ? "Program Start" : "Program End",
      phase: before ? "Pre-launch" : "Post-program",
    };
  }
  return null;
}
