/**
 * ILLUSTRATIVE SAMPLE DATA — NOT NMU's REAL PROCESS.
 *
 * Used only by the development placeholder (DATA_BACKEND=memory) and tests.
 * The step names and timings below are plausible examples so the app can be
 * demonstrated end to end; NMU's actual onboarding steps should be entered
 * in Airtable (Program Templates / Template Steps) by the team.
 */
import type { ProgramTemplate, Site, TemplateStep, User } from "@/lib/domain/types";

export const SAMPLE_USERS: User[] = [
  { id: "usrAdmin", name: "Avery Admin", email: "admin@example.org", accessLevel: "Admin", active: true, projectIds: [], assignedTaskIds: [] },
  { id: "usrStaff1", name: "Sam Staff", email: "staff@example.org", accessLevel: "Staff", active: true, projectIds: [], assignedTaskIds: [] },
  { id: "usrStaff2", name: "Jordan Coordinator", email: "jordan@example.org", accessLevel: "Staff", active: true, projectIds: [], assignedTaskIds: [] },
  { id: "usrPartner", name: "Pat Partner", email: "partner@example.org", accessLevel: "Partner", active: true, projectIds: [], assignedTaskIds: [] },
  { id: "usrInactive", name: "Former Staff", email: "former@example.org", accessLevel: "Staff", active: false, projectIds: [], assignedTaskIds: [] },
];

export const SAMPLE_SITES: Site[] = [
  { id: "siteUW", name: "Sample University Pool", location: "Seattle, WA", partnerOrganization: "Sample University Swim Club", siteType: "University" },
  { id: "siteY", name: "Sample YMCA Branch", location: "Tacoma, WA", partnerOrganization: "Sample YMCA", siteType: "YMCA" },
];

type StepSeed = Omit<TemplateStep, "id" | "templateId" | "dependsOnStepIds"> & { key: string; dependsOn?: string[] };

function buildTemplate(id: string, name: string, programType: string, description: string, seeds: StepSeed[]): ProgramTemplate {
  const steps: TemplateStep[] = seeds.map(({ key, dependsOn, ...rest }) => ({
    ...rest,
    id: `${id}_${key}`,
    templateId: id,
    dependsOnStepIds: (dependsOn ?? []).map((k) => `${id}_${k}`),
  }));
  return { id, name, programType, description, active: true, steps };
}

const pre = "Pre-launch";
const during = "During program";
const post = "Post-program";

export const SAMPLE_TEMPLATES: ProgramTemplate[] = [
  buildTemplate(
    "tplCollegiate",
    "Collegiate Swim Safely Series",
    "Collegiate Swim Safely Series",
    "Sample profile: NMU runs registration and family communications; the collegiate partner provides volunteers and pool time.",
    [
      { key: "agreement", title: "Confirm partnership agreement with campus partner", description: "", order: 1, phase: pre, offsetAmount: 4, offsetUnit: "Months", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Program Manager" },
      { key: "pool", title: "Reserve pool time", description: "", order: 2, phase: pre, offsetAmount: 3, offsetUnit: "Months", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Site Partner", dependsOn: ["agreement"] },
      { key: "volunteers", title: "Recruit and confirm student volunteers", description: "", order: 3, phase: pre, offsetAmount: 8, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Site Partner", dependsOn: ["agreement"] },
      { key: "registration", title: "Open family registration (NMU-managed)", description: "", order: 4, phase: pre, offsetAmount: 6, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Program Manager", dependsOn: ["pool"] },
      { key: "address", title: "Confirm shipping address", description: "", order: 5, phase: pre, offsetAmount: 5, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Site Partner" },
      { key: "counts", title: "Confirm participant quantities", description: "", order: 6, phase: pre, offsetAmount: 4, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Program Manager", dependsOn: ["registration"] },
      { key: "ship", title: "Ship program supplies", description: "Requires confirmed shipping address and participant quantities.", order: 7, phase: pre, offsetAmount: 3, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Operations", dependsOn: ["address", "counts"] },
      { key: "families", title: "Send welcome email to families", description: "", order: 8, phase: pre, offsetAmount: 1, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Program Manager", dependsOn: ["registration"] },
      { key: "checkin", title: "Mid-program check-in with site lead", description: "", order: 9, phase: during, offsetAmount: 1, offsetUnit: "Weeks", timing: "After", anchor: "Program Start", defaultOwnerRole: "Program Manager" },
      { key: "survey", title: "Send post-program survey", description: "", order: 10, phase: post, offsetAmount: 3, offsetUnit: "Days", timing: "After", anchor: "Program End", defaultOwnerRole: "Program Manager" },
      { key: "report", title: "Compile completion report", description: "", order: 11, phase: post, offsetAmount: 2, offsetUnit: "Weeks", timing: "After", anchor: "Program End", defaultOwnerRole: "Program Manager", dependsOn: ["survey"] },
    ],
  ),
  buildTemplate(
    "tplYmca",
    "Learn to Swim — YMCA-operated",
    "Learn to Swim",
    "Sample profile: the YMCA runs registration and family communications; NMU supplies curriculum, materials and funding.",
    [
      { key: "mou", title: "Sign MOU with YMCA branch", description: "", order: 1, phase: pre, offsetAmount: 3, offsetUnit: "Months", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Program Manager" },
      { key: "instructors", title: "Confirm certified instructors", description: "", order: 2, phase: pre, offsetAmount: 6, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Site Partner", dependsOn: ["mou"] },
      { key: "registration", title: "Confirm YMCA has opened registration", description: "Registration is run by the YMCA for this profile.", order: 3, phase: pre, offsetAmount: 5, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Site Partner", dependsOn: ["mou"] },
      { key: "address", title: "Confirm shipping address", description: "", order: 4, phase: pre, offsetAmount: 4, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Site Partner" },
      { key: "ship", title: "Ship curriculum materials", description: "", order: 5, phase: pre, offsetAmount: 3, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Operations", dependsOn: ["address"] },
      { key: "roster", title: "Receive final participant roster from YMCA", description: "", order: 6, phase: pre, offsetAmount: 3, offsetUnit: "Days", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Site Partner", dependsOn: ["registration"] },
      { key: "outcomes", title: "Collect swim-skill outcome data", description: "", order: 7, phase: post, offsetAmount: 1, offsetUnit: "Weeks", timing: "After", anchor: "Program End", defaultOwnerRole: "Site Partner" },
      { key: "invoice", title: "Process YMCA invoice", description: "", order: 8, phase: post, offsetAmount: 1, offsetUnit: "Months", timing: "After", anchor: "Program End", defaultOwnerRole: "Operations", dependsOn: ["outcomes"] },
    ],
  ),
];
