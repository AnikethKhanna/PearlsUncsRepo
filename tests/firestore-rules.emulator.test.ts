/**
 * firestore.rules against the Firestore emulator, using the modular client
 * SDK with emulator mock tokens (what a browser talking to Firestore directly
 * would look like). Data is seeded with the Admin SDK, which bypasses rules.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  setLogLevel,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { FirestoreStore } from "@/lib/data/firestore-store";
import { generateTaskDrafts, rolesForSteps } from "@/lib/domain/generate-tasks";
import { FIRESTORE_HOST, PROJECT_ID, admin, clearFirestore, seedReferenceData } from "./emulator-helpers";

interface Who {
  appUserId?: string;
  email: string;
  verified?: boolean;
}

setLogLevel("silent"); // permission-denied is the expected outcome of many tests

const apps: FirebaseApp[] = [];
let n = 0;

/** A Firestore client signed in as `who` (or signed out). */
function as(who?: Who): Firestore {
  const app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-key" }, `rules-${n++}`);
  apps.push(app);
  const db = getFirestore(app);
  const [host, port] = FIRESTORE_HOST!.split(":");
  connectFirestoreEmulator(
    db,
    host,
    Number(port),
    who
      ? { mockUserToken: { sub: `fb-${n}`, email: who.email, email_verified: who.verified ?? true, ...(who.appUserId ? { appUserId: who.appUserId } : {}) } }
      : undefined,
  );
  return db;
}

const ADMIN: Who = { appUserId: "usrJordan", email: "jordan@example.org" };
const SAM: Who = { appUserId: "usrSam", email: "sam@example.org" };
const PARTNER: Who = { appUserId: "usrPartner", email: "partner@example.org" };

const denied = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: "permission-denied" });

let ids: { project: string; otherProject: string; samTask: string; morganTask: string };

beforeAll(async () => {
  await clearFirestore();
  await seedReferenceData();
  const store = new FirestoreStore(admin().db);
  const template = (await store.getTemplate("tplYmca"))!;
  const roles = rolesForSteps(template.steps);
  // First role → Sam, the rest → Morgan.
  const roleAssignments = Object.fromEntries(roles.map((r, i) => [r, [i === 0 ? "usrSam" : "usrMorgan"]]));
  const base = { siteId: "siteY", templateId: "tplYmca", startDate: "2027-04-15", endDate: "2027-05-20", teamUserIds: [], createdByUserId: "usrJordan" };
  const { drafts } = generateTaskDrafts({ steps: template.steps, startDate: base.startDate, endDate: base.endDate, roleAssignments });
  const project = await store.createProjectWithTasks({ ...base, name: "Mixed" }, drafts);
  const tasks = await store.getTasksByIds(project.taskIds);
  const other = await store.createProjectWithTasks(
    { ...base, name: "Morgan only" },
    generateTaskDrafts({ steps: template.steps, startDate: base.startDate, endDate: base.endDate, roleAssignments: Object.fromEntries(roles.map((r) => [r, ["usrMorgan"]])) }).drafts,
  );
  ids = {
    project: project.id,
    otherProject: other.id,
    samTask: tasks.find((t) => t.assigneeIds.includes("usrSam") && !t.assigneeIds.includes("usrMorgan"))!.id,
    morganTask: tasks.find((t) => !t.assigneeIds.includes("usrSam"))!.id,
  };
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => deleteApp(a)));
});

describe("signed-out and unlinked accounts", () => {
  it("can't read anything", async () => {
    await denied(getDoc(doc(as(), "tasks", ids.samTask)));
    await denied(getDoc(doc(as(), "users", "usrSam")));
  });
  it("a new Firebase account without the server-set link gets nothing", async () => {
    await denied(getDoc(doc(as({ email: "new@example.org" }), "projects", ids.project)));
  });
  it("an unverified email gets nothing, even with an admin's link", async () => {
    await denied(getDoc(doc(as({ ...ADMIN, verified: false }), "projects", ids.project)));
  });
  it("a link whose email doesn't match the user record gets nothing", async () => {
    await denied(getDoc(doc(as({ appUserId: "usrJordan", email: "attacker@example.org" }), "projects", ids.project)));
  });
  it("deactivated users get nothing", async () => {
    await denied(getDoc(doc(as({ appUserId: "usrInactive", email: "former@example.org" }), "users", "usrInactive")));
  });
});

