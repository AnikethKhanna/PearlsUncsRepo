"use client";

import { useActionState, useRef } from "react";
import { TASK_STATUSES, type TaskStatus } from "@/lib/domain/types";
import { updateTaskStatus, type TaskUpdateState } from "@/app/(app)/projects/actions";

/** Status dropdown that saves as soon as it changes. */
export function TaskStatusForm({ taskId, status, taskTitle, disabled }: { taskId: string; status: TaskStatus; taskTitle: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState<TaskUpdateState, FormData>(updateTaskStatus, {});
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={action} className="flex flex-col items-start gap-1 sm:items-end">
      <input type="hidden" name="taskId" value={taskId} />
      <label className="sr-only" htmlFor={`status_${taskId}`}>Status for {taskTitle}</label>
      <select
        id={`status_${taskId}`}
        name="status"
        key={status /* reset to the saved value after a server refresh */}
        defaultValue={status}
        disabled={disabled || pending}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm disabled:opacity-60"
      >
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <span aria-live="polite" className="text-xs">
        {pending ? <span className="text-slate-500">Saving…</span> : state.error ? <span className="text-red-700">{state.error}</span> : state.savedAt ? <span className="text-green-700">Saved</span> : null}
      </span>
    </form>
  );
}
