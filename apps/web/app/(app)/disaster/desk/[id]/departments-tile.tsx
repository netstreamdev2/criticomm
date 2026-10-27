'use client';

import { useMemo, useState, useTransition } from 'react';
import { Check, ChevronRight, Landmark, Plus, X } from 'lucide-react';
import {
  DOC_REPRESENTATIVE, LINE_FUNCTIONS, departmentsFor, lineFunction, type DutyState, type ReportState,
} from '@criticom/db/disaster-departments';
import { Modal } from '@/components/ui/modal';
import { CallButton } from '@/components/disaster/call-button';
import { useT } from '@/components/i18n';
import { Fold } from '@/components/disaster/fold';
import { FieldProblem, problemBorder } from '@/components/disaster/field-problem';
import { anyProblem, checkCount, checkName, checkPhone, figureMax } from '@/lib/disaster-checks';
import { cn } from '@/lib/utils';
import { addDepartmentAction, removeDepartmentAction, saveDepartmentReportAction } from '../actions';

/**
 * The departments on the incident (0113): only those it needs, each with its
 * DOC representative and its role during disaster operations in the Plan's
 * words. A department's form opens as a short wizard; the list shows how far
 * each has got.
 */

export type BoardLineReport = {
  department: string; status: ReportState; representativeName: string | null; representativePost: string | null;
  representativePhone: string | null; atDoc: boolean; duties: Record<string, DutyState>; figures: Record<string, number>; notes: string | null;
};
export type BoardContact = { id: string; department: string; name: string; post: string | null; phone: string | null; docRep: boolean };

const STATE_TONE: Record<ReportState, string> = {
  'Not started': 'bg-muted text-muted-foreground',
  'In progress': 'bg-severity-medium/15 text-severity-medium-ink',
  Done: 'bg-severity-low/15 text-severity-low-ink',
};

