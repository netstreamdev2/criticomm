'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { HardHat, Radio, Search, Smartphone, X } from 'lucide-react';
import type { KitBookingRow, KitEntry } from '@criticom/api/radio';
import { useT } from '@/components/i18n';
import { cn, formatSaTime, timeAgo } from '@/lib/utils';
import { addRangeAction, receiveKitAction, retireKitAction, saveKitAction, type KitFormState } from './actions';

type Option = { id: string; label: string };
type KindFilter = 'all' | 'hard_hat' | 'radio';
type StatusFilter = 'all' | 'in_use' | 'available' | 'repair' | 'lost' | 'retired';

const field = 'mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft/80 px-3 text-sm';
const label = 'text-xs font-semibold uppercase text-muted-foreground';

const STATUS: Record<KitEntry['status'], { word: string; tone: string }> = {
  in_use: { word: 'Booked out', tone: 'bg-sky-500/15 text-sky-500' },
  available: { word: 'Available', tone: 'bg-emerald-500/15 text-emerald-500' },
  repair: { word: 'In repair', tone: 'bg-amber-500/15 text-amber-500' },
  lost: { word: 'Lost', tone: 'bg-red-500/15 text-red-500' },
  retired: { word: 'Out of service', tone: 'bg-muted text-muted-foreground' },
};
const RETURNED: Record<string, string> = { fine: 'Handed back', damaged: 'Back damaged', lost: 'Reported lost', taken_over: 'Taken over by the next person' };

const KindIcon = ({ kind, className }: { kind: KitEntry['kind']; className?: string }) =>
  kind === 'hard_hat' ? <HardHat className={className} aria-hidden /> : <Radio className={className} aria-hidden />;

