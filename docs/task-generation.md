# How task generation works

Code: [`src/lib/domain/generate-tasks.ts`](../src/lib/domain/generate-tasks.ts)
and [`src/lib/domain/dates.ts`](../src/lib/domain/dates.ts).

1. An admin picks a **site**, a **template**, a **start date** and an
   optional **end date**.
2. For each template role (for example "Program Manager" or "Operations"),
   they pick a person or leave it unassigned.
3. They untick any steps that don't apply to this program.
4. For each remaining step, the due date is calculated:

   `due = Anchor date ± Offset Amount × Offset Unit`

   | Rule | Start 2027‑04‑15, End 2027‑05‑20 |
   | --- | --- |
   | 4 Months Before Program Start | 2026‑12‑15 |
   | 3 Weeks Before Program Start | 2027‑03‑25 |
   | 2 Weeks After Program End | 2027‑06‑03 |

   - Months are calendar months, clamped to the end of shorter months
     (Mar 31 − 1 month = Feb 28).
   - "Program End" uses the start date if no end date was entered.
5. Dependencies between steps become dependencies between the new tasks.
   If a prerequisite step was unticked, the link is dropped and a warning is
   shown. Circular dependencies in a template block creation.
6. The new-project screen shows a live preview built from the **same
   function** the server uses, so the preview always matches what's saved.
   The server recalculates everything itself and doesn't trust the browser.

## Saving to Airtable

The project is created with status **Setting Up**. Then its tasks are
created, 10 per request (Airtable's limit), and dependency links are added in
a second pass. Finally the status is switched to **Planning**. If anything
fails midway, the project stays in "Setting Up" and the project page shows a
warning, so a partial project can't go unnoticed.

## When program dates change (planned, not built yet)

Deadlines are never silently overwritten. The planned flow:

- Changing a project's dates opens a **review screen** that lists each task
  with its current due date and its proposed new date from the original rule.
- Tasks that are done, or whose dates were edited by hand, are unticked by
  default.
- Nothing changes until the user confirms.
