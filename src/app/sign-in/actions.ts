"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { endSession, startSession } from "@/lib/auth/current-user";
import { isDemoEmail } from "@/lib/auth/demo-accounts";
import { configProblems, getDemoPassword, isDevSignInEnabled } from "@/lib/config";
import { getStore } from "@/lib/data";

export interface SignInState {
  error?: string;
}

/**
 * Email-only sign-in for LOCAL DEVELOPMENT and demos without Google OAuth.
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
  redirect("/my-tasks");
}

/**
 * Demo-account sign-in: an @example.com Users row plus the shared DEMO_PASSWORD.
 * Works in production (the password is the gate), so testers can see the Admin
 * and Staff views. Off unless DEMO_PASSWORD is set (16+ characters).
 */
export async function demoSignIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const expected = getDemoPassword();
  if (!expected || configProblems().length > 0) return { error: "Demo accounts are turned off." };
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!isDemoEmail(email) || !passwordMatches(password, expected)) {
    // There's no lockout, so slow down guessing.
    await new Promise((resolve) => setTimeout(resolve, FAILED_DEMO_DELAY_MS));
    return { error: "That demo password isn't right." };
  }
  const user = await getStore().getUserByEmail(email);
  if (!user || !user.active) return { error: "That demo account isn't set up. Ask an administrator." };
  await startSession(user.id);
  redirect("/my-tasks");
}

const FAILED_DEMO_DELAY_MS = 1000;

/** Constant-time comparison (hashing first so lengths always match). */
function passwordMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function signOut() {
  await endSession();
  redirect("/sign-in");
}
