'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { dispatchUnit } from '@criticom/api';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import type { Silo } from '@criticom/db';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

type Vehicle = { id: string; unit_number: string; name: string; type: string; silo: Silo };

const SILOS: { value: Silo; label: string }[] = [
  { value: 'MetroPolice',       label: 'Metro Police' },
  { value: 'MetroFire',         label: 'Fire & Rescue' },
  { value: 'Medical',           label: 'EMS' },
  { value: 'EthekwiniDisaster', label: 'Disaster Mgmt' },
];

export function AssignForm({
  incidentId, silo, vehicles, dispatchedBy,
}: {
  incidentId: string;
  silo: Silo;
  vehicles: Vehicle[];
  dispatchedBy?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string>(vehicles[0]?.id ?? '');
  const [targets, setTargets] = useState<Silo[]>([silo]);

  const toggleTarget = (s: Silo) => {
    setTargets((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!unitId) return setError('Pick a unit');
    if (targets.length === 0) return setError('Pick at least one target silo');
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
        router.push('/dispatch/pending');
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-lg border border-border bg-bg-card p-6">
      <div>
        <Label>Target silos</Label>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {SILOS.map((s) => (
            <label
              key={s.value}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={targets.includes(s.value)}
                onChange={() => toggleTarget(s.value)}
              />
              {s.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <Label>Available unit</Label>
        <select
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
          className="mt-2 h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm"
        >
          {vehicles.length === 0 && <option value="">No vehicles available</option>}
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              [{v.silo}] {v.unit_number} — {v.name} ({v.type})
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Dispatching…' : 'Dispatch unit'}</Button>
      </div>
    </form>
  );
}
