/**
 * Derived task state: blocked / overdue. Computed, never stored, so it can
 * never get out of sync with the underlying data.
 */
import type { Task } from "./types";

export function isComplete(task: Pick<Task, "status">): boolean {
  return task.status === "Done" || task.status === "Not Needed";
}

/** Prerequisite tasks that are not yet complete. */
export function openPrerequisites(task: Task, allTasks: Map<string, Task>): Task[] {
  return task.dependsOnTaskIds
    .map((id) => allTasks.get(id))
    .filter((t): t is Task => !!t && !isComplete(t));
}

export function isOverdue(task: Task, todayIso: string): boolean {
  return !isComplete(task) && !!task.dueDate && task.dueDate < todayIso;
}

export interface ProjectProgress {
  total: number;
  complete: number;
  overdue: number;
  blocked: number;
  percent: number;
}

export function projectProgress(tasks: Task[], todayIso: string): ProjectProgress {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const complete = tasks.filter(isComplete).length;
  return {
    total: tasks.length,
    complete,
    overdue: tasks.filter((t) => isOverdue(t, todayIso)).length,
    blocked: tasks.filter((t) => !isComplete(t) && openPrerequisites(t, byId).length > 0).length,
    percent: tasks.length ? Math.round((complete / tasks.length) * 100) : 0,
  };
}
