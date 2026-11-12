"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type AuthCredential,
  type User as FirebaseUser,
} from "firebase/auth";
import { Alert, buttonPrimary, buttonSecondary, inputClass, labelClass } from "@/components/ui";
import { describeFirebaseAuthError, getBrowserAuth, startAppSession } from "@/lib/firebase/client";
import { linkGoogleToPasswordAccount, signInWithGoogle } from "@/lib/firebase/google";

type Mode = "sign-in" | "create" | "reset" | "link";
type Status =
  | { kind: "idle" }
  | { kind: "working"; label: string; via: "google" | "form" }
  | { kind: "error"; message: string; unverified?: FirebaseUser }
  | { kind: "info"; message: string };

const TITLES: Record<Mode, string> = {
  "sign-in": "Or sign in with email and password",
  create: "First time? Set your password",
  reset: "Reset your password",
  link: "Connect Google to your account",
};

class NotConfiguredError extends Error {
  code = "auth/not-configured";
}

async function browserAuth(): Promise<Auth> {
  const auth = getBrowserAuth();
  if (!auth) throw new NotConfiguredError();
  return auth;
}

/**
 * Firebase sign-in: "Continue with Google" plus email and password.
 * Firebase proves who the person is; the server then checks the email against
 * the Users table and starts the normal app session
 * (src/app/auth/firebase/session/route.ts), identically for both methods.
 */
