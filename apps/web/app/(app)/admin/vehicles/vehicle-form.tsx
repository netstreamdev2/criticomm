'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { VEHICLE_TYPES } from '@criticom/db/assets';
import { DEPARTMENT_NAMES } from '@criticom/db/onboarding';
import type { Silo } from '@criticom/db/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addVehicleAction, updateVehicleAction, type VehicleDetails } from './actions';
import { blankVehicle } from './blank';

const SELECT = 'mt-1.5 h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';

/**
 * One vehicle's details, for adding a new one or correcting one in the fleet.
 * Its status is never edited here: that goes through Status, with a reason.
 */
export function VehicleForm({ initial, id, departments, onDone }: {
  initial: VehicleDetails; id?: string; departments: Silo[]; onDone?: () => void;
}) {
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const set = (k: keyof VehicleDetails) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setSaved(null);
    const res = id ? await updateVehicleAction(id, d) : await addVehicleAction(d);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    router.refresh();
    if (id) { onDone?.(); return; }
    setSaved(`${d.unit_number.trim()} added to the fleet.`);
    setD({ ...blankVehicle(d.silo), type: d.type, make: d.make, model: d.model, station_number: d.station_number, fuel_type: d.fuel_type });
  };

  const k = id ?? 'new';
  const field = (name: keyof VehicleDetails, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <Label htmlFor={`v-${name}-${k}`}>{label}</Label>
      <Input id={`v-${name}-${k}`} value={d[name]} onChange={set(name)} className="mt-1.5" {...extra} />
    </div>
  );
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {field('unit_number', 'Unit number', { required: true, maxLength: 30, autoComplete: 'off', className: 'mt-1.5 font-mono' })}
        <div>
          <Label htmlFor={`v-type-${k}`}>Type</Label>
          <select id={`v-type-${k}`} value={d.type} onChange={set('type')} required className={SELECT}>
            <option value="" disabled>Choose</option>
            {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {field('name', 'Name', { maxLength: 80, placeholder: 'e.g. Patrol 12 (blank: type and unit)' })}
        {field('license_plate', 'Licence plate', { maxLength: 20, className: 'mt-1.5 font-mono uppercase' })}
        {field('make', 'Make', { maxLength: 40, placeholder: 'e.g. Toyota' })}
        {field('model', 'Model', { maxLength: 40, placeholder: 'e.g. Hilux 2.4 GD-6' })}
        {field('year', 'Year', { inputMode: 'numeric', maxLength: 4 })}
        {field('station_number', 'Station', { maxLength: 40 })}
        {field('disc_expiry', 'Licence disc expires', { type: 'date' })}
        {field('fuel_type', 'Fuel', { maxLength: 20, placeholder: 'Diesel or Petrol' })}
        {field('vin', 'VIN', { maxLength: 30, className: 'mt-1.5 font-mono uppercase' })}
        {departments.length > 1 ? (
          <div>
            <Label htmlFor={`v-silo-${k}`}>Department</Label>
            <select id={`v-silo-${k}`} value={d.silo} onChange={set('silo')} className={SELECT}>
              {departments.map((s) => <option key={s} value={s}>{DEPARTMENT_NAMES[s]}</option>)}
            </select>
          </div>
        ) : null}
      </div>
      {error ? <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">{error}</p> : null}
      {saved ? <output className="block text-sm text-success">{saved}</output> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : id ? 'Save changes' : 'Add vehicle'}</Button>
        {onDone ? <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>Cancel</Button> : null}
      </div>
    </form>
  );
}
