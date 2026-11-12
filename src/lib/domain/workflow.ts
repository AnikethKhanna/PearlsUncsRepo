import { calculateDueDate, isIsoDate, type ScheduleRule } from "./dates";
import { OFFSET_UNITS } from "./types";

export const SYSTEM_PHASES = ["Pre-launch", "During program", "Post-program"] as const;
export interface WorkflowPhase { name: string; active: boolean }
export interface DeadlinePreset extends ScheduleRule { id: string; label: string }
export interface WorkflowConfig { version: 1; phases: WorkflowPhase[]; deadlinePresets: DeadlinePreset[] }
export const DEFAULT_WORKFLOW: WorkflowConfig = {
  version: 1,
  phases: SYSTEM_PHASES.map((name) => ({ name, active: true })),
  deadlinePresets: [
    { id: "four-months", label: "Four months before launch", offsetAmount: 4, offsetUnit: "Months", timing: "Before", anchor: "Program Start" },
    { id: "two-weeks", label: "Two weeks before launch", offsetAmount: 2, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start" },
    { id: "launch-day", label: "Launch day", offsetAmount: 0, offsetUnit: "Days", timing: "After", anchor: "Program Start" },
    { id: "follow-up", label: "One week after program ends", offsetAmount: 1, offsetUnit: "Weeks", timing: "After", anchor: "Program End" },
  ],
};
export class WorkflowValidationError extends Error {}
const fail = (message: string): never => { throw new WorkflowValidationError(message); };
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail("Workflow settings must be an object.");
  return v as Record<string, unknown>;
};
const label = (v: unknown, max: number): string => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max || /[\x00-\x1f]/.test(v)) return fail(`Use a name between 1 and ${max} characters.`);
  return v.trim();
};
/** Whitelist structure and calculations; never allow editing system statuses or permissions through JSON. */
export function validateWorkflow(value: unknown, previous?: WorkflowConfig): WorkflowConfig {
  const v = object(value);
  if (v.version !== 1 || Object.keys(v).some((k) => !["version", "phases", "deadlinePresets"].includes(k))) return fail("Unsupported workflow settings.");
  if (!Array.isArray(v.phases) || v.phases.length > 40) return fail("Use at most 40 phases.");
  const phases = v.phases.map((item) => {
    const p = object(item);
    if (typeof p.active !== "boolean") return fail("Choose whether each phase is active.");
    return { name: label(p.name, 50), active: p.active };
  });
  if (new Set(phases.map((p) => p.name.toLowerCase())).size !== phases.length) return fail("Phase names must be unique (ignoring capitalization).");
  if (SYSTEM_PHASES.some((name) => !phases.some((p) => p.name === name && p.active))) return fail("Keep the three system phases active and unchanged.");
  if (previous?.phases.some((p) => !phases.some((n) => n.name === p.name))) return fail("Archive an existing phase instead of deleting or renaming it. Existing tasks keep their labels.");
  if (!Array.isArray(v.deadlinePresets) || v.deadlinePresets.length > 20) return fail("Use at most 20 deadline presets.");
  const deadlinePresets: DeadlinePreset[] = v.deadlinePresets.map((item) => {
    const p = object(item);
    const id = label(p.id, 60);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) return fail("Invalid preset identifier.");
    if (!Number.isInteger(p.offsetAmount) || Number(p.offsetAmount) < 0 || Number(p.offsetAmount) > 365) return fail("Preset offsets must be whole numbers from 0 to 365.");
    if (!OFFSET_UNITS.includes(p.offsetUnit as never) || !["Before", "After"].includes(String(p.timing)) || !["Program Start", "Program End"].includes(String(p.anchor))) return fail("Use the supported date units, timing and program anchors.");
    return { id, label: label(p.label, 80), offsetAmount: Number(p.offsetAmount), offsetUnit: p.offsetUnit as DeadlinePreset["offsetUnit"], timing: p.timing as DeadlinePreset["timing"], anchor: p.anchor as DeadlinePreset["anchor"] };
  });
  if (new Set(deadlinePresets.map((p) => p.id)).size !== deadlinePresets.length || new Set(deadlinePresets.map((p) => p.label.toLowerCase())).size !== deadlinePresets.length) return fail("Preset names and identifiers must be unique.");
  return { version: 1, phases, deadlinePresets };
}

export function phaseChoices(config: WorkflowConfig, current?: string) {
  return [...new Set([...config.phases.filter((p) => p.active).map((p) => p.name), ...(current !== undefined ? [current] : [])])];
}
export function canChoosePhase(config: WorkflowConfig, phase: string, existing?: string) {
  return phase === existing || config.phases.some((p) => p.active && p.name === phase);
}
export function presetDate(preset: DeadlinePreset, start: string | null, end: string | null): string | null {
  // Never silently substitute the start date when a preset requires an absent end date.
  if (!start || !isIsoDate(start) || (preset.anchor === "Program End" && (!end || !isIsoDate(end)))) return null;
  const date = calculateDueDate(preset, start, end);
  return isIsoDate(date) ? date : null;
}
