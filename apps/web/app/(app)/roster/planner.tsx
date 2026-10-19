'use client';

import { useMemo, useState, useTransition } from 'react';
import { CalendarPlus, Repeat, Scale, Send, X } from 'lucide-react';
import {
  dayLabel, lineActive, monthRange, saTime, shiftState, stateWords,
  type PublicHoliday, type Rotation, type ScheduleLine, type ScheduleSettings, type ShiftTemplate, type SwapView, type TeamMember,
} from '@criticom/api';
import type { Database } from '@criticom/db';
import { useToast } from '@/components/toast';
import {
  addEndorsementAction, addShiftAction, cancelShiftAction, deactivateEndorsementAction, decideSwapAction,
  generateAction, outcomeAction, publishAction, type RosterResult,
} from './actions';
import { useT } from '@/components/i18n';
import { T } from '@/components/i18n';

type Endorsement = Database['public']['Tables']['endorsements']['Row'];

const btn = 'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-60';
const input = 'h-9 rounded-md border border-border bg-bg-soft px-2 text-sm';
const label = 'text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground';
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const ENDORSEMENT_TYPES = ['Court Attendance', 'Special Event', 'Special Instruction', 'Restriction'];
const OUTCOMES = ['Present', 'Excused', 'Sick', 'Absent without leave'] as const;

