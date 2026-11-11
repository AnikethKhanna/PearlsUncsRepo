/**
 * "Save as Template": turn an existing program's tasks into reusable template steps.
 *
 * Copied: title, description, phase, order, relative deadline, owner roles,
 *         dependencies between copied tasks.
 * Never copied: program dates, status, completion dates.
 * Copied only if chosen: task notes (often private), assigned people,
 *         tasks marked "Not Needed".
 *
 * Pure function: the caller saves the result as a NEW template, so the source
 * program and the original template are never modified.
 */
import { calculateDueDate, isIsoDate, type ScheduleRule } from "./dates";
import { sortForDisplay } from "./program-edit";
import type { Project, StepDraft, Task, TemplateStep } from "./types";

export interface SaveAsTemplateOptions {
  includeNotNeeded?: boolean;
  includeNotes?: boolean;
  includeAssignees?: boolean;
}

const DAY_MS = 86_400_000;
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * Express a task's due date relative to the program, so it can be reused.
 * If the task still has its original template rule's date, that rule is kept
 * (so "4 months prior" stays in months). Otherwise the rule is worked out from
 * the date: before start → before Program Start; during → Program day N;
 * after the end → after Program End. Whole weeks are written as weeks.
 */
export function deriveRule(
  dueDate: string,
  startDate: string,
  endDate: string | null,
  originalStep?: ScheduleRule,
): ScheduleRule {
  if (originalStep && calculateDueDate(originalStep, startDate, endDate) === dueDate) {
    const { offsetAmount, offsetUnit, timing, anchor } = originalStep;
    return { offsetAmount, offsetUnit, timing, anchor };
  }
  const end = endDate ?? startDate;
  const inUnits = (days: number) =>
    days % 7 === 0 && days !== 0
      ? { offsetAmount: days / 7, offsetUnit: "Weeks" as const }
      : { offsetAmount: days, offsetUnit: "Days" as const };

  if (dueDate < startDate) return { ...inUnits(daysBetween(dueDate, startDate)), timing: "Before", anchor: "Program Start" };
  if (dueDate <= end) return { offsetAmount: daysBetween(startDate, dueDate), offsetUnit: "Days", timing: "After", anchor: "Program Start" };
  return { ...inUnits(daysBetween(end, dueDate)), timing: "After", anchor: "Program End" };
}

export interface BuildTemplateResult {
  steps: StepDraft[];
  warnings: string[];
  skippedNotNeeded: number;
}

export function buildTemplateFromProject(
  project: Pick<Project, "startDate" | "endDate">,
  tasks: Task[],
  originalSteps: TemplateStep[],
  options: SaveAsTemplateOptions = {},
): BuildTemplateResult {
  if (!project.startDate || !isIsoDate(project.startDate)) {
    throw new Error("The program needs a start date before it can be saved as a template.");
  }
  const start = project.startDate;
  const stepById = new Map(originalSteps.map((s) => [s.id, s]));
  const warnings: string[] = [];

  const kept = sortForDisplay(tasks.filter((t) => options.includeNotNeeded || t.status !== "Not Needed"));
  const keptIds = new Set(kept.map((t) => t.id));

  const steps = kept.map((t, i): StepDraft => {
    let rule: ScheduleRule;
    if (t.dueDate) {
      rule = deriveRule(t.dueDate, start, project.endDate, t.templateStepId ? stepById.get(t.templateStepId) : undefined);
    } else {
      rule = { offsetAmount: 0, offsetUnit: "Days", timing: "Before", anchor: "Program Start" };
      warnings.push(`"${t.title}" has no due date, so it was scheduled on the program start date.`);
    }
    const droppedDeps = t.dependsOnTaskIds.filter((d) => !keptIds.has(d));
    if (droppedDeps.length) warnings.push(`"${t.title}" depended on a task that was left out, so that link was dropped.`);

    const description = options.includeNotes && t.notes.trim()
      ? [t.description, `Notes from the source program:\n${t.notes.trim()}`].filter(Boolean).join("\n\n")
      : t.description;

    return {
      key: t.id,
      title: t.title,
      description,
      order: i + 1,
      phase: t.phase,
      ...rule,
      defaultOwnerRoles: t.ownerRole.split(",").map((r) => r.trim()).filter(Boolean),
      defaultAssigneeIds: options.includeAssignees ? [...t.assigneeIds] : [],
      dependsOnKeys: t.dependsOnTaskIds.filter((d) => keptIds.has(d)),
    };
  });

  return { steps, warnings, skippedNotNeeded: tasks.length - kept.length };
}
