'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, CheckCircle2, Loader2, Lock, MapPin, Plus, Radio, UserRound } from 'lucide-react';
import type { Silo } from '@criticom/db';
import { cn } from '@/lib/utils';
import { deskFormsFor, type DeskForm } from '@/lib/radio-forms';
import { answered, FormIcon, FormWizard, onTone } from '@/components/form-wizard';
import { closeFromDeskAction, fileRadioReportAction, markPartAction } from './actions';
import { useT } from '@/components/i18n';

type CrewMember = { id: string; name: string; badge: string | null; onDuty: boolean };

const ON_SCENE = ['Arrived', 'On Scene', 'Transporting'];
const draftKey = (incidentId: string, silo: string) => `hiktech.radio-draft.${incidentId}.${silo}`;

/**
 * The desk's filing page, laid out like the crew's phone: who radioed it in,
 * where the crew is, the report every department needs, then (police) the
 * optional DMPS forms as coloured tiles. Each opens as a step-by-step wizard;
 * Done ticks it. The draft is kept in this browser until filed.
 */
export function RadioReport({ incidentId, incidentNumber, silo, departmentName, part, crew }: {
  incidentId: string;
  incidentNumber: string;
  silo: Silo;
  departmentName: string;
  part: { status: string; leadId: string | null; leadName: string | null; reportFiledAt: string | null; closedAt: string | null };
  crew: CrewMember[];
}) {
  const { t } = useT();
  const router = useRouter();
  // Stable per department: the draft loader below depends on it.
  const set = useMemo(() => deskFormsFor(silo)!, [silo]);
  const [officerId, setOfficerId] = useState(part.leadId ?? '');
  const [filter, setFilter] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [forms, setForms] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState(Boolean(part.reportFiledAt));
  const [closed, setClosed] = useState(Boolean(part.closedAt));
  const [pending, start] = useTransition();
  const [loaded, setLoaded] = useState(false);

  // The draft, kept in this browser so a long radio call survives a reload.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey(incidentId, silo));
      if (raw) {
        const d = JSON.parse(raw) as { answers?: Record<string, string>; forms?: string[]; officerId?: string };
        setAnswers(d.answers ?? {});
        setForms((d.forms ?? []).filter((f) => set.optional.some((o) => o.id === f)));
        if (!part.leadId && d.officerId) setOfficerId(d.officerId);
      }
    } catch { /* no draft */ }
    setLoaded(true);
  }, [incidentId, silo, part.leadId, set.optional]);
  useEffect(() => {
    if (!loaded || filed) return;
    try { window.localStorage.setItem(draftKey(incidentId, silo), JSON.stringify({ answers, forms, officerId })); } catch { /* full */ }
  }, [loaded, filed, incidentId, silo, answers, forms, officerId]);

  const officer = crew.find((c) => c.id === officerId) ?? null;
  const officerName = officer?.name ?? part.leadName ?? null;
  const onScene = ON_SCENE.includes(part.status);
  const requiredDone = set.required.problems(answers).length === 0;
  const all: DeskForm[] = [set.required, ...set.optional];
  const openForm = all.find((f) => f.id === open) ?? null;
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? crew.filter((c) => c.name.toLowerCase().includes(q) || (c.badge ?? '').toLowerCase().includes(q)) : crew;
  }, [crew, filter]);

  const setAnswer = (key: string, value: string) => setAnswers((a) => ({ ...a, [key]: value }));
  const markDone = (id: string) => {
    if (id !== set.required.id) setForms((cur) => set.optional.map((f) => f.id).filter((f) => f === id || cur.includes(f)));
    setOpen(null);
  };
  const removeForm = (form: DeskForm) => {
    if (!window.confirm(`Remove ${form.code} ${form.title}? Its answers are cleared.`)) return;
    setForms((cur) => cur.filter((f) => f !== form.id));
    setAnswers((a) => Object.fromEntries(Object.entries(a).filter(([k]) => !k.startsWith(`${form.id}_`) && !k.startsWith(`rows_${form.id}_`))));
    setOpen(null);
  };

  const mark = (status: string) => start(async () => {
    setError(null);
    const res = await markPartAction({ incidentId, silo, status });
    if (!res.ok) setError(res.error);
    router.refresh();
  });

  const file = () => {
    setError(null);
    if (!officerId) { setError('Choose who radioed it in.'); return; }
    if (!requiredDone) { setOpen(set.required.id); return; }
    if (!window.confirm(`File the ${departmentName} report on ${incidentNumber} as radioed in by ${officerName ?? 'the crew'}?\n\nIt becomes a permanent record, in their name, filed from your desk.`)) return;
    start(async () => {
      const res = await fileRadioReportAction({ incidentId, silo, officerId, forms, answers });
      if (!res.ok) { setError(res.error); return; }
      try { window.localStorage.removeItem(draftKey(incidentId, silo)); } catch { /* ignore */ }
      setFiled(true);
      router.refresh();
    });
  };

  const close = () => start(async () => {
    setError(null);
    const res = await closeFromDeskAction({ incidentId, silo });
    if (!res.ok) { setError(res.error); return; }
    setClosed(true);
    router.refresh();
  });

  if (filed) {
    return (
      <section className="space-y-4 rounded-2xl border border-severity-low/40 bg-severity-low/10 p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-severity-low-ink" aria-hidden />
        <div>
          <h2 className="text-lg font-bold">{t('{departmentName} report filed', { departmentName })}</h2>
          <p className="text-sm text-muted-foreground">
            {t('{value}filed from your desk. Dispatch and command have been told.', { value: officerName ? `In ${officerName}'s name, ` : '' })}</p>
        </div>
        {error ? <p role="alert" className="text-sm font-semibold text-severity-critical-ink">{error}</p> : null}
        <div className="flex flex-wrap justify-center gap-3">
          {closed ? (
            <span className="inline-flex h-11 items-center gap-2 rounded-lg border border-severity-low/40 px-4 text-sm font-bold text-severity-low-ink">
              <Lock className="h-4 w-4" /> {' '}{t('Closed on scene')}</span>
          ) : (
            <button type="button" onClick={close} disabled={pending}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-severity-low px-5 text-sm font-bold text-white disabled:opacity-60">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {' '}{t('Close {departmentName} on scene', { departmentName })}</button>
          )}
          <Link href={`/incidents/${incidentId}`} className="inline-flex h-11 items-center rounded-lg border border-border px-5 text-sm font-semibold hover:bg-muted">
            {t('Back to the incident')}</Link>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">{error}</div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 1. Who radioed it in */}
        <section className="rounded-xl border border-border bg-bg-card p-4">
          <h2 className="flex items-center gap-2 font-semibold"><UserRound className="h-4 w-4 text-accent" /> {' '}{t('Who radioed it in?')}</h2>
          {part.leadId ? (
            <p className="mt-2 text-sm">
              <span className="font-semibold">{part.leadName ?? 'The lead'}</span>
              <span className="text-muted-foreground"> {' '}{t('leads {departmentName} on this call. The report is filed in their name.', { departmentName })}</span>
            </p>
          ) : (
            <>
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('Search name or force number')}
                className="mt-2 h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm"
                aria-label={t('Search the crew')}
              />
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto" aria-label={`${departmentName} crew`}>
                {shown.map((c) => {
                  const on = c.id === officerId;
                  return (
                    <li key={c.id}>
                      <button type="button" onClick={() => setOfficerId(c.id)} aria-pressed={on}
                        className={cn('flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm',
                          on ? 'border-accent bg-accent/10 font-semibold' : 'border-transparent hover:bg-muted')}>
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', c.onDuty ? 'bg-severity-low' : 'bg-muted-foreground/40')} aria-hidden />
                        <span className="flex-1 truncate">{c.name}</span>
                        {c.badge ? <span className="font-mono text-xs text-muted-foreground">#{c.badge}</span> : null}
                        {on ? <Check className="h-4 w-4 text-accent" /> : null}
                      </button>
                    </li>
                  );
                })}
                {shown.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">{t('Nobody matches.')}</li> : null}
              </ul>
            </>
          )}
        </section>

        {/* 2. Where the crew is */}
        <section className="rounded-xl border border-border bg-bg-card p-4">
          <h2 className="flex items-center gap-2 font-semibold"><MapPin className="h-4 w-4 text-accent" /> {' '}{t('Where the crew is')}</h2>
          <p className="mt-2 text-sm">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold',
              onScene ? 'border-severity-low/40 bg-severity-low/10 text-severity-low-ink' : 'border-severity-medium/40 bg-severity-medium/10 text-severity-medium-ink')}>
              <Radio className="h-3 w-3" /> {part.status}
            </span>
          </p>
          {!onScene ? (
            <>
              <p className="mt-2 text-sm text-muted-foreground">{t('Mark the crew as they radio it in. The report is filed once they are on scene.')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {['En Route', 'On Scene'].map((s) => (
                  <button key={s} type="button" onClick={() => mark(s)} disabled={pending}
                    className={cn('h-9 rounded-md px-3 text-sm font-semibold disabled:opacity-60',
                      s === 'On Scene' ? 'bg-accent text-white' : 'border border-border hover:bg-muted')}>
                    {t('Mark {s}', { s })}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t('On scene. Fill the report as the crew tells you.')}</p>
          )}
        </section>
      </div>

      {/* 3. The report every department files */}
      <ReportCard form={set.required} answers={answers} done={requiredDone} required onOpen={() => setOpen(set.required.id)} />

      {/* 4. Police: the DMPS forms, optional */}
      {set.optional.length ? (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('DMPS forms · optional')}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {set.optional.map((f) => (
              <FormTile key={f.id} form={f} answers={answers} done={forms.includes(f.id)} onOpen={() => setOpen(f.id)} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-bg-soft p-4">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {t('Filing:')}{' '}<span className="font-semibold text-fg">{[set.required.title, ...set.optional.filter((f) => forms.includes(f.id)).map((f) => f.code)].join(' · ')}</span>
          {officerName ? <> {' '}{t('· as radioed in by')}{' '}<span className="font-semibold text-fg">{officerName}</span></> : null}
        </p>
        <button type="button" onClick={file} disabled={pending || !onScene || !officerId}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-severity-low px-6 text-sm font-bold text-white disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} {' '}{t('File report')}</button>
      </div>

      {openForm ? (
        <FormWizard
          form={openForm}
          answers={answers}
          set={setAnswer}
          onDone={() => markDone(openForm.id)}
          onClose={() => setOpen(null)}
          onRemove={openForm.optional && forms.includes(openForm.id) ? () => removeForm(openForm) : undefined}
        />
      ) : null}
    </div>
  );
}

function ReportCard({ form, answers, done, required, onOpen }: {
  form: DeskForm; answers: Record<string, string>; done: boolean; required?: boolean; onOpen: () => void;
}) {
  const { t } = useT();
  const { done: n, total } = answered(form, answers);
  return (
    <button type="button" onClick={onOpen}
      className="flex w-full items-center gap-4 rounded-xl border-2 p-4 text-left transition-colors hover:brightness-110"
      style={{ borderColor: done ? '#10b98199' : `${form.tone}88`, backgroundColor: done ? '#10b9811a' : `${form.tone}14` }}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: form.tone }}>
        <FormIcon name={form.icon} className="h-5 w-5" style={{ color: onTone(form.tone) }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold">{form.title}</span>
        <span className="block text-sm text-muted-foreground">{done ? 'Ready' : `${n} of ${total} answered · tap to fill`}</span>
      </span>
      {done ? (
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-severity-low text-white"><Check className="h-4 w-4" /></span>
      ) : required ? (
        <span className="rounded-full px-2.5 py-1 text-[10px] font-black tracking-wider" style={{ backgroundColor: form.tone, color: onTone(form.tone) }}>{t('REQUIRED')}</span>
      ) : null}
    </button>
  );
}

function FormTile({ form, answers, done, onOpen }: { form: DeskForm; answers: Record<string, string>; done: boolean; onOpen: () => void }) {
  const { done: n } = answered(form, answers);
  const ink = onTone(form.tone);
  return (
    <button type="button" onClick={onOpen} aria-pressed={done}
      className="relative overflow-hidden rounded-xl border-2 p-4 pl-5 text-left transition-transform hover:-translate-y-0.5"
      style={{ borderColor: done ? form.tone : `${form.tone}55`, backgroundColor: done ? `${form.tone}2e` : `${form.tone}10` }}>
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: form.tone }} aria-hidden />
      <span className="flex items-center justify-between">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: done ? form.tone : `${form.tone}33` }}>
          <FormIcon name={form.icon} className="h-4 w-4" style={{ color: done ? ink : form.tone }} />
        </span>
        {done ? (
          <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: form.tone, color: ink }}><Check className="h-3.5 w-3.5" /></span>
        ) : (
          <Plus className="h-5 w-5" style={{ color: form.tone }} aria-hidden />
        )}
      </span>
      <span className="mt-2 block font-mono text-xs font-black tracking-widest" style={{ color: form.tone }}>{form.code}</span>
      <span className="block text-sm font-bold">{form.title}</span>
      <span className="mt-1 block text-xs text-muted-foreground">{done ? 'Done' : n ? `${n} answered · not done` : 'Click to fill'}</span>
    </button>
  );
}
