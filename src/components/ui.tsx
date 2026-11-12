import type { ReactNode } from "react";
import type { ProjectStatus, TaskStatus } from "@/lib/domain/types";

export const buttonPrimary =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60";
export const buttonSecondary =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";
export const inputClass =
  "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";
export const labelClass = "block text-sm font-medium text-slate-800";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

const TASK_STATUS_STYLES: Record<TaskStatus, string> = {
  "Not Started": "bg-slate-100 text-slate-700 ring-slate-300",
  "In Progress": "bg-blue-50 text-blue-800 ring-blue-300",
  Done: "bg-green-50 text-green-800 ring-green-300",
  "Not Needed": "bg-slate-50 text-slate-600 ring-slate-200",
};

const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = {
  "Setting Up": "bg-amber-50 text-amber-800 ring-amber-300",
  Planning: "bg-slate-100 text-slate-700 ring-slate-300",
  Active: "bg-blue-50 text-blue-800 ring-blue-300",
  Completed: "bg-green-50 text-green-800 ring-green-300",
  Cancelled: "bg-slate-50 text-slate-600 ring-slate-200",
};

export function Badge({ children, tone }: { children: ReactNode; tone: "red" | "amber" | "slate" }) {
  const styles = {
    red: "bg-red-50 text-red-800 ring-red-300",
    amber: "bg-amber-50 text-amber-900 ring-amber-300",
    slate: "bg-slate-100 text-slate-700 ring-slate-300",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${styles}`}>{children}</span>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TASK_STATUS_STYLES[status]}`}>{status}</span>;
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${PROJECT_STATUS_STYLES[status]}`}>{status}</span>;
}

export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-full bg-brand-600" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Alert({ tone, children }: { tone: "error" | "warning" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-red-300 bg-red-50 text-red-900",
    warning: "border-amber-300 bg-amber-50 text-amber-900",
    success: "border-green-300 bg-green-50 text-green-900",
    info: "border-brand-100 bg-brand-50 text-brand-800",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}
