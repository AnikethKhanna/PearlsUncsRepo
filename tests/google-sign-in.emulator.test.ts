/**
 * Google sign-in end to end on the Auth + Firestore emulators:
 *  - a Google credential signs in through the real session route,
 *  - returning users, duplicate prevention and secure account linking,
 *  - unapproved Google accounts get nothing,
 *  - and the real project/task server actions behave identically for
 *    Google and email/password sessions.
 *
 * The Auth emulator accepts unsigned Google ID tokens, so no real Google
 * account (or popup) is needed. The popup itself is covered by unit tests
 * with a fake (tests/google-sign-in.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from "firebase/auth";
import { verifySessionToken } from "@/lib/auth/session-token";
import { linkGoogleToPasswordAccount } from "@/lib/firebase/google";
import { AUTH_HOST, PROJECT_ID, admin, clearAuth, clearFirestore, seedReferenceData } from "./emulator-helpers";

// Server actions read the session cookie through next/headers; give them the
// cookie our sign-in produced, exactly as a browser would send it.
const jar = vi.hoisted(() => ({ session: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "nmu_session" && jar.session ? { name, value: jar.session } : undefined),
    set: () => {},
    delete: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const SECRET = "test-session-secret-0123456789abcdef";
Object.assign(process.env, { DATA_BACKEND: "firestore", SESSION_SECRET: SECRET, APP_URL: "", FIREBASE_PROJECT_ID: PROJECT_ID });

const ORIGIN = "http://localhost:3000";
let POST: (req: NextRequest) => Promise<Response>;
let actions: typeof import("@/app/(app)/projects/actions");
let app: FirebaseApp;
let auth: Auth;

beforeAll(async () => {
  ({ POST } = await import("@/app/auth/firebase/session/route"));
  actions = await import("@/app/(app)/projects/actions");
  app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-key" }, "google-test");
  auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  await clearFirestore();
  await seedReferenceData();
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  await signOut(auth);
  await clearAuth();
  jar.session = undefined;
});

/** A Google credential as the Auth emulator accepts it (unsigned). */
const google = (email: string, sub = `google-${email}`) =>
  GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: true, name: email.split("@")[0] }));

async function exchange(idToken: string) {
  const res = await POST(
    new NextRequest(`${ORIGIN}/auth/firebase/session`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    }),
  );
  const cookie = /nmu_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
  return { status: res.status, body: await res.json(), cookie, userId: verifySessionToken(cookie, SECRET)?.uid ?? null };
}

async function googleSignIn(email: string, sub?: string) {
  const { user } = await signInWithCredential(auth, google(email, sub));
  const result = await exchange(await user.getIdToken());
  await signOut(auth);
  return { ...result, firebaseUid: user.uid, providers: user.providerData.map((p) => p.providerId) };
}

async function accountsFor(email: string) {
  const { users } = await admin().auth.listUsers();
  return users.filter((u) => u.email === email);
}

