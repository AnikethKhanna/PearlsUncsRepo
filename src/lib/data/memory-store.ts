/**
 * ⚠️ DEVELOPMENT PLACEHOLDER — NOT PERSISTENT.
 *
 * In-memory DataStore seeded with illustrative sample data, so the UI can be
 * built and demonstrated without Airtable credentials. Everything is lost
 * when the server restarts. The app shows a warning banner while it is in use,
 * and src/lib/config.ts refuses it in production deployments.
 */
import { addDays, dayOfWeek, today } from "@/lib/domain/dates";
import { generateTaskDrafts, rolesForSteps } from "@/lib/domain/generate-tasks";
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
import { SAMPLE_SITES, SAMPLE_TEMPLATES, SAMPLE_USERS } from "./sample-data";
import type { DataStore } from "./store";

interface State {
  users: User[];
  sites: Site[];
  templates: ProgramTemplate[];
  projects: Project[];
  tasks: Task[];
  calendarConnections: CalendarConnection[];
  seq: number;
}

function freshState(): State {
  return structuredClone({
    users: SAMPLE_USERS,
    sites: SAMPLE_SITES,
    templates: SAMPLE_TEMPLATES,
    projects: [],
    tasks: [],
    calendarConnections: [],
    seq: 1,
  });
}

export class MemoryStore implements DataStore {
  readonly kind = "memory" as const;
  constructor(
    private readonly s: State = freshState(),
    seedProjects = true,
  ) {
    if (seedProjects) seedSampleProjects(this);
  }

  private id(prefix: string) {
    return `${prefix}${String(this.s.seq++).padStart(6, "0")}`;
  }
  private withLinks(u: User): User {
    return {
      ...u,
      projectIds: this.s.projects.filter((p) => p.teamUserIds.includes(u.id)).map((p) => p.id),
      assignedTaskIds: this.s.tasks.filter((t) => t.assigneeIds.includes(u.id)).map((t) => t.id),
    };
  }

