'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronDown, Clock, FileDown, MapPin, Radio, Search, ShieldAlert, Siren, Timer, Truck, Users,
} from 'lucide-react';
import {
  PHASE_LABEL, PHASE_TONE, SEVERITY_TONE, boardCounts, filterBoard, formatBoardDuration,
  type BoardEntry, type BoardFilters, type BoardPhase,
} from '@criticom/api/responder-board';
import { TALK_DEPARTMENT_LABELS, TALK_TONES } from '@criticom/api/radio';
import { formatSaTime } from '@/lib/utils';
import { useT } from '@/components/i18n';

const DEPARTMENTS = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const PHASES: BoardPhase[] = ['responding', 'on_scene', 'transporting'];
/** The page re-reads every 30 seconds as well, should a live update be missed. */
const REFRESH_MS = 30_000;

function Tile({ label, value, tone, icon: Icon, hint }: { label: string; value: string | number; tone: string; icon: typeof Siren; hint?: string }) {
  return (
    <div
      className="frost relative overflow-hidden rounded-xl border p-4"
      style={{ borderColor: `${tone}55`, backgroundImage: `linear-gradient(135deg, ${tone}24, transparent 70%)` }}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: tone }} aria-hidden />
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4" style={{ color: tone }} aria-hidden />
      </div>
      <p className="mt-1 text-3xl font-bold tabular-nums" style={{ color: tone }}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Chip({ on, tone, onClick, children }: { on: boolean; tone: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick}
      className="frost-pill rounded-full border px-3 py-1.5 text-xs font-semibold"
      style={on ? { borderColor: tone, backgroundColor: `${tone}22`, color: tone } : { borderColor: `${tone}44` }}
    >
      {children}
    </button>
  );
}