export function FirebaseSignIn() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pendingLink, setPendingLink] = useState<{ email: string; credential: AuthCredential } | null>(null);
  const busy = status.kind === "working";

  async function finish(auth: Auth, user: FirebaseUser) {
    const result = await startAppSession(auth, user);
    if (result.ok) {
      setStatus({ kind: "working", label: "Opening your dashboard…", via: "form" });
      window.location.assign(result.redirectTo);
      return;
    }
    setStatus({ kind: "error", message: result.message, unverified: result.reason === "email-not-verified" ? user : undefined });
  }

  async function onGoogle() {
    setStatus({ kind: "working", label: "Waiting for Google…", via: "google" });
    try {
      const auth = await browserAuth();
      const outcome = await signInWithGoogle(auth);
      if (outcome.kind === "cancelled") return setStatus({ kind: "idle" });
      if (outcome.kind === "error") return setStatus({ kind: "error", message: outcome.message });
      if (outcome.kind === "needs-link") {
        setPendingLink({ email: outcome.email, credential: outcome.credential });
        setMode("link");
        return setStatus({
          kind: "info",
          message: `${outcome.email} already has a password for NMU Onboarding. Enter it once to connect Google; after that you can use either.`,
        });
      }
      setStatus({ kind: "working", label: "Signing in…", via: "google" });
      await finish(auth, outcome.user);
    } catch (err) {
      setStatus({ kind: "error", message: describeFirebaseAuthError(err) });
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = (pendingLink && mode === "link" ? pendingLink.email : String(form.get("email") ?? "")).trim();
    const password = String(form.get("password") ?? "");

    try {
      const auth = await browserAuth();

      if (mode === "reset") {
        setStatus({ kind: "working", label: "Sending…", via: "form" });
        await sendPasswordResetEmail(auth, email);
        // Same message whether or not the account exists, so emails can't be probed.
        setMode("sign-in");
        return setStatus({ kind: "info", message: "If that email has a password set, a reset link is on its way. Check your inbox." });
      }

      if (mode === "create") {
        setStatus({ kind: "working", label: "Creating…", via: "form" });
        const { user } = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(user);
        await signOut(auth);
        setMode("sign-in");
        return setStatus({
          kind: "info",
          message:
            "Password set. We emailed you a verification link: open it, then sign in. Access is only granted to emails an administrator has added.",
        });
      }

      if (mode === "link" && pendingLink) {
        setStatus({ kind: "working", label: "Connecting Google…", via: "form" });
        const user = await linkGoogleToPasswordAccount(auth, pendingLink.email, password, pendingLink.credential);
        setPendingLink(null);
        return await finish(auth, user);
      }

      setStatus({ kind: "working", label: "Signing in…", via: "form" });
      const { user } = await signInWithEmailAndPassword(auth, email, password);
      await finish(auth, user);
    } catch (err) {
      setStatus({ kind: "error", message: describeFirebaseAuthError(err) });
    }
  }

  async function resendVerification(user: FirebaseUser) {
    setStatus({ kind: "working", label: "Sending…", via: "form" });
    try {
      await sendEmailVerification(user);
      await signOut(await browserAuth());
      setStatus({ kind: "info", message: "Verification email sent. Open the link, then sign in again." });
    } catch (err) {
      setStatus({ kind: "error", message: describeFirebaseAuthError(err) });
    }
  }

  const switchMode = (next: Mode) => {
    setMode(next);
    setPendingLink(null);
    setStatus({ kind: "idle" });
  };

  return (
    <div className="space-y-5">
      {mode !== "link" && (
        <>
          <GoogleButton onClick={onGoogle} disabled={busy} working={busy && status.via === "google"} />
          <div className="flex items-center gap-3 text-xs text-slate-500" aria-hidden="true">
            <span className="h-px flex-1 bg-slate-200" />
            or
            <span className="h-px flex-1 bg-slate-200" />
          </div>
        </>
      )}

      <section aria-labelledby="fb-form-title" className="space-y-3">
        <h2 id="fb-form-title" className="text-sm font-semibold text-slate-800">
          {mode === "sign-in" ? TITLES["sign-in"] : TITLES[mode]}
        </h2>
        <form onSubmit={onSubmit} className="space-y-3" aria-busy={busy}>
          <div>
            <label htmlFor="fb-email" className={labelClass}>
              Email
            </label>
            <input
              key={mode === "link" ? "link" : "free" /* remount when switching to the prefilled linking step */}
              id="fb-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              readOnly={mode === "link"}
              defaultValue={mode === "link" ? pendingLink?.email : undefined}
              className={`mt-1 ${inputClass} read-only:bg-slate-50`}
            />
          </div>
          {mode !== "reset" && (
            <div>
              <label htmlFor="fb-password" className={labelClass}>
                Password
              </label>
              <input
                id="fb-password"
                name="password"
                type="password"
                autoComplete={mode === "create" ? "new-password" : "current-password"}
                minLength={mode === "create" ? 8 : undefined}
                required
                autoFocus={mode === "link"}
                className={`mt-1 ${inputClass}`}
              />
            </div>
          )}
          <button type="submit" disabled={busy} className={`${mode === "sign-in" ? buttonSecondary : buttonPrimary} w-full`}>
            {busy && status.via === "form"
              ? status.label
              : { "sign-in": "Sign in", create: "Set password", reset: "Send reset link", link: "Connect Google and sign in" }[mode]}
          </button>
        </form>
      </section>

      <div aria-live="polite" aria-atomic="true">
        {status.kind === "error" && (
          <Alert tone="error">
            <p>{status.message}</p>
            {status.unverified && (
              <button type="button" onClick={() => resendVerification(status.unverified!)} className={`${buttonSecondary} mt-2`}>
                Resend verification email
              </button>
            )}
          </Alert>
        )}
        {status.kind === "info" && <Alert tone="info">{status.message}</Alert>}
        {busy && <span className="sr-only">{status.label}</span>}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {mode !== "sign-in" && <TextButton onClick={() => switchMode("sign-in")}>Back to sign in</TextButton>}
        {mode !== "reset" && mode !== "link" && <TextButton onClick={() => switchMode("reset")}>Forgot password?</TextButton>}
        {mode === "sign-in" && <TextButton onClick={() => switchMode("create")}>First time? Set a password</TextButton>}
      </div>
    </div>
  );
}

function TextButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded font-medium text-brand-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40"
    >
      {children}
    </button>
  );
}

/**
 * Google-branded button (white, standard "G" mark, "Continue with Google"),
 * following Google's sign-in branding guidelines. Large touch target and a
 * visible keyboard focus ring.
 */
export function GoogleButton({ onClick, disabled, working }: { onClick: () => void; disabled?: boolean; working?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-11 w-full items-center justify-center gap-3 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-[#1f1f1f] shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg aria-hidden="true" focusable="false" viewBox="0 0 48 48" className="h-5 w-5 shrink-0">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
      <span>{working ? "Waiting for Google…" : "Continue with Google"}</span>
    </button>
  );
}
