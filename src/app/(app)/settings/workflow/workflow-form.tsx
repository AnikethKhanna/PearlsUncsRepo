"use client";
import { useActionState, useState } from "react";
import { Alert, Card, buttonPrimary, buttonSecondary, inputClass, labelClass } from "@/components/ui";
import { SYSTEM_PHASES, type DeadlinePreset, type WorkflowConfig } from "@/lib/domain/workflow";
import { OFFSET_UNITS } from "@/lib/domain/types";
import { updateWorkflow } from "./actions";

export function WorkflowForm({ initial, revision, writable }: { initial: WorkflowConfig; revision: string; writable: boolean }) {
  const [config, setConfig] = useState(initial);
  const [newPhase, setNewPhase] = useState("");
  const [localError, setLocalError] = useState("");
  const [state, action, pending] = useActionState(updateWorkflow, {});
  const patchPreset = (id: string, patch: Partial<DeadlinePreset>) => setConfig((c) => ({ ...c, deadlinePresets: c.deadlinePresets.map((p) => p.id === id ? { ...p, ...patch } : p) }));
  const movePhase = (index: number, delta: number) => setConfig((c) => {
    const phases = [...c.phases];
    [phases[index], phases[index + delta]] = [phases[index + delta], phases[index]];
    return { ...c, phases };
  });
  return <form action={action} className="space-y-6" aria-busy={pending}>
    <input type="hidden" name="config" value={JSON.stringify(config)} />
    <input type="hidden" name="revision" value={state.revision ?? revision} />
    {state.error && <Alert tone="error">{state.error}</Alert>}
    {localError && <Alert tone="error">{localError}</Alert>}
    {state.success && <Alert tone="success">{state.success}</Alert>}
    <fieldset disabled={pending || !writable} className="space-y-6">
      <legend className="sr-only">Workflow configuration</legend>
      <Card className="space-y-4 p-6">
        <div><h2 className="text-lg font-semibold">Task phases</h2><p className="mt-1 text-sm text-slate-600">Phases organize program tasks. Move them to set their display order. Archive custom phases to stop offering them for new tasks; existing tasks keep their labels.</p></div>
        <ul className="divide-y divide-slate-200">
          {config.phases.map((phase, index) => {
            const system = (SYSTEM_PHASES as readonly string[]).includes(phase.name);
            return <li key={phase.name} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div><span className="font-medium">{phase.name}</span>{system && <span className="ml-2 text-xs text-slate-600">Required</span>}</div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={phase.active} disabled={system} onChange={(e) => setConfig((c) => ({ ...c, phases: c.phases.map((p) => p.name === phase.name ? { ...p, active: e.target.checked } : p) }))} aria-label={`Active: ${phase.name}`} />{phase.active ? "Active" : "Archived"}</label>
                <button type="button" className={buttonSecondary} disabled={index === 0} aria-label={`Move ${phase.name} up`} onClick={() => movePhase(index, -1)}>↑</button>
                <button type="button" className={buttonSecondary} disabled={index === config.phases.length - 1} aria-label={`Move ${phase.name} down`} onClick={() => movePhase(index, 1)}>↓</button>
              </div>
            </li>;
          })}
        </ul>
        <div className="flex flex-wrap items-end gap-3"><div className="min-w-48 flex-1"><label htmlFor="new-phase" className={labelClass}>New phase name</label><input id="new-phase" value={newPhase} onChange={(e) => setNewPhase(e.target.value)} maxLength={50} className={`mt-1 ${inputClass}`} placeholder="e.g. Partner coordination" /></div>
          <button type="button" className={buttonSecondary} disabled={config.phases.length >= 40} onClick={() => {
            const name = newPhase.trim();
            if (!name || config.phases.some((p) => p.name.toLowerCase() === name.toLowerCase())) { setLocalError("Enter a unique phase name."); return; }
            setConfig((c) => ({ ...c, phases: [...c.phases, { name, active: true }] })); setNewPhase(""); setLocalError("");
          }}>Add phase</button>
        </div>
      </Card>
      <Card className="space-y-5 p-6">
        <div><h2 className="text-lg font-semibold">Deadline presets</h2><p className="mt-1 text-sm text-slate-600">Offer common deadlines when adding or editing a task. Applying a preset uses that program’s dates. Changing these choices never reschedules existing tasks or template steps.</p></div>
        {config.deadlinePresets.map((p, i) => <fieldset key={p.id} className="rounded-lg border border-slate-200 p-4">
          <legend className="px-2 text-sm font-semibold">Preset {i + 1}</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <label className={`${labelClass} sm:col-span-2 lg:col-span-5`}>Name<input value={p.label} required maxLength={80} className={`mt-1 ${inputClass}`} onChange={(e) => patchPreset(p.id, { label: e.target.value })} /></label>
            <label className={labelClass}>Amount<input type="number" min={0} max={365} step={1} required value={Number.isNaN(p.offsetAmount) ? "" : p.offsetAmount} className={`mt-1 ${inputClass}`} onChange={(e) => patchPreset(p.id, { offsetAmount: e.target.value === "" ? NaN : Number(e.target.value) })} /></label>
            <label className={labelClass}>Unit<select value={p.offsetUnit} className={`mt-1 ${inputClass}`} onChange={(e) => patchPreset(p.id, { offsetUnit: e.target.value as DeadlinePreset["offsetUnit"] })}>{OFFSET_UNITS.map((u) => <option key={u}>{u}</option>)}</select></label>
            <label className={labelClass}>Timing<select value={p.timing} className={`mt-1 ${inputClass}`} onChange={(e) => patchPreset(p.id, { timing: e.target.value as DeadlinePreset["timing"] })}><option>Before</option><option>After</option></select></label>
            <label className={labelClass}>Relative to<select value={p.anchor} className={`mt-1 ${inputClass}`} onChange={(e) => patchPreset(p.id, { anchor: e.target.value as DeadlinePreset["anchor"] })}><option>Program Start</option><option>Program End</option></select></label>
            <button type="button" className={`${buttonSecondary} self-end`} aria-label={`Remove preset ${i + 1}: ${p.label}`} onClick={() => setConfig((c) => ({ ...c, deadlinePresets: c.deadlinePresets.filter((x) => x.id !== p.id) }))}>Remove</button>
          </div>
        </fieldset>)}
        <button type="button" className={buttonSecondary} disabled={config.deadlinePresets.length >= 20} onClick={() => setConfig((c) => ({ ...c, deadlinePresets: [...c.deadlinePresets, { id: crypto.randomUUID(), label: "", offsetAmount: 1, offsetUnit: "Weeks", timing: "Before", anchor: "Program Start" }] }))}>Add deadline preset</button>
      </Card>
      <p className="text-sm text-slate-600">Task statuses, project statuses, roles and supported date units stay fixed so completion, access and scheduling continue to work.</p>
      <button className={buttonPrimary} type="submit">{pending ? "Saving settings…" : "Save workflow settings"}</button>
    </fieldset>
  </form>;
}
