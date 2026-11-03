import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert, Card, buttonPrimary } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getGoogleOAuthConfig, isDevSignInEnabled } from "@/lib/config";
import { DevSignInForm } from "./dev-sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  "not-registered": "That Google account isn't registered for NMU Onboarding. Ask an administrator to add your email.",
  "sign-in-failed": "Sign-in didn't complete. Please try again.",
  "google-not-configured": "Google sign-in hasn't been set up yet (see the README).",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  if (await getCurrentUser()) redirect("/projects");
  const { error } = await searchParams;
  const googleEnabled = !!getGoogleOAuthConfig();
  const devEnabled = isDevSignInEnabled();

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
          {!googleEnabled && !devEnabled && (
            <Alert tone="warning">No sign-in method is configured. See the README for GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.</Alert>
          )}
        </div>
      </Card>
    </main>
  );
}
