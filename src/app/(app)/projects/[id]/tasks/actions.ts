"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthorizationError, requirePermission } from "@/lib/auth/current-user";
import { canViewProject } from "@/lib/auth/permissions";
import { queueCalendarSync } from "@/lib/calendar-sync";
import { loadWorkflowSettings } from "@/lib/data/workflow-settings";
import { canChoosePhase } from "@/lib/domain/workflow";
import { getStore } from "@/lib/data";
import { isIsoDate } from "@/lib/domain/dates";
import { moveTask, nextOrder, wouldCreateCycle } from "@/lib/domain/program-edit";
import type { Project, Task, TaskEdit } from "@/lib/domain/types";

/**
 * Editing ONE program's tasks. These actions only ever write to that
 * program's own task records: templates and other programs are never touched.
 * Every input is re-validated here; the browser is not trusted.
 */

export interface TaskFormState {
  error?: string;
  fieldErrors?: Partial<Record<"title" | "dueDate" | "dependsOn" | "phase", string>>;
}

/** Signed-in user may edit this program's tasks; returns the program and its tasks. */
async function loadEditableProgram(projectId: string): Promise<{ project: Project; tasks: Task[] }> {
  const user = await requirePermission("program.editTasks");
  const store = getStore();
  const project = await store.getProject(projectId);
  if (!project || !canViewProject(user, project)) throw new AuthorizationError("That program isn't available.");
  return { project, tasks: await store.getTasksByIds(project.taskIds) };
}

function revalidateProgram(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath("/my-tasks");
}

export async function saveTask(_prev: TaskFormState, formData: FormData): Promise<TaskFormState> {
  const projectId = String(formData.get("projectId") ?? "");
  const taskId = String(formData.get("taskId") ?? "");
  let savedId: string;
  try {
    const { project, tasks } = await loadEditableProgram(projectId);
    const store = getStore();
    const existing = taskId ? tasks.find((t) => t.id === taskId) : undefined;
    if (taskId && !existing) return { error: "That task is no longer in this program." };

    const title = String(formData.get("title") ?? "").trim();
    const dueRaw = String(formData.get("dueDate") ?? "").trim();
    const phase = String(formData.get("phase") ?? "").trim();
    const fieldErrors: TaskFormState["fieldErrors"] = {};
    if (!title) fieldErrors.title = "Give the task a title.";
    else if (title.length > 200) fieldErrors.title = "Keep the title under 200 characters.";
    if (dueRaw && !isIsoDate(dueRaw)) fieldErrors.dueDate = "Enter a valid date.";
    const { config: workflow } = await loadWorkflowSettings(store);
    if (!canChoosePhase(workflow, phase, existing?.phase)) fieldErrors.phase = "Choose an active phase. Administrators can add phases in Workflow settings.";
    if (phase.length > 50) fieldErrors.phase = "Keep the phase under 50 characters.";

    // People must be active staff; prerequisites must be other tasks in THIS program.
    const users = await store.listUsers();
    const assignable = new Set(users.filter((u) => u.active && u.accessLevel !== "Partner").map((u) => u.id));
    const assigneeIds = [...new Set(formData.getAll("assignee").map(String))].filter((id) => assignable.has(id));
    const inProgram = new Set(tasks.map((t) => t.id));
    const dependsOnTaskIds = [...new Set(formData.getAll("dependsOn").map(String))].filter(
      (id) => inProgram.has(id) && id !== taskId,
    );
    if (existing && wouldCreateCycle(tasks, existing.id, dependsOnTaskIds))
      fieldErrors.dependsOn = "That would create a loop: one of those tasks already waits for this one.";
    if (Object.keys(fieldErrors).length) return { fieldErrors };

    const edit: TaskEdit = {
      title,
      description: String(formData.get("description") ?? "")
        .trim()
        .slice(0, 5000),
      phase,
      dueDate: dueRaw || null,
      ownerRole: String(formData.get("ownerRole") ?? "")
        .trim()
        .slice(0, 200),
      assigneeIds,
      dependsOnTaskIds,
    };
    const saved = existing
      ? await store.updateTaskDetails(existing.id, edit)
      : // New tasks go to the end of their phase.
        await store.createTask({
          ...edit,
          projectId: project.id,
          order: nextOrder(tasks.filter((t) => t.phase === phase)),
        });
    savedId = saved.id;
    // Both old and new assignees: someone taken off a task loses its event.
    queueCalendarSync([...(existing?.assigneeIds ?? []), ...saved.assigneeIds]);
  } catch (err) {
    if (err instanceof AuthorizationError) return { error: err.message };
    console.error("saveTask failed:", err instanceof Error ? err.message : "unknown error");
    return { error: "Couldn't save the task. Please try again." };
  }
  revalidateProgram(projectId);
  redirect(`/projects/${projectId}?saved=${encodeURIComponent(savedId)}#task-${savedId}`);
}

export async function removeTask(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const taskId = String(formData.get("taskId") ?? "");
  const { tasks } = await loadEditableProgram(projectId);
  if (!tasks.some((t) => t.id === taskId)) throw new AuthorizationError("That task is no longer in this program.");
  await getStore().deleteTask(taskId);
  queueCalendarSync(tasks.find((t) => t.id === taskId)!.assigneeIds);
  revalidateProgram(projectId);
  redirect(`/projects/${projectId}?removed=1`);
}

export async function moveTaskAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const taskId = String(formData.get("taskId") ?? "");
  const direction = formData.get("direction") === "down" ? "down" : "up";
  const { tasks } = await loadEditableProgram(projectId);
  const updates = moveTask(tasks, taskId, direction);
  if (updates.length) await getStore().reorderTasks(updates);
  revalidateProgram(projectId);
}
