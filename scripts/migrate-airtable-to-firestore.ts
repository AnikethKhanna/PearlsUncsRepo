/**
 * Airtable → Firestore migration CLI. Read docs/firestore-migration.md first.
 *
 *   npm run migrate:firestore                          # DRY RUN (default): read Airtable, validate, write a local plan
 *   npm run migrate:firestore -- --apply               # copy to Firestore (refuses if the plan has errors or the target isn't empty)
 *   npm run migrate:firestore -- --verify              # compare Firestore with a fresh read of Airtable
 *   npm run migrate:firestore -- --rollback <runId>    # delete exactly the documents written by that run
 *
 * Add --from-sample to use the built-in sample data instead of Airtable, to
 * rehearse the whole procedure against the emulators (`npm run emulators`).
 *
 * Airtable is only ever READ. Nothing in the app changes until DATA_BACKEND
 * is switched to "firestore", so Airtable remains the source of truth until
 * --verify passes and the team decides to cut over.
 *
 * Output (plans, manifests) goes to migration-output/, which is git-ignored
 * because it contains names and emails.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { AirtableClient } from "@/lib/airtable/client";
import { getAirtableConfig, getFirebaseAdminConfig } from "@/lib/config";
import { AirtableStore } from "@/lib/data/airtable-store";
import { MemoryStore } from "@/lib/data/memory-store";
import { createFirebaseAdmin } from "@/lib/firebase/admin";
import {
  MIGRATED_COLLECTIONS,
  MIGRATION_FIELD,
  planMigration,
  verifyMigration,
  type MigrationPlan,
  type SourceSnapshot,
} from "@/lib/migration/airtable-to-firestore";
import type { DocData } from "@/lib/data/firestore-mapping";

const OUT_DIR = "migration-output";
const BATCH_SIZE = 400;

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    /* no .env.local: rely on the shell environment */
  }

  const args = process.argv.slice(2);
  const mode = args.includes("--apply")
    ? "apply"
    : args.includes("--verify")
      ? "verify"
      : args.includes("--rollback")
        ? "rollback"
        : "dry-run";

  if (mode === "rollback") {
    const runId = args[args.indexOf("--rollback") + 1];
    if (!runId || runId.startsWith("--")) throw new Error("Usage: --rollback <runId>");
    return rollback(firestore(), runId);
  }

  const source = args.includes("--from-sample") ? await readSample() : await readAirtable();
  const plan = planMigration(source);
  printPlan(plan);

  if (mode === "dry-run") {
    const runId = newRunId();
    const file = savePlan(runId, plan);
    console.log(`\nDry run only — nothing was written to Firestore.\nPlan saved to ${file}`);
    if (hasErrors(plan)) process.exitCode = 1;
    return;
  }

  const db = firestore();
  if (mode === "verify") return verify(db, plan);

  // --apply
  if (hasErrors(plan)) throw new Error("The plan has errors (see above). Fix them in Airtable, then dry-run again.");
  const occupied = await nonEmptyCollections(db);
  if (occupied.length && !args.includes("--allow-nonempty"))
    throw new Error(
      `Firestore already has data in: ${occupied.join(", ")}. Roll back the earlier run, or pass --allow-nonempty to overwrite matching IDs.`,
    );
  await apply(db, plan, newRunId());
}

// ---------- steps ----------

async function readAirtable(): Promise<SourceSnapshot> {
  console.log("Reading Airtable (read-only)…");
  const store = new AirtableStore(new AirtableClient(getAirtableConfig()));
  const [users, sites, templates, projects, tasks] = await Promise.all([
    store.listUsers(),
    store.listSites(),
    store.listTemplates(),
    store.listProjects(),
    store.listAllTasks(),
  ]);
  return { users, sites, templates, projects, tasks };
}

/** Sample data (the development placeholder's users, templates and three projects), for rehearsals. */
async function readSample(): Promise<SourceSnapshot> {
  console.log("Using built-in SAMPLE data (rehearsal; Airtable is not read)…");
  const store = new MemoryStore();
  const projects = await store.listProjects();
  return {
    users: await store.listUsers(),
    sites: await store.listSites(),
    templates: await store.listTemplates(),
    projects,
    tasks: await store.getTasksByIds(projects.flatMap((p) => p.taskIds)),
  };
}

