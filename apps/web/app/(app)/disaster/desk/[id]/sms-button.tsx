'use client';

import { useState, useTransition } from 'react';
import { MessageSquareText } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { sendSmsAction } from '../actions';

/**
 * SMS from the desk (0113): to the person who reported the incident, a
 * department's representative or anyone called out. Criti drafts it; the
 * dispatcher reads it and presses Send. Every SMS is kept with the incident.
 */

export type SmsTarget = { key: string; name: string; number: string; kind: 'caller' | 'manager' | 'partner' };

export function SmsButton({ incidentId, targets }: { incidentId: string; targets: SmsTarget[] }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState('');
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [body, setBody] = useState('');
  const [state, setState] = useState<'idle' | 'drafting' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const target = targets.find((x) => x.key === pick) ?? null;

  const choose = (key: string) => {
    setPick(key);
    const tg = targets.find((x) => x.key === key);
    if (tg) { setName(tg.name); setNumber(tg.number); }
  };
  const draft = async () => {
    setState('drafting'); setError(null);
    try {
      const res = await fetch('/api/disaster/brief', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentId, mode: 'sms', recipient: target?.kind ?? 'partner', who: name || null }),
      });
      const j = (await res.json()) as { sms?: string | null; error?: string };
      if (j.sms) setBody(j.sms);
      else setError(t('Criti could not draft it now. Write it yourself.'));
    } catch {
      setError(t('Criti could not draft it now. Write it yourself.'));
    } finally {
      setState('idle');
    }
  };
  const send = () => start(async () => {
    setError(null);
    const res = await sendSmsAction({ incidentId, toName: name, toNumber: number, body });
    if ('error' in res) { setError(res.error); return; }
    setState('sent');
  });
  const close = () => { setOpen(false); setPick(''); setName(''); setNumber(''); setBody(''); setState('idle'); setError(null); };
  const parts = Math.max(1, Math.ceil(body.length / 160));

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-bg-soft px-4 text-sm font-semibold hover:bg-muted">
        <MessageSquareText className="h-4 w-4" aria-hidden />{t('Send SMS')}
      </button>
      {open ? (
        <Modal title={t('Send SMS')} onClose={close} busy={pending}
          confirmClose={body.trim() && state !== 'sent' ? { title: t('Close without sending?'), body: t('The message is not sent yet.') } : null}
          footer={state === 'sent' ? (
            <button type="button" onClick={close} className="h-11 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground">{t('Done')}</button>
          ) : (
            <div className="flex w-full justify-end gap-2">
              <button type="button" onClick={close} className="h-11 rounded-md border border-border px-5 text-sm hover:bg-muted">{t('Cancel')}</button>
              <button type="button" onClick={send} disabled={pending || !body.trim() || number.replace(/\D/g, '').length < 9}
                className="h-11 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? t('Sending…') : t('Send')}</button>
            </div>
          )}>
          {state === 'sent' ? (
            <p className="text-[15px]">{t('Sent to {name}. It is on the incident’s timeline.', { name: name || number })}</p>
          ) : (
            <div className="space-y-4">
              <label className="block text-sm font-medium">{t('To')}
                <select value={pick} onChange={(e) => choose(e.target.value)} className="mt-1 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-[15px]">
                  <option value="">{t('Someone else')}</option>
                  {targets.map((x) => <option key={x.key} value={x.key}>{x.name} · {x.number}</option>)}
                </select>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium">{t('Name')}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} className="mt-1 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-[15px]" /></label>
                <label className="block text-sm font-medium">{t('Cellphone')}<input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={30} inputMode="tel" className="mt-1 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-[15px]" /></label>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="desk-sms" className="text-sm font-medium">{t('Message')}</label>
                  <button type="button" onClick={draft} disabled={state === 'drafting'}
                    className="h-9 rounded-md border border-accent/50 bg-accent/10 px-3 text-sm font-semibold text-accent hover:bg-accent/20 disabled:opacity-60">
                    {state === 'drafting' ? t('Criti is writing…') : t('Draft with Criti')}
                  </button>
                </div>
                <textarea id="desk-sms" value={body} onChange={(e) => setBody(e.target.value.slice(0, 640))} rows={5}
                  className="mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-[15px]" />
                <p className={cn('mt-1 text-xs', body.length > 300 ? 'text-severity-medium-ink' : 'text-muted-foreground')}>
                  {t('{n} characters · {p} SMS', { n: body.length, p: parts })}
                </p>
              </div>
              {error ? <p role="alert" className="text-sm font-medium text-severity-critical-ink">{error}</p> : null}
            </div>
          )}
        </Modal>
      ) : null}
    </>
  );
}
