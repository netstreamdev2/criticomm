'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, FileText, Loader2, MessageCircleQuestion, Plus, Search, Send, Sparkles, X } from 'lucide-react';
import { injuryType, searchInjuries, type IncidentSeverity } from '@criticom/db';
import type { IntakeSuggestion } from '@criticom/api';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
import { AI_STATUS, CritiMark, DeptDots, fieldCls, labelCls, type AiState } from './intake-ui';

const SEV_INK: Record<IncidentSeverity, string> = {
  Low: 'text-severity-low-ink',
  Medium: 'text-severity-medium-ink',
  High: 'text-severity-high-ink',
  Critical: 'text-severity-critical-ink',
};

export const HURT_COUNTS: Array<[string, string]> = [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5+']];

const hurtText = (victims: string, isPatient: boolean | null) => {
  if (victims === '0') return 'No one hurt';
  const n = victims === '' ? null : victims === '5' ? '5 or more' : victims;
  const who = isPatient === true ? 'the caller' : isPatient === false ? 'not the caller' : null;
  if (!n) return who ? `Hurt: ${who}` : null;
  return `${n} hurt${who ? `, ${who}` : ''}`;
};

/**
 * The description on the form: a box that opens the full editor. Shows what
 * has been written, the injuries and who is hurt; Criti's draft until then.
 */
export function DescriptionBox({
  description, byCriti, draft, injuries, victims, isPatient, invalid, onOpen,
}: {
  description: string;
  byCriti: boolean;
  draft: string;
  injuries: string[];
  victims: string;
  isPatient: boolean | null;
  invalid?: boolean;
  onOpen: () => void;
}) {
  const hurt = hurtText(victims, isPatient);
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
          <span>
            Click to add what happened and who is hurt.
            {draft ? <span className="mt-0.5 block text-xs"><Sparkles className="mr-1 inline h-3 w-3 text-accent" />Criti will start it: “{draft}”</span> : null}
          </span>
        </span>
      )}
      {injuries.length || hurt ? (
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          {injuries.map((n) => (
            <span key={n} className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-card px-2 py-0.5 text-[11px] font-semibold">
              <DeptDots departments={injuryType(n)?.departments ?? []} /> {n}
            </span>
          ))}
          {hurt ? <span className="text-[11px] font-semibold text-muted-foreground">{hurt}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The full description: the caller's words, the injuries (search and tick),
 * who is hurt and how many. Criti starts the text from the ticks, reads what
 * is typed and says what to ask next. Nothing here is sent until the call is.
 */
export function DescriptionModal({
  description, onDescription, byCriti, draft, onUseDraft,
  injuries, onInjuries, injuriesByCriti,
  victims, onVictims, victimsByCriti,
  isPatient, onPatient, patientByCriti,
  ai, aiState, ask, sendNow, onClose,
}: {
  description: string;
  onDescription: (text: string) => void;
  byCriti: boolean;
  draft: string;
  onUseDraft: () => void;
  injuries: string[];
  onInjuries: (list: string[]) => void;
  injuriesByCriti: boolean;
  victims: string;
  onVictims: (v: string) => void;
  victimsByCriti: boolean;
  isPatient: boolean | null;
  onPatient: (v: boolean | null) => void;
  patientByCriti: boolean;
  ai: IntakeSuggestion | null;
  aiState: AiState;
  ask: string[];
  /** Offered while the call may go to dispatch before it is complete. */
  sendNow: { busy: boolean; onSend: () => void } | null;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const found = useMemo(() => searchInjuries(q).filter((x) => !injuries.includes(x.name)), [q, injuries]);
  const heard = (ai?.injuries ?? []).filter((n) => !injuries.includes(n));
  const danger = ai?.danger ?? [];

  const add = (name: string) => { onInjuries([...injuries, name]); setQ(''); };
  const remove = (name: string) => onInjuries(injuries.filter((n) => n !== name));

  return (
    <Modal title="Description" onClose={onClose} large>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* ── The caller's words ── */}
        <div className="space-y-3">
          <div>
            <label htmlFor="descText" className={labelCls}>
              What the caller says {byCriti ? <CritiMark /> : null}
            </label>
            <textarea
              id="descText"
              // biome-ignore lint/a11y/noAutofocus: the editor opens to be typed in
              autoFocus
              rows={11}
              maxLength={2000}
              className={cn(fieldCls, 'h-auto py-2.5 leading-relaxed')}
              placeholder="What happened, where, and who is hurt. Use the caller's words where you can."
              value={description}
              onChange={(e) => onDescription(e.target.value)}
            />
            <p className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>{byCriti ? 'Started by Criti from what you ticked. Type to change it.' : ' '}</span>
              <span className="tabular-nums">{description.length}/2000</span>
            </p>
          </div>

          {draft && !byCriti && !description.includes(draft) ? (
            <div className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              <p className="min-w-0 flex-1"><span className="font-semibold">Criti draft:</span> {draft}</p>
              <button type="button" onClick={onUseDraft} className="shrink-0 font-semibold text-accent hover:underline">Add it</button>
            </div>
          ) : null}

          {/* ── Criti reading ── */}
          <div className="rounded-lg border border-white/10 bg-slate-950/90 p-3 text-white">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/70">
              {aiState === 'reading' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" /> : <Sparkles className="h-3.5 w-3.5 text-sky-400" />}
              Criti
              <span className="font-normal normal-case tracking-normal text-white/60">· {AI_STATUS[aiState]}</span>
            </p>
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
                <p className="text-[11px] font-semibold text-white/60">Ask the caller</p>
                <ul className="mt-1 space-y-1">
                  {ask.map((x) => (
                    <li key={x} className="flex items-start gap-1.5 text-xs">
                      <MessageCircleQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" /> {x}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-2 text-xs text-white/60">Choose the incident type or tick an injury to see what to ask.</p>
            )}
          </div>
        </div>

        {/* ── Injuries and who is hurt ── */}
        <div className="space-y-4">
          <div>
            <label htmlFor="injurySearch" className={labelCls}>
              Injuries {injuriesByCriti && injuries.length ? <CritiMark /> : null}
            </label>
            {injuries.length ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {injuries.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => remove(n)}
                    title="Remove"
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-soft px-2 py-1 text-xs font-semibold hover:border-severity-critical/60"
                  >
                    <DeptDots departments={injuryType(n)?.departments ?? []} /> {n} <X className="h-3 w-3 text-muted-foreground" />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="injurySearch"
                className={cn(fieldCls, 'h-10 pl-9')}
                placeholder="Search: gun, burn, bleeding…"
                autoComplete="off"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); const first = found[0]; if (q.trim() && first) add(first.name); }
                }}
              />
            </div>
            <ul className="mt-1.5 max-h-52 overflow-y-auto rounded-lg border border-border">
              {found.length === 0 ? (
                <li className="px-3 py-2 text-xs text-muted-foreground">{q ? `No injury matches “${q}”.` : 'All ticked.'}</li>
              ) : found.map((x) => (
                <li key={x.name}>
                  <button
                    type="button"
                    onClick={() => add(x.name)}
                    className="flex w-full items-center gap-2 border-b border-border/60 px-2.5 py-1.5 text-left text-sm last:border-0 hover:bg-muted"
                  >
                    <DeptDots departments={x.departments} className="w-7" />
                    <span className="min-w-0 flex-1 truncate">{x.name}</span>
                    <span className={cn('shrink-0 text-[10px] font-bold', SEV_INK[x.severity])}>{x.severity}</span>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
            {heard.length ? (
              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="inline-flex items-center gap-1 font-semibold text-accent"><Sparkles className="h-3 w-3" /> Criti heard:</span>
                {heard.map((n) => (
                  <button key={n} type="button" onClick={() => add(n)} className="rounded-full border border-accent/40 px-2 py-0.5 font-semibold text-accent hover:bg-accent/10">
                    + {n}
                  </button>
                ))}
              </p>
            ) : null}
          </div>

          <fieldset>
            <legend className={labelCls}>Who is hurt {patientByCriti ? <CritiMark /> : null}</legend>
            <div className="grid grid-cols-3 gap-1.5">
              {([['The caller', true], ['Someone else', false], ['Not known', null]] as const).map(([txt, val]) => (
                <button
                  key={txt}
                  type="button"
                  aria-pressed={isPatient === val}
                  onClick={() => onPatient(val)}
                  className={cn(
                    'h-10 rounded-lg border text-xs font-semibold',
                    isPatient === val ? 'border-accent bg-accent/15 text-fg' : 'border-border bg-bg-soft text-muted-foreground hover:text-fg',
                  )}
                >
                  {txt}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={labelCls}>How many are hurt {victimsByCriti ? <CritiMark /> : null}</legend>
            <div className="grid grid-cols-6 gap-1.5">
              {HURT_COUNTS.map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={victims === v}
                  onClick={() => onVictims(victims === v ? '' : v)}
                  className={cn(
                    'h-10 rounded-lg border text-sm font-bold tabular-nums',
                    victims === v ? 'border-accent bg-accent/15 text-fg' : 'border-border bg-bg-soft text-muted-foreground hover:text-fg',
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {sendNow ? (
          <button
            type="button"
            onClick={sendNow.onSend}
            disabled={sendNow.busy}
            className="mr-auto inline-flex h-10 items-center gap-2 rounded-lg bg-severity-critical px-4 text-xs font-bold uppercase tracking-wider disabled:opacity-60"
          >
            {sendNow.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send to dispatch now
          </button>
        ) : null}
        <button type="button" onClick={onClose} className="inline-flex h-10 items-center rounded-lg bg-accent px-5 text-sm font-bold">
          Done
        </button>
      </div>
    </Modal>
  );
}
