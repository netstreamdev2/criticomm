'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Ambulance, Flame, Loader2, Radio, Shield, Siren, Waves } from 'lucide-react';
import { dispatchUnit, raiseDispatchAlerts } from '@criticom/api';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import type { IncidentSeverity, Silo } from '@criticom/db';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';

type Vehicle = { id: string; unit_number: string; name: string; type: string; silo: Silo };
type Department = Exclude<Silo, 'Ethekwini'>;

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
  MetroPolice: 'Metro Police',
  MetroFire: 'Fire & Rescue',
  Medical: 'EMS / Medical',
  EthekwiniDisaster: 'Disaster Mgmt',
};

export function AssignForm({
  incidentId, silo, severity, vehicles, dispatchedBy,
}: {
  incidentId: string;
  silo: Silo;
  severity: IncidentSeverity;
  vehicles: Vehicle[];
  dispatchedBy?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const initialTargets: Department[] = silo === 'Ethekwini' ? [] : [silo as Department];
  const [targets, setTargets] = useState<Department[]>(initialTargets);

  // Units from the selected departments first — that's who is actually rolling.
  const orderedVehicles = useMemo(() => {
    if (targets.length === 0) return vehicles;
    const inTarget = vehicles.filter((v) => targets.includes(v.silo as Department));
    const rest = vehicles.filter((v) => !targets.includes(v.silo as Department));
    return [...inTarget, ...rest];
  }, [vehicles, targets]);

  const [unitId, setUnitId] = useState<string>(orderedVehicles[0]?.id ?? '');

  const toggleTarget = (d: Department) => {
    setTargets((cur) => {
      const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
      // Re-point the unit picker at the newly relevant department.
      const preferred = vehicles.find((v) => next.includes(v.silo as Department));
      if (preferred) setUnitId(preferred.id);
      return next;
    });
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!unitId) return setError('Pick a unit to dispatch.');
    if (targets.length === 0) return setError('Select at least one department.');
    start(async () => {
      try {
        const sb = getBrowserSupabase();
        const unitType = targets.length > 1 ? targets.join(',') : targets[0]!;
        await dispatchUnit(sb, {
          incident_id: incidentId,
          unit_id: unitId,
          unit_type: unitType,
          target_silos: targets,
        });
        // Stamp the dispatcher for per-user KPIs (V4 DispatchedBy attribution).
        if (dispatchedBy) {
          await sb.from('incidents').update({ dispatched_by: dispatchedBy }).eq('id', incidentId);
        }
        // Pop every screen in the receiving departments, then reach locked
        // phones — both best-effort, never blocking the dispatch itself.
        await raiseDispatchAlerts(sb, { incidentId, silos: targets, byName: dispatchedBy }).catch(() => {});
        void fetch('/api/push/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ incidentId, silos: targets }),
        }).catch(() => {});

        toast.push({
          title: 'Unit dispatched',
          body: `${targets.map((t) => SILO_LABELS[t]).join(', ')} alerted.`,
          tone: 'success',
          badge: severity,
        });
        router.push(`/incidents/${incidentId}`);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="overflow-hidden rounded-2xl border border-border bg-bg-card">
      <h2 className="border-b border-border bg-bg-soft px-5 py-3 text-center text-xs font-bold uppercase tracking-[0.18em]">
        Unit dispatch &amp; routing
      </h2>

      <div className="space-y-4 p-5">
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Radio className="h-4 w-4 text-accent" /> Target departments
            {targets.length > 0 ? (
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {targets.length} selected · lead is {SILO_LABELS[targets[0]!]}
              </span>
            ) : null}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {DEPARTMENTS.map((d) => {
              const active = targets.includes(d.id);
              const Icon = d.icon;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => toggleTarget(d.id)}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex h-11 items-center justify-center gap-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all',
                    active
                      ? `${d.className} ring-2 ring-fg/40 ring-offset-2 ring-offset-bg-card`
                      : 'border border-border bg-bg text-muted-foreground hover:border-accent/40 hover:text-fg',
                  )}
                >
                  <Icon className="h-4 w-4" /> {d.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Available unit
          </p>
          <select
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className="h-11 w-full rounded-lg border border-border bg-bg-soft px-3 text-sm focus:border-accent focus:outline-none"
          >
            {orderedVehicles.length === 0 && <option value="">No vehicles available</option>}
            {orderedVehicles.map((v) => (
              <option key={v.id} value={v.id}>
                [{v.silo}] {v.unit_number} — {v.name} ({v.type})
              </option>
            ))}
          </select>
          {targets.length > 0 ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Units from the selected departments are listed first.
            </p>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">
            {error}
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          On dispatch, every screen in the selected department{targets.length === 1 ? '' : 's'} is alerted
          {severity === 'High' || severity === 'Critical'
            ? ' with a blocking pop-up that must be acknowledged.'
            : '.'}
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
            disabled={pending}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-6 text-sm font-bold uppercase tracking-wider transition-transform hover:scale-[1.01] disabled:opacity-60 sm:w-56"
          >
            {pending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Dispatching…</>
              : <><Siren className="h-4 w-4" /> Dispatch unit</>}
          </button>
        </div>
      </div>
    </form>
  );
}
