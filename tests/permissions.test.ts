import { describe, expect, it } from "vitest";
import { can, canUpdateTaskIn, canViewProject } from "@/lib/auth/permissions";
import type { User } from "@/lib/domain/types";

const user = (over: Partial<User>): User => ({
  id: "u1", name: "", email: "", accessLevel: "Staff", jobTitle: "", active: true, projectIds: [], assignedTaskIds: [], ...over,
});
const project = { teamUserIds: ["u2"], taskIds: ["t1", "t2"] };

describe("permissions", () => {
  it("admins can do everything", () => {
    const admin = user({ accessLevel: "Admin" });
    expect(can(admin, "project.create")).toBe(true);
    expect(canViewProject(admin, project)).toBe(true);
    expect(canUpdateTaskIn(admin, project)).toBe(true);
  });

  it("staff cannot create projects and only see their own projects", () => {
    expect(can(user({}), "project.create")).toBe(false);
    expect(canViewProject(user({}), project)).toBe(false);
    expect(canViewProject(user({ id: "u2" }), project)).toBe(true);
    expect(canViewProject(user({ assignedTaskIds: ["t2"] }), project)).toBe(true);
    expect(canUpdateTaskIn(user({ id: "u2" }), project)).toBe(true);
    expect(canUpdateTaskIn(user({}), project)).toBe(false);
  });

  it("partners have no access until scope is confirmed", () => {
    const partner = user({ id: "u2", accessLevel: "Partner", assignedTaskIds: ["t1"] });
    expect(canViewProject(partner, project)).toBe(false);
    expect(canUpdateTaskIn(partner, project)).toBe(false);
  });

  it("inactive users and anonymous visitors have no access", () => {
    const inactive = user({ accessLevel: "Admin", active: false });
    expect(can(inactive, "project.create")).toBe(false);
    expect(canViewProject(inactive, project)).toBe(false);
    expect(can(null, "task.update")).toBe(false);
    expect(canViewProject(null, project)).toBe(false);
  });
});
