/**
 * "Continue with Google" through Firebase Authentication's GoogleAuthProvider.
 *
 * Popup, not redirect: the app is hosted on Vercel while Firebase's auth
 * handler lives on <project>.firebaseapp.com. signInWithRedirect across those
 * two domains breaks in browsers that block third-party storage (Safari,
 * Firefox, Chrome's tracking protection), whereas signInWithPopup works
 * everywhere without proxying the auth domain. See docs/firebase.md.
 *
 * Scopes: ordinary sign-in asks for NOTHING beyond Firebase's defaults
 * (openid, email, profile). Google Calendar access is a separate, explicit
 * "Connect calendar" step in the future (GOOGLE_CALENDAR_SCOPES below), so
 * staff never see a Calendar consent screen just to log in.
 *
 * No Google access token or credential is ever stored: the pending credential
 * used for account linking lives only in component memory for one step.
 */
import {
  GoogleAuthProvider,
  linkWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  type Auth,
  type AuthCredential,
  type AuthProvider,
  type User,
  type UserCredential,
} from "firebase/auth";
import { describeFirebaseAuthError, firebaseErrorCode } from "./client";

/** Extra scopes requested at sign-in. Intentionally empty; see the file comment. */
export const GOOGLE_SIGN_IN_SCOPES: readonly string[] = [];

/**
 * Scopes for the FUTURE Google Calendar integration. Request these only from
 * an explicit "Connect Google Calendar" action (incremental authorization),
 * never during sign-in. See docs/firebase.md → "Future: Google Calendar".
 */
export const GOOGLE_CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.events"] as const;

/** The provider used for ordinary sign-in. */
export function createGoogleSignInProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  for (const scope of GOOGLE_SIGN_IN_SCOPES) provider.addScope(scope);
  // Always show the account chooser, so people with a personal and a work
  // Google account pick the right one (and can switch after signing out).
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

export type GoogleSignInOutcome =
  | { kind: "signed-in"; user: User }
  /** The person closed the popup or started another one: not an error. */
  | { kind: "cancelled" }
  /** The email already has a password account; prove ownership to link Google to it. */
  | { kind: "needs-link"; email: string; credential: AuthCredential }
  | { kind: "error"; code: string; message: string };

type PopupFn = (auth: Auth, provider: AuthProvider) => Promise<UserCredential>;

const CANCELLED = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);

export async function signInWithGoogle(auth: Auth, popup: PopupFn = signInWithPopup): Promise<GoogleSignInOutcome> {
  try {
    const result = await popup(auth, createGoogleSignInProvider());
    return { kind: "signed-in", user: result.user };
  } catch (err) {
    const code = firebaseErrorCode(err);
    if (CANCELLED.has(code)) return { kind: "cancelled" };
    if (code === "auth/account-exists-with-different-credential") {
      const credential = GoogleAuthProvider.credentialFromError(err as Parameters<typeof GoogleAuthProvider.credentialFromError>[0]);
      const email = (err as { customData?: { email?: unknown } }).customData?.email;
      if (credential && typeof email === "string") return { kind: "needs-link", email, credential };
    }
    return { kind: "error", code, message: describeFirebaseAuthError(err) };
  }
}

/**
 * Secure account linking: the person signs in with the password they already
 * have (proving they own the account), then Google is attached to that SAME
 * Firebase account. One account, one app profile, either sign-in method.
 */
export async function linkGoogleToPasswordAccount(
  auth: Auth,
  email: string,
  password: string,
  googleCredential: AuthCredential,
): Promise<User> {
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  try {
    await linkWithCredential(user, googleCredential);
  } catch (err) {
    // Already linked (e.g. a second attempt) is fine: the person is signed in either way.
    if (firebaseErrorCode(err) !== "auth/provider-already-linked") throw err;
  }
  return user;
}
