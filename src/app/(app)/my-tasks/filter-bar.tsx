"use client";

import { useRef } from "react";
import { buttonSecondary, inputClass } from "@/components/ui";

/** Same look as other inputs; active filters get a brand-coloured border and tint instead of the default. */
const activeInputClass = inputClass
  .replace("border-slate-300", "border-brand-600 ring-1 ring-brand-600")
  .replace("bg-white", "bg-brand-50");
const inputFor = (active: boolean) => (active ? activeInputClass : inputClass);

interface Option {
  value: string;
  label: string;
}

interface Props {
  scope: string;
  /** Page the form submits to (default My Tasks) */
  action?: string;
  /** Extra state to keep when filters change, e.g. the calendar's view and date */
  hidden?: Record<string, string>;
  values: { project: string; status: string; due: string; assignee: string; q: string; sort: string };
  options: { project: Option[]; status: Option[]; due: Option[]; assignee: Option[] | null; sort: Option[] | null };
}

/**
 * Filter + sort controls. A plain GET form (works without JavaScript via
 * "Apply"); with JavaScript, changing a dropdown applies it immediately.
 */
export function FilterBar({ scope, action = "/my-tasks", hidden = {}, values, options }: Props) {
  const ref = useRef<HTMLFormElement>(null);
  const submit = () => ref.current?.requestSubmit();
  const select = (name: keyof Props["values"], label: string, opts: Option[]) => (
    <label className="text-sm">
      <span className="mb-1 block font-medium text-slate-800">{label}</span>
      <select
        name={name}
        defaultValue={values[name]}
        onChange={submit}
        className={inputFor(values[name] !== opts[0]?.value && name !== "sort")}
      >
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form
      ref={ref}
      method="get"
      action={action}
      aria-label="Filter and sort tasks"
      className="grid grid-cols-2 items-end gap-3 md:grid-cols-3 lg:grid-cols-6"
    >
      {scope !== "mine" && <input type="hidden" name="scope" value={scope} />}
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label className="col-span-2 text-sm md:col-span-3 lg:col-span-1">
        <span className="mb-1 block font-medium text-slate-800">Search</span>
        <input
          type="search"
          name="q"
          defaultValue={values.q}
          placeholder="Task name…"
          className={inputFor(!!values.q)}
        />
      </label>
      {select("project", "Program", options.project)}
      {select("status", "Status", options.status)}
      {select("due", "Due", options.due)}
      {options.assignee && select("assignee", "Assignee", options.assignee)}
      {options.sort && select("sort", "Sort by", options.sort)}
      <button type="submit" className={`${buttonSecondary} h-[38px]`}>
        Apply
      </button>
    </form>
  );
}