describe("Continue with Google", () => {
  it("signs an approved staff member in with their existing role and dashboard", async () => {
    const r = await googleSignIn("sam@example.org");
    expect(r).toMatchObject({ status: 200, userId: "usrSam", body: { ok: true, redirectTo: "/my-tasks" } });
    expect(r.providers).toEqual(["google.com"]);
  });

  it("keeps an admin an admin and sends them to All Projects", async () => {
    const r = await googleSignIn("jordan@example.org");
    expect(r).toMatchObject({ status: 200, userId: "usrJordan", body: { redirectTo: "/projects" } });
  });

  it("recognizes returning users: same Firebase account, same app profile, no duplicates", async () => {
    const first = await googleSignIn("sam@example.org", "google-sam");
    const second = await googleSignIn("sam@example.org", "google-sam");
    expect(second.firebaseUid).toBe(first.firebaseUid);
    expect(second.userId).toBe("usrSam");
    expect(await accountsFor("sam@example.org")).toHaveLength(1);
    expect((await admin().db.collection("users").where("email", "==", "sam@example.org").get()).size).toBe(1);
  });

  it("gives an unapproved Google account no session and creates nothing", async () => {
    const usersBefore = (await admin().db.collection("users").get()).size;
    const r = await googleSignIn("someone.new@gmail.com");
    expect(r).toMatchObject({ status: 403, cookie: undefined, body: { reason: "not-registered" } });
    expect(r.body.message).toMatch(/administrator/);
    expect((await admin().db.collection("users").get()).size).toBe(usersBefore);
    const [account] = await accountsFor("someone.new@gmail.com");
    expect(account.customClaims ?? {}).toEqual({});
  });

  it("refuses deactivated staff, even through Google", async () => {
    expect((await googleSignIn("former@example.org")).status).toBe(403);
  });

  it("links Google to an existing password account after the password is proven", async () => {
    const { user } = await createUserWithEmailAndPassword(auth, "riley@example.org", "riley-password-1");
    await admin().auth.updateUser(user.uid, { emailVerified: true });
    await signOut(auth);

    const linked = await linkGoogleToPasswordAccount(auth, "riley@example.org", "riley-password-1", google("riley@example.org"));
    expect(linked.uid).toBe(user.uid);
    expect(linked.providerData.map((p) => p.providerId).sort()).toEqual(["google.com", "password"]);
    await signOut(auth);

    // From now on Google lands in the SAME account and the same app profile.
    const r = await googleSignIn("riley@example.org");
    expect(r).toMatchObject({ firebaseUid: user.uid, userId: "usrRiley", status: 200 });
    expect(await accountsFor("riley@example.org")).toHaveLength(1);
  });

  it("refuses to link without the correct password", async () => {
    const { user } = await createUserWithEmailAndPassword(auth, "casey@example.org", "casey-password-1");
    await signOut(auth);
    await expect(
      linkGoogleToPasswordAccount(auth, "casey@example.org", "wrong-password-9", google("casey@example.org")),
    ).rejects.toMatchObject({
      // The emulator says wrong-password; production (email enumeration protection) says invalid-credential.
      code: expect.stringMatching(/^auth\/(wrong-password|invalid-credential)$/),
    });
    expect((await admin().auth.getUser(user.uid)).providerData.map((p) => p.providerId)).toEqual(["password"]);
  });

  it("maps Google and email/password sign-ins for the same person to the same app user", async () => {
    const viaGoogle = await googleSignIn("morgan@example.org", "google-morgan");
    await clearAuth();
    const { user } = await createUserWithEmailAndPassword(auth, "morgan@example.org", "morgan-password-1");
    await admin().auth.updateUser(user.uid, { emailVerified: true });
    const { user: again } = await signInWithEmailAndPassword(auth, "morgan@example.org", "morgan-password-1");
    const viaPassword = await exchange(await again.getIdToken(true));
    expect(viaPassword.userId).toBe(viaGoogle.userId);
    expect(viaPassword.body.redirectTo).toBe(viaGoogle.body.redirectTo);
  });
});

describe("project and task features after Google sign-in", () => {
  const redirectTarget = (err: unknown) => /NEXT_REDIRECT;[^;]*;([^;]+);/.exec(String((err as { digest?: string })?.digest))?.[1];

  it("work identically: admin creates a project, staff update only their own tasks", async () => {
    // Admin signs in with Google and creates a project from the YMCA template.
    jar.session = (await googleSignIn("jordan@example.org")).cookie;
    const form = new FormData();
    for (const [k, v] of Object.entries({ name: "Google sign-in check", siteId: "siteY", templateId: "tplYmca", startDate: "2027-04-15", endDate: "2027-05-20", role_0: "usrSam" }))
      form.set(k, v);
    const target = await actions.createProject({}, form).then(
      (state) => {
        throw new Error(`expected a redirect, got ${JSON.stringify(state)}`);
      },
      (err) => redirectTarget(err),
    );
    expect(target).toMatch(/^\/projects\/[^?]+\?created=1$/);
    const projectId = target!.split("/")[2].split("?")[0];

    const { db } = admin();
    const tasks = (await db.collection("tasks").where("projectId", "==", projectId).get()).docs;
    const samTask = tasks.find((t) => (t.get("assigneeIds") as string[]).includes("usrSam"))!;
    const otherTask = tasks.find((t) => !(t.get("assigneeIds") as string[]).includes("usrSam"))!;
    expect(samTask && otherTask).toBeTruthy();

    // Staff member signs in with Google.
    jar.session = (await googleSignIn("sam@example.org")).cookie;
    const update = (taskId: string, status: string) => {
      const f = new FormData();
      f.set("taskId", taskId);
      f.set("status", status);
      return actions.updateTaskStatus({}, f);
    };
    expect(await update(samTask.id, "Done")).toMatchObject({ savedAt: expect.any(Number) });
    expect((await db.collection("tasks").doc(samTask.id).get()).get("status")).toBe("Done");
    expect(await update(otherTask.id, "Done")).toEqual({ error: "You don't have permission to update this task." });
    expect((await db.collection("tasks").doc(otherTask.id).get()).get("status")).toBe("Not Started");
    expect(await actions.createProject({}, form)).toEqual({ error: "You don't have permission to do that." });

    // Signed out: nothing works.
    jar.session = undefined;
    expect(await update(samTask.id, "In Progress")).toEqual({ error: "Please sign in again." });
  });
});
