"use server";

import { redirect } from "next/navigation";
import { endSession, startSession } from "@/lib/auth/current-user";
import { homePathFor } from "@/lib/auth/permissions";
import { isDevSignInEnabled } from "@/lib/config";
import { getStore } from "@/lib/data";

export interface SignInState {
  error?: string;
}

/**
 * Email-only sign-in for LOCAL DEVELOPMENT and demos without Firebase.
 * Disabled unless ALLOW_DEV_SIGN_IN=true, and always disabled in production
 * (enforced here on the server, not just by hiding the form).
 */
export async function devSignIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  if (!isDevSignInEnabled()) return { error: "Development sign-in is turned off." };
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Enter your email address." };
  const user = await getStore().getUserByEmail(email);
  if (!user || !user.active) return { error: "No active NMU account uses that email. Ask an administrator to add you." };
  await startSession(user.id);
  redirect(homePathFor(user));
}

export async function signOut() {
  await endSession();
  redirect("/sign-in");
}