  async getUserByEmail(email: string) {
    const u = this.s.users.find((x) => x.email === email.trim().toLowerCase());
    return u ? this.withLinks(u) : null;
  }
  async getUser(id: string) {
    const u = this.s.users.find((x) => x.id === id);
    return u ? this.withLinks(u) : null;
  }
  async listUsers() {
    return this.s.users.map((u) => this.withLinks(u));
  }
  async listSites() {
    return structuredClone(this.s.sites);
  }
  async listTemplates(opts: { activeOnly?: boolean } = {}) {
    return structuredClone(this.s.templates.filter((t) => !opts.activeOnly || t.active));
  }
  async getTemplate(id: string) {
    return structuredClone(this.s.templates.find((t) => t.id === id) ?? null);
  }
  async listProjects() {
    return structuredClone([...this.s.projects].sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? "")));
  }
  async getProject(id: string) {
    return structuredClone(this.s.projects.find((p) => p.id === id) ?? null);
  }
  async getTask(id: string) {
    return structuredClone(this.s.tasks.find((t) => t.id === id) ?? null);
  }
  async getTasksByIds(ids: string[]) {
    const set = new Set(ids);
    return structuredClone(this.s.tasks.filter((t) => set.has(t.id)));
  }

  async createProjectWithTasks(input: NewProjectInput, drafts: TaskDraft[]): Promise<Project> {
    return structuredClone(this.insertProject(input, drafts));
  }

  /** Synchronous insert, shared by createProjectWithTasks and the sample-project seeding. */
  insertProject(input: NewProjectInput, drafts: TaskDraft[]): Project {
    const project: Project = {
      id: this.id("proj"),
      name: input.name,
      siteId: input.siteId,
      siteName: this.s.sites.find((x) => x.id === input.siteId)?.name ?? "",
      templateId: input.templateId,
      templateName: this.s.templates.find((x) => x.id === input.templateId)?.name ?? "",
      startDate: input.startDate,
      endDate: input.endDate,
      status: "Setting Up",
      teamUserIds: [...new Set([...input.teamUserIds, input.createdByUserId])],
      taskIds: [],
      notes: "",
    };
    this.s.projects.push(project);
    const idByKey = new Map(drafts.map((d) => [d.key, this.id("task")]));
    for (const d of drafts) {
      const task: Task = {
        id: idByKey.get(d.key)!,
        projectId: project.id,
        templateStepId: d.templateStepId,
        title: d.title,
        description: d.description,
        assigneeIds: [...d.assigneeIds],
        ownerRole: d.ownerRole,
        phase: d.phase,
        order: d.order,
        dueDate: d.dueDate,
        status: "Not Started",
        dependsOnTaskIds: d.dependsOnKeys.map((k) => idByKey.get(k)!).filter(Boolean),
        notes: "",
        documentLinks: [],
        completedAt: null,
      };
      this.s.tasks.push(task);
      project.taskIds.push(task.id);
    }
    project.status = "Planning";
    return project;
  }

  /** Seeding helper: set a task's status as if it had been updated on its due date. */
  seedTaskStatus(id: string, status: TaskStatus) {
    const t = this.s.tasks.find((x) => x.id === id);
    if (!t) return;
    t.status = status;
    t.completedAt = status === "Done" ? (t.dueDate && t.dueDate < today() ? t.dueDate : today()) : null;
  }

  /** Seeding helper: move a sample task's due date (demo data only). */
  seedTaskDueDate(id: string, dueDate: string) {
    const t = this.s.tasks.find((x) => x.id === id);
    if (t) t.dueDate = dueDate;
  }

  seedProjectStatus(id: string, status: ProjectStatus) {
    const p = this.s.projects.find((x) => x.id === id);
    if (p) p.status = status;
  }

  tasksOf(projectId: string): Task[] {
    return this.s.tasks.filter((t) => t.projectId === projectId);
  }

  async updateTask(id: string, patch: { status?: TaskStatus; notes?: string }) {
    const t = this.s.tasks.find((x) => x.id === id);
    if (!t) throw new Error("Task not found");
    if (patch.status) {
      t.status = patch.status;
      t.completedAt = patch.status === "Done" ? today() : null;
    }
    if (patch.notes !== undefined) t.notes = patch.notes;
    return structuredClone(t);
  }

  async updateProjectStatus(id: string, status: ProjectStatus) {
    const p = this.s.projects.find((x) => x.id === id);
    if (p) p.status = status;
  }

  async createTask(input: NewTaskInput): Promise<Task> {
    const project = this.s.projects.find((p) => p.id === input.projectId);
    if (!project) throw new Error("Project not found");
    const task: Task = {
      ...structuredClone(pickEdit(input)),
      id: this.id("task"),
      projectId: project.id,
      templateStepId: null,
      order: input.order,
      status: "Not Started",
      notes: "",
      documentLinks: [],
      completedAt: null,
    };
    this.s.tasks.push(task);
    project.taskIds.push(task.id);
    return structuredClone(task);
  }

  async updateTaskDetails(id: string, edit: TaskEdit): Promise<Task> {
    const t = this.s.tasks.find((x) => x.id === id);
    if (!t) throw new Error("Task not found");
    Object.assign(t, structuredClone(pickEdit(edit)));
    return structuredClone(t);
  }

  async reorderTasks(updates: { id: string; order: number }[]): Promise<void> {
    for (const u of updates) {
      const t = this.s.tasks.find((x) => x.id === u.id);
      if (t) t.order = u.order;
    }
  }

  async deleteTask(id: string): Promise<void> {
    for (const t of this.s.tasks) t.dependsOnTaskIds = t.dependsOnTaskIds.filter((d) => d !== id);
    for (const p of this.s.projects) p.taskIds = p.taskIds.filter((t) => t !== id);
    this.s.tasks = this.s.tasks.filter((t) => t.id !== id);
  }

  async createTemplate(input: NewTemplateInput, steps: StepDraft[]): Promise<ProgramTemplate> {
    const templateId = this.id("tpl");
    const idByKey = new Map(steps.map((d) => [d.key, this.id("step")]));
    const template: ProgramTemplate = {
      id: templateId,
      name: input.name,
      programType: input.programType,
      description: input.description,
      active: true,
      steps: steps.map((d) => ({
        id: idByKey.get(d.key)!,
        templateId,
        title: d.title,
        description: d.description,
        order: d.order,
        phase: d.phase,
        offsetAmount: d.offsetAmount,
        offsetUnit: d.offsetUnit,
        timing: d.timing,
        anchor: d.anchor,
        defaultOwnerRoles: [...d.defaultOwnerRoles],
        defaultAssigneeIds: [...d.defaultAssigneeIds],
        dependsOnStepIds: d.dependsOnKeys.map((k) => idByKey.get(k)!).filter(Boolean),
      })),
    };
    this.s.templates.push(template);
    return structuredClone(template);
  }

  // ---- Google Calendar connections ----

  async getCalendarConnection(userId: string) {
    return structuredClone(this.s.calendarConnections.find((c) => c.userId === userId) ?? null);
  }
  async listCalendarConnections() {
    return structuredClone(this.s.calendarConnections);
  }
  async saveCalendarConnection(connection: CalendarConnection) {
    this.s.calendarConnections = [
      ...this.s.calendarConnections.filter((c) => c.userId !== connection.userId),
      structuredClone(connection),
    ];
  }
  async deleteCalendarConnection(userId: string) {
    this.s.calendarConnections = this.s.calendarConnections.filter((c) => c.userId !== userId);
  }
}

