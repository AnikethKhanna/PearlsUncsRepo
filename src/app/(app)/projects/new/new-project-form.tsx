"use client";

import { useActionState, useState } from "react";
import { Alert, Card, buttonPrimary, inputClass, labelClass } from "@/components/ui";
import { describeRule, formatDisplayDate, isIsoDate } from "@/lib/domain/dates";
import { generateTaskDrafts, rolesForSteps } from "@/lib/domain/generate-tasks";
import type { ProgramTemplate } from "@/lib/domain/types";
import { createProject, type CreateProjectState } from "../actions";

interface Props {
  sites: { id: string; name: string; location: string }[];
  templates: ProgramTemplate[];
  staff: { id: string; name: string; jobTitle: string }[];
  /** Pre-selected template, e.g. from "Start a program from this template" */
  initialTemplateId?: string;
}

export function NewProjectForm({ sites, templates, staff, initialTemplateId = "" }: Props) {
  const [state, action, pending] = useActionState<CreateProjectState, FormData>(createProject, {});
  // Controlled inputs, so values survive a failed submit (React resets uncontrolled forms after an action).
  const [name, setName] = useState("");
  const [siteId, setSiteId] = useState("");
  const [templateId, setTemplateId] = useState(initialTemplateId);
  const [roleChoices, setRoleChoices] = useState<Record<string, string>>({});
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const template = templates.find((t) => t.id === templateId);
  const roles = template ? rolesForSteps(template.steps) : [];
  const fe = state.fieldErrors ?? {};
  // Pre-select the person whose job title matches the role; the user can change it.
  const roleValue = (role: string) =>
    roleChoices[role] ?? staff.find((u) => u.jobTitle.toLowerCase() === role.toLowerCase())?.id ?? "";
  const phases = template ? [...new Set(template.steps.map((s) => s.phase || "Other"))] : [];
  const includedCount = template ? template.steps.filter((s) => !excluded.has(s.id)).length : 0;

  // Same pure function the server uses, so the preview matches what is saved.
  const preview =
    template && isIsoDate(startDate)
      ? generateTaskDrafts({
          steps: template.steps,
          startDate,
          endDate: isIsoDate(endDate) ? endDate : null,
          excludedStepIds: [...excluded],
        })
      : null;

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form action={action} className="space-y-6">
      {state.error && <Alert tone="error">{state.error}</Alert>}

      <Card className="space-y-5 p-6">
        <h2 className="text-lg font-semibold">1. Program details</h2>
        <Field id="name" label="Project name" error={fe.name}>
          <input
            id="name"
            name="name"
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Spring 2027 Swim Safely – Sample University"
            className={inputClass}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="siteId" label="Site / partner and location" error={fe.siteId}>
            <select
              id="siteId"
              name="siteId"
              required
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className={inputClass}
            >
              <option value="" disabled>
                Choose a site…
              </option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.location ? ` — ${s.location}` : ""}
                </option>
              ))}
            </select>
            {siteId && <p className="mt-2 text-sm text-slate-600">City / location: {sites.find((s) => s.id === siteId)?.location || "Not recorded for this site"}</p>}
          </Field>
          <Field id="templateId" label="Program template" error={fe.templateId}>
            <select
              id="templateId"
              name="templateId"
              required
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setExcluded(new Set());
              }}
              className={inputClass}
            >
              <option value="" disabled>
                Choose a template…
              </option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="startDate" label="Program start date" error={fe.startDate}>
            <input
              id="startDate"
              name="startDate"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field id="endDate" label="Program end date (optional)" error={fe.endDate}>
            <input
              id="endDate"
              name="endDate"
              type="date"
              min={startDate || undefined}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        {template?.description && <p className="text-sm text-slate-600">{template.description}</p>}
      </Card>

      {template && roles.length > 0 && (
        <Card className="space-y-4 p-6">
          <div>
            <h2 className="text-lg font-semibold">2. Who is responsible?</h2>
            <p className="text-sm text-slate-600">
              Tasks for each role are assigned to the person you pick (pre-filled by job title). Shared tasks go to
              everyone in their roles. You can leave a role unassigned.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {roles.map((role, i) => (
              <Field key={role} id={`role_${i}`} label={role}>
                <select
                  id={`role_${i}`}
                  name={`role_${i}`}
                  value={roleValue(role)}
                  onChange={(e) => setRoleChoices((prev) => ({ ...prev, [role]: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">Unassigned</option>
                  {staff.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.jobTitle ? ` (${u.jobTitle})` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
        </Card>
      )}

      {template && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold">3. Review tasks</h2>
          <p className="text-sm text-slate-600">
            {includedCount} of {template.steps.length} tasks selected. Untick any task that doesn&apos;t apply to this
            program.
            {!preview && " Enter a start date to see due dates."}
          </p>
          <div className="mt-4 max-h-[32rem] overflow-y-auto rounded-md border border-slate-200 px-4">
            {phases.map((phase) => (
              <section key={phase} aria-label={phase}>
                <h3 className="sticky top-0 z-10 -mx-4 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {phase}
                </h3>
                <ul className="divide-y divide-slate-100">
                  {template.steps
                    .filter((s) => (s.phase || "Other") === phase)
                    .map((step) => {
                      const draft = preview?.drafts.find((d) => d.key === step.id);
                      const included = !excluded.has(step.id);
                      return (
                        <li key={step.id} className="flex items-start gap-3 py-3">
                          <input
                            type="checkbox"
                            id={`inc_${step.id}`}
                            checked={included}
                            onChange={() => toggle(step.id)}
                            className="mt-1 h-4 w-4 rounded border-slate-300"
                          />
                          {!included && <input type="hidden" name="excludeStep" value={step.id} />}
                          <label
                            htmlFor={`inc_${step.id}`}
                            className={`flex-1 text-sm ${included ? "" : "text-slate-400 line-through"}`}
                          >
                            <span className="font-medium text-inherit">{step.title}</span>
                            <span className="block text-xs text-slate-500">
                              {describeRule(step)}
                              {step.defaultOwnerRoles.length > 0 && ` · ${step.defaultOwnerRoles.join(", ")}`}
                            </span>
                          </label>
                          <span className="whitespace-nowrap text-sm text-slate-700">
                            {draft ? formatDisplayDate(draft.dueDate) : ""}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              </section>
            ))}
          </div>
          {preview && preview.warnings.length > 0 && (
            <div className="mt-4">
              <Alert tone="warning">
                <ul className="list-disc pl-4">
                  {preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Alert>
            </div>
          )}
        </Card>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className={buttonPrimary}>
          {pending ? "Creating project and tasks…" : "Create project"}
        </button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}
