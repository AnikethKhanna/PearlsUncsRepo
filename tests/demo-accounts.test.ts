import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/lib/domain/types";

const PASSWORD = "correct-horse-battery-staple";
const config = { demoPassword: PASSWORD as string | null, problems: [] as string[] };
const users: User[] = [
  { id: "recDemoAdmin", name: "Demo Admin", email: "user1@example.com", accessLevel: "Admin", jobTitle: "", active: true, projectIds: [], assignedTaskIds: [] },
  { id: "recDemoOff", name: "Demo Off", email: "user2@example.com", accessLevel: "Staff", jobTitle: "", active: false, projectIds: [], assignedTaskIds: [] },
  { id: "recReal", name: "Real Person", email: "real.person@gmail.com", accessLevel: "Admin", jobTitle: "", active: true, projectIds: [], assignedTaskIds: [] },
];
const startSession = vi.fn<(id: string) => Promise<void>>(async () => {});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config", () => ({
  getDemoPassword: () => config.demoPassword,
  configProblems: () => config.problems,
  isDevSignInEnabled: () => false,
}));
vi.mock("@/lib/data", () => ({
  getStore: () => ({ getUserByEmail: async (email: string) => users.find((u) => u.email === email) ?? null }),
}));
vi.mock("@/lib/auth/current-user", () => ({ startSession: (id: string) => startSession(id), endSession: async () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

import { demoSignIn } from "@/app/sign-in/actions";
import { isDemoEmail } from "@/lib/auth/demo-accounts";
import { can } from "@/lib/auth/permissions";

const form = (email: string, password: string) => {
  const f = new FormData();
  f.set("email", email);
  f.set("password", password);
  return f;
};

/** Runs the action with fake timers so the failed-attempt delay doesn't slow the tests. */
async function attempt(email: string, password: string) {
  const pending = demoSignIn({}, form(email, password)).then(
    (state) => ({ state, redirect: null as string | null }),
    (err: Error) => ({ state: null, redirect: err.message.replace("REDIRECT:", "") }),
  );
  await vi.runAllTimersAsync();
  return pending;
}

beforeEach(() => {
  vi.useFakeTimers();
  config.demoPassword = PASSWORD;
  config.problems = [];
  startSession.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("demo accounts", () => {
  it("recognizes only @example.com emails as demo accounts", () => {
    expect(isDemoEmail("user1@example.com")).toBe(true);
    expect(isDemoEmail("  USER1@Example.com ")).toBe(true);
    expect(isDemoEmail("someone@example.org")).toBe(false);
    expect(isDemoEmail("someone@notexample.com.evil.org")).toBe(false);
    expect(isDemoEmail("someone@gmail.com")).toBe(false);
    expect(isDemoEmail(undefined)).toBe(false);
  });

  it("signs in to a demo account with the right password", async () => {
    const result = await attempt("user1@example.com", PASSWORD);
    expect(result.redirect).toBe("/my-tasks");
    expect(startSession).toHaveBeenCalledWith("recDemoAdmin");
  });

  it("refuses a wrong password", async () => {
    const result = await attempt("user1@example.com", "wrong-password-guess");
    expect(result.state?.error).toMatch(/password/);
    expect(startSession).not.toHaveBeenCalled();
  });

  it("never unlocks a real person's account, even with the right password", async () => {
    const result = await attempt("real.person@gmail.com", PASSWORD);
    expect(result.state?.error).toBeTruthy();
    expect(startSession).not.toHaveBeenCalled();
  });

  it("refuses inactive demo accounts", async () => {
    const result = await attempt("user2@example.com", PASSWORD);
    expect(result.state?.error).toMatch(/isn't set up/);
    expect(startSession).not.toHaveBeenCalled();
  });

  it("is off when DEMO_PASSWORD isn't set", async () => {
    config.demoPassword = null;
    const result = await attempt("user1@example.com", PASSWORD);
    expect(result.state?.error).toMatch(/turned off/);
    expect(startSession).not.toHaveBeenCalled();
  });

  it("denies Google features to demo accounts but keeps their role's other permissions", () => {
    const demoAdmin = users[0];
    const realAdmin = users[2];
    expect(can(demoAdmin, "calendar.sync")).toBe(false);
    expect(can(demoAdmin, "task.export")).toBe(false);
    expect(can(demoAdmin, "project.create")).toBe(true);
    expect(can(demoAdmin, "task.viewAll")).toBe(true);
    expect(can(realAdmin, "calendar.sync")).toBe(true);
    expect(can(realAdmin, "task.export")).toBe(true);
  });
});

describe("getDemoPassword", () => {
  it("ignores passwords shorter than 16 characters", async () => {
    const actual = await vi.importActual<typeof import("@/lib/config")>("@/lib/config");
    const before = process.env.DEMO_PASSWORD;
    try {
      process.env.DEMO_PASSWORD = "short";
      expect(actual.getDemoPassword()).toBeNull();
      process.env.DEMO_PASSWORD = PASSWORD;
      expect(actual.getDemoPassword()).toBe(PASSWORD);
      delete process.env.DEMO_PASSWORD;
      expect(actual.getDemoPassword()).toBeNull();
    } finally {
      if (before === undefined) delete process.env.DEMO_PASSWORD;
      else process.env.DEMO_PASSWORD = before;
    }
  });
});
