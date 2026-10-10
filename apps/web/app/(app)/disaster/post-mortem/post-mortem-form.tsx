'use client';

import { useState, useTransition } from 'react';
import { POST_MORTEM_SECTIONS, durationHours, saStamp, validatePostMortem } from '@criticom/db/post-mortem';
import { cn } from '@/lib/utils';
import { filePostMortemAction } from '../actions';

type OpenIncident = { id: string; number: string; type: string; location: string; started: string };

/** The Official After-Action Report from the console, for an incident command closes out. */
export function PostMortemForm({ incidents, officer, initialId }: { incidents: OpenIncident[]; officer: string; initialId?: string }) {
  const [incidentId, setIncidentId] = useState(initialId && incidents.some((i) => i.id === initialId) ? initialId : '');
  const picked = incidents.find((i) => i.id === incidentId) ?? null;
  const [answers, setAnswers] = useState<Record<string, string>>({
    start_time: picked ? saStamp(picked.started) : '', end_time: '', injuries: '0', fatalities: '0', displaced_people: '0',
    reporting_officer: officer,
  });
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const set = (k: string, v: string) => setAnswers((a) => ({ ...a, [k]: v }));
  const hours = durationHours(answers.start_time ?? '', answers.end_time ?? '');
  const field = 'mt-1 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';

  const choose = (id: string) => {
    setIncidentId(id);
    const inc = incidents.find((i) => i.id === id);
    if (inc) set('start_time', saStamp(inc.started));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const found = [...(incidentId ? [] : ['Choose the incident.']), ...validatePostMortem(answers)];
    setProblems(found);
    if (found.length) return;
    start(async () => {
      const res = await filePostMortemAction(incidentId, answers);
      if (res?.error) setProblems([res.error]);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {problems.length ? (
        <div role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">
          <ul className="list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      ) : null}

      <fieldset className="rounded-lg border border-border bg-bg-card p-5">
        <legend className="px-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Incident</legend>
        <label htmlFor="pm-incident" className="text-sm font-medium">Incident ID <span className="text-severity-critical-ink">*</span></label>
        <select id="pm-incident" value={incidentId} onChange={(e) => choose(e.target.value)} className={cn(field, 'h-10')}>
          <option value="">-- Select incident --</option>
          {incidents.map((i) => <option key={i.id} value={i.id}>{i.number} · {i.type} · {i.location}</option>)}
        </select>
        {picked ? <p className="mt-2 text-xs text-muted-foreground">Type: {picked.type} · Location: {picked.location}</p> : null}
      </fieldset>

      {POST_MORTEM_SECTIONS.map((s) => (
        <fieldset key={s.id} className="rounded-lg border border-border bg-bg-card p-5">
          <legend className="px-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{s.title}</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {s.fields.map((f) => (
              <div key={f.key} className={f.kind === 'multiline' ? 'sm:col-span-2 lg:col-span-3' : undefined}>
                <label htmlFor={`pm-${f.key}`} className="text-sm font-medium">
                  {f.label}{f.required ? <span className="text-severity-critical-ink"> *</span> : null}
                </label>
                {f.kind === 'multiline' ? (
                  <textarea id={`pm-${f.key}`} rows={3} value={answers[f.key] ?? ''} placeholder={f.placeholder}
                    onChange={(e) => set(f.key, e.target.value)} className={cn(field, 'py-2')} />
                ) : (
                  <input
                    id={`pm-${f.key}`} value={answers[f.key] ?? ''}
                    type={f.kind === 'count' ? 'number' : 'text'} min={f.kind === 'count' ? 0 : undefined}
                    placeholder={f.placeholder ?? (f.kind === 'datetime' ? 'YYYY-MM-DD HH:MM' : undefined)}
                    onChange={(e) => set(f.key, e.target.value)} className={cn(field, 'h-10')}
                  />
                )}
              </div>
            ))}
            {s.id === 'overview' && hours !== null ? <p className="self-end text-sm font-semibold">Duration: {hours} hours</p> : null}
          </div>
        </fieldset>
      ))}

      <button type="submit" disabled={pending} className="h-11 w-full rounded-md bg-primary text-sm font-semibold disabled:opacity-60">
        {pending ? 'Filing…' : 'File Official Report'}
      </button>
    </form>
  );
}
