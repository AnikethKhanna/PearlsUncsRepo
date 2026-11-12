/**
 * Calendar-date helpers. All dates are "YYYY-MM-DD" strings and all math is
 * done in UTC so results never shift because of the server's time zone.
 */
import type { Anchor, OffsetUnit, Timing } from "./types";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function parse(value: string): Date {
  if (!isIsoDate(value)) throw new Error(`Invalid date "${value}" (expected YYYY-MM-DD)`);
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  const d = parse(value);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

/**
 * Add calendar months, clamping to the last day of the target month
 * (e.g. Mar 31 minus 1 month = Feb 28/29).
 */
export function addMonths(value: string, months: number): string {
  const d = parse(value);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return format(target);
}

export interface ScheduleRule {
  offsetAmount: number;
  offsetUnit: OffsetUnit;
  timing: Timing;
  anchor: Anchor;
}

/**
 * Calculate a due date from a relative rule, e.g.
 * "4 Months Before Program Start" or "2 Weeks After Program End".
 * If the program has no end date, "Program End" falls back to the start date.
 */
export function calculateDueDate(rule: ScheduleRule, startDate: string, endDate: string | null): string {
  const anchorDate = rule.anchor === "Program End" ? (endDate ?? startDate) : startDate;
  const amount = Math.abs(rule.offsetAmount) * (rule.timing === "Before" ? -1 : 1);
  switch (rule.offsetUnit) {
    case "Days":
      return addDays(anchorDate, amount);
    case "Weeks":
      return addDays(anchorDate, amount * 7);
    case "Months":
      return addMonths(anchorDate, amount);
  }
}

/** Human-readable description of a rule, e.g. "4 months before program start". */
export function describeRule(rule: ScheduleRule): string {
  if (rule.anchor === "Program Start" && rule.offsetUnit === "Days" && (rule.timing === "After" || rule.offsetAmount === 0))
    return `Program day ${Math.abs(rule.offsetAmount) + 1}`;
  if (rule.offsetAmount === 0) return `On ${rule.anchor.toLowerCase()} date`;
  const unit = rule.offsetUnit.toLowerCase();
  const n = Math.abs(rule.offsetAmount);
  return `${n} ${n === 1 ? unit.replace(/s$/, "") : unit} ${rule.timing.toLowerCase()} ${rule.anchor.toLowerCase()}`;
}

/** Today's date as YYYY-MM-DD, in the given IANA time zone (default Pacific, where NMU operates). */
export function today(timeZone = "America/Los_Angeles"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

export function formatDisplayDate(value: string | null): string {
  if (!value) return "—";
  const d = parse(value);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(d);
}

// ---- Calendar helpers (all UTC-based, so a date never shifts with the server's or browser's time zone) ----

/** Day of the week, 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(value: string): number {
  return parse(value).getUTCDay();
}

/** The Sunday on or before this date (weeks start on Sunday, as in US calendars). */
export function startOfWeek(value: string): string {
  return addDays(value, -dayOfWeek(value));
}

export function startOfMonth(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

export function endOfMonth(value: string): string {
  return addDays(addMonths(startOfMonth(value), 1), -1);
}

/** Every date from start to end, inclusive. */
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Format with Intl options, always in UTC so the calendar date is preserved. */
export function formatDate(value: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(parse(value));
}
