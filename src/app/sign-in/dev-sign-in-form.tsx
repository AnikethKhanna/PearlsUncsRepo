"use client";

import { useActionState } from "react";
import { Alert, buttonSecondary, inputClass, labelClass } from "@/components/ui";
import { devSignIn, type SignInState } from "./actions";

export function DevSignInForm() {
  const [state, action, pending] = useActionState<SignInState, FormData>(devSignIn, {});
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="email" className={labelClass}>
          Email (development sign-in)
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required className={`mt-1 ${inputClass}`} />
      </div>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <button type="submit" disabled={pending} className={`${buttonSecondary} w-full`}>
        {pending ? "Signing in…" : "Sign in without password"}
      </button>
      <p className="text-xs text-slate-500">Only available in local development. Never enabled in production.</p>
    </form>
  );
}
