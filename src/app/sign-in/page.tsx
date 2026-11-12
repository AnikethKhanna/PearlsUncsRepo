import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert, Card } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/current-user";
import { homePathFor } from "@/lib/auth/permissions";
import { configProblems, devSignInBlocker } from "@/lib/config";
import { getStore } from "@/lib/data";
import { getFirebaseWebConfig } from "@/lib/firebase/config";
import { isFirebaseAdminConfigured } from "@/lib/firebase/server";
import { DevSignInForm, type SampleAccount } from "./dev-sign-in-form";
import { FirebaseSignIn } from "./firebase-sign-in";

const SAMPLE_DESCRIPTIONS: Record<string, string> = {
  Admin: "Sees everything; can create projects",
  Staff: "Sees only projects they're assigned to",
  Partner: "External partner; no access yet (pending sponsor decision)",
};

export const metadata: Metadata = { title: "Sign in" };

/** What's missing for Firebase sign-in (Google + email/password), in plain words. */
function firebaseSetupGaps(): string[] {
  const gaps: string[] = [];
  if (!getFirebaseWebConfig()) gaps.push("the public web config (NEXT_PUBLIC_FIREBASE_*)");
  try {
    if (!isFirebaseAdminConfigured()) gaps.push("the server's service account (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)");
  } catch (err) {
    gaps.push(err instanceof Error ? err.message : "a valid server configuration");
  }
  return gaps;
}

export default async function SignInPage() {
  const isLocalDev = process.env.NODE_ENV === "development";
  const problems = configProblems();
  if (problems.length === 0) {
    const user = await getCurrentUser();
    if (user) redirect(homePathFor(user));
  }
  const firebaseGaps = firebaseSetupGaps();
  // Google and email/password both need the browser config AND the server credentials.
  const firebaseEnabled = problems.length === 0 && firebaseGaps.length === 0;
  const firebasePartlyConfigured = firebaseGaps.length === 1;
  const devBlocker = devSignInBlocker();
  const devEnabled = problems.length === 0 && devBlocker === null;

  // One-click buttons, ONLY for the placeholder's made-up accounts. Real Airtable
  // users are never listed on this public page.
  let sampleAccounts: SampleAccount[] = [];
  if (devEnabled && getStore().kind === "memory") {
    sampleAccounts = (await getStore().listUsers())
      .filter((u) => u.active)
      .sort(
        (a, b) =>
          ["Admin", "Staff", "Partner"].indexOf(a.accessLevel) - ["Admin", "Staff", "Partner"].indexOf(b.accessLevel),
      )
      .map((u) => ({
        email: u.email,
        name: u.name,
        accessLevel: u.accessLevel,
        description: [u.jobTitle, SAMPLE_DESCRIPTIONS[u.accessLevel]].filter(Boolean).join(" — "),
      }));
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-8 sm:py-12">
      <Card className="w-full max-w-sm p-6 sm:p-8">
        <h1 className="text-xl font-bold text-slate-900">NMU Onboarding</h1>
        <p className="mt-1 text-sm text-slate-600">
          Sign in with your No More Under account. Access is for NMU staff an administrator has added.
        </p>
        <div className="mt-6 space-y-6">
          {firebaseEnabled && <FirebaseSignIn />}
          {problems.length === 0 && firebasePartlyConfigured && (
            <Alert tone="warning">
              <p className="font-semibold">Google and email sign-in are unavailable right now.</p>
              {isLocalDev ? (
                <p className="mt-1">Firebase is only partly configured. Missing: {firebaseGaps.join("; ")}. See docs/firebase.md.</p>
              ) : (
                <p className="mt-1">Please contact an administrator.</p>
              )}
            </Alert>
          )}
          {devEnabled && <DevSignInForm sampleAccounts={sampleAccounts} />}
          {problems.length > 0 && (
            <Alert tone="error">
              <p className="font-semibold">The app isn&apos;t configured yet: {problems.join("; ")}.</p>
              {isLocalDev && <SetupHelp />}
            </Alert>
          )}
          {problems.length === 0 && !firebaseEnabled && !firebasePartlyConfigured && !devEnabled && (
            <Alert tone="warning">
              <p className="font-semibold">No sign-in method is configured.</p>
              {isLocalDev ? (
                <>
                  <p className="mt-1">Development sign-in is off because {devBlocker}.</p>
                  <SetupHelp />
                </>
              ) : (
                <p className="mt-1">Set up Firebase Authentication (see docs/firebase.md).</p>
              )}
            </Alert>
          )}
        </div>
      </Card>
    </main>
  );
}

/** Local setup checklist (only shown by `npm run dev`). Contains no secret values. */
function SetupHelp() {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-4">
      <li>
        In <code>.env.local</code> (project root, next to <code>package.json</code>), make sure it has{" "}
        <code>DATA_BACKEND=memory</code>, <code>ALLOW_DEV_SIGN_IN=true</code> and a <code>SESSION_SECRET</code> of 32+
        characters — and no other <code>ALLOW_DEV_SIGN_IN=false</code> line.
      </li>
      <li>
        On Windows, check the file isn&apos;t secretly named <code>.env.local.txt</code>.
      </li>
      <li>
        Stop the dev server (Ctrl+C) and run <code>npm run dev</code> again — env files are only read at startup.
      </li>
    </ul>
  );
}
