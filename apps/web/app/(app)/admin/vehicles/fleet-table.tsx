'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import type { FleetVehicle } from '@criticom/api';
import type { ApparatusStatus } from '@criticom/db';
import { DEPARTMENT_NAMES } from '@criticom/db/onboarding';
import type { Silo } from '@criticom/db/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { cn, formatSaTime } from '@/lib/utils';
import { setVehicleStatusAction } from './actions';
import { VehicleForm } from './vehicle-form';

export type FleetFilter = 'current' | 'Available' | 'with-officer' | 'off-road' | 'failed' | 'disc' | 'Decommissioned' | 'all';
type Disc = 'expired' | 'soon' | 'ok' | null;
export type FleetRow = FleetVehicle & { disc: Disc };

const FILTER_LABELS: Record<FleetFilter, string> = {
  current: 'In the fleet', Available: 'Available', 'with-officer': 'With an officer', 'off-road': 'Off the road',
  failed: 'Failed inspection', disc: 'Disc expired or due', Decommissioned: 'Decommissioned', all: 'Everything',
};

const ON_SHIFT: ApparatusStatus[] = ['In Use', 'En Route', 'On Scene'];
const OFF_ROAD: ApparatusStatus[] = ['Out of Service', 'Maintenance'];

const matches = (v: FleetRow, f: FleetFilter) => {
  switch (f) {
    case 'current': return v.status !== 'Decommissioned';
    case 'Available': return v.status === 'Available';
    case 'with-officer': return ON_SHIFT.includes(v.status) || !!v.driver;
    case 'off-road': return OFF_ROAD.includes(v.status);
    case 'failed': return v.last_inspection_result === 'fail' && v.status !== 'Decommissioned';
    case 'disc': return (v.disc === 'expired' || v.disc === 'soon') && v.status !== 'Decommissioned';
    case 'Decommissioned': return v.status === 'Decommissioned';
    case 'all': return true;
  }
};

const STATUS_TONE = (s: ApparatusStatus) =>
  s === 'Available' ? 'border-success/40 bg-success/10 text-success'
    : ON_SHIFT.includes(s) ? 'border-primary/40 bg-primary/10 text-primary'
      : s === 'Out of Service' ? 'border-severity-high/50 bg-severity-high/10 text-severity-high-ink'
        : s === 'Maintenance' ? 'border-severity-medium/50 bg-severity-medium/10 text-severity-medium-ink'
          : 'border-border bg-muted text-muted-foreground';

const INSPECTION = { pass: ['Passed', 'text-success'], faults: ['Passed with faults', 'text-severity-medium-ink'], fail: ['Failed', 'text-severity-high-ink'] } as const;

type Dialog = { kind: 'edit' | 'status'; vehicle: FleetRow } | null;

