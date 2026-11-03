/**
 * Domain types used by the UI and business logic.
 * These are deliberately independent of Airtable field names
 * (see src/lib/airtable/schema.ts for the mapping).
 *
 * Dates are ISO calendar dates "YYYY-MM-DD" (no time zone).
 */

export const ACCESS_LEVELS = ["Admin", "Staff", "Partner"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const TASK_STATUSES = ["Not Started", "In Progress", "Done", "Not Needed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PROJECT_STATUSES = ["Setting Up", "Planning", "Active", "Completed", "Cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const OFFSET_UNITS = ["Days", "Weeks", "Months"] as const;
export type OffsetUnit = (typeof OFFSET_UNITS)[number];

export type Timing = "Before" | "After";
export type Anchor = "Program Start" | "Program End";

export interface User {
  id: string;
  name: string;
  email: string;
  accessLevel: AccessLevel;
  active: boolean;
  /** IDs of projects where this user is on the team */
  projectIds: string[];
  /** IDs of tasks assigned to this user */
  assignedTaskIds: string[];
}

export interface Site {
  id: string;
  name: string;
  location: string;
  partnerOrganization: string;
  siteType: string;
}

export interface TemplateStep {
  id: string;
  templateId: string;
  title: string;
  description: string;
  order: number;
  phase: string;
  offsetAmount: number;
  offsetUnit: OffsetUnit;
  timing: Timing;
  anchor: Anchor;
  defaultOwnerRole: string;
  dependsOnStepIds: string[];
}

export interface ProgramTemplate {
  id: string;
  name: string;
  programType: string;
  description: string;
  active: boolean;
  steps: TemplateStep[];
}

export interface Project {
  id: string;
  name: string;
  siteId: string | null;
  siteName: string;
  templateId: string | null;
  templateName: string;
  startDate: string | null;
  endDate: string | null;
  status: ProjectStatus;
  teamUserIds: string[];
  taskIds: string[];
  notes: string;
}

export interface Task {
  id: string;
  projectId: string | null;
  templateStepId: string | null;
  title: string;
  description: string;
  assigneeIds: string[];
  ownerRole: string;
  phase: string;
  order: number;
  dueDate: string | null;
  status: TaskStatus;
  dependsOnTaskIds: string[];
  notes: string;
  documentLinks: string[];
  completedAt: string | null;
}

export interface NewProjectInput {
  name: string;
  siteId: string;
  templateId: string;
  startDate: string;
  endDate: string | null;
  teamUserIds: string[];
  createdByUserId: string;
}

/** A task to be created, before it has an Airtable ID. */
export interface TaskDraft {
  /** Temporary key (the template step ID) used to wire dependencies */
  key: string;
  templateStepId: string;
  title: string;
  description: string;
  ownerRole: string;
  assigneeIds: string[];
  phase: string;
  order: number;
  dueDate: string;
  /** Keys of other drafts this one depends on */
  dependsOnKeys: string[];
}
