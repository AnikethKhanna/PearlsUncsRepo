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
  /** Job title, e.g. "Program Manager". Used to pre-fill role assignments; NOT a permission. */
  jobTitle: string;
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
  /** One or more roles that share the task, e.g. ["Program Manager", "Executive Director"] */
  defaultOwnerRoles: string[];
  /**
   * Optional default people (only set when a template was saved from a program
   * with "include assignments" ticked). Used only when nobody is picked for the
   * step's roles.
   */
  defaultAssigneeIds: string[];
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

/** Editable fields of a task inside one program. Editing never touches the template. */
export interface TaskEdit {
  title: string;
  description: string;
  phase: string;
  dueDate: string | null;
  ownerRole: string;
  assigneeIds: string[];
  dependsOnTaskIds: string[];
}

export interface NewTaskInput extends TaskEdit {
  projectId: string;
  order: number;
}

export interface NewTemplateInput {
  name: string;
  programType: string;
  description: string;
}

/** A template step to be created, before it has an ID. */
export interface StepDraft {
  /** Temporary key (e.g. the source task ID) used to wire dependencies */
  key: string;
  title: string;
  description: string;
  order: number;
  phase: string;
  offsetAmount: number;
  offsetUnit: OffsetUnit;
  timing: Timing;
  anchor: Anchor;
  defaultOwnerRoles: string[];
  defaultAssigneeIds: string[];
  dependsOnKeys: string[];
}

// ---- Google Calendar sync (one optional connection per user) ----

export const OVERDUE_REMINDER_MODES = ["off", "daily", "weekly"] as const;
export type OverdueReminderMode = (typeof OVERDUE_REMINDER_MODES)[number];

export const CALENDAR_CONNECTION_STATUSES = ["connected", "needs_reconnect", "error"] as const;
export type CalendarConnectionStatus = (typeof CALENDAR_CONNECTION_STATUSES)[number];

export interface CalendarConnection {
  userId: string;
  /** Google account the calendar belongs to (shown to the user) */
  googleEmail: string;
  /** Refresh token, AES-256-GCM encrypted with TOKEN_ENCRYPTION_KEY. Never sent to the browser. */
  encryptedRefreshToken: string;
  /** Google calendar ID; "primary" is the user's main calendar */
  calendarId: string;
  calendarName: string;
  /** IANA time zone of the chosen calendar, used for the timed overdue reminder */
  calendarTimeZone: string;
  syncEnabled: boolean;
  /** Pop-up reminders for each deadline, in whole days before the due date (1–7) */
  reminderDays: number[];
  /** Time of day for those reminders, "HH:MM" in the calendar's time zone */
  reminderTime: string;
  overdueReminders: OverdueReminderMode;
  status: CalendarConnectionStatus;
  /** ISO timestamp of the last successful sync */
  lastSyncedAt: string | null;
  /** Plain-language problem from the last sync (never contains tokens) */
  lastError: string | null;
}
