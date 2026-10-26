'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { DUTIES } from '@criticom/db/disaster-plan';
import { saStamp } from '@criticom/db/post-mortem';
import { CallButton } from '@/components/disaster/call-button';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { endDutyAction, saveDutyAction, setScgChairAction } from '../desk/actions';

type Duty = { id: string; name: string; phone: string | null; duty: string; status: 'On duty' | 'On standby'; startsAt: string; endsAt: string; note: string | null };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const when = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

export function DutyBoard({ canEdit, nowIso, year, thisMonth, duty, officers, chairs }: {
  canEdit: boolean; nowIso: string; year: number; thisMonth: number | null; duty: Duty[];
  officers: Array<{ id: string; name: string; phone: string | null }>; chairs: Array<{ month: number; name: string; phone: string | null }>;
}) {
  const { t } = useT();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const now = new Date(nowIso).getTime();
  const current = duty.filter((d) => new Date(d.startsAt).getTime() <= now);
  const ahead = duty.filter((d) => new Date(d.startsAt).getTime() > now);
  const holder = (role: string) => current.find((d) => d.duty === role);
  const principal = holder('Principal Disaster Management Stand-by Officer');
  const mdmc = holder('MDMC Duty Officer');
  const chairNow = thisMonth ? chairs.find((c) => c.month === thisMonth) : null;

  return (
    <div className="space-y-6">
      {error ? <p role="alert" className="rounded-lg border border-severity-critical bg-bg-card px-4 py-3 text-sm font-medium text-severity-critical-ink">{error}</p> : null}

      <section className="grid gap-5 md:grid-cols-3">
        <WhoTile title={t('Principal Disaster Management Stand-by Officer')} who={principal} empty={t('Nobody rostered now')} />
        <WhoTile title={t('MDMC Duty Officer')} who={mdmc} empty={t('Nobody rostered now')} />
        <div className="rounded-xl border border-t-4 border-border border-t-[#d4a72c] bg-bg-card p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('SCG duty chair this month')}</p>
          <p className="mt-2 text-lg font-semibold">{chairNow?.name ?? t('Not rostered')}</p>
          <div className="mt-3"><CallButton number={chairNow?.phone} /></div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="font-semibold">{t('On duty and on standby now ({n})', { n: current.length })}</h2>
          {canEdit && !adding ? (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
              <Plus className="h-4 w-4" aria-hidden />{t('Put someone on')}
            </button>
          ) : null}
        </div>
        {adding ? <DutyForm officers={officers} onDone={() => setAdding(false)} onError={setError} /> : null}
        <ul className="divide-y divide-border">
          {current.length === 0 ? <li className="px-5 py-6 text-center text-sm text-muted-foreground">{t('Nobody on the roster right now.')}</li> : null}
          {current.map((d) => <DutyRow key={d.id} d={d} canEdit={canEdit} onError={setError} />)}
        </ul>
      </section>

      {ahead.length ? (
        <section className="overflow-hidden rounded-xl border border-border bg-bg-card shadow-sm">
          <h2 className="border-b border-border px-5 py-4 font-semibold">{t('Coming up ({n})', { n: ahead.length })}</h2>
          <ul className="divide-y divide-border">{ahead.map((d) => <DutyRow key={d.id} d={d} canEdit={canEdit} onError={setError} />)}</ul>
        </section>
      ) : null}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t('SCG duty chair, {year}', { year })}</h2>
          <div className="flex gap-2">
            <Link href={`/disaster/duty?year=${year - 1}`} className="inline-flex h-10 items-center rounded-md border border-border bg-bg-card px-4 text-sm hover:bg-muted">{t('Previous year')}</Link>
            <Link href={`/disaster/duty?year=${year + 1}`} className="inline-flex h-10 items-center rounded-md border border-border bg-bg-card px-4 text-sm hover:bg-muted">{t('Next year')}</Link>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{t('The City Manager and Deputy City Managers are on stand-by for one calendar month at a time. Whoever is on stand-by chairs the SCG.')}</p>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {MONTHS.map((m, i) => (
            <ChairMonth key={m} year={year} month={i + 1} label={t(m)} current={thisMonth === i + 1}
              chair={chairs.find((c) => c.month === i + 1) ?? null} canEdit={canEdit} onError={setError} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function WhoTile({ title, who, empty }: { title: string; who: Duty | undefined; empty: string }) {
  const { t } = useT();
  return (
    <div className="rounded-xl border border-t-4 border-border border-t-accent bg-bg-card p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-2 text-lg font-semibold">{who?.name ?? empty}</p>
      {who ? <p className="text-sm text-muted-foreground">{t('{status} until {until}', { status: t(who.status), until: when.format(new Date(who.endsAt)) })}</p> : null}
      <div className="mt-3"><CallButton number={who?.phone} /></div>
    </div>
  );
}

function DutyRow({ d, canEdit, onError }: { d: Duty; canEdit: boolean; onError: (e: string | null) => void }) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const end = () => {
    if (!window.confirm(t('Take {name} off the roster?', { name: d.name }))) return;
    start(async () => {
      const res = await endDutyAction(d.id);
      if ('error' in res) onError(res.error);
    });
  };
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          {d.name}
          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', d.status === 'On duty' ? 'bg-severity-low/15 text-severity-low-ink' : 'bg-sky-500/15 text-sky-300')}>{t(d.status)}</span>
        </p>
        <p className="text-sm text-muted-foreground">{t(d.duty)} · {when.format(new Date(d.startsAt))} – {when.format(new Date(d.endsAt))}</p>
        {d.note ? <p className="text-xs text-muted-foreground">{d.note}</p> : null}
      </div>
      <CallButton number={d.phone} size="sm" />
      {canEdit ? <button type="button" onClick={end} disabled={pending} className="h-8 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted">{t('Take off')}</button> : null}
    </li>
  );
}

function DutyForm({ officers, onDone, onError }: {
  officers: Array<{ id: string; name: string; phone: string | null }>; onDone: () => void; onError: (e: string | null) => void;
}) {
  const { t } = useT();
  const start0 = new Date();
  const [v, setV] = useState({
    personnel_id: '', name: '', phone: '', duty: 'Principal Disaster Management Stand-by Officer', status: 'On standby',
    starts_at: saStamp(start0), ends_at: saStamp(new Date(start0.getTime() + 7 * 24 * 3600_000)), note: '',
  });
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v, x: string) => setV({ ...v, [k]: x });
  const save = () => start(async () => {
    onError(null);
    const res = await saveDutyAction(null, v);
    if ('error' in res) onError(res.error);
    else onDone();
  });
  const field = 'mt-1 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';
  return (
    <div className="border-b border-border bg-bg-soft p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm font-medium">{t('Who')}
          <select value={v.personnel_id} onChange={(e) => set('personnel_id', e.target.value)} className={field}>
            <option value="">{t('Someone not in the system')}</option>
            {officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select></label>
        {v.personnel_id ? null : (
          <label className="block text-sm font-medium">{t('Name')}<input value={v.name} onChange={(e) => set('name', e.target.value)} maxLength={160} className={field} /></label>
        )}
        <label className="block text-sm font-medium">{t('Phone')}<input value={v.phone} onChange={(e) => set('phone', e.target.value)} maxLength={60} inputMode="tel"
          placeholder={v.personnel_id ? t('Their work cellphone') : undefined} className={field} /></label>
        <label className="block text-sm font-medium">{t('Duty')}
          <select value={v.duty} onChange={(e) => set('duty', e.target.value)} className={field}>{DUTIES.map((d) => <option key={d} value={d}>{t(d)}</option>)}</select></label>
        <div className="text-sm font-medium">{t('On duty or on standby')}
          <div className="mt-1 flex gap-2">
            {(['On duty', 'On standby'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={v.status === s} onClick={() => set('status', s)}
                className={cn('h-11 flex-1 rounded-md border px-3 text-sm font-semibold', v.status === s ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted-foreground hover:bg-muted')}>{t(s)}</button>
            ))}
          </div>
        </div>
        <label className="block text-sm font-medium">{t('From')}<input value={v.starts_at} onChange={(e) => set('starts_at', e.target.value)} placeholder="YYYY-MM-DD HH:MM" className={field} /></label>
        <label className="block text-sm font-medium">{t('Until')}<input value={v.ends_at} onChange={(e) => set('ends_at', e.target.value)} placeholder="YYYY-MM-DD HH:MM" className={field} /></label>
        <label className="block text-sm font-medium">{t('Note')}<input value={v.note} onChange={(e) => set('note', e.target.value)} maxLength={300} className={field} /></label>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={save} disabled={pending || (!v.personnel_id && !v.name.trim())}
          className="h-11 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{pending ? t('Saving…') : t('Put on the roster')}</button>
        <button type="button" onClick={onDone} className="h-11 rounded-md border border-border px-5 text-sm hover:bg-muted">{t('Cancel')}</button>
      </div>
    </div>
  );
}

function ChairMonth({ year, month, label, current, chair, canEdit, onError }: {
  year: number; month: number; label: string; current: boolean; chair: { name: string; phone: string | null } | null;
  canEdit: boolean; onError: (e: string | null) => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(chair?.name ?? '');
  const [phone, setPhone] = useState(chair?.phone ?? '');
  const [pending, start] = useTransition();
  const changed = name !== (chair?.name ?? '') || phone !== (chair?.phone ?? '');
  const save = () => start(async () => {
    onError(null);
    const res = await setScgChairAction({ year, month, name, phone });
    if ('error' in res) onError(res.error);
  });
  return (
    <li className={cn('space-y-2 rounded-xl border bg-bg-card p-4 shadow-sm', current ? 'border-2 border-accent' : 'border-border')}>
      <p className="font-semibold">{label}{current ? <span className="ml-2 text-xs font-normal text-accent">{t('(this month)')}</span> : null}</p>
      {canEdit ? (
        <>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder={t('Not rostered')} aria-label={t('Chairperson')}
            className="h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={60} placeholder={t('Phone')} aria-label={t('Phone')} inputMode="tel"
            className="h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm" />
          {changed ? (
            <button type="button" onClick={save} disabled={pending} className="h-9 w-full rounded-md bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60">{t('Save')}</button>
          ) : <CallButton number={chair?.phone} size="sm" />}
        </>
      ) : (
        <>
          <p className="text-sm">{chair?.name ?? t('Not rostered')}</p>
          <CallButton number={chair?.phone} size="sm" />
        </>
      )}
    </li>
  );
}
