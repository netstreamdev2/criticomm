'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Ambulance, Flame, Loader2, Radio, Shield, Siren, UserCheck, UserX, Users, Waves,
} from 'lucide-react';
import { assignIncident, partOpen, partWords, routeIncident, type DepartmentPart, type OnDutyOfficer } from '@criticom/api';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useOnDutyOfficers } from '@/lib/on-duty';
import { DEPARTMENT_NAMES, type IncidentSeverity, type Silo } from '@criticom/db';
import { useToast } from '@/components/toast';
import { cn, timeAgo } from '@/lib/utils';
import { OfficerPicker, type RankedOfficer } from './officer-picker';

type Department = Exclude<Silo, 'Ethekwini'>;
type Mode = 'all' | 'assign';

/** Same buttons, same order, same colours as the intake console. */
const DEPARTMENTS: Array<{
  id: Department; label: string; icon: typeof Flame; className: string;
}> = [
  { id: 'MetroFire', label: 'Fire', icon: Flame, className: 'bg-[#f59e0b] text-black' },
  { id: 'MetroPolice', label: 'Police', icon: Shield, className: 'bg-[#3b82f6] text-white' },
  { id: 'Medical', label: 'Medical', icon: Ambulance, className: 'bg-[#dc3545] text-white' },
  { id: 'EthekwiniDisaster', label: 'Disaster', icon: Waves, className: 'bg-[#8b5cf6] text-white' },
];

const SILO_LABELS: Record<Department, string> = {
  MetroPolice: DEPARTMENT_NAMES.MetroPolice,
  MetroFire: DEPARTMENT_NAMES.MetroFire,
  Medical: DEPARTMENT_NAMES.Medical,
  EthekwiniDisaster: DEPARTMENT_NAMES.EthekwiniDisaster,
};
const deptLabel = (s: string) => SILO_LABELS[s as Department] ?? s;

const FIELD_SILOS: Silo[] = DEPARTMENTS.map((d) => d.id);

/** A GPS fix older than this is shown as stale — the officer may have moved. */
const STALE_FIX_MINUTES = 15;

function distanceKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Dispatch & routing. Two ways to send a call (migration 0042):
 *   - Send to all on duty in the chosen departments: the first to respond
 *     leads, anyone else may join as backup.
 *   - Assign to one officer, picked from a searchable list: they lead.
 * Officers may hold several calls at once, so busy officers are still listed.
 */
