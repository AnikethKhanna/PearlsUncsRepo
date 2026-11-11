"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Alert, Card, buttonPrimary, buttonSecondary, inputClass, labelClass } from "@/components/ui";
import { saveProgramAsTemplate, type SaveTemplateState } from "./actions";

interface Props {
  projectId: string;
  defaultName: string;
  defaultProgramType: string;
  counts: { total: number; notNeeded: number; withNotes: number; assigned: number };
}

export function SaveTemplateForm({ projectId, defaultName, defaultProgramType, counts }: Props) {
  const [state, action, pending] = useActionState<SaveTemplateState, FormData>(saveProgramAsTemplate, {});
  const [name, setName] = useState(defaultName);
  const [programType, setProgramType] = useState(defaultProgramType);
  const [description, setDescription] = useState("");
  const [opts, setOpts] = useState({ includeNotNeeded: false, includeNotes: false, includeAssignees: false });
  const stepCount = counts.total - (opts.includeNotNeeded ? 0 : counts.notNeeded);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="projectId" value={projectId} />
      {state.error && <Alert tone="error">{state.error}</Alert>}

      <Card className="space-y-5 p-6">
        <div>
          <label htmlFor="name" className={labelClass}>
            New template name
          </label>
          <input
            id="name"
            name="name"
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`mt-1 ${inputClass}`}
          />
          {state.fieldErrors?.name && <p className="mt-1 text-sm text-red-700">{state.fieldErrors.name}</p>}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="programType" className={labelClass}>
              Program type
            </label>
            <input
              id="programType"
              name="programType"
              value={programType}
              onChange={(e) => setProgramType(e.target.value)}
              className={`mt-1 ${inputClass}`}
            />
          </div>
          <div>
            <label htmlFor="description" className={labelClass}>
              Description (optional)
            </label>
            <input
              id="description"
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`mt-1 ${inputClass}`}
            />
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="font-semibold">What gets copied</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>Task titles, descriptions, phases and the program&apos;s current order</li>
          <li>
            Deadlines as <strong>relative rules</strong> (e.g. &ldquo;2 weeks before program start&rdquo;), worked out
            from this program&apos;s dates
          </li>
          <li>Owner roles and dependencies between copied tasks</li>
        </ul>
        <h2 className="mt-4 font-semibold">Never copied</h2>
        <p className="mt-1 text-sm text-slate-700">This program&apos;s dates, statuses and completion dates.</p>

        <fieldset className="mt-5 space-y-3">
          <legend className="font-semibold">Optional</legend>
          <Option
            name="includeNotNeeded"
            checked={opts.includeNotNeeded}
            onChange={(v) => setOpts({ ...opts, includeNotNeeded: v })}
            label={`Include tasks marked "Not Needed" (${counts.notNeeded})`}
          />
          <Option
            name="includeNotes"
            checked={opts.includeNotes}
            onChange={(v) => setOpts({ ...opts, includeNotes: v })}
            label={`Include task notes (${counts.withNotes} tasks have notes — they may be private)`}
          />
          <Option
            name="includeAssignees"
            checked={opts.includeAssignees}
            onChange={(v) => setOpts({ ...opts, includeAssignees: v })}
            label={`Remember who was assigned (${counts.assigned} tasks) — used only when nobody is picked for a role`}
          />
        </fieldset>
      </Card>

      <Alert tone="info">
        This creates a <strong>new</strong> template with {stepCount} steps. This program and its original template are
        not changed.
      </Alert>

      <div className="flex justify-end gap-3">
        <Link href={`/projects/${projectId}`} className={buttonSecondary}>
          Cancel
        </Link>
        <button type="submit" disabled={pending} className={buttonPrimary}>
          {pending ? "Saving template…" : "Save as new template"}
        </button>
      </div>
    </form>
  );
}

function Option({
  name,
  label,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300"
      />
      {label}
    </label>
  );
}