describe("Admin", () => {
  it("reads and manages programs, templates and assignments", async () => {
    const db = as(ADMIN);
    expect((await getDoc(doc(db, "tasks", ids.morganTask))).exists()).toBe(true);
    expect((await getDocs(collection(db, "users"))).size).toBeGreaterThan(5);
    await updateDoc(doc(db, "projects", ids.project), { status: "Active" });
    await updateDoc(doc(db, "tasks", ids.morganTask), { assigneeIds: ["usrRiley"] });
    await updateDoc(doc(db, "templates", "tplYmca"), { description: "Edited by an admin" });
  });
  it("still can't edit user records (access levels change only through the server)", async () => {
    await denied(updateDoc(doc(as(ADMIN), "users", "usrSam"), { accessLevel: "Admin" }));
  });
  it("can't save an invalid status", async () => {
    await denied(updateDoc(doc(as(ADMIN), "tasks", ids.samTask), { status: "Whatever" }));
  });
});

describe("Staff", () => {
  it("reads their own tasks and their projects, but not others'", async () => {
    const db = as(SAM);
    expect((await getDoc(doc(db, "tasks", ids.samTask))).exists()).toBe(true);
    expect((await getDoc(doc(db, "projects", ids.project))).exists()).toBe(true);
    await denied(getDoc(doc(db, "tasks", ids.morganTask)));
    await denied(getDoc(doc(db, "projects", ids.otherProject)));
  });
  it("can list their own tasks but not everyone's", async () => {
    const db = as(SAM);
    const mine = await getDocs(query(collection(db, "tasks"), where("assigneeIds", "array-contains", "usrSam")));
    expect(mine.size).toBeGreaterThan(0);
    await denied(getDocs(collection(db, "tasks")));
  });
  it("reads only their own user record", async () => {
    const db = as(SAM);
    expect((await getDoc(doc(db, "users", "usrSam"))).exists()).toBe(true);
    await denied(getDoc(doc(db, "users", "usrJordan")));
  });
  it("can change the status of their own task, and nothing else on it", async () => {
    const db = as(SAM);
    await updateDoc(doc(db, "tasks", ids.samTask), { status: "In Progress" });
    await denied(updateDoc(doc(db, "tasks", ids.samTask), { assigneeIds: ["usrSam", "usrRiley"] }));
    await denied(updateDoc(doc(db, "tasks", ids.samTask), { dueDate: "2030-01-01" }));
    await denied(updateDoc(doc(db, "tasks", ids.samTask), { status: "Hacked" }));
  });
  it("can't change other people's tasks, projects or templates", async () => {
    const db = as(SAM);
    await denied(updateDoc(doc(db, "tasks", ids.morganTask), { status: "Done" }));
    await denied(updateDoc(doc(db, "projects", ids.project), { status: "Cancelled" }));
    await denied(getDoc(doc(db, "templates", "tplYmca")));
    await denied(setDoc(doc(db, "projects", "newProject"), { name: "Mine", status: "Planning" }));
  });
  it("can never promote themselves to Admin", async () => {
    await denied(updateDoc(doc(as(SAM), "users", "usrSam"), { accessLevel: "Admin" }));
    await denied(setDoc(doc(as({ appUserId: "usrNew", email: "new@example.org" }), "users", "usrNew"), { email: "new@example.org", accessLevel: "Admin", active: true }));
  });
});

describe("Partner", () => {
  it("has no access yet", async () => {
    const db = as(PARTNER);
    await denied(getDoc(doc(db, "projects", ids.project)));
    await denied(getDoc(doc(db, "tasks", ids.samTask)));
  });
});
