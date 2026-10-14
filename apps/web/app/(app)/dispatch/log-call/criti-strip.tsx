'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ListChecks, Loader2, MessageCircleQuestion, Send, Sparkles, Split } from 'lucide-react';
import { DEPARTMENT_NAMES, type DeskSilo, type IncidentSeverity, type MedPriority } from '@criticom/db';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
import { AI_STATUS, DeptDots, deskList, type AiState } from './intake-ui';

type Line = { key: string; dot: string; icon: typeof Sparkles; text: React.ReactNode; action?: React.ReactNode };

const SHOWN = 3;

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
  const [all, setAll] = useState(false);

  const lines: Line[] = [];
  if (danger.length) {
    lines.push({ key: 'danger', dot: 'bg-severity-critical', icon: AlertTriangle, text: <span className="font-semibold text-red-200">{danger.slice(0, 2).join(' · ')}</span> });
  }
  if (early) {
    lines.push({
      key: 'early',
      dot: 'bg-severity-critical animate-pulse',
      icon: Send,
      text: <><span className="font-semibold">{early.severity} call: dispatch can start now.</span><span className="text-white/60"> Add the rest after.</span></>,
      action: (
        <button
          type="button"
          onClick={early.onSend}
          disabled={early.busy}
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded bg-severity-critical px-2 text-[11px] font-bold disabled:opacity-60"
        >
          {early.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Send to dispatch now
        </button>
      ),
    });
  }
  if (sent) {
    lines.push({
      key: 'sent',
      dot: 'bg-severity-low',
      icon: CheckCircle2,
      text: missing.length
        ? <><span className="font-semibold">{sent.number} is with dispatch.</span><span className="text-white/60"> Still to add: {missing.join(', ')}</span></>
        : <span className="font-semibold">{sent.number} is with dispatch. All the details are in.</span>,
    });
  }
  if (ask.length) {
    lines.push({ key: 'ask', dot: 'bg-sky-400', icon: MessageCircleQuestion, text: <><span className="text-white/60">Ask: </span>{ask.slice(0, 2).join(' · ')}</> });
  }
  if (suggestAdd.length) {
    lines.push({
      key: 'add',
      dot: 'bg-severity-medium',
      icon: Split,
      text: <>Criti suggests also sending to <span className="font-semibold">{deskList(suggestAdd)}</span></>,
      action: (
        <span className="flex shrink-0 gap-1">
          {suggestAdd.map((d) => (
            <button key={d} type="button" onClick={() => onAddDesk(d)} className="inline-flex h-6 items-center rounded bg-white/10 px-2 text-[11px] font-semibold hover:bg-white/20">
              + {DEPARTMENT_NAMES[d]}
            </button>
          ))}
        </span>
      ),
    });
  }
  if (!sent && missing.length) {
    lines.push({ key: 'missing', dot: 'bg-severity-medium', icon: ListChecks, text: <><span className="text-white/60">Still needed: </span>{missing.slice(0, 4).join(', ')}{missing.length > 4 ? ` +${missing.length - 4}` : ''}</> });
  }

  return (
    <section aria-label="Criti on this call" aria-live="polite" className="overflow-hidden rounded-lg border border-white/10 bg-slate-950/90 text-white shadow-sm">
      <div className="flex items-center gap-2 px-3 py-1.5">
        {aiState === 'reading' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" /> : <Sparkles className="h-3.5 w-3.5 text-sky-400" />}
        <span className="text-[11px] font-bold uppercase tracking-wider text-white/70">Criti</span>
        <span className="truncate text-[11px] text-white/60">{AI_STATUS[aiState]}</span>
        <button type="button" onClick={() => setAll(true)} className="ml-auto shrink-0 text-[11px] font-semibold text-sky-300 hover:underline">
          View all
        </button>
      </div>
      {lines.length === 0 ? (
        <p className="border-t border-white/10 px-3 py-2 text-xs text-white/60">Choose the incident type to see what to ask and who to send.</p>
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
        <Modal title="Criti on this call" onClose={() => setAll(false)} wide>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1 text-sm">
            {danger.length ? (
              <section>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-severity-critical-ink">Take care</h3>
                <ul className="list-disc space-y-0.5 pl-5">{danger.map((d) => <li key={d}>{d}</li>)}</ul>
              </section>
            ) : null}
            <section>
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Ask the caller</h3>
              {ask.length
                ? <ul className="list-disc space-y-0.5 pl-5">{ask.map((x) => <li key={x}>{x}</li>)}</ul>
                : <p className="text-muted-foreground">Choose the incident type or tick an injury first.</p>}
            </section>
            <section className="grid gap-3 sm:grid-cols-3">
              <div>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Send to</h3>
                {departments.length
                  ? <p className="flex items-center gap-1.5"><DeptDots departments={departments} /> {deskList(departments)}</p>
                  : <p className="text-muted-foreground">Not known yet</p>}
              </div>
              <div>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Severity</h3>
                <p>{severity ?? <span className="text-muted-foreground">Not known yet</span>}</p>
              </div>
              <div>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Medical code</h3>
                <p>{priority ?? <span className="text-muted-foreground">None suggested</span>}</p>
              </div>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{sent ? 'Still to add' : 'Still needed to send'}</h3>
              {missing.length
                ? <ul className="list-disc space-y-0.5 pl-5">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
                : <p className="text-severity-low-ink">Everything is filled in.</p>}
            </section>
            <p className="text-xs text-muted-foreground">
              Criti fills in only empty fields and marks them. It never changes what you chose. The AI is sent the
              type, the injuries and the description, never the caller&apos;s name or number.
            </p>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
