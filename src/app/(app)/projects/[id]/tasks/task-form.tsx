"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Alert, Card, buttonPrimary, buttonSecondary, inputClass, labelClass } from "@/components/ui";
import { removeTask, saveTask, type TaskFormState } from "./actions";

export interface TaskFormProps {
  projectId: string;
  templateName: string;
  task?: {
    id: string;
    title: string;
    description: string;
    phase: string;
    dueDate: string | null;
    ownerRole: string;
    assigneeIds: string[];
    dependsOnTaskIds: string[];
  };
  phases: string[];
  staff: { id: string; name: string; jobTitle: string }[];
  /** Other tasks in this program that can be prerequisites */
  otherTasks: { id: string; title: string; phase: string }[];
}

/** Add or edit one task in ONE program. The template is never changed. */
export function TaskForm({ projectId, templateName, task, phases, staff, otherTasks }: TaskFormProps) {
  const [state, action, pending] = useActionState<TaskFormState, FormData>(saveTask, {});
  // Controlled fields so values survive a failed save.
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [phase, setPhase] = useState(task?.phase ?? phases[0] ?? "Pre-launch");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [ownerRole, setOwnerRole] = useState(task?.ownerRole ?? "");
  const [assignees, setAssignees] = useState(new Set(task?.assigneeIds ?? []));
  const [deps, setDeps] = useState(new Set(task?.dependsOnTaskIds ?? []));
  const [depFilter, setDepFilter] = useState("");
  const fe = state.fieldErrors ?? {};
  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  const phaseOptions = [...new Set([...phases, "Pre-launch", "During program", "Post-program"])];
  const visibleDeps = otherTasks.filter(
    (t) => deps.has(t.id) || t.title.toLowerCase().includes(depFilter.trim().toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <Alert tone="info">
        You&apos;re editing <strong>this program only</strong>. The &ldquo;{templateName || "original"}&rdquo; template
        and other programs created from it won&apos;t change.
      </Alert>

      <form action={action} className="space-y-6">
        <input type="hidden" name="projectId" value={projectId} />
        {task && <input type="hidden" name="taskId" value={task.id} />}
        {state.error && <Alert tone="error">{state.error}</Alert>}

        <Card className="space-y-5 p-6">
          <Field id="title" label="Task title" error={fe.title}>
            <input
              id="title"
              name="title"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field id="description" label="Description (optional)">
            <textarea
              id="description"
              name="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field id="phase" label="Phase" error={fe.phase}>
              <select
                id="phase"
                name="phase"
                value={phase}
                onChange={(e) => setPhase(e.target.value)}
                className={inputClass}
              >
                {phaseOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="dueDate" label="Due date" error={fe.dueDate}>
              <input
                id="dueDate"
                name="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field id="ownerRole" label="Owner role(s)">
              <input
                id="ownerRole"
                name="ownerRole"
                placeholder="e.g. Program Manager"
                value={ownerRole}
                onChange={(e) => setOwnerRole(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        </Card>

        <Card className="p-6">
          <fieldset>
            <legend className={labelClass}>Assigned to (choose one or more)</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {staff.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="assignee"
                    value={u.id}
                    checked={assignees.has(u.id)}
                    onChange={() => setAssignees((s) => toggle(s, u.id))}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  {u.name}
                  {u.jobTitle && <span className="text-slate-500">({u.jobTitle})</span>}
                </label>
              ))}
            </div>
          </fieldset>
        </Card>

        <Card className="p-6">
          <fieldset>
            <legend className={labelClass}>Waits for (prerequisites in this program)</legend>
            <p className="text-sm text-slate-600">
              This task shows as Blocked until the ones you tick are Done or Not Needed.
            </p>
            {fe.dependsOn && <p className="mt-2 text-sm text-red-700">{fe.dependsOn}</p>}
            <input
              type="search"
              aria-label="Filter prerequisite tasks"
              placeholder="Filter tasks…"
              value={depFilter}
              onChange={(e) => setDepFilter(e.target.value)}
              className={`mt-3 ${inputClass}`}
            />
            <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-3">
              {visibleDeps.length === 0 && <p className="text-sm text-slate-500">No matching tasks.</p>}
              {visibleDeps.map((t) => (
                <label key={t.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="dependsOn"
                    value={t.id}
                    checked={deps.has(t.id)}
                    onChange={() => setDeps((s) => toggle(s, t.id))}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  />
                  <span>
                    {t.title} <span className="text-xs text-slate-500">· {t.phase || "Other"}</span>
                  </span>
                </label>
              ))}
            </div>
            {/* Keep ticked prerequisites that are filtered out of view */}
            {[...deps]
              .filter((id) => !visibleDeps.some((t) => t.id === id))
              .map((id) => (
                <input key={id} type="hidden" name="dependsOn" value={id} />
              ))}
          </fieldset>
        </Card>

        <div className="flex flex-wrap justify-end gap-3">
          <Link href={`/projects/${projectId}`} className={buttonSecondary}>
            Cancel
          </Link>
          <button type="submit" disabled={pending} className={buttonPrimary}>
            {pending ? "Saving…" : task ? "Save changes" : "Add task to this program"}
          </button>
        </div>
      </form>

      {task && (
        <Card className="border-red-200 p-6">
          <h2 className="font-semibold text-red-900">Remove this task</h2>
          <p className="mt-1 text-sm text-slate-600">
            Removes it from this program only. Tasks that waited for it will no longer wait. Tip: if it might apply
            later, set its status to &ldquo;Not Needed&rdquo; instead.
          </p>
          <form
            action={removeTask}
            onSubmit={(e) => {
              if (!window.confirm(`Remove "${task.title}" from this program?`)) e.preventDefault();
            }}
            className="mt-4"
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="taskId" value={task.id} />
            <button
              type="submit"
              className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50"
            >
              Remove from this program
            </button>
          </form>
        </Card>
      )}
    </div>
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
