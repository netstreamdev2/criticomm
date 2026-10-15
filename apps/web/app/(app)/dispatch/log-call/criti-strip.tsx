'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ListChecks, Loader2, MessageCircleQuestion, Send, Split } from 'lucide-react';
import type { DeskSilo, IncidentSeverity, MedPriority } from '@criticom/db';
import type { Translate } from '@criticom/db/i18n';
import { Modal } from '@/components/ui/modal';
import { CritiMascot } from '@/components/criti/mascot';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { DeptDots, aiStatus, deptName, deskList, severityWord, type AiState } from './intake-ui';

type Line = { key: string; dot: string; icon: typeof AlertTriangle; text: React.ReactNode; action?: React.ReactNode };

const SHOWN = 3;

/** What the form still needs, in the reader's language. */
export function missingWord(m: string, t: Translate): string {
  switch (m) {
    case 'Incident type': return t('Incident type');
    case 'Location on the map': return t('Location on the map');
    case 'Caller name': return t('Caller name');
    case 'Caller number': return t('Caller number');
    case 'Description': return t('Description');
    case 'Region': return t('Region');
    case 'Severity': return t('Severity');
    case 'Is the caller the patient?': return t('Is the caller the patient?');
    case 'Number of people hurt': return t('Number of people hurt');
    case 'Medical code': return t('Medical code');
    case 'Department': return t('Department');
    case 'High or Critical severity': return t('High or Critical severity');
    default: return t(m);
  }
}

/**
 * Criti on the call-taking form: three slim lines on dark, the rest under
 * View all. Warnings first, then sending early, then what to ask the caller,
 * then a department the call may also need, then what is still missing.
 */
