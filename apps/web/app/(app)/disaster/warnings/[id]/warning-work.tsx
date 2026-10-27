'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ClipboardCheck, Copy, Megaphone, MessageCircle, Printer, Send, Siren, Users } from 'lucide-react';
import { JOC_LEVEL, READINESS_OUTCOMES, WARNING_STEPS, smsParts } from '@criticom/db/disaster-warnings';
import { Fold } from '@/components/disaster/fold';
import { useT } from '@/components/i18n';
import { cn, escapeHtml, formatSaTime } from '@/lib/utils';
import { endWarningAction, readinessAction, smsCouncillorsAction, warningColourAction, warningStepAction } from '../actions';

type Session = { id: string; at: string; outcome: string; attended: string | null; notes: string | null; by: string | null };

/** "YYYY-MM-DDTHH:MM" now, South African time, for a datetime field. */
function localNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

/**
 * The warning's work, in the order of the process: 1 check and tell, 2 spread
 * it (the message to copy, WhatsApp, a script to print, the SMS to every
 * councillor), 3 the JOC's readiness session at Level 4 or higher, 4 an
 * incident if a response is needed. Each tick says who and when.
 */
export function WarningWork({ warningId, live, level, colour, colourByDesk, steps, message, sms, councillors, sessions, incident }: {
  warningId: string; live: boolean; level: number; colour: string; colourByDesk: boolean;
  steps: Record<string, { at: string; by: string }>; message: string; sms: string; councillors: number;
  sessions: Session[]; incident: { id: string; number: string } | null;
}) {
  const { t } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const tick = (step: string, done: boolean) => {
    setBusyStep(step);
    start(async () => {
      setError(null);
      const res = await warningStepAction(warningId, step, done);
      if ('error' in res) setError(res.error);
      setBusyStep(null);
      router.refresh();
    });
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(message); setNote(t('Message copied. Paste it where it is needed.')); }
    catch { setNote(t('Copy did not work here. Select the message and copy it.')); }
  };
  const printScript = () => {
    const win = window.open('', '_blank', 'width=800,height=900');
    if (!win) return;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(t('Warning script'))}</title>
      <style>body{font:28px/1.45 system-ui,sans-serif;margin:40px;color:#000}h1{font-size:34px}</style></head>
      <body><h1>${escapeHtml(t('Weather warning'))}</h1><p>${escapeHtml(message).replace(/\n/g, '</p><p>')}</p></body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };
  const sendSms = () => {
    if (!window.confirm(t('Send this warning by SMS to {n} councillors?', { n: councillors }))) return;
    start(async () => {
      setError(null);
      const res = await smsCouncillorsAction(warningId);
      if ('error' in res) setError(res.error);
      else setNote(res.failed ? t('{sent} SMS sent. {failed} did not go.', { sent: res.sent, failed: res.failed }) : t('{sent} SMS sent.', { sent: res.sent }));
      router.refresh();
    });
  };

  const checks = WARNING_STEPS.filter((s) => s.group === 'check');
  const channels = WARNING_STEPS.filter((s) => s.group === 'channel');
  const doneChecks = checks.filter((s) => s.key in steps).length;
  const doneChannels = channels.filter((s) => s.key in steps).length;

  const row = (step: (typeof WARNING_STEPS)[number], extra?: React.ReactNode) => {
    const done = steps[step.key];
    return (
      <li key={step.key} className="flex flex-wrap items-center gap-3 px-5 py-3">
        <label className={cn('flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3', !live && 'cursor-default')}>
          <input type="checkbox" checked={Boolean(done)} disabled={!live || busyStep === step.key}
            onChange={(e) => tick(step.key, e.target.checked)} className="h-6 w-6 shrink-0" />
          <span className="min-w-0">
            <span className="block font-semibold">{t(step.label)}</span>
            <span className="block text-xs text-muted-foreground">
              {done ? t('Done by {by}, {at}', { by: done.by, at: formatSaTime(done.at) }) : t(step.who)}
            </span>
          </span>
        </label>
        {extra}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      {error ? <p role="alert" className="rounded-lg border border-severity-critical bg-bg-card px-4 py-3 text-sm font-medium text-severity-critical-ink">{error}</p> : null}
      {note ? <output className="block rounded-lg border border-severity-low/50 bg-bg-card px-4 py-3 text-sm font-medium">{note}</output> : null}

      <Fold id="warning.check" icon={ClipboardCheck} title={t('1. Check and tell')} summary={t('{done} of {all} done', { done: doneChecks, all: checks.length })}
        info={t('Check the warning with the FEWS team (rain, radar, rivers and flood models), then tell Emergency Services and the service units.')}>
        <ul className="divide-y divide-border">{checks.map((s) => row(s))}</ul>
      </Fold>

      <Fold id="warning.spread" icon={Megaphone} title={t('2. Spread the warning')} summary={t('{done} of {all} channels', { done: doneChannels, all: channels.length })}
        info={t('Communications and Community Participation spreads the warning and the emergency number on every channel. Tick each one when it is done.')}>
        <div className="space-y-3 border-b border-border p-5">
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-bg-soft p-3 font-sans text-sm leading-relaxed">{message}</pre>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy()} className="inline-flex h-11 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted">
              <Copy className="h-4 w-4" aria-hidden />{t('Copy message')}
            </button>
            <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted">
              <MessageCircle className="h-4 w-4" aria-hidden />{t('Open WhatsApp')}
            </a>
            <button type="button" onClick={printScript} className="inline-flex h-11 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted">
              <Printer className="h-4 w-4" aria-hidden />{t('Print a script')}
            </button>
          </div>
        </div>
        <ul className="divide-y divide-border">
          {channels.map((s) => (s.key !== 'sms_councillors' || !live ? row(s) : row(s, councillors ? (
            <button type="button" onClick={sendSms} disabled={pending}
              title={t('{n} letters, {p} SMS part(s) each', { n: sms.length, p: smsParts(sms) })}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              <Send className="h-4 w-4" aria-hidden />{t('Send to {n} councillors', { n: councillors })}
            </button>
          ) : (
            <Link href="/disaster/councillors" className="inline-flex h-11 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted">
              <Users className="h-4 w-4" aria-hidden />{t('Add the councillors first')}
            </Link>
          ))))}
        </ul>
      </Fold>

      <Readiness warningId={warningId} live={live} level={level} sessions={sessions} />

      <Fold id="warning.respond" icon={Siren} title={t('4. Respond')}
        info={t('If impacts are happening or close, log an incident from the warning. It is linked to the warning and starts at Bronze.')}>
        <div className="p-5">
          {incident ? (
            <Link href={`/disaster/desk/${incident.id}`} className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-5 font-semibold text-primary-foreground">
              <Check className="h-5 w-5" aria-hidden />{t('Incident {number}: open it', { number: incident.number })}
            </Link>
          ) : live ? (
            <Link href={`/disaster/desk/new?warning=${warningId}`} className="inline-flex h-12 items-center gap-2 rounded-md bg-primary px-5 font-semibold text-primary-foreground">
              <Siren className="h-5 w-5" aria-hidden />{t('Add an incident from this warning')}
            </Link>
          ) : <p className="text-sm text-muted-foreground">{t('No incident was logged from this warning.')}</p>}
        </div>
      </Fold>

      {live ? <Settings warningId={warningId} colour={colour} colourByDesk={colourByDesk} /> : null}
    </div>
  );
}

