import type { Metadata } from "next";
import Link from "next/link";
import { CalendarLegend, CalendarTaskLink, MilestoneLink, dayLabel } from "@/components/calendar";
import { Card, PageHeader, buttonSecondary } from "@/components/ui";
import { requireUser } from "@/lib/auth/current-user";
import { ACCESS_SUMMARY, can } from "@/lib/auth/permissions";
import { getStore } from "@/lib/data";
import { loadTasksInScope } from "@/lib/data/task-scope";
import {
  anchorForViewSwitch,
  buildCalendar,
  calendarHref,
  calendarState,
  milestoneProjects,
  milestonesShown,
  parseCalendarParams,
  projectMilestones,
  shiftPeriod,
  type CalendarDay,
  type CalendarParams,
} from "@/lib/domain/calendar";
import { formatDate, today } from "@/lib/domain/dates";
import {
  DEFAULT_FILTERS,
  DUE_FILTERS,
  LABELS,
  STATUS_FILTERS,
  activeFilterChips,
  applyFilters,
  filtersToQuery,
  parseFilters,
  type DashboardFilters,
} from "@/lib/domain/task-dashboard";
import { FilterBar } from "../my-tasks/filter-bar";

export const metadata: Metadata = { title: "Calendar" };

/** Items listed in a month-view day cell before "+N more" (which opens that week). */
const MONTH_ITEMS_PER_DAY = 3;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Calendar view of the same tasks as My Tasks: same data, same permissions,
 * same filters (kept in the URL), plus month/week navigation.
 */
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const user = await requireUser();
  const params = await searchParams;
  const canSeeEveryone = can(user, "task.viewAll");
  const f = parseFilters(params, { canSeeEveryone });
  const now = today();
  const cal = parseCalendarParams(params, now);

  const { projects, projectById, tasks, users, userName, rows: allRows } = await loadTasksInScope(
    getStore(),
    user,
    f.scope,
  );
  const shown = applyFilters(allRows, f, now);
  const milestones = projectMilestones(milestoneProjects(projects, f, { userId: user.id, tasksInScope: tasks }));
  const model = buildCalendar({ rows: shown, milestones, cal, todayIso: now });

  const href = (over: Partial<CalendarParams> = {}, filters: DashboardFilters = f) =>
    calendarHref(filters, cal, now, over);
  const listHref = `/my-tasks${filtersToQuery(f)}`;
  const chips = activeFilterChips(
    f,
    { project: (id) => projectById.get(id)?.name ?? "Unknown program", user: (id) => userName.get(id) ?? "Unknown" },
    (filters) => href({}, filters),
  );
  const resetHref = href({}, { ...f, project: "all", status: "all", due: "any", assignee: "all", q: "" });
  const projectsInScope = projects.filter((p) => tasks.some((t) => t.projectId === p.id));
  const hidden: Record<string, string> = {};
  if (cal.view !== "month") hidden.view = cal.view;
  if (cal.date !== now) hidden.date = cal.date;
  if (f.sort !== DEFAULT_FILTERS.sort) hidden.sort = f.sort;
  const showPeople = f.scope === "all";
  const todayInView = now >= model.period.focusStart && now <= model.period.focusEnd;

  return (
    <>
      <PageHeader
        title={f.scope === "all" ? "Everyone's calendar" : "My calendar"}
        description={`Signed in as ${user.name} (${user.accessLevel}): ${ACCESS_SUMMARY[user.accessLevel]}`}
        actions={
          <Link href={listHref} className={buttonSecondary}>
            List view
          </Link>
        }
      />

      {canSeeEveryone && (
        <nav
          aria-label="Whose tasks"
          className="mb-5 inline-flex rounded-lg border border-slate-300 bg-white p-1 text-sm font-medium"
        >
          {(["mine", "all"] as const).map((scope) => (
            <Link
              key={scope}
              href={href({}, { ...f, scope, assignee: "all" })}
              aria-current={f.scope === scope ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 ${f.scope === scope ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}
            >
              {scope === "mine" ? "My tasks" : "Everyone's tasks"}
            </Link>
          ))}
        </nav>
      )}

      {/* The same filters as My Tasks (sorting doesn't apply to a calendar, so it is kept but not shown) */}
      <Card className="mb-5 p-4">
        <FilterBarForCalendar
          f={f}
          hidden={hidden}
          projectOptions={[
            { value: "all", label: "All programs" },
            ...projectsInScope.map((p) => ({ value: p.id, label: p.name })),
          ]}
          assigneeOptions={
            f.scope === "all"
              ? [
                  { value: "all", label: "Anyone" },
                  { value: "unassigned", label: "Unassigned" },
                  ...users
                    .filter((u) => tasks.some((t) => t.assigneeIds.includes(u.id)))
                    .map((u) => ({ value: u.id, label: u.name })),
                ]
              : null
          }
        />
        <div
          className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm"
          data-testid="filter-status"
        >
          <span className="text-slate-700">
            Showing <strong>{shown.length}</strong> of {allRows.length} tasks
            {!milestonesShown(f) && <span className="text-slate-500"> · Program dates hidden while task filters are on</span>}
          </span>
          {chips.map((c) => (
            <Link
              key={c.key}
              href={c.removeHref}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-800 ring-1 ring-brand-100 hover:bg-brand-100"
              aria-label={`Remove filter ${c.label}`}
            >
              {c.label} <span aria-hidden>×</span>
            </Link>
          ))}
          {chips.length > 0 && (
            <Link href={resetHref} className="ml-auto font-semibold text-brand-700 hover:underline">
              Reset filters
            </Link>
          )}
        </div>
      </Card>

      {/* Navigation: previous / today / next, and month / week */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Calendar navigation" className="inline-flex gap-1">
            <Link
              href={href({ date: shiftPeriod(cal.view, cal.date, -1) })}
              className={`${buttonSecondary} px-3`}
              aria-label={`Previous ${cal.view}`}
              data-testid="calendar-prev"
            >
              ←
            </Link>
            <Link
              href={href({ date: now })}
              className={buttonSecondary}
              aria-current={todayInView ? "date" : undefined}
            >
              Today
            </Link>
            <Link
              href={href({ date: shiftPeriod(cal.view, cal.date, 1) })}
              className={`${buttonSecondary} px-3`}
              aria-label={`Next ${cal.view}`}
              data-testid="calendar-next"
            >
              →
            </Link>
          </nav>
          <h2 className="text-lg font-semibold text-slate-900" data-testid="calendar-title">
            {model.title}
          </h2>
        </div>
        <nav aria-label="Calendar view" className="inline-flex rounded-lg border border-slate-300 bg-white p-1 text-sm font-medium">
          {(["month", "week"] as const).map((view) => (
            <Link
              key={view}
              href={href({ view, date: view === cal.view ? cal.date : anchorForViewSwitch(cal, now) })}
              aria-current={cal.view === view ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 ${cal.view === view ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}
            >
              {view === "month" ? "Month" : "Week"}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <CalendarLegend milestones={milestonesShown(f)} />
        {model.overdueBefore > 0 && (
          <Link
            href={`/my-tasks${filtersToQuery(f, { due: "overdue" })}`}
            className="text-sm font-semibold text-red-700 hover:underline"
          >
            {model.overdueBefore} overdue task{model.overdueBefore === 1 ? " is" : "s are"} due before this{" "}
            {cal.view} →
          </Link>
        )}
      </div>

      {allRows.length === 0 && milestones.length === 0 ? (
        <Card className="p-8 text-center text-slate-600">No tasks assigned in active programs.</Card>
      ) : cal.view === "month" ? (
        <MonthView weeks={model.weeks} days={model.days} weekHref={(date) => href({ view: "week", date })} showPeople={showPeople} />
      ) : (
        <WeekView days={model.days} showPeople={showPeople} />
      )}

      {model.unscheduled.length > 0 && (
        <details className="mt-5 rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="unscheduled">
          <summary className="cursor-pointer px-5 py-3 font-semibold text-slate-900">
            No due date <span className="font-normal text-slate-500">· {model.unscheduled.length} task{model.unscheduled.length === 1 ? "" : "s"} not on the calendar</span>
          </summary>
          <ul className="grid gap-1.5 border-t border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {model.unscheduled.map((row) => (
              <li key={row.task.id}>
                <CalendarTaskLink entry={{ row, state: calendarState(row.task, now) }} detailed showPeople={showPeople} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function FilterBarForCalendar({
  f,
  hidden,
  projectOptions,
  assigneeOptions,
}: {
  f: DashboardFilters;
  hidden: Record<string, string>;
  projectOptions: { value: string; label: string }[];
  assigneeOptions: { value: string; label: string }[] | null;
}) {
  return (
    <FilterBar
      key={filtersToQuery(f) /* reset the form when filters change via links */}
      action="/calendar"
      hidden={hidden}
      scope={f.scope}
      values={{ project: f.project, status: f.status, due: f.due, assignee: f.assignee, q: f.q, sort: f.sort }}
      options={{
        project: projectOptions,
        status: STATUS_FILTERS.map((s) => ({ value: s, label: LABELS.status[s] })),
        due: DUE_FILTERS.map((d) => ({ value: d, label: LABELS.due[d] })),
        assignee: assigneeOptions,
        sort: null,
      }}
    />
  );
}

/** Month grid on tablets and up; an agenda list (only days with items) on phones. */
function MonthView({
  weeks,
  days,
  weekHref,
  showPeople,
}: {
  weeks: CalendarDay[][];
  days: CalendarDay[];
  weekHref: (date: string) => string;
  showPeople: boolean;
}) {
  const busyDays = days.filter((d) => d.inFocus && (d.entries.length > 0 || d.milestones.length > 0));
  return (
    <>
      <table className="hidden w-full table-fixed border-collapse overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm md:table" data-testid="month-grid">
        <thead>
          <tr>
            {WEEKDAYS.map((w) => (
              <th key={w} scope="col" className="border-b border-slate-200 bg-slate-50 px-2 py-2 text-left text-xs font-semibold text-slate-600">
                <abbr title={w} className="no-underline">
                  {w.slice(0, 3)}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0].date}>
              {week.map((d) => (
                <MonthCell key={d.date} day={d} weekHref={weekHref(d.date)} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="md:hidden" data-testid="month-agenda">
        {busyDays.length === 0 ? (
          <Card className="p-6 text-center text-sm text-slate-600">Nothing due this month.</Card>
        ) : (
          <ol className="space-y-3">
            {busyDays.map((d) => (
              <li key={d.date}>
                <DayList day={d} showPeople={showPeople} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}

function MonthCell({ day: d, weekHref }: { day: CalendarDay; weekHref: string }) {
  const entries = d.entries.slice(0, MONTH_ITEMS_PER_DAY);
  const milestones = d.milestones.slice(0, Math.max(0, MONTH_ITEMS_PER_DAY - entries.length));
  const more = d.entries.length + d.milestones.length - entries.length - milestones.length;
  return (
    <td
      className={`h-28 border border-slate-100 p-1.5 align-top ${d.inFocus ? "" : "bg-slate-50"} ${d.isToday ? "bg-brand-50/70 ring-2 ring-inset ring-brand-600" : ""}`}
      data-testid="calendar-day"
      data-date={d.date}
    >
      <div className="mb-1 flex items-center justify-between">
        <span
          className={`text-xs ${d.isToday ? "rounded bg-brand-600 px-1.5 font-bold text-white" : d.inFocus ? "font-semibold text-slate-800" : "text-slate-400"}`}
        >
          <span aria-hidden>{formatDate(d.date, { day: "numeric" })}</span>
          <span className="sr-only">
            {dayLabel(d.date)}
            {d.isToday ? " (today)" : ""}
          </span>
        </span>
        {d.isToday && <span className="text-[10px] font-semibold uppercase text-brand-700">Today</span>}
      </div>
      <ul className="space-y-1">
        {entries.map((e) => (
          <li key={e.row.task.id}>
            <CalendarTaskLink entry={e} />
          </li>
        ))}
        {milestones.map((m) => (
          <li key={`${m.projectId}-${m.kind}`}>
            <MilestoneLink milestone={m} />
          </li>
        ))}
      </ul>
      {more > 0 && (
        <Link href={weekHref} className="mt-1 block text-xs font-semibold text-brand-700 hover:underline">
          +{more} more<span className="sr-only"> on {dayLabel(d.date)}</span>
        </Link>
      )}
    </td>
  );
}

/** Week view: one column per day on wide screens, stacked on smaller ones. Shows full details. */
function WeekView({ days, showPeople }: { days: CalendarDay[]; showPeople: boolean }) {
  return (
    <ol className="grid gap-3 lg:grid-cols-7 lg:gap-2" data-testid="week-grid">
      {days.map((d) => (
        <li key={d.date} className="min-w-0">
          <DayList day={d} showPeople={showPeople} />
        </li>
      ))}
    </ol>
  );
}

function DayList({ day: d, showPeople }: { day: CalendarDay; showPeople: boolean }) {
  const empty = d.entries.length === 0 && d.milestones.length === 0;
  return (
    <section
      aria-label={`${dayLabel(d.date)}${d.isToday ? " (today)" : ""}`}
      className={`h-full rounded-lg border bg-white shadow-sm ${d.isToday ? "border-brand-600 ring-1 ring-brand-600" : "border-slate-200"}`}
      data-testid="calendar-day"
      data-date={d.date}
    >
      <h3 className={`border-b border-slate-100 px-2.5 py-1.5 text-sm ${d.isToday ? "font-bold text-brand-700" : "font-semibold text-slate-800"}`}>
        {formatDate(d.date, { weekday: "short", month: "short", day: "numeric" })}
        {d.isToday && <span className="ml-1 text-xs uppercase">· Today</span>}
      </h3>
      {empty ? (
        <p className="px-2.5 py-2 text-xs text-slate-500">Nothing due</p>
      ) : (
        <ul className="space-y-1.5 p-2">
          {d.entries.map((e) => (
            <li key={e.row.task.id}>
              <CalendarTaskLink entry={e} detailed showPeople={showPeople} />
            </li>
          ))}
          {d.milestones.map((m) => (
            <li key={`${m.projectId}-${m.kind}`}>
              <MilestoneLink milestone={m} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
