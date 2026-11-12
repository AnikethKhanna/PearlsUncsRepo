# Airtable → Cloud Firestore migration plan

**Status: prepared, not executed.** Airtable is the source of truth. The Firestore store, the security rules and the migration tooling are built and tested against the emulators. Nothing changes for users until someone deliberately sets `DATA_BACKEND=firestore`.

## Principles

1. **One source of truth at a time.** The app talks to exactly one data store (`DATA_BACKEND`). There are no dual writes and no sync jobs, so the two databases can't disagree.
2. **Airtable is only ever read** by the migration. Rolling back never needs to repair Airtable.
3. **IDs are preserved.** Each Airtable record ID (`rec…`) becomes the Firestore document ID. All links stay valid, and existing session cookies (which hold the user's record ID) keep working after cutover.
4. **Nothing silent.**
   - The dry run lists every problem.
   - `--apply` refuses to run if there are blocking errors or the target already has data.
   - `--verify` must pass before cutover.

## Where data lives today

| Data | Today | After cutover |
| --- | --- | --- |
| Users and access levels | Airtable `Users` | Firestore `users` |
| Sites | Airtable `Sites` | `sites` |
| Program templates | Airtable `Program Templates` | `templates` |
| Template steps | Airtable `Template Steps` | `templateSteps` |
| Projects (programs) | Airtable `Projects` | `projects` |
| Tasks and assignments | Airtable `Tasks` (Assignees link) | `tasks` (`assigneeIds`) |
| Sign-in identities | Firebase Auth (Google, email/password) | unchanged |

The development placeholder (`DATA_BACKEND=memory`) is sample data only and isn't migrated.

## Data mapping

Field names on the Airtable side come from `src/lib/airtable/schema.ts`. The Firestore side is defined in `src/lib/data/firestore-mapping.ts`. Dates are `YYYY-MM-DD` strings, in both stores.

| Firestore collection / field | From Airtable | Notes |
| --- | --- | --- |
| `users/{recId}`: `name`, `email`, `accessLevel`, `jobTitle`, `active` | Users | Email trimmed and lower-cased. An unknown access level becomes `Partner` (least privilege). |
| *(not stored)* `projectIds`, `assignedTaskIds` | Users inverse links | Derived by query, so they can't drift |
| `sites/{recId}`: `name`, `location`, `partnerOrganization`, `siteType` | Sites | |
| `templates/{recId}`: `name`, `programType`, `description`, `active` | Program Templates | |
| `templateSteps/{recId}`: `templateId`, `title`, `description`, `order`, `phase`, `offsetAmount`, `offsetUnit`, `timing`, `anchor`, `defaultOwnerRoles[]`, `dependsOnStepIds[]` | Template Steps | Links become ID strings or arrays |
| `projects/{recId}`: `name`, `siteId`, `templateId`, `startDate`, `endDate`, `status`, `teamUserIds[]`, `taskIds[]`, `notes` | Projects | Site and template names are looked up when read, not copied |
| `projects/…`: `assigneeUserIds[]` | *(computed)* | Union of the project's task assignees. Used by `firestore.rules`. |
| `tasks/{recId}`: `projectId`, `templateStepId`, `title`, `description`, `assigneeIds[]`, `ownerRole`, `phase`, `order`, `dueDate`, `status`, `dependsOnTaskIds[]`, `notes`, `documentLinks[]`, `completedAt` | Tasks | Only `https://` links are kept |
| every document: `_migration: { runId, migratedAt }`, `updatedAt` | *(added)* | Used to verify and roll back one specific run |

## Procedure

Prerequisites:
- Firebase Console setup, including creating Firestore and deploying the rules ([firebase.md](firebase.md)).
- Airtable and Firebase service-account credentials in `.env.local` on a trusted machine.

### 0. Rehearse on the emulators (no credentials needed)

```bash
npm run emulators                                         # terminal 1
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run migrate:firestore -- --from-sample --apply    # terminal 2
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run migrate:firestore -- --from-sample --verify
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run migrate:firestore -- --rollback <runId>
```

### 1. Dry run against the real Airtable base

```bash
npm run migrate:firestore            # dry run is the default
```

This reads Airtable, prints the document counts per collection, and lists **errors** and **warnings**. It saves the full plan to `migration-output/<runId>/plan.json`. That folder is git-ignored because it contains names and emails; delete it when you're done.

- **Errors block `--apply`.** Examples: an active user with no email, or two active users sharing an email (sign-in would be ambiguous). Fix these in Airtable, then run the dry run again.
- **Warnings** are migrated as they are. Examples: dangling links, tasks without a project, projects stuck in "Setting Up". Review them with NMU.

### 2. Freeze edits, then apply

1. Agree a short maintenance window. Ask staff not to edit tasks in the app or in Airtable. Optionally switch to a read-only Airtable view.
2. Run the copy:

   ```bash
   npm run migrate:firestore -- --apply
   ```

   This refuses to run if the plan has errors or if Firestore already contains data. To overwrite matching IDs, pass `--allow-nonempty` (but rolling back first is cleaner). It writes in batches and saves `migration-output/<runId>/manifest.json`. Note the printed **runId**.

### 3. Verify

```bash
npm run migrate:firestore -- --verify
```

This re-reads Airtable and compares every planned document with Firestore, field by field. Bookkeeping fields are ignored. It exits with an error if anything is missing or different. **Don't cut over unless it prints "✅ Firestore matches Airtable."**

Also spot-check in the Firebase Console:
- Pick two users and check their access levels.
- Pick one project and check its task count, a few due dates and assignees.

### 4. Cut over

1. In Vercel, set `DATA_BACKEND=firestore` for **Preview** first. Smoke test as an Admin and as a Staff member:
   - Sign in.
   - My Tasks shows the right tasks.
   - Change a status, refresh, and check that it persisted.
   - Create a project.
   - Confirm that Staff can't see other people's tasks.
2. Then set it for **Production** and redeploy.
3. Leave Airtable read-only for an agreed period, for example two weeks, as the fallback copy. **Don't edit Airtable from here on**, or the two stores will diverge.

### Rollback

- **Before cutover,** or if `--verify` fails: `npm run migrate:firestore -- --rollback <runId>`. This deletes only the documents tagged with that run. Airtable was never touched.
- **After cutover:**
  1. Set `DATA_BACKEND=airtable` and redeploy. The app is immediately back on Airtable, and sessions keep working because the IDs are the same.
  2. Any changes made in Firestore since cutover (task statuses, new projects) won't be in Airtable. Find them with `--verify`: they show up as *different* or *only in Firestore*.
  3. Copy those back to Airtable by hand before re-opening edits. This is why the cutover should happen early in a quiet period.

## Not covered yet

- Activity history, attachments and Drive links beyond `documentLinks`. Add these to the mapping when they're built.
- Automated copy-back from Firestore to Airtable. This is deliberately not built, because it would create a second write path.
- Composite indexes. Current queries use only single-field indexes, so `firestore.indexes.json` is empty. Add entries there when queries combine filters with sorting.