function firestore(): Firestore {
  const config = getFirebaseAdminConfig();
  if (!config) throw new Error("Firebase Admin isn't configured (see docs/firebase.md).");
  console.log(`Firestore project: ${config.projectId}${config.emulator ? " (EMULATOR)" : ""}`);
  return createFirebaseAdmin(config).db;
}

async function apply(db: Firestore, plan: MigrationPlan, runId: string) {
  const migratedAt = new Date().toISOString();
  const manifest = plan.writes.map((w) => `${w.collection}/${w.id}`);
  savePlan(runId, plan);
  writeFileSync(join(OUT_DIR, runId, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\nApplying run ${runId}: ${plan.writes.length} documents…`);
  for (let i = 0; i < plan.writes.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const w of plan.writes.slice(i, i + BATCH_SIZE)) {
      batch.set(db.collection(w.collection).doc(w.id), {
        ...w.data,
        [MIGRATION_FIELD]: { runId, migratedAt },
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    console.log(`  ${Math.min(i + BATCH_SIZE, plan.writes.length)}/${plan.writes.length}`);
  }
  console.log(`\nDone. Next: npm run migrate:firestore -- --verify\nTo undo: npm run migrate:firestore -- --rollback ${runId}`);
}

async function verify(db: Firestore, plan: MigrationPlan) {
  const actual = new Map<string, DocData>();
  for (const c of MIGRATED_COLLECTIONS) {
    const snap = await db.collection(c).get();
    for (const d of snap.docs) actual.set(`${c}/${d.id}`, d.data());
  }
  const report = verifyMigration(plan, actual);
  console.log(`\nVerified ${report.checked} documents.`);
  const show = (label: string, keys: string[]) => {
    if (!keys.length) return;
    console.log(`${label} (${keys.length}):`);
    for (const k of keys.slice(0, 25)) console.log(`  - ${k}`);
    if (keys.length > 25) console.log(`  … and ${keys.length - 25} more`);
  };
  show("Missing in Firestore", report.missing);
  show("Different from Airtable", report.different);
  show("Only in Firestore (created after migration, or stale)", report.extra);
  console.log(report.ok ? "\n✅ Firestore matches Airtable." : "\n❌ Firestore does NOT match Airtable. Do not cut over.");
  if (!report.ok) process.exitCode = 1;
}

async function rollback(db: Firestore, runId: string) {
  console.log(`Rolling back run ${runId} (only documents tagged with that run)…`);
  let deleted = 0;
  for (const c of MIGRATED_COLLECTIONS) {
    const snap = await db.collection(c).where(`${MIGRATION_FIELD}.runId`, "==", runId).select().get();
    for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const d of snap.docs.slice(i, i + BATCH_SIZE)) batch.delete(d.ref);
      await batch.commit();
    }
    deleted += snap.size;
    console.log(`  ${c}: ${snap.size}`);
  }
  console.log(`Deleted ${deleted} documents. Airtable was never modified.`);
}

// ---------- helpers ----------

async function nonEmptyCollections(db: Firestore): Promise<string[]> {
  const result: string[] = [];
  for (const c of MIGRATED_COLLECTIONS) if (!(await db.collection(c).limit(1).get()).empty) result.push(c);
  return result;
}

function printPlan(plan: MigrationPlan) {
  console.log("\nDocuments to write:");
  for (const [c, n] of Object.entries(plan.counts)) console.log(`  ${c.padEnd(14)} ${n}`);
  const errors = plan.problems.filter((p) => p.severity === "error");
  const warnings = plan.problems.filter((p) => p.severity === "warning");
  if (errors.length) console.log(`\nErrors (${errors.length}) — these block --apply:`);
  for (const p of errors) console.log(`  ✗ ${p.message}`);
  if (warnings.length) console.log(`\nWarnings (${warnings.length}) — migrated as-is, please review:`);
  for (const p of warnings.slice(0, 50)) console.log(`  ! ${p.message}`);
  if (warnings.length > 50) console.log(`  … and ${warnings.length - 50} more (see the saved plan)`);
}

function savePlan(runId: string, plan: MigrationPlan): string {
  const dir = join(OUT_DIR, runId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "plan.json");
  if (!existsSync(file)) writeFileSync(file, JSON.stringify(plan, null, 2));
  return file;
}

const hasErrors = (plan: MigrationPlan) => plan.problems.some((p) => p.severity === "error");
const newRunId = () => `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;

main().catch((err) => {
  console.error(`\nMigration failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
