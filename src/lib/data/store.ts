import type { WorkflowConfig } from "@/lib/domain/workflow";
import type {
  CalendarConnection,
  NewProjectInput,
  NewTaskInput,
  NewTemplateInput,
  StepDraft,
  TaskEdit,
  ProgramTemplate,
  Project,
  ProjectStatus,
  Site,
  Task,
  TaskDraft,
  TaskStatus,
  User,
} from "@/lib/domain/types";

/**
 * Everything the app needs from persistent storage.
 *
 * The production implementation is AirtableStore. MemoryStore is a
 * DEVELOPMENT PLACEHOLDER only (data disappears on restart) and is refused
 * in production deployments.
 *
 * Authorization is NOT done here; callers must check permissions first
 * (see src/lib/auth/permissions.ts).
 */
export interface DataStore {
  getWorkflowConfig(): Promise<WorkflowConfig | null>;
  saveWorkflowConfig(config: WorkflowConfig): Promise<void>;

  readonly kind: "airtable" | "memory";

  getUserByEmail(email: string): Promise<User | null>;
  getUser(id: string): Promise<User | null>;
  listUsers(): Promise<User[]>;

  listSites(): Promise<Site[]>;
  listTemplates(opts?: { activeOnly?: boolean }): Promise<ProgramTemplate[]>;
  getTemplate(id: string): Promise<ProgramTemplate | null>;

  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;

  getTask(id: string): Promise<Task | null>;
  getTasksByIds(ids: string[]): Promise<Task[]>;

  /**
   * Creates the project, then its tasks, then wires task dependencies.
   * The project is created with status "Setting Up" and switched to
   * "Planning" only after every task saved, so a partial failure is visible.
   */
  createProjectWithTasks(input: NewProjectInput, drafts: TaskDraft[]): Promise<Project>;

  updateTask(id: string, patch: { status?: TaskStatus; notes?: string }): Promise<Task>;
  updateProjectStatus(id: string, status: ProjectStatus): Promise<void>;

  // ---- Editing one program's tasks (never touches templates or other programs) ----

  /** Add a task to a program. */
  createTask(input: NewTaskInput): Promise<Task>;
  /** Change a task's details (title, dates, people, dependencies…). Status is unchanged. */
  updateTaskDetails(id: string, edit: TaskEdit): Promise<Task>;
  /** Save new Order values (used for reordering). */
  reorderTasks(updates: { id: string; order: number }[]): Promise<void>;
  /** Remove a task; other tasks in its program stop depending on it first. */
  deleteTask(id: string): Promise<void>;

  // ---- Templates ----

  /** Create a NEW template with its steps, then wire step dependencies. */
  createTemplate(input: NewTemplateInput, steps: StepDraft[]): Promise<ProgramTemplate>;

  // ---- Google Calendar connections (one per user; tokens are stored encrypted) ----

  getCalendarConnection(userId: string): Promise<CalendarConnection | null>;
  listCalendarConnections(): Promise<CalendarConnection[]>;
  /** Create or replace the user's connection. */
  saveCalendarConnection(connection: CalendarConnection): Promise<void>;
  deleteCalendarConnection(userId: string): Promise<void>;
}

/** The storage for a feature hasn't been set up yet (e.g. a missing Airtable table). */
export class StorageNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageNotReadyError";
  }
}
