'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, Play, Repeat, Users } from 'lucide-react';
import {
  dayLabel, lineActive, monthGrid, saTime, shiftState, stateWords,
  type MyMonth, type ScheduleLine, type SwapView, type WhosOnRow,
} from '@criticom/api';
import { useToast } from '@/components/toast';
import { confirmShiftAction, requestSwapAction, respondSwapAction, startShiftAction, withdrawSwapAction, type MineResult } from './actions';
import { useT } from '@/components/i18n';
import { T } from '@/components/i18n';

const btn = 'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-60';
const input = 'h-9 rounded-md border border-border bg-bg-soft px-2 text-sm';
const card = 'rounded-lg border border-border bg-bg-card p-4';

export function MySchedule({
  userId, today, month, monthName, prevHref, nextHref, data, now, whosOn, swaps, options, ahead, startsAtConsole,
}: {
  userId: string;
  today: string;
  month: string;
  monthName: string;
  prevHref: string;
  nextHref: string;
  data: MyMonth;
  now: ScheduleLine | null;
  whosOn: WhosOnRow[];
  swaps: SwapView[];
  options: WhosOnRow[];
  ahead: ScheduleLine[];
  startsAtConsole: boolean;
}) {
  const { t } = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const tpl = useMemo(() => new Map(data.templates.map((t) => [t.id, t])), [data.templates]);
  const nameOf = (l: { template_id: string | null; activity_type?: string | null }) =>
    (l.template_id ? tpl.get(l.template_id)?.name : null) ?? l.activity_type ?? 'Shift';

  const run = (fn: () => Promise<MineResult>, ok: string) => start(async () => {
    const res = await fn();
    if (res.error) toast.push({ title: 'Not done', body: res.error, tone: 'critical' });
    else toast.push({ title: res.message ?? ok, tone: 'success' });
  });
  const fd = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };

  const state = now && now.start_at && now.end_at
    ? shiftState({ start_at: now.start_at, end_at: now.end_at, status: now.status, cancelled_at: now.cancelled_at }, now.attendance, data.settings)
    : null;
  const canStart = startsAtConsole && now && !now.attendance?.checked_in_at && now.start_at
    && Date.parse(now.start_at) - 3 * 3_600_000 <= Date.now();

  return (
    <div className="space-y-6">
      {/* Now, or next */}
      <section className={`${card} ${state === 'late' || state === 'not_started' ? 'border-danger/60' : ''}`}>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> {now && now.start_at && Date.parse(now.start_at) <= Date.now() ? 'Your shift now' : 'Your next shift'}
        </p>
        {now && now.start_at && now.end_at ? (
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xl font-bold">{nameOf(now)} · {dayLabel(now.duty_date ?? today)} · {saTime(now.start_at)}–{saTime(now.end_at)}</p>
              <p className="text-sm text-muted-foreground">{[now.post, now.station, now.vehicle, now.call_sign].filter(Boolean).join(' · ') || 'Post given at the start of the shift'}</p>
              {state ? (
                <p className={`mt-1 text-sm font-semibold ${state === 'late' || state === 'not_started' ? 'text-danger' : state === 'started_late' ? 'text-warning' : ''}`}>
                  {stateWords(state, now.attendance)}
                </p>
              ) : null}
              {!startsAtConsole && !now.attendance?.checked_in_at ? (
                <p className="mt-1 text-xs text-muted-foreground">{t('Start your shift in the app: going on duty checks you in.')}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {!now.acknowledged_at ? (
                <button type="button" disabled={pending} onClick={() => run(() => confirmShiftAction(fd({ id: now.id })), 'Shift confirmed')}
                  className={`${btn} border border-border hover:bg-muted`}>
                  <CheckCircle2 className="h-4 w-4" /> {' '}{t('I have read this shift')}</button>
              ) : null}
              {canStart ? (
                <button type="button" disabled={pending} onClick={() => run(() => startShiftAction(), 'Started')}
                  className={`${btn} bg-primary text-primary-foreground`}>
                  <Play className="h-4 w-4" /> {' '}{t('Start shift')}</button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{t('Nothing on your roster in the next day.')}</p>
        )}
      </section>

      {/* The month */}
      <section className={card}>
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 font-semibold"><CalendarDays className="h-4 w-4" /> {monthName}</p>
          <div className="flex gap-1">
            <Link href={prevHref} aria-label={t('Previous month')} className="rounded-md border border-border p-1.5 hover:bg-muted"><ChevronLeft className="h-4 w-4" /></Link>
            <Link href={nextHref} aria-label={t('Next month')} className="rounded-md border border-border p-1.5 hover:bg-muted"><ChevronRight className="h-4 w-4" /></Link>
          </div>
        </div>
        <MonthCalendar month={month} today={today} data={data} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <WhosOn rows={whosOn} today={today} me={userId} nameOf={nameOf} />
        <Swaps me={userId} swaps={swaps.filter((s) => s.requester_id === userId || s.partner_id === userId)} ahead={ahead} options={options}
          nameOf={nameOf} />
      </div>
    </div>
  );
}

function MonthCalendar({ month, today, data }: { month: string; today: string; data: MyMonth }) {
  const { t } = useT();
  const tpl = new Map(data.templates.map((t) => [t.id, t]));
  const holiday = new Map(data.holidays.map((h) => [h.day, h.name]));
  const byDay = new Map<string, ScheduleLine[]>();
  for (const l of data.lines) {
    if (!l.duty_date) continue;
    const list = byDay.get(l.duty_date) ?? [];
    list.push(l);
    byDay.set(l.duty_date, list);
  }
  const leaveOn = (day: string) => data.leave.find((l) => l.eff_from <= day && l.eff_to >= day);
  const weeks = monthGrid(month);
  const total = data.lines.filter((l) => l.duty_date?.startsWith(month) && lineActive(l.status, l.cancelled_at)).length;
  return (
    <div className="mt-3">
      <p className="mb-2 text-xs text-muted-foreground">{t('{total} shift{value} this month', { total, value: total === 1 ? '' : 's' })}</p>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border text-xs">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="bg-bg-soft px-2 py-1.5 text-center font-bold uppercase tracking-wider text-muted-foreground">{d}</div>
        ))}
        {weeks.flat().map(({ day, inMonth }) => {
          const lines = (byDay.get(day) ?? []).filter((l) => !l.cancelled_at);
          const leave = leaveOn(day);
          const h = holiday.get(day);
          return (
            <div key={day} className={`min-h-20 space-y-1 p-1.5 ${inMonth ? 'bg-bg-card' : 'bg-bg-card/40'} ${day === today ? 'ring-2 ring-inset ring-primary' : ''}`}>
              <p className="flex justify-between text-[10px] font-bold text-muted-foreground">
                <span>{Number(day.slice(8))}</span>
                {h ? <span className="truncate text-severity-medium-ink" title={h}>{h}</span> : null}
              </p>
              {lines.map((l) => {
                const t = l.template_id ? tpl.get(l.template_id) : undefined;
                if (l.status === 'Leave') return <p key={l.id} className="rounded bg-muted px-1 py-0.5 text-[10px] font-semibold"><T s="On leave" /></p>;
                return (
                  <p key={l.id} className="truncate rounded px-1 py-0.5 text-[10px] font-semibold"
                    style={{ background: `${t?.colour ?? '#64748b'}33`, color: t?.colour ?? undefined }}
                    title={`${t?.name ?? l.activity_type} ${l.start_at ? saTime(l.start_at) : ''}${l.post ? ` · ${l.post}` : ''}`}>
                    {t?.code ?? ''} {l.start_at ? saTime(l.start_at) : ''}
                  </p>
                );
              })}
              {!lines.length && leave ? (
                <p className={`rounded px-1 py-0.5 text-[10px] font-semibold ${leave.status === 'Approved' ? 'bg-muted' : 'border border-dashed border-border'}`}>
                  {leave.status === 'Approved' ? 'Leave' : 'Leave asked'}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WhosOn({ rows, today, me, nameOf }: { rows: WhosOnRow[]; today: string; me: string; nameOf: (l: WhosOnRow) => string }) {
  const { t } = useT();
  const now = Date.now();
  const on = rows.filter((r) => lineActive(r.status, r.cancelled_at) && Date.parse(r.start_at!) <= now && Date.parse(r.end_at!) > now);
  const later = rows.filter((r) => lineActive(r.status, r.cancelled_at) && Date.parse(r.start_at!) > now);
  const off = rows.filter((r) => r.status === 'Leave' && r.start_at!.slice(0, 10) >= today.slice(0, 10));
  const row = (r: WhosOnRow) => (
    <li key={r.id} className="flex justify-between gap-2">
      <span className={r.user_id === me ? 'font-semibold' : ''}>{r.user_name}</span>
      <span className="text-muted-foreground">{nameOf(r)} {saTime(r.start_at!)}–{saTime(r.end_at!)}{r.post ? ` · ${r.post}` : ''}</span>
    </li>
  );
  return (
    <section className={card}>
      <p className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4" /> {' '}{t('Who\'s on today')}</p>
      {!rows.length ? <p className="mt-2 text-sm text-muted-foreground">{t('Nobody is on the issued roster today.')}</p> : null}
      {on.length ? <><p className="mt-3 text-xs font-bold uppercase text-muted-foreground">{t('On now ({length})', { length: on.length })}</p><ul className="mt-1 space-y-1 text-sm">{on.map(row)}</ul></> : null}
      {later.length ? <><p className="mt-3 text-xs font-bold uppercase text-muted-foreground">{t('Later ({length})', { length: later.length })}</p><ul className="mt-1 space-y-1 text-sm">{later.map(row)}</ul></> : null}
      {off.length ? (
        <>
          <p className="mt-3 text-xs font-bold uppercase text-muted-foreground">{t('Off today ({length})', { length: off.length })}</p>
          <ul className="mt-1 space-y-1 text-sm">{off.map((r) => <li key={r.id}>{r.user_name}</li>)}</ul>
        </>
      ) : null}
    </section>
  );
}

function Swaps({ me, swaps, ahead, options, nameOf }: {
  me: string; swaps: SwapView[]; ahead: ScheduleLine[]; options: WhosOnRow[]; nameOf: (l: { template_id: string | null; activity_type?: string | null }) => string;
}) {
  const { t } = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const mine = ahead.filter((l) => lineActive(l.status, l.cancelled_at) && l.start_at && Date.parse(l.start_at) > Date.now() + 3_600_000);
  const [myLine, setMyLine] = useState(mine[0]?.id ?? '');
  const [theirLine, setTheirLine] = useState('');
  const [note, setNote] = useState('');
  const run = (fn: () => Promise<MineResult>, ok: string, after?: () => void) => start(async () => {
    const res = await fn();
    if (res.error) toast.push({ title: 'Not done', body: res.error, tone: 'critical' });
    else { toast.push({ title: ok, tone: 'success' }); after?.(); }
  });
  const fd = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };
  const describe = (l: { template_id: string | null; activity_type?: string | null; start_at: string | null; duty_date?: string | null; user_name?: string } | null) =>
    l && l.start_at ? `${nameOf(l)} ${dayLabel(l.duty_date ?? l.start_at.slice(0, 10))} ${saTime(l.start_at)}` : 'a shift';
  const open = swaps.filter((s) => s.status === 'Requested' || s.status === 'Accepted');
  const STATUS: Record<string, string> = { Requested: 'Waiting for them', Accepted: 'Waiting for your supervisor', Approved: 'Approved', Declined: 'Declined', Refused: 'Not approved', Withdrawn: 'Withdrawn', Expired: 'Expired' };

  return (
    <section className={card}>
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 font-semibold"><Repeat className="h-4 w-4" /> {' '}{t('Swaps')}</p>
        {!asking && mine.length && options.length ? (
          <button type="button" onClick={() => setAsking(true)} className={`${btn} h-8 border border-border hover:bg-muted`}>{t('Ask for a swap')}</button>
        ) : null}
      </div>
      {asking ? (
        <div className="mt-3 space-y-2 rounded-md border border-dashed border-border p-3">
          <label className="block text-xs text-muted-foreground">{t('My shift')}<select className={`${input} mt-1 w-full`} value={myLine} onChange={(e) => setMyLine(e.target.value)}>
              {mine.map((l) => <option key={l.id} value={l.id}>{describe(l)}</option>)}
            </select>
          </label>
          <label className="block text-xs text-muted-foreground">{t('For their shift')}<select className={`${input} mt-1 w-full`} value={theirLine} onChange={(e) => setTheirLine(e.target.value)}>
              <option value="">{t('Choose…')}</option>
              {options.map((l) => <option key={l.id} value={l.id}>{l.user_name}: {describe(l)}</option>)}
            </select>
          </label>
          <input className={`${input} w-full`} placeholder={t('Note (optional)')} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" disabled={pending || !myLine || !theirLine}
              onClick={() => run(() => requestSwapAction(fd({ myLine, theirLine, note })), 'Swap asked for', () => setAsking(false))}
              className={`${btn} bg-primary text-primary-foreground`}>{t('Ask')}</button>
            <button type="button" onClick={() => setAsking(false)} className={`${btn} border border-border`}>{t('Cancel')}</button>
          </div>
          <p className="text-xs text-muted-foreground">{t('They accept, then your supervisor approves. Until then your shift stays yours.')}</p>
        </div>
      ) : null}
      {!swaps.length && !asking ? <p className="mt-2 text-sm text-muted-foreground">{t('No swaps.')}</p> : null}
      <ul className="mt-3 space-y-2 text-sm">
        {swaps.slice(0, 10).map((s) => {
          const mineSide = s.requester_id === me ? s.mine : s.theirs;
          const otherSide = s.requester_id === me ? s.theirs : s.mine;
          return (
            <li key={s.id} className="rounded-md border border-border p-2">
              <p>{t('Your {describe} for {value}\'s {describe2}', { describe: describe(mineSide), value: otherSide?.user_name ?? 'a colleague', describe2: describe(otherSide) })}</p>
              <p className="text-xs text-muted-foreground">{STATUS[s.status] ?? s.status}{s.decision_comment ? ` · ${s.decision_comment}` : ''}</p>
              {open.includes(s) ? (
                <div className="mt-1.5 flex gap-1.5">
                  {s.partner_id === me && s.status === 'Requested' ? (
                    <>
                      <button type="button" disabled={pending} onClick={() => run(() => respondSwapAction(fd({ id: s.id, answer: 'accept' })), 'Accepted')} className={`${btn} h-8 bg-severity-low/20 text-severity-low-ink`}>{t('Accept')}</button>
                      <button type="button" disabled={pending} onClick={() => run(() => respondSwapAction(fd({ id: s.id, answer: 'decline' })), 'Declined')} className={`${btn} h-8 border border-border`}>{t('Decline')}</button>
                    </>
                  ) : null}
                  {s.requester_id === me ? (
                    <button type="button" disabled={pending} onClick={() => run(() => withdrawSwapAction(fd({ id: s.id })), 'Withdrawn')} className={`${btn} h-8 border border-border`}>{t('Withdraw')}</button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
