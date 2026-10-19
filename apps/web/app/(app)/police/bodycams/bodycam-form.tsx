'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEPARTMENT_NAMES } from '@criticom/db/onboarding';
import type { Silo } from '@criticom/db/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addBodycamAction, updateBodycamAction, type BodycamDetails } from './actions';
import { blankBodycam } from './blank';
import { useT } from '@/components/i18n';

const SELECT = 'mt-1.5 h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';

/**
 * One bodycam's details, for adding a new one or correcting one on the
 * register. Who has it and its status are never edited here.
 */
export function BodycamForm({ initial, id, departments, onDone }: {
  initial: BodycamDetails; id?: string; departments: Silo[]; onDone?: () => void;
}) {
  const { t } = useT();
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const set = (k: keyof BodycamDetails) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setSaved(null);
    const res = id ? await updateBodycamAction(id, d) : await addBodycamAction(d);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    router.refresh();
    if (id) { onDone?.(); return; }
    setSaved(`${d.serial_number.trim()} added to the register.`);
    setD({ ...blankBodycam(d.silo), model: d.model, station: d.station });
  };

  const k = id ?? 'new';
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`bc-serial-${k}`}>{t('Serial number')}</Label>
          <Input id={`bc-serial-${k}`} value={d.serial_number} onChange={set('serial_number')} required maxLength={60} className="mt-1.5 font-mono" autoComplete="off" />
        </div>
        <div>
          <Label htmlFor={`bc-model-${k}`}>{t('Model')}</Label>
          <Input id={`bc-model-${k}`} value={d.model} onChange={set('model')} maxLength={60} placeholder={t('e.g. DS-MCW407')} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor={`bc-sim-${k}`}>{t('SIM number')}</Label>
          <Input id={`bc-sim-${k}`} value={d.sim_number} onChange={set('sim_number')} maxLength={30} inputMode="tel" placeholder={t('The data SIM in the bodycam')} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor={`bc-station-${k}`}>{t('Station')}</Label>
          <Input id={`bc-station-${k}`} value={d.station} onChange={set('station')} maxLength={80} placeholder={t('Where it is kept and charged')} className="mt-1.5" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`bc-code-${k}`}>{t('Hikvision camera code')}</Label>
          <Input id={`bc-code-${k}`} value={d.hik_camera_code} onChange={set('hik_camera_code')} maxLength={64} autoComplete="off"
            placeholder={t('Leave blank until the Hikvision platform is connected')} className="mt-1.5 font-mono" />
          <p className="mt-1 text-xs text-muted-foreground">{t('The camera’s code on the Hikvision platform (cameraIndexCode). Live video needs it.')}</p>
        </div>
        {departments.length > 1 ? (
          <div>
            <Label htmlFor={`bc-silo-${k}`}>{t('Department')}</Label>
            <select id={`bc-silo-${k}`} value={d.silo} onChange={set('silo')} className={SELECT}>
              {departments.map((s) => <option key={s} value={s}>{DEPARTMENT_NAMES[s]}</option>)}
            </select>
          </div>
        ) : null}
        <div className={departments.length > 1 ? '' : 'sm:col-span-2'}>
          <Label htmlFor={`bc-notes-${k}`}>{t('Notes')}</Label>
          <Input id={`bc-notes-${k}`} value={d.notes} onChange={set('notes')} maxLength={500} className="mt-1.5" />
        </div>
      </div>
      {error ? <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">{error}</p> : null}
      {saved ? <output className="block text-sm text-success">{saved}</output> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : id ? 'Save changes' : 'Add bodycam'}</Button>
        {onDone ? <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>{t('Cancel')}</Button> : null}
      </div>
    </form>
  );
}
