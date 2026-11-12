/**
 * Pure helpers for editing ONE program's tasks (add, edit, remove, reorder).
 * Nothing here touches templates: a program's tasks are its own copies.
 */
import { SYSTEM_PHASES } from "./workflow";
import type { Task } from "./types";

export const PHASE_ORDER: readonly string[] = SYSTEM_PHASES;

function phaseRank(phase: string, order: readonly string[] = PHASE_ORDER): number {
  const i = order.indexOf(phase);
  return i === -1 ? order.length : i;
}

/** The program's own order: by phase, then the editable Order field, then due date. */
export function sortForDisplay<T extends Pick<Task, "phase" | "order" | "dueDate">>(tasks: T[], phaseOrder: readonly string[] = PHASE_ORDER): T[] {
  return [...tasks].sort(
    (a, b) =>
      phaseRank(a.phase || "Other", phaseOrder) - phaseRank(b.phase || "Other", phaseOrder) ||
      a.order - b.order ||
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
  );
}

/** Phases present in a task list, in display order. */
export function phasesOf(tasks: Pick<Task, "phase">[], phaseOrder: readonly string[] = PHASE_ORDER): string[] {
  return [...new Set(tasks.map((t) => t.phase || "Other"))].sort((a, b) => phaseRank(a, phaseOrder) - phaseRank(b, phaseOrder));
}

/** Order value for a task added at the end of the program. */
export function nextOrder(tasks: Pick<Task, "order">[]): number {
  return tasks.reduce((max, t) => Math.max(max, t.order), 0) + 1;
}

/**
 * Move a task one place up or down within its phase.
 * Returns the minimal set of { id, order } changes to save (empty if it can't move).
 * If neighbouring orders are equal (older data), the phase is renumbered.
 */
export function moveTask(
  tasks: Pick<Task, "id" | "phase" | "order" | "dueDate">[],
  taskId: string,
  direction: "up" | "down",
): { id: string; order: number }[] {
  const target = tasks.find((t) => t.id === taskId);
  if (!target) return [];
  const section = sortForDisplay(tasks.filter((t) => (t.phase || "Other") === (target.phase || "Other")));
  const i = section.findIndex((t) => t.id === taskId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= section.length) return [];

  const a = section[i];
  const b = section[j];
  if (a.order !== b.order) {
    return [
      { id: a.id, order: b.order },
      { id: b.id, order: a.order },
    ];
  }
  // Equal orders: renumber the whole phase after swapping positions.
  const reordered = [...section];
  [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
  const base = Math.min(...section.map((t) => t.order));
  return reordered
    .map((t, k) => ({ id: t.id, order: base + k }))
    .filter((u) => section.find((t) => t.id === u.id)!.order !== u.order);
}

/** Would making `taskId` depend on `newDeps` create a loop (A waits for B waits for A)? */
export function wouldCreateCycle(
  tasks: Pick<Task, "id" | "dependsOnTaskIds">[],
  taskId: string,
  newDeps: string[],
): boolean {
  const deps = new Map(tasks.map((t) => [t.id, t.dependsOnTaskIds]));
  deps.set(taskId, newDeps);
  const seen = new Set<string>();
  const stack = [...newDeps];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(deps.get(id) ?? []));
  }
  return false;
}
