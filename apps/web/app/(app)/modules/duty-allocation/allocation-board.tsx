'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import type { AllocationResult, AvailableStaff } from '@criticom/api';
import { ox } from '@/components/office/styles';
import { useToast } from '@/components/toast';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { notify } from '@/components/office/notice';
import { tx } from '@criticom/db/i18n';
import { allocateAction } from './actions';

type Sign = { id: string; callSign: string; start: string; stop: string; rank: string | null; description: string | null };
type Pair = { sign: Sign; member: AvailableStaff };

/**
 * The old allocation screen: call sign slots on the left, staff on the
 * right. Tick both, Allocate selected pairs them in order (first call sign to
 * first member), then Confirm & save books every day in the period.
 */
export function AllocationBoard({
  sectionId, from, to, canEdit, signs, staff, dept, printHref,
}: {
  sectionId: string;
  /** The department, for the controller tier (?dept=). */
  dept: string | null;
  /** The next step once booked: the duty sheet for the first day. */
  printHref: string;
  from: string;
  to: string;
  canEdit: boolean;
  signs: Sign[];
  staff: AvailableStaff[];
}) {
  const { t } = useT();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pickSigns, setPickSigns] = useState<string[]>([]);
  const [pickStaff, setPickStaff] = useState<string[]>([]);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [search, setSearch] = useState('');
  const [rank, setRank] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<AllocationResult | null>(null);

  const pairedSigns = new Set(pairs.map((p) => p.sign.id));
  const pairedStaff = new Set(pairs.map((p) => p.member.userId));
  const ranks = useMemo(() => [...new Set(staff.map((s) => s.rank).filter(Boolean) as string[])].sort(), [staff]);
  const shownStaff = staff.filter((s) =>
    !pairedStaff.has(s.userId)
    && (!rank || s.rank === rank)
    && (!search.trim() || `${s.name} ${s.force ?? ''} ${s.badge}`.toLowerCase().includes(search.trim().toLowerCase())));
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const allocateSelected = () => {
    const n = Math.min(pickSigns.length, pickStaff.length);
    if (n === 0) {
      toast.push({ title: t('Tick at least one call sign and one member'), tone: 'warning' });
      return;
    }
    const next: Pair[] = [];
    for (let i = 0; i < n; i++) {
      const sign = signs.find((s) => s.id === pickSigns[i]);
      const member = staff.find((s) => s.userId === pickStaff[i]);
      if (sign && member) next.push({ sign, member });
    }
    setPairs((p) => [...p, ...next]);
    setPickSigns([]);
    setPickStaff([]);
  };

  const save = () => {
    if (pairs.length === 0) return;
    start(async () => {
      const res = await allocateAction({
        sectionId, from, to, note: note.trim() || null,
        lines: pairs.map((p) => ({ post_id: p.sign.id, user_id: p.member.userId })),
      });
      if (res.error || !res.result) {
        toast.push({ title: t('Not allocated'), body: res.error, tone: 'critical' });
        return;
      }
      setResult(res.result);
      notify(t('{count} duties allocated', { count: res.result.created }),
        res.result.skipped.length ? t('{count} left out: see the list below', { count: res.result.skipped.length }) : undefined,
        res.result.created > 0 ? { label: tx('Next: print the duty sheet'), href: printHref } : undefined);
      setPairs([]);
      setNote('');
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={ox.card}>
          <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('Call signs — slots')}</h2>
            <span className="text-xs text-muted-foreground">{t('{count} free', { count: signs.length - pairedSigns.size })}</span></div>
          <div className="max-h-[26rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-bg-card"><tr>
                <th className={ox.th}>{t('Alloc')}</th><th className={ox.th}>{t('Call sign')}</th>
                <th className={ox.th}>{t('Start')}</th><th className={ox.th}>{t('Stop')}</th><th className={ox.th}>{t('Description')}</th>
              </tr></thead>
              <tbody>
                {signs.filter((s) => !pairedSigns.has(s.id)).map((s) => {
                  const order = pickSigns.indexOf(s.id);
                  return (
                    <tr key={s.id} className={cn(ox.row, order >= 0 && 'bg-primary/10')}>
                      <td className={ox.td}>
                        <label className="flex items-center gap-1.5">
                          <input type="checkbox" disabled={!canEdit} checked={order >= 0} onChange={() => toggle(pickSigns, setPickSigns, s.id)} className="h-4 w-4" />
                          {order >= 0 ? <span className="text-xs font-bold text-primary">{order + 1}</span> : null}
                        </label>
                      </td>
                      <td className={cn(ox.td, 'font-mono font-bold')}>{s.callSign}</td>
                      <td className={cn(ox.td, 'font-mono')}>{s.start}</td>
                      <td className={cn(ox.td, 'font-mono')}>{s.stop}</td>
                      <td className={cn(ox.td, 'text-muted-foreground')}>{[s.rank, s.description].filter(Boolean).join(' · ')}</td>
                    </tr>
                  );
                })}
                {signs.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    {t('This section has no call signs yet.')}{' '}
                    <Link href={`/modules/call-signs?${dept ? `dept=${dept}&` : ''}section=${sectionId}&id=new`} className="font-semibold text-primary hover:underline">{t('+ Add call signs')}</Link>
                  </td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className={ox.card}>
          <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('Staff — available for allocation')}</h2></div>
          <div className="flex gap-2 border-b border-border px-4 py-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search officer…')} className={ox.input} />
            <select value={rank} onChange={(e) => setRank(e.target.value)} className={cn(ox.input, 'w-32')} aria-label={t('Rank')}>
              <option value="">{t('All ranks')}</option>
              {ranks.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="max-h-[23rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-bg-card"><tr>
                <th className={ox.th}>{t('Alloc')}</th><th className={ox.th}>{t('Rank')}</th><th className={ox.th}>{t('Force')}</th>
                <th className={ox.th}>{t('W/E')}</th><th className={ox.th}>{t('Name')}</th>
              </tr></thead>
              <tbody>
                {shownStaff.map((s) => {
                  const order = pickStaff.indexOf(s.userId);
                  return (
                    <tr key={s.userId} className={cn(ox.row, order >= 0 && 'bg-primary/10')}>
                      <td className={ox.td}>
                        <label className="flex items-center gap-1.5">
                          <input type="checkbox" disabled={!canEdit} checked={order >= 0} onChange={() => toggle(pickStaff, setPickStaff, s.userId)} className="h-4 w-4" />
                          {order >= 0 ? <span className="text-xs font-bold text-primary">{order + 1}</span> : null}
                        </label>
                      </td>
                      <td className={ox.td}>{s.rank ?? ''}</td>
                      <td className={cn(ox.td, 'font-mono')}>{s.force ?? ''}</td>
                      <td className={ox.td}>{s.weekend ?? ''}</td>
                      <td className={ox.td}>
                        {s.name}
                        {s.away ? <div className="text-xs text-severity-high-ink">{s.away}</div> : null}
                      </td>
                    </tr>
                  );
                })}
                {shownStaff.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">{t('Nobody to show.')}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {canEdit ? (
        <section className={ox.card}>
          <div className={ox.cardHead}>
            <h2 className={ox.cardTitle}>{t('Allocation')}</h2>
            <span className="text-xs text-muted-foreground">{t('{pairs} pairs × {days} days', { pairs: pairs.length, days })}</span>
          </div>
          {pairs.length > 0 ? (
            <ul className="divide-y divide-border text-sm">
              {pairs.map((p) => (
                <li key={p.sign.id} className="flex items-center justify-between px-4 py-2">
                  <span><span className="font-mono font-bold">{p.sign.callSign}</span> {p.sign.start}–{p.sign.stop} → {p.member.rank ? `${p.member.rank} ` : ''}{p.member.force ? `${p.member.force} ` : ''}{p.member.name}</span>
                  <button type="button" onClick={() => setPairs((all) => all.filter((x) => x.sign.id !== p.sign.id))} aria-label={t('Remove')}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-fg"><X className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-muted-foreground">{t('Tick call signs and staff above, then Allocate selected.')}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-border p-4">
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={t('Note on the duty sheet (optional)')} className={cn(ox.input, 'min-w-[14rem] flex-1')} />
            <button type="button" onClick={allocateSelected} disabled={pending} className={ox.secondary}>{t('Allocate selected')}</button>
            <button type="button" onClick={() => { setPairs([]); setPickSigns([]); setPickStaff([]); }} disabled={pending} className={ox.secondary}>{t('Clear all')}</button>
            <button type="button" onClick={save} disabled={pending || pairs.length === 0} className={ox.primary}>{pending ? t('Saving…') : t('Confirm & save')}</button>
          </div>
        </section>
      ) : null}

      {result && result.skipped.length > 0 ? (
        <section className={cn(ox.card, 'border-severity-high/40')}>
          <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('Left out ({count})', { count: result.skipped.length })}</h2></div>
          <ul className="divide-y divide-border text-sm">
            {result.skipped.map((s, i) => (
              <li key={`${s.name}-${s.day}-${i}`} className="px-4 py-2"><span className="font-semibold">{s.name}</span> · {s.call_sign} · {s.day}: <span className="text-muted-foreground">{s.reason}</span></li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
