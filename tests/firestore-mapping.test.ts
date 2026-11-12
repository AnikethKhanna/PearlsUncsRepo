import { describe, expect, it } from "vitest";
import {
  projectFromDoc,
  projectToDoc,
  stepFromDoc,
  stepToDoc,
  taskFromDoc,
  taskToDoc,
  userFromDoc,
  userToDoc,
} from "@/lib/data/firestore-mapping";
import { SAMPLE_TEMPLATES, SAMPLE_USERS } from "@/lib/data/sample-data";
import type { Project, Task } from "@/lib/domain/types";

const noLinks = { projectIds: [], assignedTaskIds: [] };

describe("Firestore mapping", () => {
  it("round-trips users without storing derived links", () => {
    const u = SAMPLE_USERS[0];
    const doc = userToDoc({ ...u, projectIds: ["p1"], assignedTaskIds: ["t1"] });
    expect(doc).not.toHaveProperty("projectIds");
    expect(userFromDoc(u.id, { ...doc }, noLinks)).toEqual({ ...u, ...noLinks });
  });

  it("treats an unknown or missing access level as least privilege, and missing 'active' as inactive", () => {
    const u = userFromDoc("x", { name: "X", email: "X@Example.org", accessLevel: "SuperAdmin" }, noLinks);
    expect(u).toMatchObject({ accessLevel: "Partner", active: false, email: "x@example.org" });
  });

  it("round-trips template steps", () => {
    const s = SAMPLE_TEMPLATES[1].steps.find((x) => x.dependsOnStepIds.length)!;
    expect(stepFromDoc(s.id, { ...stepToDoc(s) })).toEqual(s);
  });

  it("round-trips tasks and drops non-https document links", () => {
    const t: Task = {
      id: "t1", projectId: "p1", templateStepId: "s1", title: "Book pool", description: "", assigneeIds: ["usrSam"],
      ownerRole: "Operations", phase: "Pre-launch", order: 3, dueDate: "2027-03-01", status: "In Progress",
      dependsOnTaskIds: ["t0"], notes: "", documentLinks: ["https://drive.google.com/x"], completedAt: null,
    };
    expect(taskFromDoc("t1", { ...taskToDoc(t) })).toEqual(t);
    expect(taskFromDoc("t1", { ...taskToDoc(t), documentLinks: ["javascript:alert(1)"] }).documentLinks).toEqual([]);
  });

  it("denormalizes project assignees for the security rules and resolves names on read", () => {
    const p: Project = {
      id: "p1", name: "Fall", siteId: "s1", siteName: "", templateId: "tp", templateName: "", startDate: "2027-04-15",
      endDate: null, status: "Active", teamUserIds: ["a"], taskIds: ["t1", "t2"], notes: "",
    };
    const doc = projectToDoc(p, [{ assigneeIds: ["u1", "u2"] }, { assigneeIds: ["u2"] }]);
    expect(doc.assigneeUserIds).toEqual(["u1", "u2"]);
    const back = projectFromDoc("p1", { ...doc }, { sites: new Map([["s1", "Pool"]]), templates: new Map([["tp", "Collegiate"]]) });
    expect(back).toEqual({ ...p, siteName: "Pool", templateName: "Collegiate" });
  });
});