/** W3: the JOC's readiness session and what it decided. */
function Readiness({ warningId, live, level, sessions }: { warningId: string; live: boolean; level: number; sessions: Session[] }) {
  const { t } = useT();
  const router = useRouter();
  const ref = useRef(crypto.randomUUID());
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(level >= JOC_LEVEL && sessions.length === 0);
  const [v, setV] = useState({ held_at: localNow(), attended: '', outcome: '', notes: '' });
  const save = () => start(async () => {
    setError(null);
    const res = await readinessAction(warningId, ref.current, v);
    if ('error' in res) { setError(res.error); return; }
    ref.current = crypto.randomUUID();
    setV({ held_at: localNow(), attended: '', outcome: '', notes: '' });
    setShow(false);
    router.refresh();
  });
  const field = 'mt-1 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-[15px]';
  return (
    <Fold id="warning.joc" icon={Users} title={t('3. JOC readiness session')}
      summary={sessions[0] ? t('Decided: {outcome}', { outcome: t(sessions[0].outcome) }) : level >= JOC_LEVEL ? t('Needed') : t('Not needed below Level 4')}
      info={t('At Level 4 or higher the JOC meets to check readiness and decides: monitor, pre-position resources, open halls as a precaution, or respond.')}>
      <div className="space-y-4 p-5">
        <p className={cn('rounded-lg px-3 py-2 text-sm font-medium', level >= JOC_LEVEL ? 'bg-severity-critical/10 text-severity-critical-ink' : 'bg-muted')}>
          {level >= JOC_LEVEL ? t('Level {n}: the JOC meets to check readiness.', { n: level }) : t('Level {n}: watch it until it ends. A session can still be recorded.', { n: level })}
        </p>
        {sessions.length ? (
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li key={s.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-semibold">{t(s.outcome)} <span className="font-normal text-muted-foreground">· {formatSaTime(s.at)} · {s.by}</span></p>
                {s.attended ? <p className="mt-1"><span className="text-muted-foreground">{t('Attended:')}</span> {s.attended}</p> : null}
                {s.notes ? <p className="mt-1 whitespace-pre-line">{s.notes}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {live && !show ? (
          <button type="button" onClick={() => setShow(true)} className="h-11 rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted">
            {t('Record a session')}
          </button>
        ) : null}
        {live && show ? (
          <div className="space-y-4 rounded-lg border border-border p-4">
            {error ? <p role="alert" className="text-sm font-medium text-severity-critical-ink">{error}</p> : null}
            <fieldset>
              <legend className="text-sm font-medium">{t('What did the JOC decide?')}</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {READINESS_OUTCOMES.map((o) => (
                  <button key={o} type="button" aria-pressed={v.outcome === o} onClick={() => setV({ ...v, outcome: o })}
                    className={cn('min-h-12 rounded-md border px-4 text-left text-sm font-semibold',
                      v.outcome === o ? 'border-accent bg-accent/15 text-accent' : 'border-border hover:bg-muted')}>
                    {t(o)}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">{t('When it met')}
                <input type="datetime-local" value={v.held_at} onChange={(e) => setV({ ...v, held_at: e.target.value })} className={field} />
              </label>
              <label className="block text-sm font-medium">{t('Who was there')}
                <input value={v.attended} onChange={(e) => setV({ ...v, attended: e.target.value })} maxLength={1000}
                  placeholder={t('For example: Stand-by Officer, Fire, Water, Electricity')} className={field} />
              </label>
            </div>
            <label className="block text-sm font-medium">{t('Notes')}
              <textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} rows={3} maxLength={4000}
                className="mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-[15px]" />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={save} disabled={pending || !v.outcome}
                className="h-11 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                {pending ? t('Saving…') : t('Save the session')}
              </button>
              <button type="button" onClick={() => setShow(false)} className="h-11 rounded-md border border-border px-5 text-sm hover:bg-muted">{t('Cancel')}</button>
            </div>
          </div>
        ) : null}
      </div>
    </Fold>
  );
}

/** The colour the issued warning states, and ending it early. */
function Settings({ warningId, colour, colourByDesk }: { warningId: string; colour: string; colourByDesk: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const setColour = (c: string) => start(async () => {
    const res = await warningColourAction(warningId, c);
    if ('error' in res) setError(res.error);
    router.refresh();
  });
  const end = () => {
    const reason = window.prompt(t('Why does this warning end now? For example: lifted by the SA Weather Service.'));
    if (!reason?.trim()) return;
    start(async () => {
      const res = await endWarningAction(warningId, reason);
      if ('error' in res) setError(res.error);
      router.refresh();
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-bg-card px-5 py-3 text-sm">
      <label className="flex items-center gap-2">{t('Colour')}
        <select value={colourByDesk ? colour : ''} onChange={(e) => setColour(e.target.value)} disabled={pending}
          className="h-10 rounded-md border border-border bg-bg-soft px-2">
          <option value="">{t('Match the level')}</option>
          <option value="Yellow">{t('Yellow')}</option>
          <option value="Orange">{t('Orange')}</option>
          <option value="Red">{t('Red')}</option>
        </select>
      </label>
      <button type="button" onClick={end} disabled={pending} className="ml-auto h-10 rounded-md border border-severity-critical/50 px-4 font-semibold text-severity-critical-ink hover:bg-severity-critical/10">
        {t('End this warning')}
      </button>
      {error ? <p role="alert" className="w-full text-severity-critical-ink">{error}</p> : null}
    </div>
  );
}
