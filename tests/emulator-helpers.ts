/**
 * Shared setup for *.emulator.test.ts. These run only under
 * `npm run test:emulators`, which starts the Auth + Firestore emulators and
 * sets FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST.
 */
import { createFirebaseAdmin } from "@/lib/firebase/admin";
import { FIRESTORE_COLLECTIONS as C } from "@/lib/firebase/config";
import { siteToDoc, stepToDoc, templateToDoc, userToDoc } from "@/lib/data/firestore-mapping";
import { SAMPLE_SITES, SAMPLE_TEMPLATES, SAMPLE_USERS } from "@/lib/data/sample-data";

export const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "demo-nmu-onboarding";
export const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;
export const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;

if (!FIRESTORE_HOST || !AUTH_HOST) {
  throw new Error("Emulator tests need the Firebase emulators. Run them with `npm run test:emulators`.");
}

export const admin = () => createFirebaseAdmin({ projectId: PROJECT_ID, emulator: true });

export async function clearFirestore() {
  const res = await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Couldn't clear Firestore emulator: ${res.status}`);
}

export async function clearAuth() {
  const res = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Couldn't clear Auth emulator: ${res.status}`);
}

/** Seeds users, sites and templates from the sample data (Admin SDK, bypassing rules). */
export async function seedReferenceData() {
  const { db } = admin();
  const writer = db.bulkWriter();
  for (const u of SAMPLE_USERS) writer.set(db.collection(C.users).doc(u.id), userToDoc(u));
  for (const s of SAMPLE_SITES) writer.set(db.collection(C.sites).doc(s.id), siteToDoc(s));
  for (const t of SAMPLE_TEMPLATES) {
    writer.set(db.collection(C.templates).doc(t.id), templateToDoc(t));
    for (const s of t.steps) writer.set(db.collection(C.templateSteps).doc(s.id), stepToDoc(s));
  }
  await writer.close();
}
