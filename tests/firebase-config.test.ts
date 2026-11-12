import { afterEach, describe, expect, it, vi } from "vitest";
import { getDataBackend, getFirebaseAdminConfig } from "@/lib/config";
import { getFirebaseWebConfig } from "@/lib/firebase/config";

afterEach(() => vi.unstubAllEnvs());
const env = (vars: Record<string, string>) => Object.entries(vars).forEach(([k, v]) => vi.stubEnv(k, v));
const CLEAR = {
  VERCEL_ENV: "", APP_ENV: "", FIREBASE_AUTH_EMULATOR_HOST: "", FIRESTORE_EMULATOR_HOST: "", FIREBASE_PROJECT_ID: "",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "", FIREBASE_CLIENT_EMAIL: "", FIREBASE_PRIVATE_KEY: "", GOOGLE_APPLICATION_CREDENTIALS: "",
};

describe("data backend selection", () => {
  it("accepts firestore, and keeps airtable as the default", () => {
    env({ ...CLEAR, DATA_BACKEND: "" });
    expect(getDataBackend()).toBe("airtable");
    env({ DATA_BACKEND: "firestore" });
    expect(getDataBackend()).toBe("firestore");
  });
  it("rejects unknown backends", () => {
    env({ ...CLEAR, DATA_BACKEND: "mongo" });
    expect(() => getDataBackend()).toThrow(/must be/);
  });
});

describe("getFirebaseAdminConfig", () => {
  it("is null when nothing is configured", () => {
    env(CLEAR);
    expect(getFirebaseAdminConfig()).toBeNull();
  });
  it("reads service-account env vars and restores escaped newlines in the key", () => {
    env({ ...CLEAR, FIREBASE_PROJECT_ID: "nmu", FIREBASE_CLIENT_EMAIL: "sa@nmu.iam.gserviceaccount.com", FIREBASE_PRIVATE_KEY: "-----BEGIN-----\\nabc\\n-----END-----" });
    expect(getFirebaseAdminConfig()).toEqual({
      projectId: "nmu",
      emulator: false,
      serviceAccount: { clientEmail: "sa@nmu.iam.gserviceaccount.com", privateKey: "-----BEGIN-----\nabc\n-----END-----" },
    });
  });
  it("uses the emulators locally but refuses them in production", () => {
    env({ ...CLEAR, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });
    expect(getFirebaseAdminConfig()).toMatchObject({ emulator: true, projectId: "demo-nmu-onboarding" });
    env({ VERCEL_ENV: "production" });
    expect(() => getFirebaseAdminConfig()).toThrow(/refused in production/);
  });
});

describe("getFirebaseWebConfig", () => {
  it("needs apiKey, authDomain, projectId and appId", () => {
    env({ NEXT_PUBLIC_FIREBASE_API_KEY: "k", NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "nmu.firebaseapp.com", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "nmu", NEXT_PUBLIC_FIREBASE_APP_ID: "" });
    expect(getFirebaseWebConfig()).toBeNull();
    env({ NEXT_PUBLIC_FIREBASE_APP_ID: "1:2:web:3" });
    expect(getFirebaseWebConfig()).toMatchObject({ projectId: "nmu", appId: "1:2:web:3" });
  });
});
