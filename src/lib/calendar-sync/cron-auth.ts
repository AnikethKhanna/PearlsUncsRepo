import { timingSafeEqual } from "node:crypto";

/** True only for "Bearer <secret>" with the exact secret (constant-time compare). No secret configured → never authorized. */
export function isAuthorizedCronRequest(authorization: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = Buffer.from(authorization ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
