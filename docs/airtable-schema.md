# Airtable schema: review and proposal

## Status of the review

**We have not yet inspected NMU's actual Airtable base.** The development
environment used to build this increment has no Airtable credentials and
cannot reach `api.airtable.com`. The schema below is a **proposal** that the
app is coded against through one mapping file,
[`src/lib/airtable/schema.ts`](../src/lib/airtable/schema.ts).

To review the real base (read-only, no data is copied), run this:

```bash
cp .env.example .env.local      # then fill in AIRTABLE_TOKEN and AIRTABLE_BASE_ID
npm run airtable:inspect
```

The command writes `docs/airtable-schema.generated.md`, which lists every
table, field, type, link target and select option. It also flags each table
or field the app expects but can't find. Commit that file so the team can
review the real structure. Then do one of two things:

- If the base already has equivalent tables or fields under other names,
  **edit `schema.ts`** to point at them. No other code changes are needed.
- If something is missing, **add it in Airtable**. Additions only, nothing
  destructive. Get approval from NMU first.

## Proposed tables

Link fields marked *(inverse)* are created automatically by Airtable when the
other side's link field is added. Check their auto-generated names and update
`schema.ts` to match.

### Users
| Field | Type | Notes |
| --- | --- | --- |
| Name (primary) | Single line text | |
| Email | Email | Must match the person's Google account |
| Access Level | Single select: `Admin`, `Staff`, `Partner` | Permission level, independent of job title |
| Active | Checkbox | Unchecked = cannot sign in |
| Assigned Tasks | Link → Tasks *(inverse of Tasks.Assignees)* | |
| Projects | Link → Projects *(inverse of Projects.Team)* | |

App users are rows in this table. They do **not** need Airtable seats.

### Sites
| Field | Type |
| --- | --- |
| Name (primary) | Single line text |
| Location | Single line text |
| Partner Organization | Single line text |
| Site Type | Single select (e.g. University, YMCA) |
| Contacts | Long text |
| Notes | Long text |

### Program Templates
| Field | Type | Notes |
| --- | --- | --- |
| Name (primary) | Single line text | e.g. "Collegiate Swim Safely Series" |
| Program Type | Single select | |
| Description | Long text | |
| Active | Checkbox | Only active templates are offered for new projects |
| Steps | Link → Template Steps *(inverse)* | |

Each **program/site profile** (for example, Collegiate vs. YMCA-operated) is
its own template with its own steps. That's how "not every task applies to
every program" is modeled. A third profile is just another template.

### Template Steps
| Field | Type | Example |
| --- | --- | --- |
| Title (primary) | Single line text | "Ship program supplies" |
| Description | Long text | |
| Template | Link → Program Templates | |
| Order | Number | 7 |
| Phase | Single select | Pre-launch / During program / Post-program |
| Offset Amount | Number | 3 |
| Offset Unit | Single select: `Days`, `Weeks`, `Months` | Weeks |
| Timing | Single select: `Before`, `After` | Before |
| Anchor | Single select: `Program Start`, `Program End` | Program Start |
| Default Owner Role | Single line text / single select | "Operations" |
| Depends On | Link → Template Steps | "Confirm shipping address", "Confirm participant quantities" |

### Projects
| Field | Type | Notes |
| --- | --- | --- |
| Name (primary) | Single line text | |
| Site | Link → Sites | |
| Template | Link → Program Templates | |
| Program Start Date | Date | |
| Program End Date | Date | Optional |
| Status | Single select: `Setting Up`, `Planning`, `Active`, `Completed`, `Cancelled` | `Setting Up` = generation did not finish |
| Team | Link → Users | Who can see the project |
| Tasks | Link → Tasks *(inverse)* | |
| Notes | Long text | |
| Created By | Link → Users | |

### Tasks
| Field | Type | Notes |
| --- | --- | --- |
| Title (primary) | Single line text | Copied from the step at creation |
| Description | Long text | Copied |
| Project | Link → Projects | |
| Template Step | Link → Template Steps | Traceability back to the template |
| Assignees | Link → Users | Several people = shared ownership |
| Owner Role | Single line text | Copied |
| Phase | Single select | Copied |
| Order | Number | |
| Due Date | Date | Calculated at creation, editable afterward |
| Status | Single select: `Not Started`, `In Progress`, `Done`, `Not Needed` | |
| Depends On | Link → Tasks | |
| Notes | Long text | |
| Document Links | Long text | One Google Drive URL per line |
| Completed At | Date | Set automatically when the status becomes Done |

"Blocked" and "Overdue" are **computed** by the app and never stored, so they
can't drift out of date.

## Design decisions

- **History is preserved by copying.** A task copies the step's title,
  description, role and calculated date when it's created. Editing or
  deactivating a template never changes existing projects, so past projects
  remain an accurate record.
- **No formula filters on linked records.** Linked-record formulas return
  display names, not IDs, so the app reads link arrays such as
  `Users.Assigned Tasks` and fetches those records by ID.
- **Activity history** (Phase 4) will be a separate `Activity` table:
  who, what, when, old value, new value, linked to the task and project.
