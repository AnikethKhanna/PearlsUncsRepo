/**
 * Who can do what. Enforced on the SERVER in every page and server action;
 * hiding buttons in the UI is only a convenience.
 *
 * To change what an access level may do, edit ROLE_PERMISSIONS below.
 * Access levels are stored per user in Airtable (Users → Access Level),
 * independent of job title.
 */
import type { AccessLevel, Project, Task, User } from "@/lib/domain/types";
import { isDemoEmail } from "./demo-accounts";

export const PERMISSIONS = [
  "project.create", // create projects (and generate their tasks)
  "project.viewAll", // see every project, not only ones you have tasks in
  "task.viewAll", // see every task in a project you can see, not only your own
  "task.updateOwn", // change status on tasks assigned to you
  "task.updateAny", // change status on any task in a project you can see
  "program.editTasks", // add, edit, remove and reorder tasks in ONE program (never changes its template)
  "template.manage", // view templates and "Save as Template" from a program
  "task.export", // export only tasks visible to the current user
  "workflow.manage", // configure phases and deadline presets
  "calendar.sync", // connect your OWN Google Calendar and sync YOUR assigned task deadlines to it
  "admin.manage", // users, sites, settings
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<AccessLevel, readonly Permission[]> = {
  // Admins see and change everything.
  Admin: PERMISSIONS,
  // Staff see and update only the tasks assigned to them.
  Staff: ["task.updateOwn", "calendar.sync", "task.export"],
  // External partner access is pending sponsor confirmation: no access for now.
  Partner: [],
};

/** Plain-language summary shown in the app, so testers know what to expect. */
export const ACCESS_SUMMARY: Record<AccessLevel, string> = {
  Admin: "Sees and updates every project and task, creates projects, edits program tasks and saves templates.",
  Staff: "Sees and updates only the tasks assigned to them.",
  Partner: "No access yet (external partner access is pending the sponsor's decision).",
};

type Actor = Pick<User, "id" | "accessLevel" | "active" | "assignedTaskIds"> & { email?: string };
type ProjectRef = Pick<Project, "teamUserIds" | "taskIds">;

/**
 * Demo accounts (shared password, see demo-accounts.ts) never get features that
 * act on a Google account: nobody owns the Google account behind an @example.com email.
 */
const DEMO_DENIED: ReadonlySet<Permission> = new Set<Permission>(["calendar.sync", "task.export"]);

export function can(user: Actor | null, permission: Permission): boolean {
  if (!user || !user.active) return false;
  if (DEMO_DENIED.has(permission) && isDemoEmail(user.email)) return false;
  return ROLE_PERMISSIONS[user.accessLevel].includes(permission);
}

/** Admins see every project; Staff see projects where they have at least one task. */
export function canViewProject(user: Actor | null, project: ProjectRef): boolean {
  if (!user || !user.active) return false;
  if (can(user, "project.viewAll")) return true;
  if (user.accessLevel === "Partner") return false; // pending sponsor decision
  const mine = new Set(user.assignedTaskIds);
  return project.taskIds.some((id) => mine.has(id));
}

function isAssignee(user: Actor, task: Pick<Task, "assigneeIds">): boolean {
  return task.assigneeIds.includes(user.id);
}

export function canViewTask(user: Actor | null, project: ProjectRef, task: Pick<Task, "assigneeIds">): boolean {
  if (!user || !canViewProject(user, project)) return false;
  return can(user, "task.viewAll") || isAssignee(user, task);
}

export function canUpdateTask(user: Actor | null, project: ProjectRef, task: Pick<Task, "assigneeIds">): boolean {
  if (!user || !canViewProject(user, project)) return false;
  if (can(user, "task.updateAny")) return true;
  return can(user, "task.updateOwn") && isAssignee(user, task);
}
