import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session-token";

/**
 * Optimistic route protection: signed-out visitors to the app's pages go
 * straight to /sign-in without rendering anything.
 *
 * This only checks that a session cookie EXISTS. The real check (signature,
 * expiry, active user, permissions) happens on the server in
 * src/app/(app)/layout.tsx and in every server action — never rely on this
 * file alone.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  return NextResponse.redirect(new URL("/sign-in", request.url));
}

export const config = {
  matcher: ["/my-tasks/:path*", "/projects/:path*"],
};
