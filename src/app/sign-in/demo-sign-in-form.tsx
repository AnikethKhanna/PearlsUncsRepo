"use client";

import { useActionState } from "react";
import { Alert, buttonSecondary, inputClass, labelClass } from "@/components/ui";
import { demoSignIn, type SignInState } from "./actions";

export interface DemoAccount {
  email: string;
  name: string;
  accessLevel: string;
}

/** Demo accounts behind the shared DEMO_PASSWORD (see src/lib/auth/demo-accounts.ts). */
export function DemoSignInForm({ accounts }: { accounts: DemoAccount[] }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(demoSignIn, {});
  return (
    <form action={action} className="space-y-3 border-t border-slate-200 pt-5">
      <div>
        <p className="text-sm font-medium text-slate-800">Demo accounts for testing</p>
        <p className="text-xs text-slate-500">Enter the demo password you were given, then choose a view.</p>
      </div>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <div>
        <label htmlFor="demo-password" className={labelClass}>
          Demo password
        </label>
        <input
          id="demo-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={`mt-1 ${inputClass}`}
        />
      </div>
      <div className="space-y-2">
        {accounts.map((a) => (
          <button
            key={a.email}
            type="submit"
            name="email"
            value={a.email}
            disabled={pending}
            className={`${buttonSecondary} w-full`}
          >
            {pending ? "Signing in…" : `Continue as ${a.name} · ${a.accessLevel}`}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">Demo accounts can&apos;t use Google Calendar or Google Sheets.</p>
    </form>
  );
}