export function RosterPlanner({
  silo, month, today, templates, rotations, people, lines, holidays, settings, swaps, endorsements,
}: {
  silo: string;
  month: string;
  today: string;
  templates: ShiftTemplate[];
  rotations: Rotation[];
  people: TeamMember[];
  lines: ScheduleLine[];
  holidays: PublicHoliday[];
  settings: ScheduleSettings;
  swaps: SwapView[];
  endorsements: Endorsement[];
}) {
  const { t } = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [building, setBuilding] = useState(false);
  const [open, setOpen] = useState<{ person: TeamMember; day: string } | null>(null);
  const [team, setTeam] = useState<string>('all');

  const { from, to } = monthRange(month);
  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }, [from, to]);
  const tpl = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);
  const holiday = useMemo(() => new Map(holidays.map((h) => [h.day, h.name])), [holidays]);

  const byCell = useMemo(() => {
    const m = new Map<string, ScheduleLine[]>();
    for (const l of lines) {
      if (l.cancelled_at || !l.duty_date) continue;
      const k = `${l.user_id}|${l.duty_date}`;
      const list = m.get(k) ?? [];
      list.push(l);
      m.set(k, list);
    }
    return m;
  }, [lines]);

  const inMonth = lines.filter((l) => !l.cancelled_at && l.duty_date && l.duty_date >= from && l.duty_date <= to);
  const drafts = inMonth.filter((l) => !l.published).length;
  const issued = inMonth.filter((l) => l.published && lineActive(l.status, l.cancelled_at)).length;
  const onLeave = inMonth.filter((l) => l.status === 'Leave').length;
  const unconfirmed = inMonth.filter((l) => l.published && lineActive(l.status, l.cancelled_at) && !l.acknowledged_at && l.start_at && l.start_at > new Date().toISOString()).length;

  const teams = [...new Set(people.map((p) => p.team ?? ''))].sort((a, b) => (a || '~').localeCompare(b || '~'));
  const shown = team === 'all' ? people : people.filter((p) => (p.team ?? '') === team);

  const run = (fn: () => Promise<RosterResult & Record<string, unknown>>, ok: (res: RosterResult & Record<string, unknown>) => string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.push({ title: 'Not done', body: res.error, tone: 'critical' });
      else { toast.push({ title: ok(res), tone: 'success' }); after?.(); }
    });

  const publish = () => {
    if (!window.confirm(`Issue ${drafts} draft shift${drafts === 1 ? '' : 's'} for ${dayLabel(from)} to ${dayLabel(to)}? Each person is told and asked to confirm.`)) return;
    const fd = new FormData();
    fd.set('silo', silo); fd.set('from', from); fd.set('to', to);
    run(() => publishAction(fd), (r) => `${r.count ?? 0} shift${r.count === 1 ? '' : 's'} issued`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-bg-card p-3">
        <div className="flex flex-wrap items-end gap-4">
          <Stat label={t('Issued')} value={issued} />
          <Stat label={t('Drafts')} value={drafts} tone={drafts ? 'accent' : undefined} />
          <Stat label={t('Not confirmed')} value={unconfirmed} tone={unconfirmed ? 'warning' : undefined} />
          <Stat label={t('On leave')} value={onLeave} />
          <div>
            <p className={label}>{t('Team')}</p>
            <select className={`${input} mt-1`} value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="all">{t('Everyone')}</option>
              {teams.map((t) => <option key={t || 'none'} value={t}>{t ? `Team ${t}` : 'No team'}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setBuilding((b) => !b)} className={`${btn} border border-border hover:bg-muted`}>
            <Repeat className="h-4 w-4" /> {' '}{t('Build from a rotation')}</button>
          <button type="button" onClick={publish} disabled={pending || drafts === 0} className={`${btn} bg-primary text-primary-foreground`}>
            <Send className="h-4 w-4" /> {' '}{t('Issue {value} draft{value2}', { value: drafts || '', value2: drafts === 1 ? '' : 's' })}
          </button>
        </div>
      </div>

      {building ? (
        <BuildPanel silo={silo} rotations={rotations} templates={tpl} from={from > today ? from : today} to={to}
          onClose={() => setBuilding(false)} />
      ) : null}

      {people.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg-card p-8 text-center text-sm text-muted-foreground">
          {t('Nobody in this department has an account yet.')}</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-bg-card">
          <table className="w-max min-w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-bg-soft">
                <th className="sticky left-0 z-10 min-w-[190px] bg-bg-soft px-3 py-2 text-left font-semibold">{t('Member')}</th>
                {days.map((d) => {
                  const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
                  const h = holiday.get(d);
                  return (
                    <th key={d} title={h ?? dayLabel(d)}
                      className={`w-9 px-0.5 py-1 text-center font-semibold ${d === today ? 'text-primary' : ''} ${h ? 'bg-severity-medium/15' : wd === 0 || wd === 6 ? 'bg-muted/40' : ''}`}>
                      <div className="text-[10px] text-muted-foreground">{WEEKDAY[wd]}</div>
                      <div>{Number(d.slice(8))}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((p, i) => {
                const newTeam = i === 0 || (shown[i - 1]!.team ?? '') !== (p.team ?? '');
                return (
                  <FragmentRow key={p.userId} header={newTeam ? (p.team ? `Team ${p.team}` : 'No team') : null} cols={days.length + 1}>
                    <tr className="border-b border-border/60">
                      <td className="sticky left-0 z-10 bg-bg-card px-3 py-1.5">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-[10px] text-muted-foreground">{[p.rank, p.badge, p.station].filter(Boolean).join(' · ')}</div>
                      </td>
                      {days.map((d) => {
                        const cell = byCell.get(`${p.userId}|${d}`) ?? [];
                        return (
                          <td key={d} className={`p-0.5 text-center ${d === today ? 'bg-primary/5' : ''}`}>
                            <button type="button" onClick={() => setOpen({ person: p, day: d })}
                              aria-label={`${p.name}, ${dayLabel(d)}`}
                              className="flex h-8 w-8 flex-col items-center justify-center gap-0.5 rounded hover:bg-muted">
                              {cell.map((l) => <Chip key={l.id} line={l} tpl={l.template_id ? tpl.get(l.template_id) : undefined} settings={settings} />)}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Legend templates={templates} />

      {swaps.length ? <SwapsToDecide swaps={swaps} silo={silo} tpl={tpl} /> : null}

      <Endorsements silo={silo} people={people} endorsements={endorsements} />

      {open ? (
        <DayDialog silo={silo} person={open.person} day={open.day} today={today} lines={byCell.get(`${open.person.userId}|${open.day}`) ?? []}
          templates={templates.filter((t) => t.active)} tpl={tpl} settings={settings} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}

function FragmentRow({ header, cols, children }: { header: string | null; cols: number; children: React.ReactNode }) {
  return (
    <>
      {header ? (
        <tr className="bg-bg-soft/60">
          <td colSpan={cols} className="sticky left-0 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{header}</td>
        </tr>
      ) : null}
      {children}
    </>
  );
}

function Stat({ label: l, value, tone }: { label: string; value: number; tone?: 'accent' | 'warning' }) {
  return (
    <div>
      <p className={label}>{l}</p>
      <p className={`text-xl font-bold leading-tight ${tone === 'accent' ? 'text-accent' : tone === 'warning' ? 'text-warning' : ''}`}>{value}</p>
    </div>
  );
}

/** One shift in a grid cell: its type's code and colour; dashed while a draft. */
function Chip({ line, tpl, settings }: { line: ScheduleLine; tpl?: ShiftTemplate; settings: ScheduleSettings }) {
  const { t } = useT();
  if (line.status === 'Leave') {
    return <span className="rounded bg-muted px-1 text-[10px] font-bold text-muted-foreground" title={t('On leave')}>L</span>;
  }
  const state = line.published && line.start_at && line.end_at
    ? shiftState({ start_at: line.start_at, end_at: line.end_at, status: line.status, cancelled_at: line.cancelled_at }, line.attendance, settings)
    : 'upcoming';
  const flag = state === 'missed' || state === 'not_started' || state === 'late' ? 'ring-2 ring-danger'
    : state === 'started_late' ? 'ring-2 ring-warning' : '';
  const colour = tpl?.colour ?? '#64748b';
  return (
    <span
      title={`${tpl?.name ?? line.activity_type ?? 'Shift'} ${line.start_at ? saTime(line.start_at) : ''}${line.published ? '' : ' (draft)'}${line.post ? ` · ${line.post}` : ''}`}
      className={`rounded px-1 text-[10px] font-bold leading-4 ${flag}`}
      style={line.published
        ? { background: `${colour}33`, color: colour }
        : { border: `1px dashed ${colour}`, color: colour }}
    >
      {tpl?.code ?? (line.activity_type?.[0] ?? '•')}
    </span>
  );
}

function Legend({ templates }: { templates: ShiftTemplate[] }) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {templates.filter((t) => t.active).map((t) => (
        <span key={t.id} className="inline-flex items-center gap-1.5">
          <span className="rounded px-1 font-bold" style={{ background: `${t.colour}33`, color: t.colour }}>{t.code}</span>
          {t.name} {t.start_time.slice(0, 5)}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5"><span className="rounded bg-muted px-1 font-bold">L</span> {' '}{t('On leave')}</span>
      <span>{t('Dashed: draft, not yet issued')}</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full ring-2 ring-danger" /> {' '}{t('Late or not started')}</span>
    </div>
  );
}

/* ── Building from a rotation ─────────────────────────────────────────── */

function BuildPanel({ silo, rotations, templates, from, to, onClose }: {
  silo: string; rotations: Rotation[]; templates: Map<string, ShiftTemplate>; from: string; to: string; onClose: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [rotationId, setRotationId] = useState(rotations[0]?.id ?? '');
  const [result, setResult] = useState<{ created: number; skipped: number; reasons: Array<{ name: string; day: string; reason: string }> } | null>(null);
  const rotation = rotations.find((r) => r.id === rotationId);

  if (!rotations.length) {
    return <div className="rounded-lg border border-border bg-bg-card p-4 text-sm text-muted-foreground">{t('No rotation set up for this department yet. An administrator adds one under Shift setup.')}</div>;
  }
  return (
    <form
      action={(fd) => start(async () => {
        fd.set('silo', silo);
        const res = await generateAction(fd);
        if (res.error) toast.push({ title: 'Not built', body: res.error, tone: 'critical' });
        else {
          setResult({ created: res.created ?? 0, skipped: res.skipped ?? 0, reasons: res.reasons ?? [] });
          toast.push({ title: `${res.created ?? 0} draft shift${res.created === 1 ? '' : 's'} added`, tone: 'success' });
        }
      })}
      className="space-y-3 rounded-lg border border-border bg-bg-card p-4"
    >
      <div className="flex items-start justify-between">
        <p className="font-semibold">{t('Build from a rotation')}</p>
        <button type="button" onClick={onClose} aria-label={t('Close')} className="rounded p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="rot">{t('Rotation')}</label>
          <select id="rot" name="rotationId" className={`${input} mt-1 w-full`} value={rotationId} onChange={(e) => setRotationId(e.target.value)}>
            {rotations.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {rotation ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {rotation.cycle.map((c) => (c ? templates.get(c)?.code ?? '?' : '·')).join(' ')}
            </p>
          ) : null}
        </div>
        <div>
          <label className={label} htmlFor="gfrom">{t('From')}</label>
          <input id="gfrom" name="from" type="date" defaultValue={from} className={`${input} mt-1 w-full`} required />
        </div>
        <div>
          <label className={label} htmlFor="gto">{t('To')}</label>
          <input id="gto" name="to" type="date" defaultValue={to} className={`${input} mt-1 w-full`} required />
        </div>
      </div>
      {rotation ? (
        <div>
          <p className={label}>{t('Teams')}</p>
          <div className="mt-1 flex flex-wrap gap-3 text-sm">
            {rotation.teams.map((t) => (
              <label key={t} className="inline-flex items-center gap-1.5">
                <input type="checkbox" name="teams" value={t} defaultChecked /> {' '}<T s="Team {t}" t={t} />
              </label>
            ))}
          </div>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t('Everyone in each team gets their team\'s shifts as drafts. Anyone on leave, booked for court or already on a shift is left out, with the reason below. Issue the drafts when you are happy.')}</p>
      <button type="submit" disabled={pending} className={`${btn} bg-primary text-primary-foreground`}>
        <CalendarPlus className="h-4 w-4" /> {pending ? 'Building…' : 'Build drafts'}
      </button>
      {result && result.reasons.length ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
          <p className="font-semibold">{t('{skipped} left out', { skipped: result.skipped })}</p>
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
            {result.reasons.map((r, i) => <li key={i}>{dayLabel(String(r.day))}: {r.reason}</li>)}
          </ul>
        </div>
      ) : null}
    </form>
  );
}

/* ── One person's day ─────────────────────────────────────────────────── */

function DayDialog({ silo, person, day, today, lines, templates, tpl, settings, onClose }: {
  silo: string; person: TeamMember; day: string; today: string; lines: ScheduleLine[];
  templates: ShiftTemplate[]; tpl: Map<string, ShiftTemplate>; settings: ScheduleSettings; onClose: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [publishNow, setPublishNow] = useState(true);
  const [note, setNote] = useState('');
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [recording, setRecording] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]>('Excused');

  const send = (fn: (fd: FormData) => Promise<RosterResult>, fields: Record<string, string>, ok: string, after?: () => void) =>
    start(async () => {
      const fd = new FormData();
      fd.set('silo', silo);
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      const res = await fn(fd);
      if (res.error) toast.push({ title: 'Not done', body: res.error, tone: 'critical' });
      else { toast.push({ title: ok, tone: 'success' }); after?.(); }
    });

  return (
    // biome-ignore lint/a11y/useSemanticElements: the same overlay pattern as the duty board's dialogs, which <dialog> would not render above the console.
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="font-semibold">{person.name}</p>
            <p className="text-xs text-muted-foreground">{dayLabel(day)}{person.team ? ` · Team ${person.team}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Close')} className="rounded p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3 p-4">
          {lines.length === 0 ? <p className="text-sm text-muted-foreground">{t('Not on the roster this day.')}</p> : null}
          {lines.map((l) => {
            const t = l.template_id ? tpl.get(l.template_id) : undefined;
            const state = l.start_at && l.end_at
              ? shiftState({ start_at: l.start_at, end_at: l.end_at, status: l.status, cancelled_at: l.cancelled_at }, l.attendance, settings)
              : 'upcoming';
            const started = l.start_at ? new Date(l.start_at).getTime() <= Date.now() : false;
            return (
              <div key={l.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{t?.name ?? l.activity_type ?? 'Shift'} · {l.start_at ? saTime(l.start_at) : ''}–{l.end_at ? saTime(l.end_at) : ''}</p>
                    <p className="text-xs text-muted-foreground">
                      {[l.post, l.station, l.vehicle, l.call_sign].filter(Boolean).join(' · ') || 'No post yet'}
                    </p>
                    <p className="mt-1 text-xs">
                      {!l.published ? <span className="text-accent"><T s="Draft, not issued" /></span>
                        : l.status === 'Leave' ? <span className="text-muted-foreground"><T s="On leave" /></span>
                          : <>{stateWords(state, l.attendance)}{l.acknowledged_at ? ' · confirmed' : ' · not confirmed'}</>}
                      {l.attendance?.outcome ? ` · ${l.attendance.outcome}: ${l.attendance.outcome_reason ?? ''}` : ''}
                    </p>
                  </div>
                </div>

                {cancelling === l.id ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <input className={`${input} h-8 flex-1`} placeholder="Why it is cancelled (they are told)" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <button type="button" disabled={pending || reason.trim().length < 3}
                      onClick={() => send(cancelShiftAction, { id: l.id, reason }, 'Shift cancelled', onClose)}
                      className={`${btn} h-8 bg-severity-critical/20 text-severity-critical-ink`}><T s="Cancel shift" /></button>
                  </div>
                ) : recording === l.id ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <select className={`${input} h-8`} value={outcome} onChange={(e) => setOutcome(e.target.value as (typeof OUTCOMES)[number])}>
                      {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <input className={`${input} h-8 flex-1`} placeholder="What happened" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <button type="button" disabled={pending || reason.trim().length < 3}
                      onClick={() => send(outcomeAction, { id: l.id, outcome, reason }, 'Recorded', onClose)}
                      className={`${btn} h-8 bg-primary text-primary-foreground`}><T s="Record" /></button>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {!l.published ? (
                      <button type="button" disabled={pending}
                        onClick={() => send(cancelShiftAction, { id: l.id, reason: 'Draft removed' }, 'Draft removed', onClose)}
                        className={`${btn} h-8 border border-border hover:bg-muted`}><T s="Remove draft" /></button>
                    ) : l.status !== 'Leave' ? (
                      <button type="button" onClick={() => { setReason(''); setCancelling(l.id); }}
                        className={`${btn} h-8 border border-border hover:bg-muted`}><T s="Cancel shift…" /></button>
                    ) : null}
                    {l.published && started && !l.attendance?.checked_in_at && l.status !== 'Leave' ? (
                      <button type="button" onClick={() => { setReason(''); setRecording(l.id); }}
                        className={`${btn} h-8 border border-border hover:bg-muted`}><T s="Record why…" /></button>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}

          {day >= today && templates.length ? (
            <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
              <p className={label}>{t('Add a shift')}</p>
              <select className={`${input} w-full`} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.start_time.slice(0, 5)}</option>)}
              </select>
              <input className={`${input} w-full`} placeholder={t('Note on the duty sheet (optional)')} value={note} onChange={(e) => setNote(e.target.value)} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} /> {' '}{t('Issue now (they are told)')}</label>
              <button type="button" disabled={pending || !templateId}
                onClick={() => send(addShiftAction, { userId: person.userId, day, templateId, publish: publishNow ? 'on' : '', note }, 'Shift added', onClose)}
                className={`${btn} bg-primary text-primary-foreground`}>
                {t('Add shift')}</button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Swaps waiting for approval ───────────────────────────────────────── */

function SwapsToDecide({ swaps, silo, tpl }: { swaps: SwapView[]; silo: string; tpl: Map<string, ShiftTemplate> }) {
  const { t } = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [refusing, setRefusing] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const describe = (l: SwapView['mine']) => (l && l.start_at
    ? `${l.user_name}: ${l.template_id ? tpl.get(l.template_id)?.name ?? 'Shift' : 'Shift'} ${dayLabel(l.duty_date ?? '')} ${saTime(l.start_at)}`
    : 'Shift');
  const decide = (id: string, approve: boolean) => start(async () => {
    const fd = new FormData();
    fd.set('silo', silo); fd.set('id', id); fd.set('decision', approve ? 'approve' : 'refuse'); fd.set('comment', comment);
    const res = await decideSwapAction(fd);
    if (res.error) toast.push({ title: 'Not done', body: res.error, tone: 'critical' });
    else { toast.push({ title: approve ? 'Swap approved' : 'Swap refused', tone: 'success' }); setRefusing(null); }
  });
  return (
    <div className="space-y-2 rounded-lg border border-border bg-bg-card p-4">
      <p className="font-semibold">{t('Shift swaps to approve')}</p>
      {swaps.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
          <div>
            <p>{describe(s.mine)} <span className="text-muted-foreground">{t('for')}</span> {describe(s.theirs)}</p>
            {s.note ? <p className="text-xs text-muted-foreground">{s.note}</p> : null}
          </div>
          {refusing === s.id ? (
            <div className="flex gap-1.5">
              <input className={`${input} h-8`} placeholder={t('Why not')} value={comment} onChange={(e) => setComment(e.target.value)} />
              <button type="button" disabled={pending || comment.trim().length < 3} onClick={() => decide(s.id, false)} className={`${btn} h-8 bg-severity-critical/20 text-severity-critical-ink`}>{t('Refuse')}</button>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <button type="button" disabled={pending} onClick={() => decide(s.id, true)} className={`${btn} h-8 bg-severity-low/20 text-severity-low-ink`}>{t('Approve')}</button>
              <button type="button" onClick={() => { setComment(''); setRefusing(s.id); }} className={`${btn} h-8 border border-border`}>{t('Refuse…')}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Court dates, events and restrictions ─────────────────────────────── */

function Endorsements({ silo, people, endorsements }: { silo: string; people: TeamMember[]; endorsements: Endorsement[] }) {
  const { t } = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [key, setKey] = useState(0);
  const go = (fn: (fd: FormData) => Promise<RosterResult>, fd: FormData, ok: string, after?: () => void) => start(async () => {
    fd.set('silo', silo);
    const res = await fn(fd);
    if (res.error) toast.push({ title: 'Not done', body: res.error, tone: 'critical' });
    else { toast.push({ title: ok, tone: 'success' }); after?.(); }
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form key={key} action={(fd) => go(addEndorsementAction, fd, 'Added', () => setKey((k) => k + 1))}
        className="space-y-2 rounded-lg border border-border bg-bg-card p-4">
        <p className="flex items-center gap-1.5 font-semibold"><Scale className="h-4 w-4" /> {' '}{t('Court dates and endorsements')}</p>
        <p className="text-xs text-muted-foreground">{t('A court date keeps the person off the roster that day.')}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <select name="member" required className={input}>
            {people.map((p) => <option key={p.userId} value={`${p.userId}|${p.name}`}>{p.name}</option>)}
          </select>
          <select name="type" required className={input}>
            {ENDORSEMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input name="start_date" type="date" required className={input} aria-label={t('From')} />
          <input name="end_date" type="date" className={input} aria-label={t('To (blank: one day for court, open-ended otherwise)')} />
          <input name="details" placeholder={t('Details, e.g. Durban Magistrate 09:00')} className={`${input} sm:col-span-2`} />
        </div>
        <button type="submit" disabled={pending} className={`${btn} bg-primary text-primary-foreground`}>{t('Add')}</button>
      </form>
      <div className="rounded-lg border border-border bg-bg-card p-4">
        <p className="font-semibold">{t('Active ({length})', { length: endorsements.length })}</p>
        <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto text-sm">
          {endorsements.length === 0 ? <li className="text-muted-foreground">{t('None.')}</li> : null}
          {endorsements.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-2 rounded-md border border-border p-2">
              <div>
                <p className="font-medium">{e.employee_name ?? 'Member'} · {e.type}</p>
                <p className="text-xs text-muted-foreground">{e.start_date}{e.end_date ? ` to ${e.end_date}` : ' onwards'}{e.details ? ` · ${e.details}` : ''}</p>
              </div>
              <button type="button" disabled={pending}
                onClick={() => { const fd = new FormData(); fd.set('id', e.id); go(deactivateEndorsementAction, fd, 'Removed'); }}
                className="rounded px-2 py-1 text-xs hover:bg-muted">{t('Remove')}</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
