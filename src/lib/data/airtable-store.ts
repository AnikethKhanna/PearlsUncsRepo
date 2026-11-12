import { AirtableClient, formulaString, type AirtableRecord } from "@/lib/airtable/client";
import { AIRTABLE_SCHEMA as S } from "@/lib/airtable/schema";
import { today } from "@/lib/domain/dates";
import {
  ACCESS_LEVELS,
  OFFSET_UNITS,
  PROJECT_STATUSES,
  TASK_STATUSES,
  type AccessLevel,
  type NewProjectInput,
  type ProgramTemplate,
  type Project,
  type ProjectStatus,
  type Site,
  type Task,
  type TaskDraft,
  type TaskStatus,
  type TemplateStep,
  type User,
} from "@/lib/domain/types";
import type { DataStore } from "./store";

/** Airtable-backed implementation of DataStore. Field names come from schema.ts. */
export class AirtableStore implements DataStore {
  readonly kind = "airtable" as const;

  constructor(private readonly at: AirtableClient) {}

  // ---------- Users ----------

  async getUserByEmail(email: string): Promise<User | null> {
    const f = S.users.fields;
    const records = await this.at.list(S.users.table, {
      filterByFormula: `LOWER(TRIM({${f.email}}))=${formulaString(email.trim().toLowerCase())}`,
      maxRecords: 1,
    });
    return records[0] ? toUser(records[0]) : null;
  }

  async getUser(id: string): Promise<User | null> {
    const r = await this.at.get(S.users.table, id);
    return r ? toUser(r) : null;
  }

  async listUsers(): Promise<User[]> {
    const records = await this.at.list(S.users.table, { sort: [{ field: S.users.fields.name }] });
    return records.map(toUser);
  }

  // ---------- Sites & templates ----------

  async listSites(): Promise<Site[]> {
    const records = await this.at.list(S.sites.table, { sort: [{ field: S.sites.fields.name }] });
    return records.map(toSite);
  }

  async listTemplates(opts: { activeOnly?: boolean } = {}): Promise<ProgramTemplate[]> {
    const [templateRecords, stepRecords] = await Promise.all([
      this.at.list(S.templates.table, {
        filterByFormula: opts.activeOnly ? `{${S.templates.fields.active}}` : undefined,
        sort: [{ field: S.templates.fields.name }],
      }),
      this.at.list(S.steps.table),
    ]);
    const steps = stepRecords.map(toStep);
    return templateRecords.map((r) => toTemplate(r, steps));
  }

  async getTemplate(id: string): Promise<ProgramTemplate | null> {
    const r = await this.at.get(S.templates.table, id);
    if (!r) return null;
    const stepIds = links(r, S.templates.fields.steps);
    const steps = (await this.at.findMany(S.steps.table, stepIds)).map(toStep);
    return toTemplate(r, steps);
  }

  // ---------- Projects ----------

  async listProjects(): Promise<Project[]> {
    const [projects, sites, templates] = await Promise.all([
      this.at.list(S.projects.table, { sort: [{ field: S.projects.fields.startDate, direction: "asc" }] }),
      this.at.list(S.sites.table),
      this.at.list(S.templates.table),
    ]);
    const siteNames = nameMap(sites, S.sites.fields.name);
    const templateNames = nameMap(templates, S.templates.fields.name);
    return projects.map((r) => toProject(r, siteNames, templateNames));
  }

  async getProject(id: string): Promise<Project | null> {
    const r = await this.at.get(S.projects.table, id);
    if (!r) return null;
    const f = S.projects.fields;
    const [site, template] = await Promise.all([
      first(links(r, f.site), (sid) => this.at.get(S.sites.table, sid)),
      first(links(r, f.template), (tid) => this.at.get(S.templates.table, tid)),
    ]);
    return toProject(
      r,
      nameMap(site ? [site] : [], S.sites.fields.name),
      nameMap(template ? [template] : [], S.templates.fields.name),
    );
  }

  async updateProjectStatus(id: string, status: ProjectStatus): Promise<void> {
    await this.at.update(S.projects.table, [{ id, fields: { [S.projects.fields.status]: status } }]);
  }

