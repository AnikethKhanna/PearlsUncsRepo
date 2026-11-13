#!/usr/bin/env node
/**
 * Add the app's tables and fields to an Airtable TEST base, next to whatever
 * tables are already there (option A in docs/airtable-schema.md).
 *
 *   npm run airtable:setup              # preview only: lists what it would do
 *   npm run airtable:setup -- --apply   # actually create tables/fields
 *   npm run airtable:setup -- --apply --seed
 *                                       # ...and add the sample Collegiate template
 *                                       #    (140 steps) plus one sample site
 *
 * ADDITIVE ONLY. It never deletes or renames existing tables, never changes
 * existing fields, and never touches existing records. The one exception is
 * renaming the back-link fields that Airtable auto-creates for the NEW link
 * fields made by this script, so they get the names the app expects.
 *
 * Safety: it refuses to run unless the base's NAME contains "test", so it
 * can't be pointed at NMU's real base by accident. Override with --force
 * only once NMU has agreed to these additions.
 *
 * Needs AIRTABLE_TOKEN with scopes schema.bases:read + schema.bases:write
 * (and data.records:write for --seed), and AIRTABLE_BASE_ID, in .env.local.
 * Table/field names come from src/lib/airtable/schema.ts, so they always
 * match what the app reads.
 */
import { readFileSync } from "node:fs";
import { AIRTABLE_SCHEMA as S } from "../src/lib/airtable/schema.ts";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const SEED = args.has("--seed");
const FORCE = args.has("--force");

const token = process.env.AIRTABLE_TOKEN;
const baseId = process.env.AIRTABLE_BASE_ID;
if (!token || !baseId) {
  console.error("Set AIRTABLE_TOKEN and AIRTABLE_BASE_ID in .env.local first.");
  process.exit(1);
}

// ---------------------------------------------------------------- field specs

const text = (name) => ({ name, type: "singleLineText" });
const longText = (name) => ({ name, type: "multilineText" });
const num = (name) => ({ name, type: "number", options: { precision: 0 } });
const checkbox = (name) => ({ name, type: "checkbox", options: { icon: "check", color: "greenBright" } });
const day = (name) => ({ name, type: "date", options: { dateFormat: { name: "iso" } } });
const select = (name, choices) => ({ name, type: "singleSelect", options: { choices: choices.map((c) => ({ name: c })) } });
const multiSelect = (name, choices) => ({ name, type: "multipleSelects", options: { choices: choices.map((c) => ({ name: c })) } });
/** Link field. `inverse` = the name the auto-created back-link in the other table must have. */
const link = (name, toTableKey, inverse) => ({ name, type: "multipleRecordLinks", toTableKey, inverse });

const PHASES = ["Pre-launch", "During program", "Post-program"];
const f = (key) => S[key].fields;

/**
 * Tables in creation order. The first field is the primary field.
 * `existing: true` = the table is already in the base; only missing fields are added.
 */
