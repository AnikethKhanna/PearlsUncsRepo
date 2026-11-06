/**
 * SAMPLE DATA for the development placeholder (DATA_BACKEND=memory) and tests.
 *
 * - The Collegiate template and the people come from the sample task spreadsheet
 *   (data/sample-template-program-tasks.csv → `npm run sample:import`).
 * - The YMCA template is ILLUSTRATIVE ONLY (made up), included to show a
 *   second program profile and task dependencies.
 * Real data belongs in Airtable.
 */
import type { ProgramTemplate, Site, TemplateStep, User } from "@/lib/domain/types";
import { SAMPLE_TEMPLATE_TASKS } from "./sample-template-tasks";

type SampleUser = Pick<User, "id" | "name" | "email" | "accessLevel" | "jobTitle"> & { active?: boolean };
const people: SampleUser[] = [
  // Names and job titles come from the sample task spreadsheet (data/sample-template-program-tasks.csv).
  { id: "usrJordan", name: "Jordan Ellis", email: "jordan@example.org", accessLevel: "Admin", jobTitle: "Program Manager" },
  { id: "usrTaylor", name: "Taylor Brooks", email: "taylor@example.org", accessLevel: "Admin", jobTitle: "Executive Director" },
  { id: "usrSam", name: "Sam Okafor", email: "sam@example.org", accessLevel: "Staff", jobTitle: "Program Assistant" },
  { id: "usrMorgan", name: "Morgan Patel", email: "morgan@example.org", accessLevel: "Staff", jobTitle: "Operations Director" },
  { id: "usrRiley", name: "Riley Chen", email: "riley@example.org", accessLevel: "Staff", jobTitle: "Marketing Director" },
  { id: "usrCasey", name: "Casey Nguyen", email: "casey@example.org", accessLevel: "Staff", jobTitle: "Grant Writer" },
  { id: "usrAvery", name: "Avery Stone", email: "avery@example.org", accessLevel: "Staff", jobTitle: "Board Member" },
  { id: "usrPartner", name: "Pat Partner", email: "partner@example.org", accessLevel: "Partner", jobTitle: "Host site contact" },
  { id: "usrInactive", name: "Former Staff", email: "former@example.org", accessLevel: "Staff", jobTitle: "Program Assistant", active: false },
];
export const SAMPLE_USERS: User[] = people.map((p) => ({ active: true, projectIds: [], assignedTaskIds: [], ...p }));

export const SAMPLE_SITES: Site[] = [
  { id: "siteUW", name: "Sample University Pool", location: "Seattle, WA", partnerOrganization: "Sample University Swim Club", siteType: "University" },
  { id: "siteY", name: "Sample YMCA Branch", location: "Tacoma, WA", partnerOrganization: "Sample YMCA", siteType: "YMCA" },
];

type StepSeed = Omit<TemplateStep, "id" | "templateId" | "dependsOnStepIds" | "defaultOwnerRoles"> & {
  key: string;
  dependsOn?: string[];
  defaultOwnerRole: string;
};

function buildTemplate(id: string, name: string, programType: string, description: string, seeds: StepSeed[]): ProgramTemplate {
  const steps: TemplateStep[] = seeds.map(({ key, dependsOn, defaultOwnerRole, ...rest }) => ({
    ...rest,
    defaultOwnerRoles: defaultOwnerRole ? [defaultOwnerRole] : [],
    id: `${id}_${key}`,
    templateId: id,
    dependsOnStepIds: (dependsOn ?? []).map((k) => `${id}_${k}`),
  }));
  return { id, name, programType, description, active: true, steps };
}

const pre = "Pre-launch";
const post = "Post-program";

export const SAMPLE_TEMPLATES: ProgramTemplate[] = [
  {
    id: "tplCollegiate",
    name: "Collegiate Swim Safely Series",
    programType: "Collegiate Swim Safely Series",
    description: `From the sample task spreadsheet: ${SAMPLE_TEMPLATE_TASKS.length} tasks from 4 months before launch to 2 months after.`,
    active: true,
    steps: SAMPLE_TEMPLATE_TASKS.map((t) => ({
      id: `tplCollegiate_s${t.order}`,
      templateId: "tplCollegiate",
      title: t.title,
      description: "",
      order: t.order,
      phase: t.phase,
      offsetAmount: t.offsetAmount,
      offsetUnit: t.offsetUnit,
      timing: t.timing,
      anchor: t.anchor,
      defaultOwnerRoles: t.roles,
      dependsOnStepIds: [], // the spreadsheet has no dependency column
    })),
  },
  buildTemplate(
    "tplYmca",
    "Learn to Swim — YMCA-operated (illustrative)",
    "Learn to Swim",
    "Illustrative example, not from NMU data. Shows a different profile and task dependencies: the YMCA runs registration and family communications; NMU supplies curriculum, materials and funding.",
    [
      { key: "mou", title: "Sign MOU with YMCA branch", description: "", order: 1, phase: pre, offsetAmount: 3, offsetUnit: "Months", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Program Manager" },
      { key: "instructors", title: "Confirm certified instructors", description: "", order: 2, phase: pre, offsetAmount: 6, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Site Partner", dependsOn: ["mou"] },
      { key: "registration", title: "Confirm YMCA has opened registration", description: "Registration is run by the YMCA for this profile.", order: 3, phase: pre, offsetAmount: 5, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Site Partner", dependsOn: ["mou"] },
      { key: "address", title: "Confirm shipping address", description: "", order: 4, phase: pre, offsetAmount: 4, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Site Partner" },
      { key: "ship", title: "Ship curriculum materials", description: "", order: 5, phase: pre, offsetAmount: 3, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Operations Director", dependsOn: ["address"] },
      { key: "roster", title: "Receive final participant roster from YMCA", description: "", order: 6, phase: pre, offsetAmount: 3, offsetUnit: "Days", timing: "Before", anchor: "Program Start", defaultOwnerRole: "Site Partner", dependsOn: ["registration"] },
      { key: "outcomes", title: "Collect swim-skill outcome data", description: "", order: 7, phase: post, offsetAmount: 1, offsetUnit: "Weeks", timing: "After", anchor: "Program End", defaultOwnerRole: "Site Partner" },
      { key: "invoice", title: "Process YMCA invoice", description: "", order: 8, phase: post, offsetAmount: 1, offsetUnit: "Months", timing: "After", anchor: "Program End", defaultOwnerRole: "Operations Director", dependsOn: ["outcomes"] },
    ],
  ),
];
