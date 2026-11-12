# Configurable workflow options

## Inspection and scope

The original app hardcoded task phases in `program-edit.ts` and again in the task form. Task/project statuses, date units, before/after timing, start/end anchors, dashboard urgency sections, filters and permissions are also fixed in code. Sites, templates, program types and template step offsets already come from Airtable; owner roles are free text or template data. Calendar reminder settings were already configurable per user.

This change makes **phase choices/order** and **reusable deadline presets** configurable by administrators. It preserves system statuses, access roles, supported date units/anchors, and the dashboard's urgency rules, because scheduling, completion and permission logic depend on those values. It does not rewrite source templates or existing tasks.

## Using Workflow Settings

An active Admin can open **Workflow Settings** from the navigation.

- Add a named phase, move phases up/down, and archive/reactivate custom phases.
- Required phases (Pre-launch, During program, Post-program) stay available. Names cannot be renamed or deleted after saving: archive an old phase and add a new one instead.
- Archived phases stop appearing for new assignments. A task already using an archived or legacy phase can retain it when edited. Existing tasks, imports and templates are not rewritten.
- Program detail groups use configured phase order. Unknown legacy groups remain visible after configured phases.
- Add/edit/remove deadline presets with a name, amount, Days/Weeks/Months, Before/After, and Program Start/End anchor.
- In Add/Edit Task, select a preset and click **Apply date**. It calculates a date using that program's dates; users can still adjust it manually before saving. Missing required program dates disable the corresponding preset.
- Editing/removing a preset never changes dates already saved in tasks or template steps. Templates continue to supply their own relative scheduling rules when creating projects.

Server validation enforces unique names, protected system phases, supported date rules, bounded values (0–365 units), at most 40 phases and 20 presets. Stale configuration revisions are rejected before saving. Airtable does not provide transactional compare-and-swap here; administrators should coordinate simultaneous edits.

## Additive Airtable setup

The application never creates or changes tables/field schemas. A base owner sets up the optional table once:

| Table | Field | Type |
| --- | --- | --- |
| Workflow Settings | Name (primary) | Single line text |
| Workflow Settings | Value | Long text, plain text (disable rich text) |

Leave the table empty initially. The first admin save creates one row with Name `workflow` and a versioned JSON Value; later saves update that row. Keep one `workflow` row only. Existing task/template tables and data are untouched. The existing server token needs read/write access to this table in the same base.

The field mapping is in `src/lib/airtable/schema.ts`. Run `npm run airtable:inspect` to check names. This optional table produces a warning, not a required-schema failure, when absent.

Custom phase names must be accepted by Tasks → Phase and, when saving a template, Template Steps → Phase. The existing Airtable client already sends `typecast: true`; if the token's Airtable permissions cannot add select choices, the base owner should add the matching choices through Airtable. Do not delete existing choices or convert fields destructively. Use a test base to confirm this before production rollout.

With no settings table or inaccessible storage, task screens retain the original defaults. The admin screen explains setup and disables saving rather than claiming to persist changes. Invalid/duplicate stored settings also fall back safely and are not overwritten. Unrelated network/service errors are surfaced, not treated as empty configuration.

Memory-mode demo settings use the same DataStore interface and reset when the server restarts. Production settings persist through Airtable.

When pulling this feature with `npm run dev` already running, an old cached data store may lack `getWorkflowConfig`. The store factory now replaces incompatible cached instances automatically. This resets temporary memory-mode demo data once; Airtable records are untouched. Restarting the dev server also clears an old cached instance.

## Compatibility and acceptance

- Authentication is unchanged: this branch had direct Google OAuth and development email-only sign-in, **not an email/password authentication backend**. No Firebase, mandatory MFA or password changes were introduced.
- Existing Admin/Staff/Partner task permissions remain. New `workflow.manage` permission is Admin-only, checked in the page and save service. Saving reloads the current user's membership and role.
- Project creation retains site/partner, linked city/location, template, start/end dates and assignments. The selected site's location is now explicitly shown under the field. Site data still comes from Airtable.
- Branding and accessibility changes are documented in `branding.md`.

Checks: admin saves survive reload; Staff/Partner cannot open/save settings; adding and archiving a phase doesn't change old tasks; preset month-end handling and missing end-date behavior; active custom phase appears in Add Task; archived current phase can still be retained. Automated tests cover both MemoryStore and AirtableStore with a fake REST API, plus non-destructive updates and invalid configuration.