export function DepartmentsTile({ incidentId, hazard, reports, contacts, live, onError }: {
  incidentId: string; hazard: string | null; reports: BoardLineReport[]; contacts: BoardContact[]; live: boolean; onError: (e: string) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [other, setOther] = useState('');
  const on = new Set(reports.map((r) => r.department));
  const suggested = departmentsFor(hazard).filter((k) => !on.has(k));
  const done = reports.filter((r) => r.status === 'Done').length;
  const add = (key: string) => start(async () => {
    const res = await addDepartmentAction(incidentId, key);
    if ('error' in res) onError(res.error);
  });
  const remove = (key: string) => start(async () => {
    const res = await removeDepartmentAction(incidentId, key);
    if ('error' in res) onError(res.error);
  });
  const current = open ? reports.find((r) => r.department === open) ?? null : null;

  return (
    <Fold id="board.departments" icon={Landmark} title={t('Departments on this incident')} defaultOpen={false}
      summary={t('{done} of {all} reports done', { done, all: reports.length })}
      info={t('The City departments working on this incident. Each one has a form for its representative, its duties and its figures.')}
      actions={<span className="text-sm text-muted-foreground">{t('{done} of {all} reports done', { done, all: reports.length })}</span>}>
      <div className="space-y-4 p-5">
        {reports.length === 0 ? <p className="text-sm text-muted-foreground">{t('No department on this incident yet.')}</p> : null}
        <ul className="grid gap-3 md:grid-cols-2">
          {reports.map((r) => {
            const d = lineFunction(r.department);
            const roles = d?.roles.length ?? 0;
            const marked = Object.keys(r.duties).length;
            return (
              <li key={r.department} className="flex flex-col gap-2 rounded-lg border border-border bg-bg-soft p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold leading-tight">{d?.name ?? r.department}</p>
                    <p className="text-sm text-muted-foreground">{r.representativeName ? `${r.representativeName}${r.representativePost ? `, ${r.representativePost}` : ''}` : t('No representative yet')}</p>
                  </div>
                  <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold', STATE_TONE[r.status])}>{t(r.status)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-accent" style={{ width: `${roles ? Math.round((marked / roles) * 100) : 0}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">{t('{n} of {all} duties marked', { n: marked, all: roles })}{r.atDoc ? ` · ${t('at the JOC')}` : ''}</p>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                  {live ? (
                    <button type="button" onClick={() => setOpen(r.department)}
                      className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
                      {r.status === 'Not started' ? t('Start the form') : t('Open the form')}<ChevronRight className="h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                  <CallButton number={r.representativePhone} size="sm" />
                  {live && r.status === 'Not started' ? (
                    <button type="button" onClick={() => remove(r.department)} disabled={pending} aria-label={t('Take off this incident')}
                      className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" aria-hidden /></button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {live ? (
          <div className="space-y-2 border-t border-border pt-4">
            {suggested.length ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Usually needed for this hazard')}</p>
                <div className="flex flex-wrap gap-2">
                  {suggested.map((k) => (
                    <button key={k} type="button" onClick={() => add(k)} disabled={pending}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-semibold hover:bg-muted">
                      <Plus className="h-3.5 w-3.5" aria-hidden />{lineFunction(k)?.name}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <div className="flex gap-2">
              <select value={other} onChange={(e) => setOther(e.target.value)} aria-label={t('Another department')}
                className="h-10 min-w-0 flex-1 rounded-md border border-border bg-bg-soft px-3 text-sm">
                <option value="">{t('Another department…')}</option>
                {LINE_FUNCTIONS.filter((d) => !on.has(d.key)).map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
              </select>
              <button type="button" onClick={() => { if (other) { add(other); setOther(''); } }} disabled={!other || pending}
                className="h-10 rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50">{t('Add')}</button>
            </div>
          </div>
        ) : null}
      </div>
      {current ? (
        <DepartmentWizard key={current.department} incidentId={incidentId} report={current}
          contacts={contacts.filter((c) => c.department === current.department)} onClose={() => setOpen(null)} onError={onError} />
      ) : null}
    </Fold>
  );
}

const STEPS = ['Representative', 'Duties', 'Figures and notes', 'Review'] as const;
const DUTY_TONE: Record<DutyState, string> = {
  Done: 'border-severity-low bg-severity-low/15 text-severity-low-ink',
  'Under way': 'border-severity-medium bg-severity-medium/15 text-severity-medium-ink',
  'Not needed': 'border-border bg-muted text-muted-foreground',
};

function DepartmentWizard({ incidentId, report, contacts, onClose, onError }: {
  incidentId: string; report: BoardLineReport; contacts: BoardContact[]; onClose: () => void; onError: (e: string) => void;
}) {
  const { t } = useT();
  const d = lineFunction(report.department)!;
  const [step, setStep] = useState(0);
  const [rep, setRep] = useState({ name: report.representativeName ?? '', post: report.representativePost ?? '', phone: report.representativePhone ?? '' });
  const [atDoc, setAtDoc] = useState(report.atDoc);
  const [duties, setDuties] = useState<Record<string, DutyState>>(report.duties);
  const [figures, setFigures] = useState<Record<string, string>>(Object.fromEntries(Object.entries(report.figures).map(([k, v]) => [k, String(v)])));
  const [notes, setNotes] = useState(report.notes ?? '');
  const [done, setDone] = useState(report.status === 'Done');
  const [pending, start] = useTransition();
  const dirty = useMemo(() => JSON.stringify([rep, atDoc, duties, figures, notes, done]) !== JSON.stringify([
    { name: report.representativeName ?? '', post: report.representativePost ?? '', phone: report.representativePhone ?? '' }, report.atDoc, report.duties,
    Object.fromEntries(Object.entries(report.figures).map(([k, v]) => [k, String(v)])), report.notes ?? '', report.status === 'Done']),
  [rep, atDoc, duties, figures, notes, done, report]);
  const save = (close: boolean) => start(async () => {
    const res = await saveDepartmentReportAction(incidentId, report.department, {
      representative_name: rep.name, representative_post: rep.post, representative_phone: rep.phone, at_doc: atDoc,
      duties, figures, notes, done,
    });
    if ('error' in res) { onError(res.error); return; }
    if (close) onClose();
  });
  const marked = Object.keys(duties).length;
  // What is wrong, by step: Save waits until it is put right; the step shows where.
  const bad = { name: checkName(rep.name), phone: checkPhone(rep.phone) };
  const badFigure = Object.fromEntries(d.figures.map((x) => [x.key, checkCount(figures[x.key], figureMax(x.key))]));
  const stepBad = [anyProblem(bad.name, bad.phone), false, anyProblem(...Object.values(badFigure)), false];
  const blocked = stepBad.some(Boolean);
  const field = 'mt-1 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-[15px]';

  return (
    <Modal title={d.name} onClose={onClose} busy={pending} large
      confirmClose={dirty ? { title: t('Close without saving?'), body: t('What you changed on this form is not saved yet.') } : null}
      footer={(
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0 || pending}
            className="h-11 rounded-md border border-border px-5 text-sm hover:bg-muted disabled:opacity-40">{t('Back')}</button>
          <div className="flex gap-2">
            <button type="button" onClick={() => save(true)} disabled={pending || !dirty || blocked}
              className="h-11 rounded-md border border-border px-5 text-sm font-semibold hover:bg-muted disabled:opacity-40">{t('Save and close')}</button>
            {step < STEPS.length - 1 ? (
              <button type="button" onClick={() => setStep(step + 1)} className="h-11 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground">{t('Next')}</button>
            ) : (
              <button type="button" onClick={() => save(true)} disabled={pending || blocked}
                className="h-11 rounded-md bg-severity-low px-6 text-sm font-semibold text-severity-low-fg disabled:opacity-60">{pending ? t('Saving…') : t('Save')}</button>
            )}
          </div>
        </div>
      )}>
      <ol className="mb-5 grid grid-cols-4 gap-2" aria-label={t('Steps')}>
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" onClick={() => setStep(i)} aria-current={step === i ? 'step' : undefined}
              className={cn('flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm',
                step === i ? 'border-accent bg-accent/10 font-semibold text-accent' : 'border-border text-muted-foreground hover:bg-muted',
                stepBad[i] && 'border-severity-critical text-severity-critical-ink')}>
              <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold',
                stepBad[i] ? 'bg-severity-critical text-white' : i < step ? 'bg-severity-low text-severity-low-fg' : 'bg-muted')}>
                {stepBad[i] ? '!' : i < step ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
              </span>
              <span className="truncate">{t(s)}</span>
            </button>
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('Responsible: {head}. {duty}.', { head: d.head, duty: DOC_REPRESENTATIVE })}</p>
          {contacts.length ? (
            <div>
              <p className="text-sm font-medium">{t('Choose from the department’s contacts')}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {contacts.map((c) => (
                  <button key={c.id} type="button" onClick={() => setRep({ name: c.name, post: c.post ?? '', phone: c.phone ?? '' })}
                    aria-pressed={rep.name === c.name}
                    className={cn('rounded-lg border px-3 py-2 text-left text-sm', rep.name === c.name ? 'border-accent bg-accent/10' : 'border-border hover:bg-muted')}>
                    <span className="block font-semibold">{c.name}{c.docRep ? <span className="ml-2 text-xs text-accent">{t('JOC representative')}</span> : null}</span>
                    <span className="block text-xs text-muted-foreground">{[c.post, c.phone].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : <p className="text-sm text-muted-foreground">{t('No contacts kept for this department yet. Type them below; add them under Departments to fill in next time.')}</p>}
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block text-sm font-medium">{t('Name')}<input value={rep.name} onChange={(e) => setRep({ ...rep, name: e.target.value })} maxLength={160} className={cn(field, problemBorder(bad.name))} /><FieldProblem problem={bad.name} /></label>
            <label className="block text-sm font-medium">{t('Post')}<input value={rep.post} onChange={(e) => setRep({ ...rep, post: e.target.value })} maxLength={120} placeholder={d.head} className={field} /></label>
            <label className="block text-sm font-medium">{t('Phone')}<input value={rep.phone} onChange={(e) => setRep({ ...rep, phone: e.target.value })} maxLength={60} inputMode="tel" placeholder="082 123 4567" className={cn(field, problemBorder(bad.phone))} /><FieldProblem problem={bad.phone} /></label>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={atDoc} onChange={(e) => setAtDoc(e.target.checked)} className="h-5 w-5" />{t('At the JOC')}</label>
            <CallButton number={rep.phone} label={rep.phone ? t('Call {n}', { n: rep.phone }) : undefined} />
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <ol className="space-y-3">
          {d.roles.map((role, i) => {
            const state = duties[String(i)];
            return (
              <li key={role} className="rounded-lg border border-border bg-bg-soft p-4">
                <p className="text-[15px]">{role}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(['Done', 'Under way', 'Not needed'] as const).map((s) => (
                    <button key={s} type="button" aria-pressed={state === s}
                      onClick={() => setDuties((cur) => {
                        const next = { ...cur };
                        if (next[String(i)] === s) delete next[String(i)]; else next[String(i)] = s;
                        return next;
                      })}
                      className={cn('h-9 rounded-md border px-4 text-sm font-semibold', state === s ? DUTY_TONE[s] : 'border-border text-muted-foreground hover:bg-muted')}>
                      {t(s)}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          {d.figures.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {d.figures.map((x) => (
                <label key={x.key} className="block text-sm font-medium">{t(x.label)}
                  <input value={figures[x.key] ?? ''} onChange={(e) => setFigures({ ...figures, [x.key]: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                    inputMode="numeric" className={cn(field, problemBorder(badFigure[x.key] ?? null))} />
                  <FieldProblem problem={badFigure[x.key] ?? null} />
                </label>
              ))}
            </div>
          ) : null}
          <label className="block text-sm font-medium">{t('Notes')}
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} maxLength={2000}
              placeholder={t('What the department has done, what it still needs, anything for the post-mortem')}
              className="mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-[15px]" />
          </label>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted-foreground">{t('Representative')}</dt><dd className="font-semibold">{rep.name || '—'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t('Duties marked')}</dt><dd className="font-semibold">{t('{n} of {all}', { n: marked, all: d.roles.length })}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t('At the JOC')}</dt><dd className="font-semibold">{atDoc ? t('Yes') : t('No')}</dd></div>
          </dl>
          <ul className="space-y-1 text-sm">
            {d.roles.map((role, i) => (
              <li key={role} className="flex gap-3"><span className={cn('w-24 shrink-0 font-semibold', duties[String(i)] ? '' : 'text-muted-foreground')}>{duties[String(i)] ? t(duties[String(i)]!) : t('Not marked')}</span><span className="text-muted-foreground">{role}</span></li>
            ))}
          </ul>
          {blocked ? (
            <p role="alert" className="rounded-lg border border-severity-critical bg-bg-soft px-4 py-3 text-sm font-medium text-severity-critical-ink">
              {t('Something on step {n} needs fixing before this can be saved.', { n: stepBad.findIndex(Boolean) + 1 })}
            </p>
          ) : null}
          <label className="flex items-center gap-3 rounded-lg border border-border bg-bg-soft p-4 text-[15px] font-semibold">
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} className="h-5 w-5" />
            {t('This department’s report is done')}
          </label>
        </div>
      ) : null}
    </Modal>
  );
}