const PLAN = [
  {
    key: "users",
    existing: true,
    fields: [
      text(f("users").name),
      select(f("users").accessLevel, ["Admin", "Staff", "Partner"]),
      text(f("users").jobTitle),
      checkbox(f("users").active),
    ],
  },
  {
    key: "sites",
    fields: [
      text(f("sites").name),
      text(f("sites").location),
      text(f("sites").partnerOrganization),
      select(f("sites").siteType, ["University", "YMCA", "Other"]),
      longText(f("sites").contacts),
      longText(f("sites").notes),
    ],
  },
  {
    key: "templates",
    fields: [
      text(f("templates").name),
      select(f("templates").programType, ["Collegiate", "YMCA", "Other"]),
      longText(f("templates").description),
      checkbox(f("templates").active),
    ],
  },
  {
    key: "steps",
    fields: [
      text(f("steps").title),
      longText(f("steps").description),
      link(f("steps").template, "templates", f("templates").steps),
      num(f("steps").order),
      select(f("steps").phase, PHASES),
      num(f("steps").offsetAmount),
      select(f("steps").offsetUnit, ["Days", "Weeks", "Months"]),
      select(f("steps").timing, ["Before", "After"]),
      select(f("steps").anchor, ["Program Start", "Program End"]),
      multiSelect(f("steps").defaultOwnerRoles, ["Program Manager", "Executive Director"]),
      link(f("steps").dependsOn, "steps", "Required By"),
      link(f("steps").defaultAssignees, "users", "Default For Steps"),
    ],
  },
  {
    key: "projects",
    fields: [
      text(f("projects").name),
      link(f("projects").site, "sites", "Projects"),
      link(f("projects").template, "templates", "Projects"),
      day(f("projects").startDate),
      day(f("projects").endDate),
      select(f("projects").status, ["Setting Up", "Planning", "Active", "Completed", "Cancelled"]),
      link(f("projects").team, "users", f("users").projects),
      longText(f("projects").notes),
      link(f("projects").createdBy, "users", "Projects Created"),
    ],
  },
  {
    key: "tasks",
    fields: [
      text(f("tasks").title),
      longText(f("tasks").description),
      link(f("tasks").project, "projects", f("projects").tasks),
      link(f("tasks").templateStep, "steps", "Generated Tasks"),
      link(f("tasks").assignees, "users", f("users").assignedTasks),
      text(f("tasks").ownerRole),
      select(f("tasks").phase, PHASES),
      num(f("tasks").order),
      day(f("tasks").dueDate),
      select(f("tasks").status, ["Not Started", "In Progress", "Done", "Not Needed"]),
      link(f("tasks").dependsOn, "tasks", "Required By"),
      longText(f("tasks").notes),
      longText(f("tasks").documentLinks),
      day(f("tasks").completedAt),
    ],
  },
  {
    key: "workflowSettings",
    fields: [text(f("workflowSettings").name), longText(f("workflowSettings").value)],
  },
  {
    key: "calendarConnections",
    fields: [
      text(f("calendarConnections").userId),
      link(f("calendarConnections").user, "users", "Calendar Connection"),
      text(f("calendarConnections").googleEmail),
      longText(f("calendarConnections").refreshToken),
      text(f("calendarConnections").calendarId),
      text(f("calendarConnections").calendarName),
      text(f("calendarConnections").calendarTimeZone),
      checkbox(f("calendarConnections").syncEnabled),
      text(f("calendarConnections").reminderDays),
      text(f("calendarConnections").reminderTime),
      select(f("calendarConnections").overdueReminders, ["off", "daily", "weekly"]),
      select(f("calendarConnections").status, ["connected", "needs_reconnect", "error"]),
      text(f("calendarConnections").lastSyncedAt),
      longText(f("calendarConnections").lastError),
    ],
  },
];

// ---------------------------------------------------------------- API helpers

const META = `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}`;
const DATA = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body) {
  for (let attempt = 0; ; attempt++) {
    await sleep(250); // stay under Airtable's 5 requests/second
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const detail = await res.text().catch(() => "");
    const hint =
      res.status === 401 || res.status === 403
        ? " Check the token has schema.bases:read + schema.bases:write (and data.records:write for --seed) and access to this base."
        : "";
    throw new Error(`Airtable ${method} failed (${res.status}): ${detail.slice(0, 300)}${hint}`);
  }
}

const loadTables = async () => (await api("GET", `${META}/tables`)).tables;

// ---------------------------------------------------------------- safety check

const { bases } = await api("GET", "https://api.airtable.com/v0/meta/bases");
const base = bases.find((b) => b.id === baseId);
if (!base) {
  console.error(`The token can't see base ${baseId}. Add it to the token's Access list.`);
  process.exit(1);
}
if (!/test/i.test(base.name) && !FORCE) {
  console.error(
    `Refusing to change "${base.name}": its name doesn't contain "test".\n` +
      `This script is meant for a TEST copy. Rename the copy, or pass --force once NMU has approved.`,
  );
  process.exit(1);
}
console.log(`Base: "${base.name}" (${APPLY ? "APPLYING CHANGES" : "preview only, nothing will change; add --apply to run"})\n`);

// ---------------------------------------------------------------- plan + apply

let tables = await loadTables();
const byName = (name) => tables.find((t) => t.name === name);
const tableFor = (key) => byName(S[key].table);
let changes = 0;
const pendingLinks = []; // link fields are added after every table exists

// Pass 1: tables and plain fields.
for (const spec of PLAN) {
  const tableName = S[spec.key].table;
  const plain = spec.fields.filter((x) => x.type !== "multipleRecordLinks");
  const links = spec.fields.filter((x) => x.type === "multipleRecordLinks");
  let table = byName(tableName);

  if (!table) {
    if (spec.existing) {
      console.error(`Expected table "${tableName}" to exist already, but it doesn't. Stopping.`);
      process.exit(1);
    }
    console.log(`+ table  ${tableName}  (${plain.map((x) => x.name).join(", ")})`);
    changes++;
    if (APPLY) {
      table = await api("POST", `${META}/tables`, { name: tableName, fields: plain });
      tables = await loadTables();
    }
  } else {
    for (const field of plain) {
      const found = table.fields.find((x) => x.name === field.name);
      if (found) {
        if (found.type !== field.type)
          console.warn(`! ${tableName} → "${field.name}" exists as ${found.type}, app expects ${field.type}. Left unchanged; check it.`);
        continue;
      }
      console.log(`+ field  ${tableName} → ${field.name} (${field.type})`);
      changes++;
      if (APPLY) await api("POST", `${META}/tables/${table.id}/fields`, field);
    }
  }
  for (const l of links) pendingLinks.push({ tableKey: spec.key, ...l });
}
if (APPLY) tables = await loadTables();

