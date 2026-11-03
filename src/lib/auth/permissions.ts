/**
 * Who can do what. Enforced on the SERVER in every page and server action;
 * hiding buttons in the UI is only a convenience.
 *
 * To change what an access level may do, edit ROLE_PERMISSIONS below.
 * Access levels are stored per user in Airtable (Users → Access Level),
 * independent of job title.
 */
import type { AccessLevel, Project, User } from "@/lib/domain/types";

export const PERMISSIONS = [
  "project.create", // create projects (and generate their tasks)
  "project.viewAll", // see every project, not only ones you're on
  "task.update", // change status / notes on tasks in projects you can see
  "task.create", // add extra tasks to a project
  "admin.manage", // templates, users, sites, settings
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<AccessLevel, readonly Permission[]> = {
  Admin: PERMISSIONS,
  Staff: ["task.update"],
  // External partner access is pending sponsor confirmation: no access for now.
  Partner: [],
};

type Actor = Pick<User, "id" | "accessLevel" | "active" | "assignedTaskIds">;

export function can(user: Actor | null, permission: Permission): boolean {
  return !!user && user.active && ROLE_PERMISSIONS[user.accessLevel].includes(permission);
}

/** Staff see projects they are on the team for, or have at least one task in. */
export function canViewProject(user: Actor | null, project: Pick<Project, "teamUserIds" | "taskIds">): boolean {
  if (!user || !user.active) return false;
  if (can(user, "project.viewAll")) return true;
  if (user.accessLevel === "Partner") return false; // pending sponsor decision
  if (project.teamUserIds.includes(user.id)) return true;
  const mine = new Set(user.assignedTaskIds);
  return project.taskIds.some((id) => mine.has(id));
}

export function canUpdateTaskIn(user: Actor | null, project: Pick<Project, "teamUserIds" | "taskIds">): boolean {
  return can(user, "task.update") && canViewProject(user, project);
}