/** The register: who has what, filters, and the side panel for one item or adding more. */
export function KitBoard({ items, picked, history, manages, showRetired, departments, defaultSilo }: {
  items: KitEntry[];
  picked: KitEntry | null;
  history: KitBookingRow[];
  manages: boolean;
  showRetired: boolean;
  departments: Option[];
  defaultSilo: string;
}) {
  const { t } = useT();
  const [kind, setKind] = useState<KindFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');

  const count = (k: KitEntry['kind'], s?: KitEntry['status']) => items.filter((i) => i.kind === k && (!s || i.status === s) && i.status !== 'retired').length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => kind === 'all' || i.kind === kind)
      .filter((i) => status === 'all' || i.status === status)
      .filter((i) => !q || [i.asset_no, i.serial, i.device_id, i.model, i.holder?.name].some((v) => v?.toLowerCase().includes(q)))
      // Booked out first, then by number.
      .sort((a, b) => Number(b.status === 'in_use') - Number(a.status === 'in_use') || a.asset_no.localeCompare(b.asset_no, undefined, { numeric: true }));
  }, [items, kind, status, query]);
  const keep = showRetired ? '&retired=1' : '';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('Hard hats out')} value={`${count('hard_hat', 'in_use')}`} sub={t('of {n}', { n: count('hard_hat') })} />
        <Stat label={t('Radios out')} value={`${count('radio', 'in_use')}`} sub={t('of {n}', { n: count('radio') })} />
        <Stat label={t('In repair')} value={`${items.filter((i) => i.status === 'repair').length}`} tone={items.some((i) => i.status === 'repair') ? 'text-amber-500' : undefined} />
        <Stat label={t('Lost')} value={`${items.filter((i) => i.status === 'lost').length}`} tone={items.some((i) => i.status === 'lost') ? 'text-red-500' : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <section className="frost overflow-hidden rounded-xl border border-border">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-3">
            <div className="inline-flex rounded-lg border border-border p-0.5 text-xs font-semibold">
              {(['all', 'hard_hat', 'radio'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setKind(k)}
                  className={cn('rounded-md px-3 py-1.5', kind === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {k === 'all' ? t('All') : k === 'hard_hat' ? t('Hard hats') : t('Radios')}
                </button>
              ))}
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label={t('Status')}
              className="h-9 rounded-md border border-border bg-bg-soft/80 px-2 text-xs font-semibold">
              <option value="all">{t('Any status')}</option>
              <option value="in_use">{t('Booked out')}</option>
              <option value="available">{t('Available')}</option>
              <option value="repair">{t('In repair')}</option>
              <option value="lost">{t('Lost')}</option>
              {showRetired ? <option value="retired">{t('Out of service')}</option> : null}
            </select>
            <label className="relative ml-auto min-w-[12rem] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Number, serial or name')}
                className="h-9 w-full rounded-md border border-border bg-bg-soft/80 pl-8 pr-2 text-sm" />
            </label>
          </div>
          <div className="max-h-[65vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-bg-card text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">{t('Number')}</th>
                  <th className="px-3 py-2">{t('With')}</th>
                  <th className="hidden px-3 py-2 sm:table-cell">{t('Since')}</th>
                  <th className="px-3 py-2">{t('Status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                    {items.length === 0 ? t('Nothing in the register yet.') : t('Nothing matches.')}
                  </td></tr>
                ) : shown.map((i) => (
                  <tr key={i.id} className={cn('hover:bg-muted/50', picked?.id === i.id && 'bg-muted/60')}>
                    <td className="px-3 py-2">
                      <Link href={`/kit?item=${i.id}${keep}`} className="inline-flex items-center gap-2 font-mono font-bold hover:underline">
                        <KindIcon kind={i.kind} className="h-4 w-4 text-muted-foreground" />{i.asset_no}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {i.holder ? (
                        <span className="inline-flex items-center gap-1.5 font-semibold">
                          {i.holder.name ?? t('Officer')}
                          {i.holder.how === 'device' ? <Smartphone className="h-3.5 w-3.5 text-muted-foreground" aria-label={t('Booked itself when the shift started on it')} /> : null}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-muted-foreground sm:table-cell">
                      {i.holder ? timeAgo(i.holder.since) : ''}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', STATUS[i.status].tone)}>{t(STATUS[i.status].word)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <span>{t('{shown} of {total}', { shown: shown.length, total: items.length })}</span>
            <Link href={showRetired ? '/kit' : '/kit?retired=1'} className="font-semibold hover:text-foreground">
              {showRetired ? t('Hide out of service') : t('Show out of service')}
            </Link>
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {picked ? (
            <ItemPanel key={picked.id} item={picked} history={history} manages={manages} departments={departments} close={`/kit${showRetired ? '?retired=1' : ''}`} />
          ) : manages ? (
            <AddPanel departments={departments} defaultSilo={defaultSilo} />
          ) : (
            <p className="frost rounded-xl border border-border p-4 text-sm text-muted-foreground">{t('Pick a number to see who had it before.')}</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Stat({ label: l, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="frost rounded-xl border border-border px-4 py-3">
      <p className="text-xs font-semibold uppercase text-muted-foreground">{l}</p>
      <p className={cn('mt-1 text-2xl font-black tabular-nums', tone)}>{value}{sub ? <span className="ml-1 text-sm font-semibold text-muted-foreground">{sub}</span> : null}</p>
    </div>
  );
}

function Result({ state }: { state: KitFormState }) {
  if (state?.error) return <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">{state.error}</p>;
  if (state?.done) return <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">{state.done}</p>;
  return null;
}

/** One item: who has it, receive it back, change it, its history, take it out of service. */
function ItemPanel({ item, history, manages, departments, close }: {
  item: KitEntry; history: KitBookingRow[]; manages: boolean; departments: Option[]; close: string;
}) {
  const { t } = useT();
  const [tab, setTab] = useState<'history' | 'edit'>('history');
  const [received, receive, receiving] = useActionState(receiveKitAction, null);
  const [retired, retire, retiring] = useActionState(retireKitAction, null);
  const [condition, setCondition] = useState<'fine' | 'damaged' | 'lost'>('fine');

  return (
    <div className="frost space-y-4 rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-mono text-xl font-black"><KindIcon kind={item.kind} className="h-5 w-5" />{item.asset_no}</p>
          <p className="text-xs text-muted-foreground">
            {[item.kind === 'hard_hat' ? t('Hard hat') : t('Radio'), item.model, item.serial ? t('Serial {s}', { s: item.serial }) : null, item.device_id].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Link href={close} aria-label={t('Close')} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></Link>
      </div>

      {item.holder ? (
        <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
          <p className="font-semibold">{item.holder.name ?? t('Officer')}</p>
          <p className="text-xs text-muted-foreground">
            {t('Since {time}', { time: formatSaTime(item.holder.since) })}
            {item.holder.how === 'device' ? ` · ${t('booked itself when the shift started on it')}` : ''}
          </p>
          {manages ? (
            <form action={receive} className="mt-3 space-y-2">
              <input type="hidden" name="booking_id" value={item.holder.bookingId} />
              <div className="flex gap-1 text-xs font-semibold">
                {(['fine', 'damaged', 'lost'] as const).map((c) => (
                  <label key={c} className={cn('flex-1 cursor-pointer rounded-md border px-2 py-1.5 text-center',
                    condition === c ? 'border-primary bg-primary/15' : 'border-border')}>
                    <input type="radio" name="condition" value={c} checked={condition === c} onChange={() => setCondition(c)} className="sr-only" />
                    {c === 'fine' ? t('Fine') : c === 'damaged' ? t('Damaged') : t('Lost')}
                  </label>
                ))}
              </div>
              {condition !== 'fine' ? (
                <input name="note" required maxLength={300} placeholder={t('What happened')} className={field} />
              ) : null}
              <Result state={received} />
              <button type="submit" disabled={receiving} className="h-9 w-full rounded-md bg-primary text-sm font-semibold disabled:opacity-60">
                {receiving ? t('Saving…') : t('Receive back')}
              </button>
            </form>
          ) : null}
        </div>
      ) : item.status_note ? (
        <p className="rounded-lg border border-border p-3 text-sm">{item.status_note}</p>
      ) : null}

      {manages ? (
        <div className="inline-flex rounded-lg border border-border p-0.5 text-xs font-semibold">
          {(['history', 'edit'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={cn('rounded-md px-3 py-1.5', tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
              {k === 'history' ? t('Who had it') : t('Change')}
            </button>
          ))}
        </div>
      ) : null}

      {tab === 'history' || !manages ? (
        <ol className="space-y-2 text-sm">
          {history.length === 0 ? <li className="text-muted-foreground">{t('Not booked out yet.')}</li> : history.map((b) => (
            <li key={b.id} className="border-l-2 border-border pl-3">
              <p className="font-semibold">{b.name ?? t('Officer')}</p>
              <p className="text-xs text-muted-foreground">
                {formatSaTime(b.booked_at)} → {b.returned_at ? formatSaTime(b.returned_at) : t('still has it')}
                {b.return_condition ? ` · ${t(RETURNED[b.return_condition] ?? b.return_condition)}` : ''}
                {b.return_note && b.return_note !== 'End of shift' ? ` · ${b.return_note}` : ''}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <>
          <KitForm item={item} departments={departments} defaultSilo={item.silo} />
          {item.status !== 'retired' && item.status !== 'in_use' ? (
            <form action={retire} className="space-y-2 border-t border-border pt-3">
              <input type="hidden" name="id" value={item.id} />
              <input name="reason" required maxLength={300} placeholder={t('Why it is taken out of service')} className={field} />
              <Result state={retired} />
              <button type="submit" disabled={retiring} className="h-9 w-full rounded-md border border-red-500/50 text-sm font-semibold text-red-500 disabled:opacity-60">
                {t('Take out of service')}
              </button>
            </form>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Add one item, or a run of numbers. */
function AddPanel({ departments, defaultSilo }: { departments: Option[]; defaultSilo: string }) {
  const { t } = useT();
  const [mode, setMode] = useState<'run' | 'one'>('run');
  const [state, action, pending] = useActionState(addRangeAction, null);
  return (
    <div className="frost space-y-3 rounded-xl border border-border p-4">
      <div className="inline-flex rounded-lg border border-border p-0.5 text-xs font-semibold">
        {(['run', 'one'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setMode(k)}
            className={cn('rounded-md px-3 py-1.5', mode === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
            {k === 'run' ? t('Add many') : t('Add one')}
          </button>
        ))}
      </div>
      {mode === 'one' ? <KitForm item={null} departments={departments} defaultSilo={defaultSilo} /> : (
        <form action={action} className="space-y-3">
          <p className="text-xs text-muted-foreground">{t('Numbers already in the register are skipped.')}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="run-kind">{t('What')}</label>
              <select id="run-kind" name="kind" defaultValue="hard_hat" className={field}>
                <option value="hard_hat">{t('Hard hats')}</option>
                <option value="radio">{t('Radios')}</option>
              </select>
            </div>
            <Department id="run-silo" departments={departments} defaultSilo={defaultSilo} />
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className={label} htmlFor="prefix">{t('Prefix')}</label>
              <input id="prefix" name="prefix" defaultValue="HH" maxLength={12} className={field} />
            </div>
            <div>
              <label className={label} htmlFor="from">{t('From')}</label>
              <input id="from" name="from" type="number" min={0} defaultValue={1} required className={field} />
            </div>
            <div>
              <label className={label} htmlFor="to">{t('To')}</label>
              <input id="to" name="to" type="number" min={0} defaultValue={300} required className={field} />
            </div>
            <div>
              <label className={label} htmlFor="digits">{t('Digits')}</label>
              <input id="digits" name="digits" type="number" min={1} max={6} defaultValue={4} className={field} />
            </div>
          </div>
          <div>
            <label className={label} htmlFor="run-model">{t('Model')}{' '}<span className="font-normal normal-case">{t('(optional)')}</span></label>
            <input id="run-model" name="model" maxLength={60} className={field} />
          </div>
          <p className="text-xs text-muted-foreground">{t('Example: HH, 1 to 300, 4 digits gives HH-0001 to HH-0300.')}</p>
          <Result state={state} />
          <button type="submit" disabled={pending} className="h-10 w-full rounded-md bg-primary text-sm font-semibold disabled:opacity-60">
            {pending ? t('Adding…') : t('Add them')}
          </button>
        </form>
      )}
    </div>
  );
}

function Department({ id, departments, defaultSilo }: { id: string; departments: Option[]; defaultSilo: string }) {
  const { t } = useT();
  return (
    <div>
      <label className={label} htmlFor={id}>{t('Department')}</label>
      <select id={id} name="silo" defaultValue={departments.length === 1 ? departments[0]!.id : defaultSilo} required className={field}>
        <option value="" disabled>{t('Choose')}</option>
        {departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>
    </div>
  );
}

/** One item's details: number, serial, the Radio ID when the app runs on it. */
function KitForm({ item, departments, defaultSilo }: { item: KitEntry | null; departments: Option[]; defaultSilo: string }) {
  const { t } = useT();
  const [state, action, pending] = useActionState(saveKitAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={item?.id ?? ''} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="kind">{t('What')}</label>
          <select id="kind" name="kind" defaultValue={item?.kind ?? 'hard_hat'} className={field}>
            <option value="hard_hat">{t('Hard hat')}</option>
            <option value="radio">{t('Radio')}</option>
          </select>
        </div>
        <Department id="silo" departments={departments} defaultSilo={item?.silo ?? defaultSilo} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="asset_no">{t('Number on it')}</label>
          <input id="asset_no" name="asset_no" defaultValue={item?.asset_no ?? ''} required maxLength={24} placeholder="HH-0001" className={cn(field, 'font-mono uppercase')} />
        </div>
        <div>
          <label className={label} htmlFor="serial">{t('Serial')}{' '}<span className="font-normal normal-case">{t('(optional)')}</span></label>
          <input id="serial" name="serial" defaultValue={item?.serial ?? ''} maxLength={60} className={field} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="device_id">{t('Radio ID')}{' '}<span className="font-normal normal-case">{t('(if the app runs on it)')}</span></label>
        <input id="device_id" name="device_id" defaultValue={item?.device_id ?? ''} maxLength={12} placeholder="HT-XXXX-XXXX" className={cn(field, 'font-mono uppercase')} />
        <p className="mt-1 text-xs text-muted-foreground">{t('With this, it books itself to whoever starts their shift on it.')}</p>
      </div>
      <div>
        <label className={label} htmlFor="model">{t('Model')}{' '}<span className="font-normal normal-case">{t('(optional)')}</span></label>
        <input id="model" name="model" defaultValue={item?.model ?? ''} maxLength={60} className={field} />
      </div>
      {item && item.status !== 'in_use' && item.status !== 'retired' ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="status">{t('Status')}</label>
            <select id="status" name="status" defaultValue={item.status} className={field}>
              <option value="available">{t('Available')}</option>
              <option value="repair">{t('In repair')}</option>
              <option value="lost">{t('Lost')}</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="status_note">{t('Why')}{' '}<span className="font-normal normal-case">{t('(optional)')}</span></label>
            <input id="status_note" name="status_note" maxLength={300} className={field} />
          </div>
        </div>
      ) : null}
      <Result state={state} />
      <button type="submit" disabled={pending} className="h-10 w-full rounded-md bg-primary text-sm font-semibold disabled:opacity-60">
        {pending ? t('Saving…') : item ? t('Save') : t('Add to the register')}
      </button>
    </form>
  );
}
