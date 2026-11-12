import type {
  NewProjectInput,
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
 * The production implementation is AirtableStore. FirestoreStore is the
 * planned replacement (DATA_BACKEND=firestore, see docs/firestore-migration.md);
 * only one backend is ever active, so data is never written to both. MemoryStore is a
 * DEVELOPMENT PLACEHOLDER only (data disappears on restart) and is refused
 * in production deployments.
 *
 * Authorization is NOT done here; callers must check permissions first
 * (see src/lib/auth/permissions.ts).
 */
export interface DataStore {
  readonly kind: "airtable" | "memory" | "firestore";

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
}
