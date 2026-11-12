/**
 * Cloud Firestore implementation of DataStore (server-side, Admin SDK).
 *
 * Selected with DATA_BACKEND=firestore. Airtable stays the default source of
 * truth until the migration in docs/firestore-migration.md is verified; only
 * ONE backend is active at a time, so the app never writes to both.
 *
 * The Admin SDK bypasses firestore.rules, so — exactly as with Airtable —
 * callers MUST check permissions first (src/lib/auth/permissions.ts).
 * The rules are a second line of defence for any direct client access.
 */
import { FieldValue, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { today } from "@/lib/domain/dates";
import { FIRESTORE_COLLECTIONS as C } from "@/lib/firebase/config";
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
import {
  projectFromDoc,
  siteFromDoc,
  stepFromDoc,
  taskFromDoc,
  templateFromDoc,
  userFromDoc,
  type DocData,
  type ProjectDoc,
  type TaskDoc,
} from "./firestore-mapping";
import type { DataStore } from "./store";

/** Firestore allows 500 writes per batch; stay safely below it. */
export const MAX_WRITES_PER_BATCH = 450;
/** getAll() reads are chunked so a single request stays small. */
const READ_CHUNK = 100;

export class FirestoreStore implements DataStore {
  readonly kind = "firestore" as const;

  constructor(private readonly db: Firestore) {}

  private col(name: keyof typeof C) {
    return this.db.collection(C[name]);
  }

  // ---------- Users ----------

  private async linksFor(userId: string) {
    const [projects, tasks] = await Promise.all([
      this.col("projects").where("teamUserIds", "array-contains", userId).select().get(),
      this.col("tasks").where("assigneeIds", "array-contains", userId).select().get(),
    ]);
    return { projectIds: projects.docs.map((d) => d.id), assignedTaskIds: tasks.docs.map((d) => d.id) };
  }

  private async toUser(snap: DocumentSnapshot): Promise<User | null> {
    if (!snap.exists) return null;
    return userFromDoc(snap.id, snap.data() as DocData, await this.linksFor(snap.id));
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const q = await this.col("users").where("email", "==", email.trim().toLowerCase()).limit(1).get();
    return q.empty ? null : this.toUser(q.docs[0]);
  }

  async getUser(id: string): Promise<User | null> {
    return this.toUser(await this.col("users").doc(id).get());
  }

  async listUsers(): Promise<User[]> {
    const [users, projects, tasks] = await Promise.all([
      this.col("users").get(),
      this.col("projects").select("teamUserIds").get(),
      this.col("tasks").select("assigneeIds").get(),
    ]);
    const projectIds = new Map<string, string[]>();
    const taskIds = new Map<string, string[]>();
    const add = (m: Map<string, string[]>, key: unknown, id: string) => {
      if (typeof key !== "string") return;
      m.set(key, [...(m.get(key) ?? []), id]);
    };
    for (const p of projects.docs) for (const uid of (p.get("teamUserIds") as unknown[]) ?? []) add(projectIds, uid, p.id);
    for (const t of tasks.docs) for (const uid of (t.get("assigneeIds") as unknown[]) ?? []) add(taskIds, uid, t.id);
    return users.docs
      .map((d) =>
        userFromDoc(d.id, d.data(), { projectIds: projectIds.get(d.id) ?? [], assignedTaskIds: taskIds.get(d.id) ?? [] }),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------- Sites & templates ----------

  async listSites(): Promise<Site[]> {
    const q = await this.col("sites").get();
    return q.docs.map((d) => siteFromDoc(d.id, d.data())).sort((a, b) => a.name.localeCompare(b.name));
  }

  async listTemplates(opts: { activeOnly?: boolean } = {}): Promise<ProgramTemplate[]> {
    const templatesQuery = opts.activeOnly ? this.col("templates").where("active", "==", true) : this.col("templates");
    const [templates, steps] = await Promise.all([templatesQuery.get(), this.col("templateSteps").get()]);
    const allSteps = steps.docs.map((d) => stepFromDoc(d.id, d.data()));
    return templates.docs
      .map((d) => templateFromDoc(d.id, d.data(), allSteps))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getTemplate(id: string): Promise<ProgramTemplate | null> {
    const [snap, steps] = await Promise.all([
      this.col("templates").doc(id).get(),
      this.col("templateSteps").where("templateId", "==", id).get(),
    ]);
    if (!snap.exists) return null;
    return templateFromDoc(snap.id, snap.data() as DocData, steps.docs.map((d) => stepFromDoc(d.id, d.data())));
  }

  // ---------- Projects ----------

  private async nameMaps() {
    const [sites, templates] = await Promise.all([
      this.col("sites").select("name").get(),
      this.col("templates").select("name").get(),
    ]);
    const map = (docs: typeof sites.docs) => new Map(docs.map((d) => [d.id, String(d.get("name") ?? "")]));
    return { sites: map(sites.docs), templates: map(templates.docs) };
  }

  async listProjects(): Promise<Project[]> {
    const [projects, names] = await Promise.all([this.col("projects").get(), this.nameMaps()]);
    return projects.docs
      .map((d) => projectFromDoc(d.id, d.data(), names))
      .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
  }

  async getProject(id: string): Promise<Project | null> {
    const snap = await this.col("projects").doc(id).get();
    if (!snap.exists) return null;
    const d = snap.data() as DocData;
    const [site, template] = await Promise.all([
      typeof d.siteId === "string" && d.siteId ? this.col("sites").doc(d.siteId).get() : null,
      typeof d.templateId === "string" && d.templateId ? this.col("templates").doc(d.templateId).get() : null,
    ]);
    const named = (s: DocumentSnapshot | null) =>
      new Map(s?.exists ? [[s.id, String(s.get("name") ?? "")]] : []);
    return projectFromDoc(snap.id, d, { sites: named(site), templates: named(template) });
  }

  async updateProjectStatus(id: string, status: ProjectStatus): Promise<void> {
    await this.col("projects").doc(id).update({ status, updatedAt: FieldValue.serverTimestamp() });
  }

  // ---------- Tasks ----------

  async getTask(id: string): Promise<Task | null> {
    const snap = await this.col("tasks").doc(id).get();
    return snap.exists ? taskFromDoc(snap.id, snap.data() as DocData) : null;
  }

  async getTasksByIds(ids: string[]): Promise<Task[]> {
    const unique = [...new Set(ids)].filter(Boolean);
    const tasks: Task[] = [];
    for (let i = 0; i < unique.length; i += READ_CHUNK) {
      const refs = unique.slice(i, i + READ_CHUNK).map((id) => this.col("tasks").doc(id));
      const snaps = await this.db.getAll(...refs);
      for (const s of snaps) if (s.exists) tasks.push(taskFromDoc(s.id, s.data() as DocData));
    }
    return tasks;
  }

  /**
   * Creates the project and all its tasks with dependencies already wired
   * (IDs are allocated up front). Normally that is ONE atomic batch, so a
   * failure leaves nothing behind. Very large projects fall back to several
   * batches, with the project kept in "Setting Up" until the last one lands,
   * matching the Airtable store's partial-failure signal.
   */
  async createProjectWithTasks(input: NewProjectInput, drafts: TaskDraft[]): Promise<Project> {
    const projectRef = this.col("projects").doc();
    const taskRefs = new Map(drafts.map((d) => [d.key, this.col("tasks").doc()]));
    const singleBatch = drafts.length + 1 <= MAX_WRITES_PER_BATCH;
    const now = FieldValue.serverTimestamp();

    const projectDoc: ProjectDoc & DocData = {
      name: input.name,
      siteId: input.siteId,
      templateId: input.templateId,
      startDate: input.startDate,
      endDate: input.endDate,
      status: singleBatch ? "Planning" : "Setting Up",
      teamUserIds: [...new Set([...input.teamUserIds, input.createdByUserId])],
      taskIds: drafts.map((d) => taskRefs.get(d.key)!.id),
      assigneeUserIds: [...new Set(drafts.flatMap((d) => d.assigneeIds))],
      notes: "",
      createdByUserId: input.createdByUserId,
      createdAt: now,
      updatedAt: now,
    };

    const taskWrites = drafts.map((d) => {
      const doc: TaskDoc & DocData = {
        projectId: projectRef.id,
        templateStepId: d.templateStepId,
        title: d.title,
        description: d.description,
        assigneeIds: [...d.assigneeIds],
        ownerRole: d.ownerRole,
        phase: d.phase,
        order: d.order,
        dueDate: d.dueDate,
        status: "Not Started",
        dependsOnTaskIds: d.dependsOnKeys.map((k) => taskRefs.get(k)?.id).filter((x): x is string => !!x),
        notes: "",
        documentLinks: [],
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      return { ref: taskRefs.get(d.key)!, doc };
    });

    if (singleBatch) {
      const batch = this.db.batch();
      batch.create(projectRef, projectDoc);
      for (const w of taskWrites) batch.create(w.ref, w.doc);
      await batch.commit();
    } else {
      await projectRef.create(projectDoc);
      for (let i = 0; i < taskWrites.length; i += MAX_WRITES_PER_BATCH) {
        const batch = this.db.batch();
        for (const w of taskWrites.slice(i, i + MAX_WRITES_PER_BATCH)) batch.create(w.ref, w.doc);
        await batch.commit();
      }
      await this.updateProjectStatus(projectRef.id, "Planning");
    }

    const project = await this.getProject(projectRef.id);
    if (!project) throw new Error("Project was created but could not be read back.");
    return project;
  }

  async updateTask(id: string, patch: { status?: TaskStatus; notes?: string }): Promise<Task> {
    const ref = this.col("tasks").doc(id);
    const fields: DocData = { updatedAt: FieldValue.serverTimestamp() };
    if (patch.status) {
      fields.status = patch.status;
      fields.completedAt = patch.status === "Done" ? today() : null;
    }
    if (patch.notes !== undefined) fields.notes = patch.notes;
    await ref.update(fields); // fails if the task doesn't exist
    const snap = await ref.get();
    return taskFromDoc(snap.id, snap.data() as DocData);
  }
}
