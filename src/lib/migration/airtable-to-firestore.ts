/**
 * Airtable → Firestore migration: planning and verification.
 *
 * Pure functions over domain objects (already read through AirtableStore),
 * so they're unit-tested without Airtable or Firebase. The CLI that does the
 * actual reading/writing is scripts/migrate-airtable-to-firestore.ts; the
 * procedure is in docs/firestore-migration.md.
 *
 * IDs are preserved: each Airtable record ID becomes the Firestore document ID.
 */
import { FIRESTORE_COLLECTIONS as C } from "@/lib/firebase/config";
import type { ProgramTemplate, Project, Site, Task, User } from "@/lib/domain/types";
import {
  projectToDoc,
  siteToDoc,
  stepToDoc,
  taskToDoc,
  templateToDoc,
  userToDoc,
  type DocData,
} from "@/lib/data/firestore-mapping";

export interface SourceSnapshot {
  users: User[];
  sites: Site[];
  templates: ProgramTemplate[];
  projects: Project[];
  tasks: Task[];
}

export interface PlannedWrite {
  collection: string;
  id: string;
  data: DocData;
}

export interface MigrationProblem {
  /** "error" blocks --apply; "warning" is migrated as-is but should be reviewed. */
  severity: "error" | "warning";
  message: string;
}

export interface MigrationPlan {
  writes: PlannedWrite[];
  counts: Record<string, number>;
  problems: MigrationProblem[];
}

/** Collections written by the migration, in dependency order. */
export const MIGRATED_COLLECTIONS = [C.users, C.sites, C.templates, C.templateSteps, C.projects, C.tasks] as const;

/** Field added to every migrated document, so a run can be verified and rolled back precisely. */
export const MIGRATION_FIELD = "_migration";

export function planMigration(src: SourceSnapshot): MigrationPlan {
  const problems: MigrationProblem[] = [];
  const error = (message: string) => problems.push({ severity: "error", message });
  const warn = (message: string) => problems.push({ severity: "warning", message });

  const userIds = new Set(src.users.map((u) => u.id));
  const siteIds = new Set(src.sites.map((s) => s.id));
  const templateIds = new Set(src.templates.map((t) => t.id));
  const projectIds = new Set(src.projects.map((p) => p.id));
  const taskIds = new Set(src.tasks.map((t) => t.id));
  const steps = src.templates.flatMap((t) => t.steps);
  const stepIds = new Set(steps.map((s) => s.id));

  // Users: email is the sign-in key, so it must be present and unique among active users.
  const byEmail = new Map<string, User[]>();
  for (const u of src.users) {
    if (!u.email) (u.active ? error : warn)(`User ${u.id} ("${u.name}") has no email${u.active ? " but is active" : ""}.`);
    else byEmail.set(u.email, [...(byEmail.get(u.email) ?? []), u]);
  }
  for (const [email, users] of byEmail) {
    if (users.filter((u) => u.active).length > 1)
      error(`${users.length} active users share the email ${email} (${users.map((u) => u.id).join(", ")}). Sign-in would be ambiguous.`);
  }

  for (const t of src.templates)
    for (const s of t.steps)
      for (const dep of s.dependsOnStepIds)
        if (!stepIds.has(dep)) warn(`Template step ${s.id} depends on missing step ${dep}.`);

  const tasksByProject = new Map<string, Task[]>();
  for (const t of src.tasks) {
    if (t.projectId && !projectIds.has(t.projectId)) warn(`Task ${t.id} belongs to missing project ${t.projectId}.`);
    if (!t.projectId) warn(`Task ${t.id} ("${t.title}") isn't linked to a project.`);
    for (const a of t.assigneeIds) if (!userIds.has(a)) warn(`Task ${t.id} is assigned to missing user ${a}.`);
    for (const d of t.dependsOnTaskIds) if (!taskIds.has(d)) warn(`Task ${t.id} depends on missing task ${d}.`);
    if (t.projectId) tasksByProject.set(t.projectId, [...(tasksByProject.get(t.projectId) ?? []), t]);
  }

  for (const p of src.projects) {
    if (p.siteId && !siteIds.has(p.siteId)) warn(`Project ${p.id} links to missing site ${p.siteId}.`);
    if (p.templateId && !templateIds.has(p.templateId)) warn(`Project ${p.id} links to missing template ${p.templateId}.`);
    for (const id of p.teamUserIds) if (!userIds.has(id)) warn(`Project ${p.id} team includes missing user ${id}.`);
    for (const id of p.taskIds) if (!taskIds.has(id)) warn(`Project ${p.id} lists missing task ${id}.`);
    if (p.status === "Setting Up") warn(`Project ${p.id} ("${p.name}") is still "Setting Up" (an incomplete creation).`);
  }

  const writes: PlannedWrite[] = [
    ...src.users.map((u) => ({ collection: C.users, id: u.id, data: { ...userToDoc(u) } })),
    ...src.sites.map((s) => ({ collection: C.sites, id: s.id, data: { ...siteToDoc(s) } })),
    ...src.templates.map((t) => ({ collection: C.templates, id: t.id, data: { ...templateToDoc(t) } })),
    ...steps.map((s) => ({ collection: C.templateSteps, id: s.id, data: { ...stepToDoc(s) } })),
    ...src.projects.map((p) => ({
      collection: C.projects,
      id: p.id,
      data: { ...projectToDoc(p, tasksByProject.get(p.id) ?? []) },
    })),
    ...src.tasks.map((t) => ({ collection: C.tasks, id: t.id, data: { ...taskToDoc(t) } })),
  ];

  const counts = Object.fromEntries(MIGRATED_COLLECTIONS.map((c) => [c, writes.filter((w) => w.collection === c).length]));
  return { writes, counts, problems };
}

/** Stable JSON of a document, ignoring bookkeeping fields (timestamps, migration tags). */
export function fingerprint(data: DocData): string {
  const IGNORED = new Set([MIGRATION_FIELD, "createdAt", "updatedAt", "createdByUserId"]);
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.keys(v as object)
          .sort()
          .map((k) => [k, normalize((v as DocData)[k])]),
      );
    return v === undefined ? null : v;
  };
  const top = Object.fromEntries(Object.entries(data).filter(([k]) => !IGNORED.has(k)));
  return JSON.stringify(normalize(top));
}

export interface VerificationReport {
  ok: boolean;
  checked: number;
  missing: string[];
  different: string[];
  /** Documents in Firestore that aren't in the plan (not an error, but reported). */
  extra: string[];
}

/** Compares planned documents with what's actually in Firestore (key: "collection/id"). */
export function verifyMigration(plan: Pick<MigrationPlan, "writes">, actual: Map<string, DocData>): VerificationReport {
  const missing: string[] = [];
  const different: string[] = [];
  const planned = new Set<string>();
  for (const w of plan.writes) {
    const key = `${w.collection}/${w.id}`;
    planned.add(key);
    const doc = actual.get(key);
    if (!doc) missing.push(key);
    else if (fingerprint(doc) !== fingerprint(w.data)) different.push(key);
  }
  const extra = [...actual.keys()].filter((k) => !planned.has(k));
  return { ok: missing.length === 0 && different.length === 0, checked: plan.writes.length, missing, different, extra };
}
