/**
 * ⚠️ DEVELOPMENT PLACEHOLDER — NOT PERSISTENT.
 *
 * In-memory DataStore seeded with illustrative sample data, so the UI can be
 * built and demonstrated without Airtable credentials. Everything is lost
 * when the server restarts. The app shows a warning banner while it is in use,
 * and src/lib/config.ts refuses it in production deployments.
 */
import { today } from "@/lib/domain/dates";
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
import { SAMPLE_SITES, SAMPLE_TEMPLATES, SAMPLE_USERS } from "./sample-data";
import type { DataStore } from "./store";

interface State {
  users: User[];
  sites: Site[];
  templates: ProgramTemplate[];
  projects: Project[];
  tasks: Task[];
  seq: number;
}

function freshState(): State {
  return structuredClone({
    users: SAMPLE_USERS,
    sites: SAMPLE_SITES,
    templates: SAMPLE_TEMPLATES,
    projects: [],
    tasks: [],
    seq: 1,
  });
}

export class MemoryStore implements DataStore {
  readonly kind = "memory" as const;
  constructor(private readonly s: State = freshState()) {}

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
    return structuredClone(project);
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
}
