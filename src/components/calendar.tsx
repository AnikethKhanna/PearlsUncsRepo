import Link from "next/link";
import {
  CALENDAR_STATE_META,
  CALENDAR_STATES,
  MILESTONE_LABEL,
  PREVIEW_ITEMS_PER_DAY,
  type CalendarDay,
  type CalendarEntry,
  type CalendarPreview,
  type CalendarState,
  type Milestone,
} from "@/lib/domain/calendar";
import { formatDate } from "@/lib/domain/dates";

/** Colour + left border per state. Colour is never the only cue: every item also has a symbol and a text label. */
export const STATE_STYLES: Record<CalendarState, string> = {
  overdue: "border-l-red-600 bg-red-50 text-red-900 hover:bg-red-100",
  dueToday: "border-l-amber-500 bg-amber-50 text-amber-950 hover:bg-amber-100",
  upcoming: "border-l-brand-600 bg-brand-50 text-brand-800 hover:bg-brand-100",
  completed: "border-l-green-600 bg-green-50 text-slate-600 hover:bg-green-100",
};

export const taskHref = (e: CalendarEntry) => `/projects/${e.row.task.projectId}/tasks/${e.row.task.id}`;

/** One task on the calendar. Opens the existing task page (details, or the edit form for admins). */
export function CalendarTaskLink({
  entry,
  detailed = false,
  showPeople = false,
}: {
  entry: CalendarEntry;
  /** Week view: also show program, status and people */
  detailed?: boolean;
  showPeople?: boolean;
}) {
  const { row, state } = entry;
  const meta = CALENDAR_STATE_META[state];
  return (
    <Link
      href={taskHref(entry)}
      className={`block rounded border-l-4 px-1.5 py-1 text-xs leading-snug ${STATE_STYLES[state]}`}
      title={`${meta.label}: ${row.task.title} (${row.projectName})`}
      data-testid="calendar-task"
      data-state={state}
    >
      <span className="flex items-start gap-1">
        <span aria-hidden className="w-3 shrink-0 text-center font-bold">
          {meta.symbol}
        </span>
        <span className="min-w-0">
          <span className="sr-only">{meta.label}: </span>
          <span className={`${detailed ? "" : "line-clamp-2"} font-medium ${state === "completed" ? "line-through decoration-slate-400" : ""}`}>
            {row.task.title}
          </span>
          {detailed && (
            <span className="mt-0.5 block text-[11px] text-slate-600">
              <span className="font-semibold">{meta.label}</span>
              {row.task.status !== "Not Started" && state !== "completed" && <> · {row.task.status}</>}
              {state === "completed" && row.task.status === "Not Needed" && <> · Not needed</>}
              {row.blocked && <> · Blocked</>}
              <br />
              {row.projectName}
              {showPeople && <> · {row.assigneeNames.join(", ") || "Unassigned"}</>}
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

/** A program start/end date on the calendar. */
export function MilestoneLink({ milestone: m }: { milestone: Milestone }) {
  return (
    <Link
      href={`/projects/${m.projectId}`}
      className="block rounded border border-dashed border-slate-400 bg-white px-1.5 py-1 text-xs leading-snug text-slate-700 hover:bg-slate-50"
      title={`${MILESTONE_LABEL[m.kind]}: ${m.projectName}`}
      data-testid="calendar-milestone"
    >
      <span className="flex items-start gap-1">
        <span aria-hidden className="w-3 shrink-0 text-center">
          {m.kind === "start" ? "▸" : "◼"}
        </span>
        <span className="line-clamp-2 min-w-0">
          <span className="font-semibold">{MILESTONE_LABEL[m.kind]}:</span> {m.projectName}
        </span>
      </span>
    </Link>
  );
}

/** Key explaining the colours and symbols, in text. */
export function CalendarLegend({ milestones = true }: { milestones?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700" aria-label="Calendar key">
      {CALENDAR_STATES.map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span aria-hidden className={`inline-flex h-4 w-4 items-center justify-center rounded border-l-4 text-[10px] font-bold ${STATE_STYLES[s]}`}>
            {CALENDAR_STATE_META[s].symbol}
          </span>
          {CALENDAR_STATE_META[s].label}
        </li>
      ))}
      {milestones && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded border border-dashed border-slate-400 text-[10px]">
            ◼
          </span>
          Program start / end
        </li>
      )}
    </ul>
  );
}

export const dayLabel = (date: string) => formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

/**
 * Compact "next 7 days" strip for the dashboard. One row on wide screens;
 * on phones only days with something on them are listed, so it stays short.
 */
export function CalendarPreviewCard({
  preview,
  calendarHref,
  weekHref,
  overdueHref,
}: {
  preview: CalendarPreview;
  calendarHref: string;
  /** Link to the week view around a given day */
  weekHref: (date: string) => string;
  overdueHref: string;
}) {
  const empty = preview.days.every((d) => d.entries.length === 0 && d.milestones.length === 0);
  return (
    <section aria-labelledby="preview-heading" className="mb-5 rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="calendar-preview">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 id="preview-heading" className="text-sm font-semibold text-slate-900">
          Next 7 days
        </h2>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {preview.overdue > 0 && (
            <Link href={overdueHref} className="font-semibold text-red-700 hover:underline">
              {preview.overdue} overdue
            </Link>
          )}
          {preview.unscheduled > 0 && <span className="text-slate-500">{preview.unscheduled} without a due date</span>}
          <Link href={calendarHref} className="font-semibold text-brand-700 hover:underline">
            Open calendar →
          </Link>
        </div>
      </div>
      {empty ? (
        <p className="px-4 py-3 text-sm text-slate-600">Nothing due in the next 7 days.</p>
      ) : (
        <ol className="grid grid-cols-1 sm:grid-cols-7 sm:divide-x sm:divide-slate-100">
          {preview.days.map((d) => (
            <PreviewDay key={d.date} day={d} moreHref={weekHref(d.date)} />
          ))}
        </ol>
      )}
    </section>
  );
}

function PreviewDay({ day, moreHref }: { day: CalendarDay; moreHref: string }) {
  const items = day.entries.length + day.milestones.length;
  const shownEntries = day.entries.slice(0, PREVIEW_ITEMS_PER_DAY);
  const shownMilestones = day.milestones.slice(0, Math.max(0, PREVIEW_ITEMS_PER_DAY - shownEntries.length));
  const more = items - shownEntries.length - shownMilestones.length;
  return (
    <li
      className={`min-w-0 px-2 py-2 ${items === 0 ? "hidden sm:block" : "border-t border-slate-100 sm:border-t-0"} ${day.isToday ? "bg-brand-50/60" : ""}`}
      data-testid="preview-day"
    >
      <div className={`mb-1 text-xs ${day.isToday ? "font-bold text-brand-700" : "font-medium text-slate-500"}`}>
        <span aria-hidden>
          {day.isToday ? "Today" : formatDate(day.date, { weekday: "short" })} {formatDate(day.date, { month: "short", day: "numeric" })}
        </span>
        <span className="sr-only">
          {day.isToday ? "Today, " : ""}
          {dayLabel(day.date)}: {items === 0 ? "nothing due" : `${items} item${items === 1 ? "" : "s"}`}
        </span>
      </div>
      <ul className="space-y-1">
        {shownEntries.map((e) => (
          <li key={e.row.task.id}>
            <CalendarTaskLink entry={e} />
          </li>
        ))}
        {shownMilestones.map((m) => (
          <li key={`${m.projectId}-${m.kind}`}>
            <MilestoneLink milestone={m} />
          </li>
        ))}
      </ul>
      {more > 0 && (
        <Link href={moreHref} className="mt-1 block text-xs font-semibold text-brand-700 hover:underline">
          +{more} more<span className="sr-only"> on {dayLabel(day.date)}</span>
        </Link>
      )}
    </li>
  );
}
