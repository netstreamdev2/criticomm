'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle, FileText, Lock, Loader2, MessageCircleQuestion, PenLine, Plus, Search, Send, Trash2, X,
} from 'lucide-react';
import {
  DETAIL_FIELDS, QUESTION_PREFIX, YES_NO, injuryType, questionKind, searchInjuries,
  type DetailField, type IncidentDetails, type IncidentSeverity, type InjuryType,
} from '@criticom/db';
import type { IntakeSuggestion } from '@criticom/api';
import { PATIENT_SEVERITIES, type PatientSeverity } from '@criticom/db/call-facts';
import type { Translate } from '@criticom/db/i18n';
import { Modal } from '@/components/ui/modal';
import { CritiMascot } from '@/components/criti/mascot';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { CritiMark, DeptDots, aiStatus, fieldCls, labelCls, severityWord, type AiState } from './intake-ui';

const SEV_INK: Record<IncidentSeverity, string> = {
  Low: 'text-severity-low-ink',
  Medium: 'text-severity-medium-ink',
  High: 'text-severity-high-ink',
  Critical: 'text-severity-critical-ink',
};

export const HURT_COUNTS: Array<[string, string]> = [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5+']];

/** A value a call taker answered, as the reader reads it. */
const shown = (v: string | string[], t: Translate) => (Array.isArray(v) ? v.map((x) => t(x)).join(', ') : t(v));

function hurtText(victims: string, isPatient: boolean | null, t: Translate) {
  if (victims === '0') return t('No one hurt');
  const n = victims === '' ? null : victims === '5' ? t('5 or more') : victims;
  const who = isPatient === true ? t('the caller') : isPatient === false ? t('not the caller') : null;
  if (!n) return who ? t('Hurt: {who}', { who }) : null;
  return who ? t('{n} hurt, {who}', { n, who }) : t('{n} hurt', { n });
}

/**
 * The description on the form: a box that opens the full editor once the
 * incident type is chosen. Shows what has been written, the details and
 * injuries answered, and who is hurt.
 */
export function DescriptionBox({
  locked, description, byCriti, details, detailOrder, injuries, victims, isPatient, invalid, onOpen,
}: {
  /** No incident type yet: the description is built for the type, so it waits. */
  locked: boolean;
  description: string;
  byCriti: boolean;
  details: IncidentDetails;
  detailOrder: readonly string[];
  injuries: string[];
  victims: string;
  isPatient: boolean | null;
  invalid?: boolean;
  onOpen: () => void;
}) {
  const { t } = useT();
  const hurt = hurtText(victims, isPatient, t);
  // Each answer in the reader's language: the option, not a sentence built from it.
  const lines = [...detailOrder.filter((k) => k in details), ...Object.keys(details).filter((k) => !detailOrder.includes(k))]
    .map((k) => ({ key: k, label: k.startsWith(QUESTION_PREFIX) ? k.slice(QUESTION_PREFIX.length) : DETAIL_FIELDS[k]?.label, value: details[k] }))
    .filter((l): l is { key: string; label: string; value: string | string[] } => Boolean(l.label) && l.value !== undefined)
    .slice(0, 6);
  if (locked) {
    return (
      <div id="description" className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-bg-soft/60 px-3 py-3 text-sm text-muted-foreground">
        <Lock className="h-4 w-4 shrink-0" /> {t('Choose the incident type first.')}
      </div>
    );
  }
  return (
    <button
      type="button"
      id="description"
      onClick={onOpen}
      className={cn(
        'block w-full rounded-lg border bg-bg-soft px-3 py-2.5 text-left transition-colors hover:border-accent/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25',
        invalid ? 'border-severity-critical' : description ? 'border-border' : 'border-dashed border-border',
      )}
    >
      {description ? (
        <span className="line-clamp-3 whitespace-pre-line text-sm leading-relaxed">
          {byCriti ? <CritiMark className="mr-1.5 align-middle" /> : null}{description}
        </span>
      ) : (
        <span className="flex items-start gap-2 text-sm text-muted-foreground">
          <FileText className="mt-0.5 h-4 w-4 shrink-0" />
          {t('Click to add what happened, the details and who is hurt.')}
        </span>
      )}
      {lines.length || injuries.length || hurt ? (
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          {lines.map((l) => (
            <span key={l.key} className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-border bg-bg-card px-2 py-0.5 text-[11px]">
              <span className="text-muted-foreground">{t(l.label)}:</span> <span className="font-semibold">{shown(l.value, t)}</span>
            </span>
          ))}
          {injuries.map((n) => (
            <span key={n} className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-card px-2 py-0.5 text-[11px] font-semibold">
              <DeptDots departments={injuryType(n)?.departments ?? []} /> {t(n)}
            </span>
          ))}
          {hurt ? <span className="text-[11px] font-semibold text-muted-foreground">{hurt}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

/** One detail's answer: buttons for a choice or Yes / No / Not known, chips for a list, or a few words. */
export function DetailInput({ field, value, onChange }: {
  field: DetailField;
  value: string | string[] | undefined;
  onChange: (v: string | string[] | undefined) => void;
}) {
  const { t } = useT();
  const chip = (on: boolean) => cn(
    'rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
    on ? 'border-accent bg-accent/15 text-fg' : 'border-border bg-bg-soft text-muted-foreground hover:text-fg',
  );
  if (field.kind === 'text') {
    return (
      <input
        className={cn(fieldCls, 'h-9 text-xs')}
        value={typeof value === 'string' ? value : ''}
        maxLength={200}
        placeholder={field.placeholder ? t(field.placeholder) : ''}
        aria-label={t(field.label)}
        onChange={(e) => onChange(e.target.value.trim() ? e.target.value : undefined)}
      />
    );
  }
  if (field.kind === 'multi') {
    const list = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-wrap gap-1.5">
        {field.options.map((o) => {
          const on = list.includes(o.value);
          return (
            <button key={o.value} type="button" aria-pressed={on} className={chip(on)}
              onClick={() => {
                const next = on ? list.filter((x) => x !== o.value) : [...list, o.value];
                onChange(next.length ? next : undefined);
              }}>
              {t(o.value)}
            </button>
          );
        })}
      </div>
    );
  }
  const options = field.kind === 'yesno' ? [...YES_NO] : field.options.map((o) => o.value);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((v) => (
        <button key={v} type="button" aria-pressed={value === v} className={chip(value === v)}
          onClick={() => onChange(value === v ? undefined : v)}>
          {t(v)}
        </button>
      ))}
    </div>
  );
}

export type QuestionRow = { q: string; field: string | null };
/** A patient who is not the caller: their name and their own severity (0080). */
export type PatientRow = { name: string; severity: PatientSeverity | '' };

const PATIENT_ON: Record<Exclude<PatientSeverity, 'Unknown'>, string> = {
  Critical: 'bg-severity-critical', High: 'bg-severity-high', Medium: 'bg-severity-medium', Low: 'bg-severity-low',
};

/** Critical … Low, and Unknown: one patient's own severity, apart from the incident's. */
function PatientSeverityPicker({ value, onChange, label }: {
  value: PatientSeverity | ''; onChange: (s: PatientSeverity) => void; label: string;
}) {
  const { t } = useT();
  return (
    <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label={label}>
      {PATIENT_SEVERITIES.map((s) => (
        <button key={s} type="button" aria-pressed={value === s} onClick={() => onChange(s)}
          className={cn('h-9 rounded-lg border text-[11px] font-bold',
            value === s
              ? s === 'Unknown' ? 'border-fg/40 bg-muted text-fg' : `border-transparent text-white ${PATIENT_ON[s]}`
              : 'border-border bg-bg-soft text-muted-foreground hover:text-fg')}>
          {s === 'Unknown' ? t('Unknown') : severityWord(s, t)}
        </button>
      ))}
    </div>
  );
}

/**
 * EMS on the call: is the caller the patient, and how bad is each patient.
 * A patient's severity is their own: a burning building is Critical while
 * the person in it may have minor burns.
 */
function PatientSection({ isPatient, onPatient, byCriti, invalid, callerName, callerSeverity, onCallerSeverity, patients, onPatients }: {
  isPatient: boolean | null; onPatient: (v: boolean) => void; byCriti: boolean; invalid: boolean;
  callerName: string; callerSeverity: PatientSeverity | ''; onCallerSeverity: (s: PatientSeverity) => void;
  patients: PatientRow[]; onPatients: (list: PatientRow[]) => void;
}) {
  const { t } = useT();
  const set = (i: number, patch: Partial<PatientRow>) => onPatients(patients.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <section className={cn('space-y-3 rounded-xl border p-3', invalid ? 'border-severity-critical bg-severity-critical/5' : 'border-border bg-bg-soft/50')}>
      <div>
        <p className={labelCls}>{t('Is the caller the patient?')} <span className="text-severity-critical-ink" aria-hidden>*</span> {byCriti ? <CritiMark /> : null}</p>
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-required="true" aria-label={t('Is the caller the patient?')}>
          {([[t('Yes'), true], [t('No'), false]] as const).map(([txt, val]) => (
            <button key={txt} type="button" aria-pressed={isPatient === val} onClick={() => onPatient(val)}
              className={cn('h-10 rounded-lg border text-sm font-semibold',
                isPatient === val ? 'border-accent bg-accent/15 text-fg' : 'border-border bg-bg-soft text-muted-foreground hover:text-fg')}>
              {txt}
            </button>
          ))}
        </div>
        {invalid ? <p role="alert" className="mt-1.5 text-xs text-severity-critical-ink">{t('Say whether the caller is the patient.')}</p> : null}
      </div>

      {isPatient === true ? (
        <div>
          <p className="mb-1 text-xs font-semibold">
            {t('How bad is the caller?')} {callerName.trim() ? <span className="font-normal text-muted-foreground">· {callerName.trim()}</span> : null}
          </p>
          <PatientSeverityPicker value={callerSeverity} onChange={onCallerSeverity} label={t('How bad is the caller?')} />
        </div>
      ) : null}

      {isPatient === false ? (
        <div className="space-y-2.5">
          <p className="text-xs font-semibold">{t('Each patient and how bad they are')}</p>
          {patients.map((p, i) => (
            <div key={`patient-${i}`} className="space-y-1.5 rounded-lg border border-border bg-bg-card/60 p-2">
              <div className="flex gap-2">
                <input className={cn(fieldCls, 'h-9 text-sm')} maxLength={200}
                  placeholder={i === 0 ? t('Patient name, if known') : t('Another patient’s name, if known')}
                  aria-label={t('Patient name {n}', { n: i + 1 })} value={p.name} onChange={(e) => set(i, { name: e.target.value })} />
                {patients.length > 1 ? (
                  <button type="button" title={t('Remove patient')} aria-label={t('Remove patient {n}', { n: i + 1 })}
                    onClick={() => onPatients(patients.filter((_, j) => j !== i))}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-severity-critical/50 text-severity-critical-ink hover:bg-severity-critical/10">
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              <PatientSeverityPicker value={p.severity} onChange={(sev) => set(i, { severity: sev })} label={t('How bad is patient {n}?', { n: i + 1 })} />
            </div>
          ))}
          {patients.length < 20 ? (
            <button type="button" onClick={() => onPatients([...patients, { name: '', severity: '' }])}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline">
              <Plus className="h-3.5 w-3.5" /> {t('Add another patient')}
            </button>
          ) : null}
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground">{t('A patient’s severity is their own: the incident can be Critical while the patient has minor injuries.')}</p>
    </section>
  );
}

/**
 * The full description, built for the incident type: the sentence it starts
 * from, the caller's words, the questions to ask with their answers as
 * buttons, the type's other details, and the injuries and who is hurt when
 * someone may be. Criti reads the words and can write it up. Nothing here is
 * sent until the call is.
 */
export function DescriptionModal({
  typeName, questions, detailIds, details, detailsBy, onDetail,
  description, onDescription, byCriti, draft, onUseDraft, writeup,
  injuriesShown, injuryList, injuries, onInjuries, injuriesByCriti,
  victims, onVictims, victimsByCriti, isPatient, onPatient, patientByCriti,
  patientAsked, patientInvalid, callerName, callerSeverity, onCallerSeverity, patients, onPatients,
  ai, aiState, ask, sendNow, onClose,
}: {
  typeName: string;
  /** The type's questions, each tied to its detail where it has one. */
  questions: QuestionRow[];
  /** The type's details, in order. */
  detailIds: readonly string[];
  details: IncidentDetails;
  detailsBy: Readonly<Record<string, 'you' | 'criti'>>;
  onDetail: (id: string, v: string | string[] | undefined) => void;
  description: string;
  onDescription: (text: string) => void;
  byCriti: boolean;
  /** The type's sentence, filled in from the answers so far. */
  draft: string;
  onUseDraft: () => void;
  writeup: { busy: boolean; error: string | null; onWrite: () => void } | null;
  injuriesShown: boolean;
  injuryList: readonly InjuryType[];
  injuries: string[];
  onInjuries: (list: string[]) => void;
  injuriesByCriti: boolean;
  victims: string;
  onVictims: (v: string) => void;
  victimsByCriti: boolean;
  isPatient: boolean | null;
  onPatient: (v: boolean) => void;
  patientByCriti: boolean;
  /** EMS is on the call: whether the caller is the patient is asked, and each patient's severity. */
  patientAsked: boolean;
  /** Send was pressed without the answer. */
  patientInvalid: boolean;
  callerName: string;
  callerSeverity: PatientSeverity | '';
  onCallerSeverity: (s: PatientSeverity) => void;
  patients: PatientRow[];
  onPatients: (list: PatientRow[]) => void;
  ai: IntakeSuggestion | null;
  aiState: AiState;
  /** What else to ask (Criti's, and the injuries'), not tied to a detail. */
  ask: string[];
  /** Offered while the call may go to dispatch before it is complete. */
  sendNow: { busy: boolean; onSend: () => void } | null;
  onClose: () => void;
}) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const found = useMemo(() => searchInjuries(q, injuryList).filter((x) => !injuries.includes(x.name)), [q, injuryList, injuries]);
  const heard = (ai?.injuries ?? []).filter((n) => !injuries.includes(n));
  const danger = ai?.danger ?? [];
  const asked = new Set(questions.map((x) => x.field).filter(Boolean));
  const others = detailIds.filter((id) => !asked.has(id) && DETAIL_FIELDS[id]);

  const add = (name: string) => { onInjuries([...injuries, name]); setQ(''); };
  const remove = (name: string) => onInjuries(injuries.filter((n) => n !== name));
  const mark = (id: string) => (detailsBy[id] === 'criti' ? <CritiMark /> : null);

  return (
    <Modal
      title={t('Description: {type}', { type: t(typeName) })}
      onClose={onClose}
      large
      confirmClose={{ title: t('Close the description?'), body: t('What you entered stays on the form. Open it again to carry on.') }}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          {sendNow ? (
            <button type="button" onClick={sendNow.onSend} disabled={sendNow.busy}
              className="mr-auto inline-flex h-10 items-center gap-2 rounded-lg bg-severity-critical px-4 text-xs font-bold uppercase tracking-wider disabled:opacity-60">
              {sendNow.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t('Send to dispatch now')}
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="inline-flex h-10 items-center rounded-lg bg-accent px-5 text-sm font-bold">
            {t('Done')}
          </button>
        </div>
      )}
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* ── The sentence it starts from, the caller's words, and Criti ── */}
        <div className="space-y-3">
          {draft ? (
            <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs">
              <p className="flex items-center gap-1.5 font-semibold text-accent"><CritiMascot className="h-4 w-4" /> {t('Starts with')}</p>
              <p className="mt-1 text-sm text-fg">{draft}</p>
              {byCriti ? (
                <p className="mt-1 text-[11px] text-muted-foreground">{t('It is in the description, and follows your answers until you type.')}</p>
              ) : !description.includes(draft) ? (
                <button type="button" onClick={onUseDraft} className="mt-1 font-semibold text-accent hover:underline">{t('Add it to the description')}</button>
              ) : null}
            </div>
          ) : null}

          <div>
            <label htmlFor="descText" className={labelCls}>
              {t('What the caller says')} {byCriti ? <CritiMark /> : null}
            </label>
            <textarea
              id="descText"
              // biome-ignore lint/a11y/noAutofocus: the editor opens to be typed in
              autoFocus
              rows={9}
              maxLength={2000}
              className={cn(fieldCls, 'h-auto py-2.5 leading-relaxed')}
              placeholder={t('What happened, where, and who is hurt. Use the caller’s words where you can.')}
              value={description}
              onChange={(e) => onDescription(e.target.value)}
            />
            <p className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">{description.length}/2000</p>
          </div>

          {/* ── Criti reading ── */}
          <div className="rounded-lg border border-white/10 bg-slate-950/90 p-3 text-white">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/70">
              {aiState === 'reading' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" /> : <CritiMascot className="h-5 w-5" />}
              Criti
              <span className="font-normal normal-case tracking-normal text-white/60">· {aiStatus(aiState, t)}</span>
              {writeup ? (
                <button
                  type="button"
                  onClick={writeup.onWrite}
                  disabled={writeup.busy}
                  className="ml-auto inline-flex h-6 items-center gap-1 rounded bg-white/10 px-2 text-[11px] font-semibold normal-case tracking-normal hover:bg-white/20 disabled:opacity-60"
                >
                  {writeup.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <PenLine className="h-3 w-3" />} {t('Write it up')}
                </button>
              ) : null}
            </div>
            {writeup?.error ? <p className="mt-1.5 text-xs text-red-300">{writeup.error}</p> : null}
            {danger.length ? (
              <ul className="mt-2 space-y-1">
                {danger.map((d) => (
                  <li key={d} className="flex items-start gap-1.5 text-xs font-semibold text-red-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {d}
                  </li>
                ))}
              </ul>
            ) : null}
            {ask.length ? (
              <div className="mt-2">
                <p className="text-[11px] font-semibold text-white/60">{t('Also ask')}</p>
                <ul className="mt-1 space-y-1">
                  {ask.map((x) => (
                    <li key={x} className="flex items-start gap-1.5 text-xs">
                      <MessageCircleQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" /> {t(x)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Ask the caller, the details, the injuries and who is hurt ── */}
        <div className="space-y-4">
          {patientAsked ? (
            <PatientSection isPatient={isPatient} onPatient={onPatient} byCriti={patientByCriti} invalid={patientInvalid}
              callerName={callerName} callerSeverity={callerSeverity} onCallerSeverity={onCallerSeverity}
              patients={patients} onPatients={onPatients} />
          ) : null}
          {questions.length ? (
            <section className="space-y-2.5">
              <p className={labelCls}>{t('Ask the caller')}</p>
              {questions.map(({ q: question, field }) => {
                const f = field ? DETAIL_FIELDS[field] : null;
                return (
                  <div key={question}>
                    <p className="mb-1 flex items-center gap-1.5 text-sm font-medium">{t(question)} {field ? mark(field) : null}</p>
                    {f ? (
                      <DetailInput field={f} value={details[f.id]} onChange={(v) => onDetail(f.id, v)} />
                    ) : (
                      <DetailInput
                        field={questionKind(question) === 'yesno'
                          ? { id: question, label: question, kind: 'yesno', yes: '', no: '', clause: '' }
                          : { id: question, label: question, kind: 'text', clause: '', placeholder: t('The caller’s answer') }}
                        value={details[`${QUESTION_PREFIX}${question}`]}
                        onChange={(v) => onDetail(`${QUESTION_PREFIX}${question}`, v)}
                      />
                    )}
                  </div>
                );
              })}
            </section>
          ) : null}

          {others.length ? (
            <section className="space-y-2.5">
              <p className={labelCls}>{t('Details')}</p>
              {others.map((id) => {
                const f = DETAIL_FIELDS[id]!;
                return (
                  <div key={id}>
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">{t(f.label)} {mark(id)}</p>
                    <DetailInput field={f} value={details[id]} onChange={(v) => onDetail(id, v)} />
                  </div>
                );
              })}
            </section>
          ) : null}

          {!questions.length && !others.length && !injuriesShown ? (
            <p className="text-sm text-muted-foreground">{t('Nothing more to ask for this type. Write what the caller says.')}</p>
          ) : null}

          {injuriesShown ? (
            <>
              <section>
                <label htmlFor="injurySearch" className={labelCls}>
                  {t('Injuries')} {injuriesByCriti && injuries.length ? <CritiMark /> : null}
                </label>
                {injuries.length ? (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {injuries.map((n) => (
                      <button key={n} type="button" onClick={() => remove(n)} title={t('Remove')}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-soft px-2 py-1 text-xs font-semibold hover:border-severity-critical/60">
                        <DeptDots departments={injuryType(n)?.departments ?? []} /> {t(n)} <X className="h-3 w-3 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="injurySearch"
                    className={cn(fieldCls, 'h-10 pl-9')}
                    placeholder={t('Search injuries: gun, burn, bleeding…')}
                    autoComplete="off"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); const first = found[0]; if (q.trim() && first) add(first.name); }
                    }}
                  />
                </div>
                <ul className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-border">
                  {found.length === 0 ? (
                    <li className="px-3 py-2 text-xs text-muted-foreground">{q ? t('No injury matches “{query}”.', { query: q }) : t('All ticked.')}</li>
                  ) : found.map((x) => (
                    <li key={x.name}>
                      <button type="button" onClick={() => add(x.name)}
                        className="flex w-full items-center gap-2 border-b border-border/60 px-2.5 py-1.5 text-left text-sm last:border-0 hover:bg-muted">
                        <DeptDots departments={x.departments} className="w-7" />
                        <span className="min-w-0 flex-1 truncate">{t(x.name)}</span>
                        <span className={cn('shrink-0 text-[10px] font-bold', SEV_INK[x.severity])}>{severityWord(x.severity, t)}</span>
                        <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
                {heard.length ? (
                  <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="inline-flex items-center gap-1 font-semibold text-accent"><CritiMascot className="h-4 w-4" /> {t('Criti heard:')}</span>
                    {heard.map((n) => (
                      <button key={n} type="button" onClick={() => add(n)} className="rounded-full border border-accent/40 px-2 py-0.5 font-semibold text-accent hover:bg-accent/10">
                        + {t(n)}
                      </button>
                    ))}
                  </p>
                ) : null}
              </section>

              <fieldset>
                <legend className={labelCls}>{t('How many are hurt')} {victimsByCriti ? <CritiMark /> : null}</legend>
                <div className="grid grid-cols-6 gap-1.5">
                  {HURT_COUNTS.map(([v, l]) => (
                    <button key={v} type="button" aria-pressed={victims === v} onClick={() => onVictims(victims === v ? '' : v)}
                      className={cn('h-10 rounded-lg border text-sm font-bold tabular-nums',
                        victims === v ? 'border-accent bg-accent/15 text-fg' : 'border-border bg-bg-soft text-muted-foreground hover:text-fg')}>
                      {l}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          ) : null}
        </div>
      </div>

    </Modal>
  );
}

