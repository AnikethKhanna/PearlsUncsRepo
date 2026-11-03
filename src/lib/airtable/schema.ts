/**
 * Airtable table and field names used by the app.
 *
 * THIS IS THE ONE FILE TO EDIT when NMU's Airtable base uses different names.
 * The app never hard-codes Airtable names anywhere else.
 *
 * Run `npm run airtable:inspect` (see README) to compare this mapping
 * against the real base. It lists every table/field below that is missing.
 *
 * Values on the right are Airtable names (or table IDs like "tblXXXX").
 * Using IDs makes the app survive renames in Airtable, but names are easier
 * for NMU staff to read, so names are the default.
 *
 * Keep this file free of imports: scripts/inspect-airtable.mjs loads it directly.
 */
export const AIRTABLE_SCHEMA = {
  users: {
    table: "Users",
    fields: {
      name: "Name",
      email: "Email",
      /** Single select: Admin | Staff | Partner */
      accessLevel: "Access Level",
      /** Checkbox. Unchecked users cannot sign in. */
      active: "Active",
      /** Inverse of tasks.assignees (Airtable creates it automatically; check its name) */
      assignedTasks: "Assigned Tasks",
      /** Inverse of projects.team (Airtable creates it automatically; check its name) */
      projects: "Projects",
    },
  },
  sites: {
    table: "Sites",
    fields: {
      name: "Name",
      location: "Location",
      partnerOrganization: "Partner Organization",
      /** Single select, e.g. "University", "YMCA" */
      siteType: "Site Type",
      contacts: "Contacts",
      notes: "Notes",
    },
  },
  templates: {
    table: "Program Templates",
    fields: {
      name: "Name",
      programType: "Program Type",
      description: "Description",
      /** Checkbox. Only active templates appear in "New project". */
      active: "Active",
      /** Link to Template Steps (inverse of steps.template) */
      steps: "Steps",
    },
  },
  steps: {
    table: "Template Steps",
    fields: {
      title: "Title",
      description: "Description",
      /** Link to Program Templates */
      template: "Template",
      /** Number: sort order within the template */
      order: "Order",
      /** Single select, e.g. "Pre-launch", "During program", "Post-program" */
      phase: "Phase",
      /** Number, e.g. 4 */
      offsetAmount: "Offset Amount",
      /** Single select: Days | Weeks | Months */
      offsetUnit: "Offset Unit",
      /** Single select: Before | After */
      timing: "Timing",
      /** Single select: Program Start | Program End */
      anchor: "Anchor",
      /** Single line text / single select, e.g. "Program Manager" */
      defaultOwnerRole: "Default Owner Role",
      /** Link to other Template Steps (prerequisites) */
      dependsOn: "Depends On",
    },
  },
  projects: {
    table: "Projects",
    fields: {
      name: "Name",
      /** Link to Sites */
      site: "Site",
      /** Link to Program Templates */
      template: "Template",
      startDate: "Program Start Date",
      endDate: "Program End Date",
      /** Single select: Setting Up | Planning | Active | Completed | Cancelled */
      status: "Status",
      /** Link to Users: everyone who can see this project */
      team: "Team",
      /** Link to Tasks (inverse of tasks.project) */
      tasks: "Tasks",
      notes: "Notes",
      /** Link to Users */
      createdBy: "Created By",
    },
  },
  tasks: {
    table: "Tasks",
    fields: {
      title: "Title",
      description: "Description",
      /** Link to Projects */
      project: "Project",
      /** Link to Template Steps: which step this task was generated from */
      templateStep: "Template Step",
      /** Link to Users (multiple allowed = shared ownership) */
      assignees: "Assignees",
      ownerRole: "Owner Role",
      phase: "Phase",
      order: "Order",
      dueDate: "Due Date",
      /** Single select: Not Started | In Progress | Done | Not Needed */
      status: "Status",
      /** Link to other Tasks (prerequisites) */
      dependsOn: "Depends On",
      notes: "Notes",
      /** Long text: one Google Drive / Docs URL per line */
      documentLinks: "Document Links",
      completedAt: "Completed At",
    },
  },
} as const;

export type SchemaKey = keyof typeof AIRTABLE_SCHEMA;