  // ---------- Tasks ----------

  async getTask(id: string): Promise<Task | null> {
    const r = await this.at.get(S.tasks.table, id);
    return r ? toTask(r) : null;
  }

  /** Every task in the base, including any not linked to a project. Used by the Firestore migration. */
  async listAllTasks(): Promise<Task[]> {
    return (await this.at.list(S.tasks.table)).map(toTask);
  }

  async getTasksByIds(ids: string[]): Promise<Task[]> {
    if (ids.length === 0) return [];
    return (await this.at.findMany(S.tasks.table, ids)).map(toTask);
  }

  async createProjectWithTasks(input: NewProjectInput, drafts: TaskDraft[]): Promise<Project> {
    const pf = S.projects.fields;
    const tf = S.tasks.fields;

    // 1. Project (status "Setting Up" until all tasks are saved)
    const [projectRecord] = await this.at.create(S.projects.table, [
      {
        [pf.name]: input.name,
        [pf.site]: [input.siteId],
        [pf.template]: [input.templateId],
        [pf.startDate]: input.startDate,
        ...(input.endDate ? { [pf.endDate]: input.endDate } : {}),
        [pf.status]: "Setting Up",
        [pf.team]: unique([...input.teamUserIds, input.createdByUserId]),
        [pf.createdBy]: [input.createdByUserId],
      },
    ]);

    // 2. Tasks (10 per request)
    const created = await this.at.create(
      S.tasks.table,
      drafts.map((d) => ({
        [tf.title]: d.title,
        [tf.description]: d.description,
        [tf.project]: [projectRecord.id],
        [tf.templateStep]: [d.templateStepId],
        [tf.assignees]: d.assigneeIds,
        [tf.ownerRole]: d.ownerRole,
        [tf.phase]: d.phase || undefined,
        [tf.order]: d.order,
        [tf.dueDate]: d.dueDate,
        [tf.status]: "Not Started",
      })),
    );

    // 3. Dependencies (needs the new task IDs, so it is a second pass)
    const idByKey = new Map(drafts.map((d, i) => [d.key, created[i].id]));
    const dependencyUpdates = drafts
      .map((d, i) => ({
        id: created[i].id,
        fields: { [tf.dependsOn]: d.dependsOnKeys.map((k) => idByKey.get(k)).filter(Boolean) },
      }))
      .filter((u) => (u.fields[tf.dependsOn] as string[]).length > 0);
    if (dependencyUpdates.length) await this.at.update(S.tasks.table, dependencyUpdates);

    // 4. Mark ready
    await this.updateProjectStatus(projectRecord.id, "Planning");

    const project = await this.getProject(projectRecord.id);
    if (!project) throw new Error("Project was created but could not be read back.");
    return project;
  }

  async updateTask(id: string, patch: { status?: TaskStatus; notes?: string }): Promise<Task> {
    const tf = S.tasks.fields;
    const fields: Record<string, unknown> = {};
    if (patch.status) {
      fields[tf.status] = patch.status;
      fields[tf.completedAt] = patch.status === "Done" ? today() : null;
    }
    if (patch.notes !== undefined) fields[tf.notes] = patch.notes;
    const [r] = await this.at.update(S.tasks.table, [{ id, fields }]);
    return toTask(r);
  }
}

// ---------- Record → domain mapping ----------

function str(r: AirtableRecord, field: string): string {
  const v = r.fields[field];
  if (v == null) return "";
  if (typeof v === "object" && v !== null && "name" in v) return String((v as { name: unknown }).name); // collaborator / select objects
  return Array.isArray(v) ? v.join(", ") : String(v);
}
function num(r: AirtableRecord, field: string, fallback = 0): number {
  const v = Number(r.fields[field]);
  return Number.isFinite(v) ? v : fallback;
}
function bool(r: AirtableRecord, field: string): boolean {
  return r.fields[field] === true;
}
function links(r: AirtableRecord, field: string): string[] {
  const v = r.fields[field];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function date(r: AirtableRecord, field: string): string | null {
  const v = r.fields[field];
  return typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null;
}
function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  const match = allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase());
  return match ?? fallback;
}
function nameMap(records: AirtableRecord[], field: string): Map<string, string> {
  return new Map(records.map((r) => [r.id, str(r, field)]));
}
function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
async function first<T>(ids: string[], fn: (id: string) => Promise<T>): Promise<T | null> {
  return ids[0] ? fn(ids[0]) : null;
}

