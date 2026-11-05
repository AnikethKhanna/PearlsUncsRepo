"use client";

import { useActionState } from "react";
import { Alert, buttonPrimary, buttonSecondary, inputClass, labelClass } from "@/components/ui";
import { devSignIn, type SignInState } from "./actions";

export interface SampleAccount {
  email: string;
  name: string;
  accessLevel: string;
  description: string;
}

/**
 * Development sign-in. With placeholder data, shows one-click buttons for the
 * made-up sample accounts so the prototype can be explored without typing.
 */
export function DevSignInForm({ sampleAccounts }: { sampleAccounts: SampleAccount[] }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(devSignIn, {});
  return (
    <div className="space-y-5">
      {state.error && <Alert tone="error">{state.error}</Alert>}

      {sampleAccounts.length > 0 && (
        <form action={action} className="space-y-2">
          <p className="text-sm font-medium text-slate-800">Explore the prototype as:</p>
          {sampleAccounts.map((a) => (
            <button
              key={a.email}
              type="submit"
              name="email"
              value={a.email}
              disabled={pending}
              className={`${a.accessLevel === "Admin" ? buttonPrimary : buttonSecondary} w-full flex-col !items-start text-left`}
            >
              <span>
                {a.name} · {a.accessLevel}
              </span>
              <span className="text-xs font-normal opacity-80">{a.description}</span>
            </button>
          ))}
          <p className="text-xs text-slate-500">These are made-up sample accounts. No real email or password is needed.</p>
        </form>
      )}

      <details className="text-sm" open={sampleAccounts.length === 0}>
        <summary className="cursor-pointer text-slate-600">Sign in with an email from the Users table</summary>
        <form action={action} className="mt-3 space-y-3">
          <div>
            <label htmlFor="email" className={labelClass}>
              Email
            </label>
            <input id="email" name="email" type="email" autoComplete="email" required className={`mt-1 ${inputClass}`} />
          </div>
          <button type="submit" disabled={pending} className={`${buttonSecondary} w-full`}>
            {pending ? "Signing in…" : "Sign in without password"}
          </button>
        </form>
      </details>
      <p className="text-xs text-slate-500">Development sign-in only. Never enabled in production.</p>
    </div>
  );
}