export function FleetTable({ vehicles, canManage, departments, initialFilter }: {
  vehicles: FleetRow[]; canManage: boolean; departments: Silo[]; initialFilter: FleetFilter;
}) {
  const [filter, setFilter] = useState<FleetFilter>(initialFilter);
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vehicles.filter((v) => matches(v, filter) && (!needle || [v.unit_number, v.name, v.license_plate, v.make, v.model, v.station_number, v.driver, v.type]
      .some((x) => x?.toLowerCase().includes(needle))));
  }, [vehicles, filter, q]);

  const count = (f: FleetFilter) => vehicles.filter((v) => matches(v, f)).length;
  const warn: FleetFilter[] = ['off-road', 'failed', 'disc'];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(FILTER_LABELS) as FleetFilter[]).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
            className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
              filter === f ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted',
              warn.includes(f) && count(f) > 0 && filter !== f && 'border-severity-medium/60 text-severity-medium-ink')}>
            {FILTER_LABELS[f]} <span className="tabular-nums opacity-80">{count(f)}</span>
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Unit, plate, driver, station" aria-label="Search the fleet" className="pl-8" />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-border bg-bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          {vehicles.length ? 'Nothing matches.' : 'No vehicles in the fleet yet. Add them below, or import the fleet list.'}
        </p>
      ) : (
      <div className="overflow-x-auto rounded-xl border border-border bg-bg-card">
        <table className="w-full min-w-[60rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2">Vehicle</th>
              <th className="px-3 py-2">Plate</th>
              <th className="px-3 py-2">Station</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Driver</th>
              <th className="px-3 py-2">Last inspection</th>
              <th className="px-3 py-2">Disc</th>
              {canManage ? <th className="px-3 py-2"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {shown.map((v) => (
              <tr key={v.id} className={cn('border-b border-border align-top last:border-0', v.status === 'Decommissioned' && 'opacity-60')}>
                <td className="px-3 py-2">
                  <span className="font-mono font-semibold">{v.unit_number}</span>
                  <span className="block text-xs text-muted-foreground">{v.name}</span>
                </td>
                <td className="px-3 py-2">
                  {v.type}
                  <span className="block text-xs text-muted-foreground">{[v.make, v.model, v.year].filter(Boolean).join(' ') || '—'}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{v.license_plate ?? '—'}</td>
                <td className="px-3 py-2">
                  {v.station_number ?? '—'}
                  {departments.length > 1 ? <span className="block text-xs text-muted-foreground">{DEPARTMENT_NAMES[v.silo]}</span> : null}
                </td>
                <td className="px-3 py-2">
                  <span className={cn('inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold', STATUS_TONE(v.status))}>{v.status}</span>
                  {v.status_note && OFF_ROAD.concat('Decommissioned').includes(v.status) ? (
                    <span className="mt-0.5 block max-w-[16rem] text-xs text-muted-foreground">{v.status_note}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{v.driver ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2">
                  {v.last_inspection_result ? (
                    <>
                      <span className={cn('font-semibold', INSPECTION[v.last_inspection_result][1])}>{INSPECTION[v.last_inspection_result][0]}</span>
                      <span className="block text-xs text-muted-foreground">{formatSaTime(v.last_inspection_at)}</span>
                    </>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {v.disc_expiry ? (
                    <span className={cn(v.disc === 'expired' && 'font-semibold text-severity-high-ink', v.disc === 'soon' && 'text-severity-medium-ink')}>
                      {v.disc === 'expired' ? 'Expired ' : v.disc === 'soon' ? 'Due ' : ''}{v.disc_expiry}
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                {canManage ? (
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'status', vehicle: v })}>Status</Button>
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'edit', vehicle: v })}>Edit</Button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {dialog?.kind === 'edit' ? (
        <Modal title={`Edit ${dialog.vehicle.unit_number}`} onClose={() => setDialog(null)} wide>
          <VehicleForm
            id={dialog.vehicle.id}
            departments={departments}
            initial={{
              unit_number: dialog.vehicle.unit_number, name: dialog.vehicle.name, type: dialog.vehicle.type, silo: dialog.vehicle.silo,
              make: dialog.vehicle.make ?? '', model: dialog.vehicle.model ?? '', year: dialog.vehicle.year ? String(dialog.vehicle.year) : '',
              license_plate: dialog.vehicle.license_plate ?? '', vin: dialog.vehicle.vin ?? '', station_number: dialog.vehicle.station_number ?? '',
              fuel_type: dialog.vehicle.fuel_type ?? '', disc_expiry: dialog.vehicle.disc_expiry ?? '',
            }}
            onDone={() => setDialog(null)}
          />
        </Modal>
      ) : null}
      {dialog?.kind === 'status' ? <VehicleStatusDialog vehicle={dialog.vehicle} onClose={() => setDialog(null)} /> : null}
    </section>
  );
}

const STATUS_HINT: Record<'Available' | 'Maintenance' | 'Out of Service' | 'Decommissioned', string> = {
  Available: 'On the road: officers can choose it at the start of a shift.',
  Maintenance: 'At the workshop or waiting for a service.',
  'Out of Service': 'Not safe to drive until it is fixed.',
  Decommissioned: 'Leaves the fleet for good. It stays on record and can be returned.',
};

/** Change a vehicle's status with a reason; also used by today's shift board. */
export function VehicleStatusDialog({ vehicle, onClose }: {
  vehicle: Pick<FleetVehicle, 'id' | 'unit_number' | 'name' | 'status' | 'status_note' | 'driver'>; onClose: () => void;
}) {
  const router = useRouter();
  const options = (Object.keys(STATUS_HINT) as Array<keyof typeof STATUS_HINT>).filter((s) => s !== vehicle.status);
  const [status, setStatus] = useState(options[0]!);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const withOfficer = ON_SHIFT.includes(vehicle.status) || !!vehicle.driver;

  const save = async () => {
    setBusy(true); setError(null);
    const res = await setVehicleStatusAction(vehicle.id, status, reason.trim());
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    router.refresh(); onClose();
  };

  return (
    <Modal title={`${vehicle.unit_number} · ${vehicle.name}`} onClose={onClose} busy={busy}>
      <p className="text-sm text-muted-foreground">Now: <b className="text-fg">{vehicle.status}</b>{vehicle.status_note ? ` (${vehicle.status_note})` : ''}</p>
      {withOfficer ? (
        <p className="rounded-md border border-severity-medium/50 bg-severity-medium/10 px-3 py-2 text-sm">
          {vehicle.driver ?? 'An officer'} has this vehicle on their shift. Its status can change once they end the shift and hand it back.
        </p>
      ) : (
        <>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">Change to</legend>
            {options.map((s) => (
              <label key={s} className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm', status === s ? 'border-primary bg-primary/5' : 'border-border')}>
                <input type="radio" name="v-status" checked={status === s} onChange={() => setStatus(s)} className="mt-1 accent-[rgb(var(--c-primary))]" />
                <span><b>{s === 'Available' && vehicle.status !== 'Available' ? 'Return to service' : s}</b><span className="block text-muted-foreground">{STATUS_HINT[s]}</span></span>
              </label>
            ))}
          </fieldset>
          <div>
            <Label htmlFor="v-status-reason">Reason (on the vehicle’s record)</Label>
            <Input id="v-status-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="mt-1.5"
              placeholder={status === 'Available' ? 'e.g. Brakes replaced, job card 4471' : 'e.g. Brake warning light, booked at the workshop'} />
          </div>
        </>
      )}
      {error ? <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">{error}</p> : null}
      <div className="flex gap-2">
        {!withOfficer ? <Button onClick={save} disabled={busy || reason.trim().length < 5}>{busy ? 'Saving…' : 'Save'}</Button> : null}
        <Button variant="ghost" onClick={onClose} disabled={busy}>{withOfficer ? 'Close' : 'Cancel'}</Button>
      </div>
    </Modal>
  );
}
