/**
 * Turns a program template into a concrete list of task drafts for a project.
 *
 * Pure function: no Airtable access, so it is easy to test and the
 * "New project" screen can show the exact same preview the server will save.
 *
 * Historical safety: task title, description, owner role and due date are
 * COPIED from the template at creation time. Editing a template later never
 * changes tasks in existing projects.
 */
import { calculateDueDate } from "./dates";
import type { TaskDraft, TemplateStep } from "./types";

export interface GenerateOptions {
  steps: TemplateStep[];
  startDate: string;
  endDate: string | null;
  /** Steps the user chose to leave out (by step ID). Default: none. */
  excludedStepIds?: string[];
  /** Who fills each owner role for this project, e.g. { "Program Manager": ["recUser1"] } */
  roleAssignments?: Record<string, string[]>;
}

export interface GenerateResult {
  drafts: TaskDraft[];
  /** Human-readable notes, e.g. dependencies dropped because a step was excluded. */
  warnings: string[];
}

export function generateTaskDrafts(opts: GenerateOptions): GenerateResult {
  const excluded = new Set(opts.excludedStepIds ?? []);
  const included = opts.steps.filter((s) => !excluded.has(s.id));
  const includedIds = new Set(included.map((s) => s.id));
  const stepById = new Map(opts.steps.map((s) => [s.id, s]));
  const warnings: string[] = [];

  const drafts: TaskDraft[] = included
    .map((step) => {
      const dependsOnKeys: string[] = [];
      for (const depId of step.dependsOnStepIds) {
        if (includedIds.has(depId)) dependsOnKeys.push(depId);
        else if (stepById.has(depId))
          warnings.push(
            `"${step.title}" normally waits for "${stepById.get(depId)!.title}", which was left out of this project.`,
          );
      }
      return {
        key: step.id,
        templateStepId: step.id,
        title: step.title,
        description: step.description,
        ownerRole: step.defaultOwnerRole,
        assigneeIds: [...(opts.roleAssignments?.[step.defaultOwnerRole] ?? [])],
        phase: step.phase,
        order: step.order,
        dueDate: calculateDueDate(step, opts.startDate, opts.endDate),
        dependsOnKeys,
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.order - b.order);

  const cycle = findCycle(drafts);
  if (cycle) warnings.push(`Template has a circular dependency: ${cycle.join(" → ")}. Please fix the template.`);

  return { drafts, warnings };
}

/** Distinct owner roles used by a set of steps, in template order. */
export function rolesForSteps(steps: TemplateStep[]): string[] {
  const roles: string[] = [];
  for (const s of [...steps].sort((a, b) => a.order - b.order)) {
    if (s.defaultOwnerRole && !roles.includes(s.defaultOwnerRole)) roles.push(s.defaultOwnerRole);
  }
  return roles;
}

function findCycle(drafts: TaskDraft[]): string[] | null {
  const byKey = new Map(drafts.map((d) => [d.key, d]));
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];
  const visit = (key: string): string[] | null => {
    if (state.get(key) === "done") return null;
    if (state.get(key) === "visiting") {
      const start = path.indexOf(key);
      return [...path.slice(start), key].map((k) => byKey.get(k)?.title ?? k);
    }
    state.set(key, "visiting");
    path.push(key);
    for (const dep of byKey.get(key)?.dependsOnKeys ?? []) {
      const found = visit(dep);
      if (found) return found;
    }
    path.pop();
    state.set(key, "done");
    return null;
  };
  for (const d of drafts) {
    const found = visit(d.key);
    if (found) return found;
  }
  return null;
}