function toUser(r: AirtableRecord): User {
  const f = S.users.fields;
  return {
    id: r.id,
    name: str(r, f.name),
    email: str(r, f.email).trim().toLowerCase(),
    // Unknown / blank access level is treated as the least-privileged level
    accessLevel: oneOf<AccessLevel>(str(r, f.accessLevel), ACCESS_LEVELS, "Partner"),
    jobTitle: str(r, f.jobTitle),
    active: bool(r, f.active),
    projectIds: links(r, f.projects),
    assignedTaskIds: links(r, f.assignedTasks),
  };
}

function toSite(r: AirtableRecord): Site {
  const f = S.sites.fields;
  return {
    id: r.id,
    name: str(r, f.name),
    location: str(r, f.location),
    partnerOrganization: str(r, f.partnerOrganization),
    siteType: str(r, f.siteType),
  };
}

function toStep(r: AirtableRecord): TemplateStep {
  const f = S.steps.fields;
  return {
    id: r.id,
    templateId: links(r, f.template)[0] ?? "",
    title: str(r, f.title),
    description: str(r, f.description),
    order: num(r, f.order),
    phase: str(r, f.phase),
    offsetAmount: num(r, f.offsetAmount),
    offsetUnit: oneOf(str(r, f.offsetUnit), OFFSET_UNITS, "Days"),
    timing: oneOf(str(r, f.timing), ["Before", "After"] as const, "Before"),
    anchor: oneOf(str(r, f.anchor), ["Program Start", "Program End"] as const, "Program Start"),
    defaultOwnerRoles: str(r, f.defaultOwnerRoles)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    dependsOnStepIds: links(r, f.dependsOn),
  };
}

function toTemplate(r: AirtableRecord, allSteps: TemplateStep[]): ProgramTemplate {
  const f = S.templates.fields;
  return {
    id: r.id,
    name: str(r, f.name),
    programType: str(r, f.programType),
    description: str(r, f.description),
    active: bool(r, f.active),
    steps: allSteps.filter((s) => s.templateId === r.id).sort((a, b) => a.order - b.order),
  };
}

function toProject(r: AirtableRecord, siteNames: Map<string, string>, templateNames: Map<string, string>): Project {
  const f = S.projects.fields;
  const siteId = links(r, f.site)[0] ?? null;
  const templateId = links(r, f.template)[0] ?? null;
  return {
    id: r.id,
    name: str(r, f.name),
    siteId,
    siteName: siteId ? (siteNames.get(siteId) ?? "") : "",
    templateId,
    templateName: templateId ? (templateNames.get(templateId) ?? "") : "",
    startDate: date(r, f.startDate),
    endDate: date(r, f.endDate),
    status: oneOf<ProjectStatus>(str(r, f.status), PROJECT_STATUSES, "Planning"),
    teamUserIds: links(r, f.team),
    taskIds: links(r, f.tasks),
    notes: str(r, f.notes),
  };
}

function toTask(r: AirtableRecord): Task {
  const f = S.tasks.fields;
  return {
    id: r.id,
    projectId: links(r, f.project)[0] ?? null,
    templateStepId: links(r, f.templateStep)[0] ?? null,
    title: str(r, f.title),
    description: str(r, f.description),
    assigneeIds: links(r, f.assignees),
    ownerRole: str(r, f.ownerRole),
    phase: str(r, f.phase),
    order: num(r, f.order),
    dueDate: date(r, f.dueDate),
    status: oneOf<TaskStatus>(str(r, f.status), TASK_STATUSES, "Not Started"),
    dependsOnTaskIds: links(r, f.dependsOn),
    notes: str(r, f.notes),
    documentLinks: str(r, f.documentLinks)
      .split(/\s+/)
      .filter((u) => /^https:\/\//.test(u)),
    completedAt: date(r, f.completedAt),
  };
}