export function CritiStrip({
  aiState, danger, ask, missing, departments, severity, priority, suggestAdd, onAddDesk, early, sent,
}: {
  aiState: AiState;
  danger: string[];
  ask: string[];
  missing: string[];
  departments: DeskSilo[];
  severity: IncidentSeverity | null;
  priority: MedPriority | null;
  /** Departments Criti would add that are not chosen. */
  suggestAdd: DeskSilo[];
  onAddDesk: (d: DeskSilo) => void;
  /** Enough to send now, before the form is complete. */
  early: { severity: IncidentSeverity; busy: boolean; onSend: () => void } | null;
  sent: { number: string } | null;
}) {
  const { t } = useT();
  const [all, setAll] = useState(false);
  const still = missing.map((m) => missingWord(m, t));

  const lines: Line[] = [];
  if (danger.length) {
    lines.push({ key: 'danger', dot: 'bg-severity-critical', icon: AlertTriangle, text: <span className="font-semibold text-red-200">{danger.slice(0, 2).join(' · ')}</span> });
  }
  if (early) {
    lines.push({
      key: 'early',
      dot: 'bg-severity-critical animate-pulse',
      icon: Send,
      text: <><span className="font-semibold">{t('{severity} call: dispatch can start now.', { severity: severityWord(early.severity, t) })}</span><span className="text-white/60"> {t('Add the rest after.')}</span></>,
      action: (
        <button
          type="button"
          onClick={early.onSend}
          disabled={early.busy}
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded bg-severity-critical px-2 text-[11px] font-bold disabled:opacity-60"
        >
          {early.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} {t('Send to dispatch now')}
        </button>
      ),
    });
  }
  if (sent) {
    lines.push({
      key: 'sent',
      dot: 'bg-severity-low',
      icon: CheckCircle2,
      text: still.length
        ? <><span className="font-semibold">{t('{number} is with dispatch.', { number: sent.number })}</span><span className="text-white/60"> {t('Still to add: {list}', { list: still.join(', ') })}</span></>
        : <span className="font-semibold">{t('{number} is with dispatch. All the details are in.', { number: sent.number })}</span>,
    });
  }
  if (ask.length) {
    lines.push({ key: 'ask', dot: 'bg-sky-400', icon: MessageCircleQuestion, text: <><span className="text-white/60">{t('Ask:')} </span>{ask.slice(0, 2).map((q) => t(q)).join(' · ')}</> });
  }
  if (suggestAdd.length) {
    lines.push({
      key: 'add',
      dot: 'bg-severity-medium',
      icon: Split,
      text: <>{t('Criti suggests also sending to {desks}', { desks: deskList(suggestAdd, t) })}</>,
      action: (
        <span className="flex shrink-0 gap-1">
          {suggestAdd.map((d) => (
            <button key={d} type="button" onClick={() => onAddDesk(d)} className="inline-flex h-6 items-center rounded bg-white/10 px-2 text-[11px] font-semibold hover:bg-white/20">
              + {deptName(d, t)}
            </button>
          ))}
        </span>
      ),
    });
  }
  if (!sent && still.length) {
    lines.push({ key: 'missing', dot: 'bg-severity-medium', icon: ListChecks, text: <><span className="text-white/60">{t('Still needed:')} </span>{still.slice(0, 4).join(', ')}{still.length > 4 ? ` +${still.length - 4}` : ''}</> });
  }

  return (
    <section aria-label={t('Criti on this call')} aria-live="polite" className="overflow-hidden rounded-lg border border-white/10 bg-slate-950/90 text-white shadow-sm">
      <div className="flex items-center gap-2 px-3 py-1.5">
        {aiState === 'reading' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" /> : <CritiMascot className="h-5 w-5" />}
        <span className="text-[11px] font-bold uppercase tracking-wider text-white/70">Criti</span>
        <span className="truncate text-[11px] text-white/60">{aiStatus(aiState, t)}</span>
        <button type="button" onClick={() => setAll(true)} className="ml-auto shrink-0 text-[11px] font-semibold text-sky-300 hover:underline">
          {t('View all')}
        </button>
      </div>
      {lines.length === 0 ? (
        <p className="border-t border-white/10 px-3 py-2 text-xs text-white/60">{t('Choose the incident type to see what to ask and who to send.')}</p>
      ) : lines.slice(0, SHOWN).map((l) => {
        const Icon = l.icon;
        return (
          <div key={l.key} className="flex min-h-9 items-center gap-2 border-t border-white/10 px-3 py-1.5">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', l.dot)} />
            <Icon className="h-3.5 w-3.5 shrink-0 text-white/60" />
            <p className="min-w-0 flex-1 truncate text-xs">{l.text}</p>
            {l.action ?? null}
          </div>
        );
      })}

      {all ? (
        <Modal title={t('Criti on this call')} onClose={() => setAll(false)} wide>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1 text-sm">
            {danger.length ? (
              <section>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-severity-critical-ink">{t('Take care')}</h3>
                <ul className="list-disc space-y-0.5 pl-5">{danger.map((d) => <li key={d}>{d}</li>)}</ul>
              </section>
            ) : null}
            <section>
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('Ask the caller')}</h3>
              {ask.length
                ? <ul className="list-disc space-y-0.5 pl-5">{ask.map((x) => <li key={x}>{t(x)}</li>)}</ul>
                : <p className="text-muted-foreground">{t('Choose the incident type or tick an injury first.')}</p>}
            </section>
            <section className="grid gap-3 sm:grid-cols-3">
              <div>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('Send to')}</h3>
                {departments.length
                  ? <p className="flex items-center gap-1.5"><DeptDots departments={departments} /> {deskList(departments, t)}</p>
                  : <p className="text-muted-foreground">{t('Not known yet')}</p>}
              </div>
              <div>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('Severity')}</h3>
                <p>{severity ? severityWord(severity, t) : <span className="text-muted-foreground">{t('Not known yet')}</span>}</p>
              </div>
              <div>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('Medical code')}</h3>
                <p>{priority ? t(priority) : <span className="text-muted-foreground">{t('None suggested')}</span>}</p>
              </div>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{sent ? t('Still to add') : t('Still needed to send')}</h3>
              {still.length
                ? <ul className="list-disc space-y-0.5 pl-5">{still.map((m) => <li key={m}>{m}</li>)}</ul>
                : <p className="text-severity-low-ink">{t('Everything is filled in.')}</p>}
            </section>
            <p className="text-xs text-muted-foreground">
              {t('Criti fills in only empty fields and marks them. It never changes what you chose. The AI is sent the type, the details, the injuries and the description, never the caller’s name or number.')}
            </p>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
