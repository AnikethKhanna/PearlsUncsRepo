import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionSecret, isProductionDeployment } from "@/lib/config";
import { getStore } from "@/lib/data";
import type { User } from "@/lib/domain/types";
import { can, type Permission } from "./permissions";
import { createSessionToken, verifySessionToken } from "./session-token";

export const SESSION_COOKIE = "nmu_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours
const USER_CACHE_MS = 60_000; // re-check role/active status at least once a minute

const g = globalThis as unknown as { __nmuUserCache?: Map<string, { user: User | null; at: number }> };
const userCache = (g.__nmuUserCache ??= new Map());

/** The signed-in, active user, or null. */
export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = verifySessionToken(token, getSessionSecret());
  if (!session) return null;

  const cached = userCache.get(session.uid);
  let user: User | null;
  if (cached && Date.now() - cached.at < USER_CACHE_MS) {
    user = cached.user;
  } else {
    user = await getStore().getUser(session.uid);
    userCache.set(session.uid, { user, at: Date.now() });
  }
  return user && user.active ? user : null;
}

/** For pages: redirect to sign-in if nobody is signed in. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

export class AuthorizationError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** For server actions: throws unless the signed-in user has the permission. */
export async function requirePermission(permission: Permission): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthorizationError("Please sign in again.");
  if (!can(user, permission)) throw new AuthorizationError();
  return user;
}

/** Forget cached user data (e.g. after a user's own record changes). */
export function invalidateUserCache(userId?: string) {
  if (userId) userCache.delete(userId);
  else userCache.clear();
}

/** Cookie that signs `userId` in. Use with cookies().set(...) or response.cookies.set(...). */
export function sessionCookie(userId: string) {
  invalidateUserCache(userId);
  return {
    name: SESSION_COOKIE,
    value: createSessionToken(userId, getSessionSecret(), SESSION_TTL_SECONDS),
    httpOnly: true,
    secure: isProductionDeployment() || process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function startSession(userId: string): Promise<void> {
  (await cookies()).set(sessionCookie(userId));
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
