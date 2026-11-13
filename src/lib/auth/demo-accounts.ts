/**
 * Demo accounts: Users rows whose email ends in @example.com, signed into with
 * a shared password (DEMO_PASSWORD) so testers can see both the Admin and the
 * Staff view without their own Google account having that role.
 *
 * - example.com is reserved (RFC 2606): no real person can own one of these
 *   emails, so the shared password can never unlock a real person's account.
 * - Demo accounts never get Google features (Calendar sync, Sheets export):
 *   see permissions.ts. Nobody owns the Google account behind them.
 * - Remove DEMO_PASSWORD from the environment to turn the feature off.
 *
 * No Node-only imports here: permissions.ts imports this file.
 */
export const DEMO_EMAIL_DOMAIN = "example.com";

/** Shorter passwords are ignored (the feature stays off) because there is no lockout. */
export const MIN_DEMO_PASSWORD_LENGTH = 16;

export function isDemoEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}