// Pass 2: link fields, then give each auto-created back-link the expected name.
for (const l of pendingLinks) {
  const fromName = S[l.tableKey].table;
  const toName = S[l.toTableKey].table;
  const from = tableFor(l.tableKey);
  const existingField = from?.fields.find((x) => x.name === l.name);
  if (existingField) {
    if (existingField.type !== "multipleRecordLinks")
      console.warn(`! ${fromName} → "${l.name}" exists as ${existingField.type}, app expects a link. Left unchanged; check it.`);
    continue;
  }
  console.log(`+ link   ${fromName} → ${l.name}  ⇄  ${toName} → ${l.inverse}`);
  changes++;
  if (!APPLY) continue;

  const to = tableFor(l.toTableKey);
  const created = await api("POST", `${META}/tables/${from.id}/fields`, {
    name: l.name,
    type: "multipleRecordLinks",
    options: { linkedTableId: to.id },
  });
  tables = await loadTables();
  const inverseId = created.options?.inverseLinkFieldId;
  const inverse = inverseId && tableFor(l.toTableKey).fields.find((x) => x.id === inverseId);
  if (inverse && inverse.name !== l.inverse) {
    if (tableFor(l.toTableKey).fields.some((x) => x.name === l.inverse)) {
      console.warn(`! Couldn't rename back-link "${inverse.name}" in ${toName} to "${l.inverse}": that name is taken. Rename it by hand.`);
    } else {
      await api("PATCH", `${META}/tables/${to.id}/fields/${inverse.id}`, { name: l.inverse });
      tables = await loadTables();
    }
  }
}

if (changes === 0) console.log("Nothing to add: every table and field the app needs is already there.");

// ---------------------------------------------------------------- optional seed

if (SEED) {
  const csvPath = new URL("../data/airtable-import/template-steps.csv", import.meta.url);
  const [header, ...rows] = parseCsv(readFileSync(csvPath, "utf8"));
  const col = (row, name) => row[header.indexOf(name)] ?? "";
  const templateName = "Collegiate Swim Safely Series";
  console.log(`\n+ seed   ${S.sites.table}: "Sample Site (test)"`);
  console.log(`+ seed   ${S.templates.table}: "${templateName}" with ${rows.length} steps`);

  if (APPLY) {
    const existing = await api(
      "GET",
      `${DATA}/${encodeURIComponent(S.templates.table)}?filterByFormula=${encodeURIComponent(`{${f("templates").name}}="${templateName}"`)}`,
    );
    if (existing.records.length > 0) {
      console.log(`  "${templateName}" already exists, so the seed was skipped.`);
    } else {
      await api("POST", `${DATA}/${encodeURIComponent(S.sites.table)}`, {
        typecast: true,
        records: [{ fields: { [f("sites").name]: "Sample Site (test)", [f("sites").siteType]: "University" } }],
      });
      const { records } = await api("POST", `${DATA}/${encodeURIComponent(S.templates.table)}`, {
        typecast: true,
        records: [{ fields: { [f("templates").name]: templateName, [f("templates").programType]: "Collegiate", [f("templates").active]: true } }],
      });
      const templateId = records[0].id;
      const stepFields = rows.map((row) => ({
        [f("steps").title]: col(row, "Title"),
        [f("steps").template]: [templateId],
        [f("steps").order]: Number(col(row, "Order")),
        [f("steps").phase]: col(row, "Phase"),
        [f("steps").offsetAmount]: Number(col(row, "Offset Amount")),
        [f("steps").offsetUnit]: col(row, "Offset Unit"),
        [f("steps").timing]: col(row, "Timing"),
        [f("steps").anchor]: col(row, "Anchor"),
        [f("steps").defaultOwnerRoles]: col(row, "Default Owner Role").split(",").map((x) => x.trim()).filter(Boolean),
      }));
      for (let i = 0; i < stepFields.length; i += 10) {
        await api("POST", `${DATA}/${encodeURIComponent(S.steps.table)}`, {
          typecast: true,
          records: stepFields.slice(i, i + 10).map((fields) => ({ fields })),
        });
      }
      console.log(`  Added the sample site, the template and ${stepFields.length} steps.`);
    }
  }
}

if (!APPLY) console.log("\nPreview only. Run again with --apply to make these changes.");
else console.log("\nDone. Next: run `npm run airtable:inspect` to confirm the app finds everything.");

/** Minimal CSV parser (handles quoted fields with commas and doubled quotes). */
function parseCsv(textIn) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < textIn.length; i++) {
    const c = textIn[i];
    if (quoted) {
      if (c === '"' && textIn[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && textIn[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some((x) => x !== "")) rows.push(row); }
  return rows;
}
