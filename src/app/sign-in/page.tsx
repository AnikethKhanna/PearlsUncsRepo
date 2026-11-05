import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert, Card, buttonPrimary } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/current-user";
import { configProblems, devSignInBlocker, getGoogleOAuthConfig } from "@/lib/config";
import { DevSignInForm } from "./dev-sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  "not-registered": "That Google account isn't registered for NMU Onboarding. Ask an administrator to add your email.",
  "sign-in-failed": "Sign-in didn't complete. Please try again.",
  "google-not-configured": "Google sign-in hasn't been set up yet (see the README).",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const isLocalDev = process.env.NODE_ENV === "development";
  const problems = configProblems();
  if (problems.length === 0 && (await getCurrentUser())) redirect("/projects");
  const { error } = await searchParams;
  const googleEnabled = !!getGoogleOAuthConfig();
  const devBlocker = devSignInBlocker();
  const devEnabled = problems.length === 0 && devBlocker === null;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm p-8">
        <h1 className="text-xl font-bold text-slate-900">NMU Onboarding</h1>
        <p className="mt-1 text-sm text-slate-600">Sign in with your No More Under account.</p>
        <div className="mt-6 space-y-6">
          {typeof error === "string" && ERRORS[error] && <Alert tone="error">{ERRORS[error]}</Alert>}
          {googleEnabled && (
            // Plain link (not <Link>): this leaves the app for Google's sign-in page.
            <a href="/auth/google" className={`${buttonPrimary} w-full`}>
              Sign in with Google
            </a>
          )}
          {devEnabled && <DevSignInForm />}
          {problems.length > 0 && (
            <Alert tone="error">
              <p className="font-semibold">The app isn&apos;t configured yet: {problems.join("; ")}.</p>
              {isLocalDev && <SetupHelp />}
            </Alert>
          )}
          {problems.length === 0 && !googleEnabled && !devEnabled && (
            <Alert tone="warning">
              <p className="font-semibold">No sign-in method is configured.</p>
              {isLocalDev ? (
                <>
                  <p className="mt-1">Development sign-in is off because {devBlocker}.</p>
                  <SetupHelp />
                </>
              ) : (
                <p className="mt-1">Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see the README).</p>
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
      <li>On Windows, check the file isn&apos;t secretly named <code>.env.local.txt</code>.</li>
      <li>
        Stop the dev server (Ctrl+C) and run <code>npm run dev</code> again — env files are only read at startup.
      </li>
    </ul>
  );
}