function pickEdit(e: TaskEdit): TaskEdit {
  return {
    title: e.title,
    description: e.description,
    phase: e.phase,
    dueDate: e.dueDate,
    ownerRole: e.ownerRole,
    assigneeIds: [...e.assigneeIds],
    dependsOnTaskIds: [...e.dependsOnTaskIds],
  };
}

/**
 * Pre-loads three SAMPLE projects so every screen has something to show.
 * Dates are relative to today, so there are always some overdue, current and
 * upcoming tasks. Project names are marked "(sample)".
 */
function seedSampleProjects(store: MemoryStore) {
  const t0 = today();
  const users = SAMPLE_USERS.filter((u) => u.active && u.accessLevel !== "Partner");
  const byTitle = (role: string) =>
    users.filter((u) => u.jobTitle.toLowerCase() === role.toLowerCase()).map((u) => u.id);
  const admin = users.find((u) => u.accessLevel === "Admin")!.id;

  const make = (
    name: string,
    templateId: string,
    siteId: string,
    startDate: string,
    endDate: string,
    overrides: Record<string, string[]> = {},
  ) => {
    const template = SAMPLE_TEMPLATES.find((t) => t.id === templateId)!;
    const roleAssignments = Object.fromEntries(
      rolesForSteps(template.steps).map((r) => [r, overrides[r] ?? byTitle(r)]),
    );
    const { drafts } = generateTaskDrafts({ steps: template.steps, startDate, endDate, roleAssignments });
    const project = store.insertProject(
      {
        name,
        siteId,
        templateId,
        startDate,
        endDate,
        teamUserIds: [...new Set(Object.values(roleAssignments).flat())],
        createdByUserId: admin,
      },
      drafts,
    );
    const tasks = store.tasksOf(project.id);
    // DEMO ONLY: most template steps are "N weeks before program start", so their generated
    // dates all share the start date's weekday, which looks odd on the calendar. Spread the
    // pre-program tasks over Monday–Friday by moving each one 0–6 days EARLIER (never later,
    // so nothing slips past the program start). Program-week tasks keep their exact dates.
    // Real programs use the template's dates as generated.
    tasks.forEach((t, i) => {
      if (!t.dueDate || t.dueDate >= startDate) return;
      const weekday = 1 + (i % 5); // Mon..Fri
      store.seedTaskDueDate(t.id, addDays(t.dueDate, -((dayOfWeek(t.dueDate) - weekday + 7) % 7)));
    });
    return { project, tasks };
  };

  // 1. In-flight collegiate program (from the spreadsheet), about 5 weeks out.
  const start1 = addDays(t0, 33);
  const p1 = make(
    "Fall Swim Safely – Sample University (sample)",
    "tplCollegiate",
    "siteUW",
    start1,
    addDays(start1, 4),
  );
  p1.tasks.forEach((t, i) => {
    const due = t.dueDate ?? t0;
    if (due < addDays(t0, -14))
      store.seedTaskStatus(t.id, i % 9 === 4 ? "Not Started" : "Done"); // a few left overdue
    else if (due < t0) store.seedTaskStatus(t.id, (["In Progress", "Not Started", "Done"] as const)[i % 3]);
    else if (due <= addDays(t0, 7) && i % 3 === 0) store.seedTaskStatus(t.id, "In Progress");
  });
  store.seedProjectStatus(p1.project.id, "Active");

  // 2. Illustrative YMCA program, about 3 weeks out (a different weekday from program 1): shows a blocked task.
  const start2 = addDays(t0, 22);
  const p2 = make("Learn to Swim – Sample YMCA (sample)", "tplYmca", "siteY", start2, addDays(start2, 35));
  for (const t of p2.tasks) if (t.title === "Sign MOU with YMCA branch") store.seedTaskStatus(t.id, "Done");
  store.seedProjectStatus(p2.project.id, "Active");

  // 3. A finished program, kept as history.
  const start3 = addDays(t0, -120);
  const p3 = make(
    "Spring Swim Safely – Sample University (sample)",
    "tplCollegiate",
    "siteUW",
    start3,
    addDays(start3, 4),
  );
  for (const t of p3.tasks) store.seedTaskStatus(t.id, "Done");
  store.seedProjectStatus(p3.project.id, "Completed");
}
