import { describe, expect, it } from "vitest";
import { can, canUpdateTask, canViewProject, canViewTask } from "@/lib/auth/permissions";
import type { User } from "@/lib/domain/types";

const user = (over: Partial<User>): User => ({
  id: "u1", name: "", email: "", accessLevel: "Staff", jobTitle: "", active: true, projectIds: [], assignedTaskIds: [], ...over,
});
const project = { teamUserIds: ["u2"], taskIds: ["t1", "t2"] };
const myTask = { assigneeIds: ["u1"] };
const otherTask = { assigneeIds: ["u2"] };

describe("permissions", () => {
  it("admins see and update everything", () => {
    const admin = user({ id: "a", accessLevel: "Admin" });
    expect(can(admin, "project.create")).toBe(true);
    expect(canViewProject(admin, project)).toBe(true);
    expect(canViewTask(admin, project, otherTask)).toBe(true);
    expect(canUpdateTask(admin, project, otherTask)).toBe(true);
  });

  it("staff see and update only their own tasks", () => {
    const staff = user({ assignedTaskIds: ["t1"] });
    expect(can(staff, "project.create")).toBe(false);
    expect(canViewProject(staff, project)).toBe(true);
    expect(canViewTask(staff, project, myTask)).toBe(true);
    expect(canUpdateTask(staff, project, myTask)).toBe(true);
    expect(canViewTask(staff, project, otherTask)).toBe(false);
    expect(canUpdateTask(staff, project, otherTask)).toBe(false);
  });

  it("staff can't see projects where they have no tasks", () => {
    expect(canViewProject(user({}), project)).toBe(false);
    // being on the team alone is not enough
    expect(canViewProject(user({ id: "u2" }), project)).toBe(false);
    expect(canUpdateTask(user({}), project, myTask)).toBe(false);
  });

  it("partners have no access until scope is confirmed", () => {
    const partner = user({ accessLevel: "Partner", assignedTaskIds: ["t1"] });
    expect(canViewProject(partner, project)).toBe(false);
    expect(canViewTask(partner, project, myTask)).toBe(false);
    expect(canUpdateTask(partner, project, myTask)).toBe(false);
  });

  it("inactive users and anonymous visitors have no access", () => {
    const inactive = user({ accessLevel: "Admin", active: false });
    expect(can(inactive, "project.create")).toBe(false);
    expect(canViewProject(inactive, project)).toBe(false);
    expect(can(null, "task.updateOwn")).toBe(false);
    expect(canViewProject(null, project)).toBe(false);
  });
});