/** A clock that runs from a moment: since dispatch, or time on scene. */
function useNow(start: number) {
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
const since = (at: string | null, now: number) => (at ? Math.max(0, (now - Date.parse(at)) / 1000) : null);

function Row({ e, now, canAct, open, onToggle }: { e: BoardEntry; now: number; canAct: boolean; open: boolean; onToggle: () => void }) {
  const { t } = useT();
  const sev = SEVERITY_TONE[e.severity] ?? '#64748b';
  const phaseTone = PHASE_TONE[e.phase];
  const onScene = e.phase === 'responding' ? null : since(e.arrivedAt, now);
  const out = since(e.dispatchedAt, now);
  return (
    <li className="frost overflow-hidden rounded-xl border" style={{ borderColor: `${sev}44` }}>
      <button
        type="button" onClick={onToggle} aria-expanded={open}
        className="grid w-full gap-x-4 gap-y-2 p-4 text-left transition-colors hover:bg-bg-soft/40 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]"
        style={{ borderLeft: `4px solid ${sev}` }}
      >
        <span className="min-w-0 space-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold">{e.number}</span>
            {e.code ? <span className="rounded bg-bg-soft/80 px-1.5 py-0.5 font-mono text-[11px] font-bold">{e.code}</span> : null}
            <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: `${sev}22`, color: sev }}>{e.severity}</span>
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: `${phaseTone}77`, color: phaseTone }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: phaseTone }} />{e.status}
            </span>
          </span>
          <span className="block truncate font-semibold">{e.type}{e.classification ? <span className="font-normal text-muted-foreground"> · {e.classification}</span> : null}</span>
          <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />{e.location ?? 'Location pending'}
          </span>
        </span>

        <span className="min-w-0 space-y-1.5">
          <span className="flex flex-wrap gap-1">
            {e.departments.map((d) => (
              <span key={d.silo} className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `${d.tone}22`, color: d.tone }}>
                {d.label}{d.status ? ` · ${d.status}` : ''}
              </span>
            ))}
          </span>
          <span className="flex items-center gap-1.5 truncate text-xs">
            <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {e.crew.length ? e.crew.map((c) => `${c.name}${c.role === 'lead' ? ' (lead)' : ''}`).join(', ') : <span className="text-muted-foreground">{e.lead ?? 'No crew accepted yet'}</span>}
          </span>
        </span>

        <span className="flex items-center gap-3 md:justify-end">
          <span className="text-right">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{onScene !== null ? 'On scene' : 'Out for'}</span>
            <span className="block font-mono text-lg font-bold tabular-nums" style={{ color: onScene !== null ? PHASE_TONE.on_scene : PHASE_TONE.responding }}>
              {formatBoardDuration(onScene ?? out)}
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </span>
      </button>

      {open ? (
        <div className="grid gap-4 border-t border-border/60 bg-bg-soft/30 p-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-sky-400">{t('Dispatch narrative')}</p>
            <p className="text-sm italic">{e.narrative ? `“${e.narrative}”` : 'No narrative from the call taker.'}</p>
            {e.callerName ? <p className="text-xs text-muted-foreground">{t('Caller: {callerName}', { callerName: e.callerName })}</p> : null}
            {e.crew.length ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {e.crew.map((c) => (
                  <li key={c.userId} className="frost-pill rounded-full border border-border px-2.5 py-1 text-xs">
                    <span className="font-semibold">{c.name}</span>
                    <span className="text-muted-foreground"> · {c.role === 'lead' ? 'Lead' : 'Backup'} · {c.status}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400">{t('Operational timeline')}</p>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-2"><dt className="flex items-center gap-2 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-sky-500" />{t('Dispatched')}</dt><dd className="font-mono">{e.dispatchedAt ? formatSaTime(e.dispatchedAt) : '—'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="flex items-center gap-2 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-emerald-500" />{t('Arrived on scene')}</dt><dd className="font-mono">{e.arrivedAt ? formatSaTime(e.arrivedAt) : 'Pending'}</dd></div>
              <div className="flex justify-between gap-2 border-t border-border/60 pt-1.5"><dt className="flex items-center gap-2 font-semibold text-amber-400"><Timer className="h-3.5 w-3.5" />{t('Time on scene')}</dt><dd className="font-mono font-bold text-amber-400">{formatBoardDuration(onScene)}</dd></div>
            </dl>
            <div className="flex flex-wrap gap-2 pt-2">
              <Link href={`/incidents/${e.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold">{t('Open the call')}</Link>
              {canAct ? (
                <Link href={`/incidents/${e.id}#talk`} className="frost-pill inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold">
                  <Radio className="h-4 w-4" /> {' '}{t('Talk to the crew')}</Link>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function ResponderBoard({ entries, canAct, renderedAt }: { entries: BoardEntry[]; canAct: boolean; renderedAt: number }) {
  const { t } = useT();
  const router = useRouter();
  const now = useNow(renderedAt);
  const [filters, setFilters] = useState<BoardFilters>({});
  const [open, setOpen] = useState<string | null>(null);

  // Live updates refresh the page (IncidentLive); this is the safety net.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [router]);

  const shown = useMemo(() => filterBoard(entries, filters), [entries, filters]);
  const c = boardCounts(entries);
  const set = (patch: Partial<BoardFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const exportHref = `/responder/monitor/export?${new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][],
  ).toString()}`;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-amber-500 text-white shadow-lg">
            <Truck className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold leading-tight">{t('Active responders')}</h1>
            <p className="text-sm text-muted-foreground">{t('Every crew still out, live. Open a row for the narrative and the timeline.')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="frost-pill inline-flex items-center gap-2 rounded-full border border-emerald-500/50 px-3 py-1.5 text-xs font-semibold text-emerald-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> {' '}{t('Live')}</span>
          {canAct ? (
            <a href={exportHref} className="frost-pill inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold">
              <FileDown className="h-3.5 w-3.5" /> {' '}{t('Export the log')}</a>
          ) : null}
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Tile label={t('Calls with crews out')} value={c.total} tone="#6366f1" icon={Siren} />
        <Tile label={t('Responding')} value={c.responding} tone={PHASE_TONE.responding} icon={Truck} />
        <Tile label={t('On scene')} value={c.onScene} tone={PHASE_TONE.on_scene} icon={MapPin} />
        <Tile label={t('Transporting')} value={c.transporting} tone={PHASE_TONE.transporting} icon={Clock} />
        <Tile label={t('Critical')} value={c.critical} tone={SEVERITY_TONE.Critical!} icon={ShieldAlert} />
        <Tile label={t('Officers out')} value={c.officers} tone="#06b6d4" icon={Users} hint={c.longestOnSceneS !== null ? `Longest on scene ${formatBoardDuration(c.longestOnSceneS)}` : undefined} />
      </section>

      <div className="frost space-y-2 rounded-xl border border-border p-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={filters.q ?? ''} onChange={(ev) => set({ q: ev.target.value })}
            placeholder={t('Search a call, type, place or officer')}
            className="h-9 w-full rounded-md border border-border bg-bg-soft/80 pl-9 pr-3 text-sm"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Chip on={!filters.phase} tone="#94a3b8" onClick={() => set({ phase: null })}>{t('Every stage')}</Chip>
          {PHASES.map((p) => <Chip key={p} on={filters.phase === p} tone={PHASE_TONE[p]} onClick={() => set({ phase: filters.phase === p ? null : p })}>{PHASE_LABEL[p]}</Chip>)}
          <span className="mx-1 w-px self-stretch bg-border" aria-hidden />
          {DEPARTMENTS.map((d) => (
            <Chip key={d} on={filters.department === d} tone={TALK_TONES[d] ?? '#64748b'} onClick={() => set({ department: filters.department === d ? null : d })}>
              {TALK_DEPARTMENT_LABELS[d] ?? d}
            </Chip>
          ))}
          <span className="mx-1 w-px self-stretch bg-border" aria-hidden />
          {SEVERITIES.map((s) => (
            <Chip key={s} on={filters.severity === s} tone={SEVERITY_TONE[s]!} onClick={() => set({ severity: filters.severity === s ? null : s })}>{s}</Chip>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="frost rounded-xl border border-dashed border-border p-10 text-center text-sm font-semibold text-muted-foreground">
          {entries.length === 0 ? 'No crews out right now.' : 'No crews out match this view.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((e) => (
            <Row key={e.id} e={e} now={now} canAct={canAct} open={open === e.id} onToggle={() => setOpen((o) => (o === e.id ? null : e.id))} />
          ))}
        </ul>
      )}
    </div>
  );
}
