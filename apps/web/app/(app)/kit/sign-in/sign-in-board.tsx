'use client';

import { useActionState, useMemo, useState } from 'react';
import { Lock, Radio, Search, Smartphone } from 'lucide-react';
import type { SignInDevice, SignInPinRow } from '@criticom/api';
import { useT } from '@/components/i18n';
import { cn, formatSaTime, timeAgo } from '@/lib/utils';
import { removeDeviceAction, resetPinAction, unlockPinAction, type PinFormState } from './actions';

type Device = Omit<SignInDevice, 'secret_hash'>;

function Outcome({ state }: { state: PinFormState }) {
  const { t } = useT();
  if (!state) return null;
  return state.error
    ? <p className="mt-1 text-xs font-semibold text-red-500">{t(state.error)}</p>
    : <p className="mt-1 text-xs font-semibold text-emerald-500">{t(state.done ?? '')}</p>;
}

export function SignInBoard({ devices, officers }: { devices: Device[]; officers: SignInPinRow[] }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const live = devices.filter((d) => !d.removed_at);
  const removed = devices.filter((d) => d.removed_at);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return officers.filter((o) => (!onlyIssues || o.locked_at || !o.has_pin)
      && (!needle || `${o.full_name ?? ''} ${o.badge_number ?? ''}`.toLowerCase().includes(needle)));
  }, [officers, q, onlyIssues]);
  const withPin = officers.filter((o) => o.has_pin).length;
  const locked = officers.filter((o) => o.locked_at).length;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t('Registered devices')} value={live.length} />
        <Stat label={t('Officers with a PIN')} value={`${withPin} / ${officers.length}`} />
        <Stat label={t('Locked PINs')} value={locked} warn={locked > 0} />
      </div>

      <section className="frost rounded-xl border border-border p-4">
        <h2 className="text-base font-bold">{t('Registered devices')}</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {t('A supervisor registers a device on the device itself: in the app, open Profile, then PIN sign-in on this device.')}
        </p>
        {live.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('No devices registered yet.')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {live.map((d) => <DeviceRow key={d.id} device={d} />)}
          </ul>
        )}
        {removed.length > 0 ? (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">{t('{n} removed', { n: removed.length })}</summary>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {removed.map((d) => (
                <li key={d.id}>{d.label}{d.radio_id ? ` · ${d.radio_id}` : ''} · {formatSaTime(d.removed_at)} · {d.removed_reason}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="frost rounded-xl border border-border p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold">{t('Officers')}</h2>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold">
              <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
              {t('Locked or no PIN only')}
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('Name or badge')}
                className="h-9 w-48 rounded-md border border-border bg-bg-soft/80 pl-8 pr-2 text-sm"
              />
            </div>
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('Nobody to show.')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.slice(0, 300).map((o) => <OfficerRow key={o.user_id} officer={o} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className={cn('frost rounded-xl border p-3', warn ? 'border-red-500/50' : 'border-border')}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('text-2xl font-black', warn && 'text-red-500')}>{value}</p>
    </div>
  );
}

function DeviceRow({ device }: { device: Device }) {
  const { t } = useT();
  const [state, action, pending] = useActionState(removeDeviceAction, null);
  const [open, setOpen] = useState(false);
  const Icon = device.radio_id ? Radio : Smartphone;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          <div>
            <p className="font-semibold">
              {device.label}
              {device.radio_id ? <span className="ml-2 font-mono text-xs text-muted-foreground">{device.radio_id}</span> : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {device.silo ?? t('Every department')} · {t('registered by {name}', { name: device.registered_by_name ?? '—' })} · {formatSaTime(device.registered_at)}
              {device.last_used_at ? ` · ${t('last used {when}', { when: timeAgo(device.last_used_at) })}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-red-500/50 px-3 py-1.5 text-xs font-semibold text-red-500"
        >
          {t('Remove')}
        </button>
      </div>
      {open ? (
        <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={device.id} />
          <input
            name="reason"
            required
            placeholder={t('Why: lost, retired, stolen…')}
            className="h-9 flex-1 rounded-md border border-border bg-bg-soft/80 px-2 text-sm"
          />
          <button type="submit" disabled={pending} className="h-9 rounded-md bg-red-600 px-3 text-sm font-semibold text-white disabled:opacity-60">
            {t('Remove device')}
          </button>
        </form>
      ) : null}
      <Outcome state={state} />
    </li>
  );
}

function OfficerRow({ officer }: { officer: SignInPinRow }) {
  const { t } = useT();
  const [unlocked, unlock, unlocking] = useActionState(unlockPinAction, null);
  const [wasReset, reset, resetting] = useActionState(resetPinAction, null);
  const [open, setOpen] = useState(false);
  const status = officer.locked_at
    ? { text: t('Locked'), tone: 'bg-red-500/15 text-red-500' }
    : officer.has_pin
      ? { text: t('PIN set'), tone: 'bg-emerald-500/15 text-emerald-600' }
      : { text: t('No PIN yet'), tone: 'bg-muted text-muted-foreground' };
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">
            {officer.full_name ?? '—'}
            {officer.badge_number ? <span className="ml-2 font-mono text-xs text-muted-foreground">{officer.badge_number}</span> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {officer.silo} · {officer.role}
            {officer.last_used_at ? ` · ${t('last PIN sign-in {when}', { when: timeAgo(officer.last_used_at) })}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold', status.tone)}>
            {officer.locked_at ? <Lock className="h-3 w-3" aria-hidden /> : null}
            {status.text}
          </span>
          {officer.locked_at ? (
            <form action={unlock}>
              <input type="hidden" name="user_id" value={officer.user_id} />
              <button type="submit" disabled={unlocking} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-60">
                {t('Unlock')}
              </button>
            </form>
          ) : null}
          {officer.has_pin ? (
            <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold">
              {t('Reset')}
            </button>
          ) : null}
        </div>
      </div>
      {open ? (
        <form action={reset} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="user_id" value={officer.user_id} />
          <input
            name="reason"
            required
            placeholder={t('Why: forgot it, someone else knows it…')}
            className="h-9 flex-1 rounded-md border border-border bg-bg-soft/80 px-2 text-sm"
          />
          <button type="submit" disabled={resetting} className="h-9 rounded-md bg-primary px-3 text-sm font-semibold disabled:opacity-60">
            {t('Reset PIN')}
          </button>
        </form>
      ) : null}
      <Outcome state={unlocked} />
      <Outcome state={wasReset} />
    </li>
  );
}
