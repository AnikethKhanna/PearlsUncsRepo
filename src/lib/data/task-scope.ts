/**
 * Loads the tasks one person may see in a dashboard-style view (My Tasks,
 * Calendar). Shared so every view applies exactly the same permission rules:
 *
 * - only active programs (not Completed/Cancelled) the user can view;
 * - scope "mine": tasks assigned to the user;
 * - scope "all": every task in those programs, only for people with
 *   "task.viewAll" (parseFilters already forces "mine" for everyone else, and
 *   canViewTask re-checks each task here as a second line of defence).
 *
 * Takes the store as a parameter (instead of calling getStore) so it can be
 * unit-tested against the in-memory store.
 */
import { canViewProject, canViewTask } from "@/lib/auth/permissions";
import type { DashboardRow, Scope } from "@/lib/domain/task-dashboard";
import { isComplete, openPrerequisites } from "@/lib/domain/task-state";
import type { Project, Task, User } from "@/lib/domain/types";
import type { DataStore } from "./store";

export interface ScopedTasks {
  /** Active programs this user may view */
  projects: Project[];
  projectById: Map<string, Project>;
  /** Tasks in scope that the user may view */
  tasks: Task[];
  /** Tasks in scope plus their prerequisites (for "blocked" checks) */
  byId: Map<string, Task>;
  users: User[];
  userName: Map<string, string>;
  rows: DashboardRow[];
}

export function isActiveProject(p: Pick<Project, "status">): boolean {
  return p.status !== "Completed" && p.status !== "Cancelled";
}

export async function loadTasksInScope(store: DataStore, user: User, scope: Scope): Promise<ScopedTasks> {
  const projects = (await store.listProjects()).filter((p) => canViewProject(user, p) && isActiveProject(p));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const taskIds = scope === "all" ? projects.flatMap((p) => p.taskIds) : user.assignedTaskIds;
  const tasks = (await store.getTasksByIds(taskIds)).filter((t) => {
    const project = t.projectId ? projectById.get(t.projectId) : undefined;
    if (!project || !canViewTask(user, project, t)) return false;
    return scope === "all" || t.assigneeIds.includes(user.id);
  });
  const inScope = new Set(tasks.map((t) => t.id));
  const [prereqs, users] = await Promise.all([
    store.getTasksByIds([...new Set(tasks.flatMap((t) => t.dependsOnTaskIds))].filter((id) => !inScope.has(id))),
    store.listUsers(),
  ]);
  const byId = new Map([...tasks, ...prereqs].map((t) => [t.id, t]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const rows: DashboardRow[] = tasks.map((t) => ({
    task: t,
    projectName: projectById.get(t.projectId!)!.name,
    blocked: !isComplete(t) && openPrerequisites(t, byId).length > 0,
    assigneeNames: t.assigneeIds.map((id) => userName.get(id) ?? "Unknown"),
  }));
  return { projects, projectById, tasks, byId, users, userName, rows };
}