export function AssignForm({
  incidentId, incidentNumber, silo, dispatchedSilos, severity, scene, officers: initialOfficers, eta, locked,
  parts = [], awaiting, assignedTo, sosRaiser, allowedSilos,
}: {
  incidentId: string;
  incidentNumber: string;
  silo: Silo;
  dispatchedSilos: Silo[];
  severity: IncidentSeverity;
  /** The scene, when the call-taker placed it. */
  scene: [number, number] | null;
  /** On duty at page load; kept live from here. */
  officers: OnDutyOfficer[];
  /** Operations Settings: the straight-line ETA model. */
  eta: { speedKmh: number; roadFactor: number };
  /** Why this call can no longer be dispatched, if it can't. */
  locked: string | null;
  /** Each department's part of the call (0073): one led or finished is not sent again. */
  parts?: DepartmentPart[];
  /** Already sent out and waiting for someone to respond. */
  awaiting: boolean;
  /** Assigned and not yet answered. */
  assignedTo: { userId: string; name: string; at: string | null } | null;
  /** For an officer's SOS: the officer in trouble, who is never sent their own SOS. */
  sosRaiser?: string | null;
  /**
   * The departments this desk dispatches: a department's dispatch desk sends
   * its own crews only (0068); the control room sends any.
   */
  allowedSilos?: Department[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const live = useOnDutyOfficers(initialOfficers, allowedSilos ?? FIELD_SILOS);
  // A department already led, or finished, is not sent again (0073); the
  // others still can be, whoever leads them.
  const busy = useMemo(() => {
    const m = new Map<Department, string>();
    for (const p of parts) {
      if (p.silo === 'Ethekwini') continue;
      if (!partOpen(p.status)) m.set(p.silo, partWords(p));
      else if (p.lead_id) m.set(p.silo, `Led by ${p.lead_name ?? 'a crew member'}`);
    }
    return m;
  }, [parts]);
  const allowed = useMemo<Department[]>(
    () => (allowedSilos ?? DEPARTMENTS.map((d) => d.id)).filter((d) => !busy.has(d)),
    [allowedSilos, busy],
  );
  const departments = DEPARTMENTS.filter((d) => allowed.includes(d.id));
  const officers = useMemo(
    () => live.filter((o) => allowed.includes(o.silo as Department) && o.userId !== sosRaiser),
    [live, sosRaiser, allowed],
  );

  const [mode, setMode] = useState<Mode>(assignedTo ? 'assign' : 'all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Start from the departments still waiting for their desk (0073); before
  // 0073, from where the call is routed, else the owning department.
  const waiting = parts.filter((p) => p.status === 'Waiting').map((p) => p.silo as Department);
  const initialTargets: Department[] = (parts.length
    ? waiting
    : dispatchedSilos.length
      ? dispatchedSilos.filter((s): s is Department => s !== 'Ethekwini')
      : silo === 'Ethekwini' ? [] : [silo as Department]).filter((d) => allowed.includes(d));
  // Sent out and not yet answered, per department.
  const sentOut = parts.filter((p) => p.status === 'Dispatched' && !p.lead_id && allowed.includes(p.silo as Department));
  const [targets, setTargets] = useState<Department[]>(initialTargets);

  const perDept = useMemo(() => {
    const counts = new Map<Silo, number>();
    for (const o of officers) counts.set(o.silo, (counts.get(o.silo) ?? 0) + 1);
    return counts;
  }, [officers]);

  // Nearest first; free before busy at equal distance. With no department
  // selected the assign list covers everyone on duty.
  const ranked = useMemo<RankedOfficer[]>(() => {
    const now = Date.now();
    return officers
      .filter((o) => (targets.length === 0 && mode === 'assign') || targets.includes(o.silo as Department))
      .map((o) => {
        const km = scene && o.lat !== null && o.lng !== null ? distanceKm([o.lat, o.lng], scene) : null;
        const minutes = km !== null
          ? Math.max(2, Math.round(((km * eta.roadFactor) / eta.speedKmh) * 60))
          : null;
        const fixAgeMin = (now - new Date(o.seenAt).getTime()) / 60_000;
        return { officer: o, km, minutes, fixAgeMin, stale: fixAgeMin > STALE_FIX_MINUTES };
      })
      .sort((a, b) =>
        (a.km ?? Number.POSITIVE_INFINITY) - (b.km ?? Number.POSITIVE_INFINITY)
        || a.officer.activeCalls - b.officer.activeCalls
        || a.officer.name.localeCompare(b.officer.name));
  }, [officers, targets, mode, scene, eta]);

  const onDuty = ranked.length;
  const free = ranked.filter((r) => r.officer.activeCalls === 0).length;
  const nobody = mode === 'all' && targets.length > 0 && onDuty === 0;
  // Someone who went off duty since being picked is no longer pickable.
  const selected = ranked.find((r) => r.officer.userId === selectedId) ?? null;

  const toggleTarget = (d: Department) => {
    setTargets((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  };

  // Picking someone while browsing in send-to-all switches to assigning them.
  const pickOfficer = (userId: string | null) => {
    setSelectedId(userId);
    if (userId) setMode('assign');
  };

  const push = (body: Record<string, unknown>) => {
    // Reach locked phones (the server resolves who). Best-effort: a push
    // failure is not a dispatch failure — realtime reached open apps.
    void fetch('/api/push/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incidentId, ...body }),
    }).catch(() => {});
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (locked) return setError(locked);
    if (mode === 'assign') {
      if (!selected) return setError('Pick the officer to assign.');
    } else {
      if (targets.length === 0) return setError('Select at least one department.');
      if (nobody) return setError('No one is on duty to receive the dispatch.');
    }
    start(async () => {
      try {
        const sb = getBrowserSupabase();
        if (mode === 'assign' && selected) {
          // The server re-checks they are on duty, alerts them and logs it.
          await assignIncident(sb, { incident_id: incidentId, user_id: selected.officer.userId });
          push({ userId: selected.officer.userId });
          toast.push({
            title: `${incidentNumber} assigned`,
            body: `Assigned to ${selected.officer.name}. You'll be told when they respond.`,
            tone: 'success',
            badge: severity,
          });
        } else {
          await routeIncident(sb, { incident_id: incidentId, silos: targets });
          push({ silos: targets });
          toast.push({
            title: `${incidentNumber} dispatched`,
            body: `Sent to ${onDuty} on duty in ${targets.map((t) => SILO_LABELS[t]).join(', ')}. You'll be told who responds.`,
            tone: 'success',
            badge: severity,
          });
        }
        router.push(`/incidents/${incidentId}`);
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  };

  const submitLabel = mode === 'assign'
    ? selected ? `Assign to ${selected.officer.name}` : 'Pick an officer'
    : nobody ? 'No one on duty' : `Dispatch to ${onDuty} on duty`;

  return (
    <form onSubmit={onSubmit} className="overflow-visible rounded-2xl border border-border bg-bg-card">
      <h2 className="rounded-t-2xl border-b border-border bg-bg-soft px-5 py-3 text-center text-xs font-bold uppercase tracking-[0.18em]">
        Dispatch &amp; routing
      </h2>

      <div className="space-y-4 p-5">
        {locked ? (
          <p className="rounded-lg border border-severity-medium/40 bg-severity-medium/10 px-3 py-2 text-sm">{locked}</p>
        ) : null}
        {busy.size > 0 ? (
          <ul className="space-y-1 rounded-lg border border-border bg-bg-soft px-3 py-2 text-sm">
            {[...busy].map(([d, words]) => (
              <li key={d}><span className="font-semibold">{SILO_LABELS[d]}:</span> {words}. Other crews can join it as backup from the app.</li>
            ))}
          </ul>
        ) : null}
        {sentOut.map((p) => (
          <p key={p.silo} className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
            {deptLabel(p.silo)}: {p.assigned_to_name
              ? `assigned to ${p.assigned_to_name}${p.assigned_at ? ` ${timeAgo(p.assigned_at)}` : ''}, waiting for them to respond.`
              : 'sent out, waiting for a crew to respond.'} Dispatching again re-alerts them.
          </p>
        ))}
        {locked ? null : assignedTo ? (
          <p className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
            Assigned to {assignedTo.name}{assignedTo.at ? ` ${timeAgo(assignedTo.at)}` : ''} — waiting for them to respond.
            You can reassign it or send it to all.
          </p>
        ) : awaiting ? (
          <p className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
            Sent out — waiting for an officer to respond. Dispatching again re-alerts everyone on duty.
          </p>
        ) : null}

        {/* How to send it */}
        <div aria-label="How to dispatch" className="grid gap-2 sm:grid-cols-2">
          {([
            { id: 'all', icon: Users, title: 'Send to all on duty', blurb: 'First to respond leads; others can join as backup.' },
            { id: 'assign', icon: UserCheck, title: 'Assign to officer', blurb: 'Pick one officer — they lead. Others can still back up.' },
          ] as const).map((m) => {
            const active = mode === m.id;
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={active}
                onClick={() => setMode(m.id)}
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                  active ? 'border-accent bg-accent/10' : 'border-border bg-bg hover:border-accent/40',
                )}
              >
                <span className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  active ? 'bg-accent text-white' : 'bg-muted text-muted-foreground',
                )}>
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-bold">{m.title}</span>
                  <span className="block text-xs text-muted-foreground">{m.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Radio className="h-4 w-4 text-accent" />
            {mode === 'all' ? 'Target departments' : 'Departments (filter)'}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {departments.map((d) => {
              const active = targets.includes(d.id);
              const Icon = d.icon;
              const count = perDept.get(d.id) ?? 0;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => toggleTarget(d.id)}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex h-12 flex-col items-center justify-center rounded-lg text-xs font-bold uppercase tracking-wider transition-all',
                    active
                      ? `${d.className} ring-2 ring-fg/40 ring-offset-2 ring-offset-bg-card`
                      : 'border border-border bg-bg text-muted-foreground hover:border-accent/40 hover:text-fg',
                  )}
                >
                  <span className="inline-flex items-center gap-2"><Icon className="h-4 w-4" /> {d.label}</span>
                  <span className="text-[10px] font-semibold normal-case tracking-normal opacity-80">
                    {count} on duty
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Who is on duty — searchable, for any head count */}
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-severity-low opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-severity-low" />
            </span>
            {mode === 'assign' ? 'Officer to assign' : 'On duty now'}
            <span className="ml-auto font-normal normal-case tracking-normal">
              {onDuty} on duty · {free} available · nearest first
            </span>
          </p>

          {mode === 'all' && targets.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              Select a department to see who is on duty.
            </p>
          ) : nobody ? (
            <p role="alert" className="flex items-center justify-center gap-2 rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-3 py-6 text-center text-sm font-semibold text-severity-critical-ink">
              <UserX className="h-4 w-4 shrink-0" />
              No one is on duty to receive the dispatch.
            </p>
          ) : (
            <OfficerPicker
              ranked={ranked}
              selectedId={mode === 'assign' ? selectedId : null}
              onSelect={pickOfficer}
              deptLabel={deptLabel}
              placeholder={mode === 'assign'
                ? 'Search name, badge, unit or station…'
                : 'Browse who is on duty — picking one switches to Assign'}
              disabled={Boolean(locked)}
            />
          )}
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Only officers who went on duty in the app after today&apos;s start of shift are listed. Distance is straight-line
            from their last GPS heartbeat; ETA assumes {eta.speedKmh} km/h with a {eta.roadFactor}× road factor
            (Admin → Operations Settings).
          </p>
        </div>

        {error ? (
          <p role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">
            {error}
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          {mode === 'assign'
            ? 'The officer gets the incident on their phone and leads it once they press Responding. You are told when they do, and when anyone joins as backup.'
            : 'Every officer on duty in the selected departments gets the incident on their phone. The first to press Responding leads it; others can join as backup. You are told who responds.'}
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-border px-6 text-sm font-semibold hover:bg-muted sm:w-32"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || Boolean(locked) || (mode === 'assign' ? !selected : targets.length === 0 || nobody)}
            className="inline-flex h-11 max-w-full items-center justify-center gap-2 rounded-lg bg-accent px-6 text-sm font-bold uppercase tracking-wider transition-transform hover:scale-[1.01] disabled:opacity-60 sm:min-w-56"
          >
            {pending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> {mode === 'assign' ? 'Assigning…' : 'Dispatching…'}</>
              : <>{mode === 'assign' ? <UserCheck className="h-4 w-4" /> : <Siren className="h-4 w-4" />} <span className="truncate">{submitLabel}</span></>}
          </button>
        </div>
      </div>
    </form>
  );
}
