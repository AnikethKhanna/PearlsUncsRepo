/**
 * Firestore document shapes and domain ↔ document mapping.
 *
 * Pure (no Firebase imports) so the store, the migration script and the
 * unit tests share one definition. Document IDs are the domain IDs, which
 * for migrated data are the original Airtable record IDs — that keeps every
 * link, and every existing session cookie, valid after a cutover.
 *
 * Inverse links (User.projectIds / User.assignedTaskIds) are NOT stored;
 * they're derived by query, so they can never drift out of sync.
 */
import {
  ACCESS_LEVELS,
  OFFSET_UNITS,
  PROJECT_STATUSES,
  TASK_STATUSES,
  type AccessLevel,
  type ProgramTemplate,
  type Project,
  type ProjectStatus,
  type Site,
  type Task,
  type TaskStatus,
  type TemplateStep,
  type User,
} from "@/lib/domain/types";

export type DocData = Record<string, unknown>;

export interface UserDoc {
  name: string;
  /** Always trimmed + lower-case, so sign-in lookups are exact matches. */
  email: string;
  accessLevel: AccessLevel;
  jobTitle: string;
  active: boolean;
}
export type SiteDoc = Omit<Site, "id">;
export type TemplateDoc = Omit<ProgramTemplate, "id" | "steps">;
export type TemplateStepDoc = Omit<TemplateStep, "id">;
export interface ProjectDoc extends Omit<Project, "id" | "siteName" | "templateName"> {
  /** Everyone assigned to at least one task (denormalized for firestore.rules). */
  assigneeUserIds: string[];
}
export type TaskDoc = Omit<Task, "id">;

// ---------- tolerant readers (bad data degrades to safe defaults) ----------

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((a) => a === v) ?? fallback;
}

export function userFromDoc(id: string, d: DocData, links: { projectIds: string[]; assignedTaskIds: string[] }): User {
  return {
    id,
    name: str(d.name),
    email: str(d.email).trim().toLowerCase(),
    // Unknown / missing level → least privilege, exactly like the Airtable mapping.
    accessLevel: oneOf<AccessLevel>(d.accessLevel, ACCESS_LEVELS, "Partner"),
    jobTitle: str(d.jobTitle),
    active: d.active === true,
    ...links,
  };
}

export function userToDoc(u: User): UserDoc {
  return { name: u.name, email: u.email.trim().toLowerCase(), accessLevel: u.accessLevel, jobTitle: u.jobTitle, active: u.active };
}

export function siteFromDoc(id: string, d: DocData): Site {
  return {
    id,
    name: str(d.name),
    location: str(d.location),
    partnerOrganization: str(d.partnerOrganization),
    siteType: str(d.siteType),
  };
}

export function siteToDoc(s: Site): SiteDoc {
  return { name: s.name, location: s.location, partnerOrganization: s.partnerOrganization, siteType: s.siteType };
}

export function stepFromDoc(id: string, d: DocData): TemplateStep {
  return {
    id,
    templateId: str(d.templateId),
    title: str(d.title),
    description: str(d.description),
    order: num(d.order),
    phase: str(d.phase),
    offsetAmount: num(d.offsetAmount),
    offsetUnit: oneOf(d.offsetUnit, OFFSET_UNITS, "Days"),
    timing: oneOf(d.timing, ["Before", "After"] as const, "Before"),
    anchor: oneOf(d.anchor, ["Program Start", "Program End"] as const, "Program Start"),
    defaultOwnerRoles: strs(d.defaultOwnerRoles),
    dependsOnStepIds: strs(d.dependsOnStepIds),
  };
}

export function stepToDoc(s: TemplateStep): TemplateStepDoc {
  const { id: _id, ...rest } = s;
  void _id;
  return { ...rest, defaultOwnerRoles: [...s.defaultOwnerRoles], dependsOnStepIds: [...s.dependsOnStepIds] };
}

export function templateFromDoc(id: string, d: DocData, steps: TemplateStep[]): ProgramTemplate {
  return {
    id,
    name: str(d.name),
    programType: str(d.programType),
    description: str(d.description),
    active: d.active === true,
    steps: steps.filter((s) => s.templateId === id).sort((a, b) => a.order - b.order),
  };
}

export function templateToDoc(t: ProgramTemplate): TemplateDoc {
  return { name: t.name, programType: t.programType, description: t.description, active: t.active };
}

export function projectFromDoc(id: string, d: DocData, names: { sites: Map<string, string>; templates: Map<string, string> }): Project {
  const siteId = str(d.siteId) || null;
  const templateId = str(d.templateId) || null;
  return {
    id,
    name: str(d.name),
    siteId,
    siteName: siteId ? (names.sites.get(siteId) ?? "") : "",
    templateId,
    templateName: templateId ? (names.templates.get(templateId) ?? "") : "",
    startDate: isoDate(d.startDate),
    endDate: isoDate(d.endDate),
    status: oneOf<ProjectStatus>(d.status, PROJECT_STATUSES, "Planning"),
    teamUserIds: strs(d.teamUserIds),
    taskIds: strs(d.taskIds),
    notes: str(d.notes),
  };
}

export function projectToDoc(p: Project, tasks: Pick<Task, "assigneeIds">[]): ProjectDoc {
  return {
    name: p.name,
    siteId: p.siteId,
    templateId: p.templateId,
    startDate: p.startDate,
    endDate: p.endDate,
    status: p.status,
    teamUserIds: [...p.teamUserIds],
    taskIds: [...p.taskIds],
    notes: p.notes,
    assigneeUserIds: [...new Set(tasks.flatMap((t) => t.assigneeIds))],
  };
}

export function taskFromDoc(id: string, d: DocData): Task {
  return {
    id,
    projectId: str(d.projectId) || null,
    templateStepId: str(d.templateStepId) || null,
    title: str(d.title),
    description: str(d.description),
    assigneeIds: strs(d.assigneeIds),
    ownerRole: str(d.ownerRole),
    phase: str(d.phase),
    order: num(d.order),
    dueDate: isoDate(d.dueDate),
    status: oneOf<TaskStatus>(d.status, TASK_STATUSES, "Not Started"),
    dependsOnTaskIds: strs(d.dependsOnTaskIds),
    notes: str(d.notes),
    documentLinks: strs(d.documentLinks).filter((u) => /^https:\/\//.test(u)),
    completedAt: isoDate(d.completedAt),
  };
}

export function taskToDoc(t: Task): TaskDoc {
  const { id: _id, ...rest } = t;
  void _id;
  return {
    ...rest,
    assigneeIds: [...t.assigneeIds],
    dependsOnTaskIds: [...t.dependsOnTaskIds],
    documentLinks: [...t.documentLinks],
  };
}
