'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FIREARM_TYPES } from '@criticom/db/assets';
import { DEPARTMENT_NAMES } from '@criticom/db/onboarding';
import type { Silo } from '@criticom/db/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addFirearmAction, updateFirearmAction, type FirearmDetails } from './actions';
import { blankFirearm } from './blank';

const SELECT = 'mt-1.5 h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';

/**
 * One firearm's details, for adding a new one or correcting one on the
 * register. Who holds it and its status are never edited here.
 */
export function FirearmForm({ initial, id, departments, onDone }: {
  initial: FirearmDetails; id?: string; departments: Silo[]; onDone?: () => void;
}) {
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const set = (k: keyof FirearmDetails) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setSaved(null);
    const res = id ? await updateFirearmAction(id, d) : await addFirearmAction(d);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    router.refresh();
    if (id) { onDone?.(); return; }
    setSaved(`${d.serial_number.trim()} added to the armoury.`);
    setD({ ...blankFirearm(d.silo), station: d.station, make: d.make, model: d.model, calibre: d.calibre, firearm_type: d.firearm_type });
  };

  const k = id ?? 'new';
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`fa-serial-${k}`}>Serial number</Label>
          <Input id={`fa-serial-${k}`} value={d.serial_number} onChange={set('serial_number')} required maxLength={60} className="mt-1.5 font-mono" autoComplete="off" />
        </div>
        <div>
          <Label htmlFor={`fa-type-${k}`}>Type</Label>
          <select id={`fa-type-${k}`} value={d.firearm_type} onChange={set('firearm_type')} required className={SELECT}>
            <option value="" disabled>Choose</option>
            {FIREARM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor={`fa-make-${k}`}>Make</Label>
          <Input id={`fa-make-${k}`} value={d.make} onChange={set('make')} required maxLength={60} placeholder="e.g. Glock" className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor={`fa-model-${k}`}>Model</Label>
          <Input id={`fa-model-${k}`} value={d.model} onChange={set('model')} required maxLength={60} placeholder="e.g. 17 Gen 5" className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor={`fa-cal-${k}`}>Calibre</Label>
          <Input id={`fa-cal-${k}`} value={d.calibre} onChange={set('calibre')} maxLength={30} placeholder="e.g. 9mm" className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor={`fa-station-${k}`}>Station</Label>
          <Input id={`fa-station-${k}`} value={d.station} onChange={set('station')} maxLength={80} placeholder="Where it is kept" className="mt-1.5" />
        </div>
        {departments.length > 1 ? (
          <div>
            <Label htmlFor={`fa-silo-${k}`}>Department</Label>
            <select id={`fa-silo-${k}`} value={d.silo} onChange={set('silo')} className={SELECT}>
              {departments.map((s) => <option key={s} value={s}>{DEPARTMENT_NAMES[s]}</option>)}
            </select>
          </div>
        ) : null}
        <div className={departments.length > 1 ? '' : 'sm:col-span-2'}>
          <Label htmlFor={`fa-notes-${k}`}>Notes</Label>
          <Input id={`fa-notes-${k}`} value={d.notes} onChange={set('notes')} maxLength={300} className="mt-1.5" />
        </div>
      </div>
      {error ? <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">{error}</p> : null}
      {saved ? <output className="block text-sm text-success">{saved}</output> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : id ? 'Save changes' : 'Add firearm'}</Button>
        {onDone ? <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>Cancel</Button> : null}
      </div>
    </form>
  );
}
