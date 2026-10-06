'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import type { BodycamCondition, RegisterBodycam } from '@criticom/api';
import type { BodycamStatus } from '@criticom/db';
import { DEPARTMENT_NAMES } from '@criticom/db/onboarding';
import type { Silo } from '@criticom/db/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { cn, formatSaTime } from '@/lib/utils';
import { receiveBodycamAction, setBodycamStatusAction } from './actions';
import { BodycamForm } from './bodycam-form';

export type BodycamFilter = 'current' | 'Available' | 'Booked out' | 'overdue' | 'In repair' | 'Lost' | 'Retired' | 'all';

const FILTER_LABELS: Record<BodycamFilter, string> = {
  current: 'In service', Available: 'Available', 'Booked out': 'Booked out', overdue: 'Out over a shift',
  'In repair': 'In repair', Lost: 'Lost', Retired: 'Retired', all: 'Everything',
};

const STATUS_TONE: Record<BodycamStatus, string> = {
  Available: 'border-success/40 bg-success/10 text-success',
  'Booked out': 'border-primary/40 bg-primary/10 text-primary',
  'In repair': 'border-severity-medium/50 bg-severity-medium/10 text-severity-medium-ink',
  Lost: 'border-severity-critical/50 bg-severity-critical/10 text-severity-critical-ink',
  Retired: 'border-border bg-muted text-muted-foreground',
};

const isOverdue = (c: RegisterBodycam, overdueBefore: string) => c.status === 'Booked out' && !!c.booked_at && c.booked_at < overdueBefore;
const inService = (c: RegisterBodycam) => c.status !== 'Retired' && c.status !== 'Lost';

type Dialog = { kind: 'edit' | 'status' | 'receive'; cam: RegisterBodycam } | null;

export function BodycamTable({ cams, canManage, departments, overdueBefore, initialFilter }: {
  cams: RegisterBodycam[]; canManage: boolean; departments: Silo[]; overdueBefore: string; initialFilter: BodycamFilter;
}) {
  const [filter, setFilter] = useState<BodycamFilter>(initialFilter);
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);

  const matches = (c: RegisterBodycam, f: BodycamFilter) => (f === 'all' ? true : f === 'current' ? inService(c)
    : f === 'overdue' ? isOverdue(c, overdueBefore) : c.status === f);

  const needle = q.trim().toLowerCase();
  const shown = cams.filter((c) => matches(c, filter) && (!needle
    || [c.serial_number, c.model, c.sim_number, c.station, c.hik_camera_code, c.holder?.name, c.holder?.badge]
      .some((v) => v?.toLowerCase().includes(needle))));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(FILTER_LABELS) as BodycamFilter[]).map((f) => {
          const n = cams.filter((c) => matches(c, f)).length;
          return (
            <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
              className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                filter === f ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted',
                f === 'overdue' && n > 0 && filter !== f && 'border-severity-high/60 text-severity-high-ink')}>
              {FILTER_LABELS[f]} <span className="tabular-nums opacity-80">{n}</span>
            </button>
          );
        })}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Serial, holder, SIM, station" aria-label="Search the bodycams" className="pl-8" />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-border bg-bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          {cams.length ? 'Nothing matches.' : 'No bodycams on the register yet. Add them below, or import the bodycam list.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-bg-card">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Serial</th>
                <th className="px-3 py-2">Bodycam</th>
                <th className="px-3 py-2">Kept at</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">With</th>
                {canManage ? <th className="px-3 py-2"><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className={cn('border-b border-border align-top last:border-0', !inService(c) && 'opacity-60')}>
                  <td className="px-3 py-2 font-mono font-semibold">{c.serial_number}</td>
                  <td className="px-3 py-2">
                    {c.model ?? '—'}
                    <span className="block text-xs text-muted-foreground">
                      {[c.sim_number && `SIM ${c.sim_number}`, c.hik_camera_code ? 'Linked to Hikvision' : 'No Hikvision code yet'].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {c.station ?? '—'}
                    {departments.length > 1 ? <span className="block text-xs text-muted-foreground">{DEPARTMENT_NAMES[c.silo]}</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn('inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold', STATUS_TONE[c.status])}>
                      {c.status}
                    </span>
                    {c.status_note && c.status !== 'Available' && c.status !== 'Booked out' ? (
                      <span className="mt-0.5 block max-w-[16rem] text-xs text-muted-foreground">{c.status_note}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {c.holder ? (
                      <>
                        <span className="font-medium">{c.holder.name}</span>
                        <span className={cn('block text-xs', isOverdue(c, overdueBefore) ? 'font-semibold text-severity-high-ink' : 'text-muted-foreground')}>
                          since {formatSaTime(c.booked_at)}{c.holder.onDuty ? '' : ' · off duty'}
                        </span>
                      </>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  {canManage ? (
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1.5">
                        {c.status === 'Booked out' ? (
                          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'receive', cam: c })}>Receive back</Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'status', cam: c })}>Status</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'edit', cam: c })}>Edit</Button>
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
        <Modal title={`Edit ${dialog.cam.serial_number}`} onClose={() => setDialog(null)} wide>
          <BodycamForm
            id={dialog.cam.id}
            departments={departments}
            initial={{
              serial_number: dialog.cam.serial_number, model: dialog.cam.model ?? '', sim_number: dialog.cam.sim_number ?? '',
              hik_camera_code: dialog.cam.hik_camera_code ?? '', silo: dialog.cam.silo, station: dialog.cam.station ?? '', notes: dialog.cam.notes ?? '',
            }}
            onDone={() => setDialog(null)}
          />
        </Modal>
      ) : null}
      {dialog?.kind === 'status' ? <StatusDialog cam={dialog.cam} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'receive' ? <ReceiveDialog cam={dialog.cam} onClose={() => setDialog(null)} /> : null}
    </section>
  );
}

type SettableStatus = Exclude<BodycamStatus, 'Booked out'>;

function StatusDialog({ cam, onClose }: { cam: RegisterBodycam; onClose: () => void }) {
  const router = useRouter();
  const options = (['Available', 'In repair', 'Lost', 'Retired'] as const).filter((s) => s !== cam.status);
  const [status, setStatus] = useState<SettableStatus>(options[0]!);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setError(null);
    const res = await setBodycamStatusAction(cam.id, status, reason.trim());
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    router.refresh(); onClose();
  };

  const hint: Record<SettableStatus, string> = {
    Available: 'Back in service: officers can book it out.',
    'In repair': 'Away for repair: nobody can book it out until it is back.',
    Lost: 'Missing. It stays on record and can be reinstated if it turns up.',
    Retired: 'Off the register for good. It stays on record and can be reinstated.',
  };
  return (
    <Modal title={`${cam.serial_number}${cam.model ? ` · ${cam.model}` : ''}`} onClose={onClose} busy={busy}>
      <p className="text-sm text-muted-foreground">Now: <b className="text-fg">{cam.status}</b>{cam.status_note ? ` (${cam.status_note})` : ''}</p>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">Change to</legend>
        {options.map((s) => (
          <label key={s} className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm', status === s ? 'border-primary bg-primary/5' : 'border-border')}>
            <input type="radio" name="bc-status" checked={status === s} onChange={() => setStatus(s)} className="mt-1 accent-[rgb(var(--c-primary))]" />
            <span><b>{s === 'Available' && (cam.status === 'Retired' || cam.status === 'Lost') ? 'Reinstate' : s}</b><span className="block text-muted-foreground">{hint[s]}</span></span>
          </label>
        ))}
      </fieldset>
      <div>
        <Label htmlFor="bc-status-reason">Reason (on the bodycam’s record)</Label>
        <Input id="bc-status-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="mt-1.5"
          placeholder={status === 'In repair' ? 'e.g. Will not charge, sent to supplier' : status === 'Lost' ? 'e.g. Lost during arrest, CAS 45/10/2026' : 'e.g. Repaired and tested'} />
      </div>
      {error ? <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">{error}</p> : null}
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy || reason.trim().length < 5}>{busy ? 'Saving…' : 'Save'}</Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      </div>
    </Modal>
  );
}

function ReceiveDialog({ cam, onClose }: { cam: RegisterBodycam; onClose: () => void }) {
  const router = useRouter();
  const [condition, setCondition] = useState<BodycamCondition>('ok');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setError(null);
    const res = await receiveBodycamAction({ bodycamId: cam.id, condition, notes: notes.trim() });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setDone(res.status); router.refresh();
  };

  if (done) {
    return (
      <Modal title="Received" onClose={onClose}>
        <p className="text-sm">
          {cam.serial_number} is back and now <b>{done === 'Available' ? 'available' : done.toLowerCase()}</b>.
          {done !== 'Available' ? ' Command has been told.' : ''}
        </p>
        <Button onClick={onClose}>Done</Button>
      </Modal>
    );
  }

  return (
    <Modal title={`Receive back ${cam.serial_number}`} onClose={onClose} busy={busy}>
      <p className="text-sm text-muted-foreground">
        Booked out to <b className="text-fg">{cam.holder?.name ?? 'an officer'}</b> since {formatSaTime(cam.booked_at)}. Use this when the officer
        cannot hand it back in the app. Any live view of it ends.
      </p>
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">Condition</legend>
        <div className="flex flex-wrap gap-2">
          {([['ok', 'In order'], ['damaged', 'Damaged'], ['lost', 'Lost']] as const).map(([v, l]) => (
            <label key={v} className={cn('cursor-pointer rounded-md border px-3 py-1.5 text-sm', condition === v ? 'border-primary bg-primary/10 font-semibold' : 'border-border')}>
              <input type="radio" name="bc-rcv-cond" className="sr-only" checked={condition === v} onChange={() => setCondition(v)} />{l}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <Label htmlFor="bc-rcv-notes">Notes (who handed it in, and why here)</Label>
        <Input id="bc-rcv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className="mt-1.5"
          placeholder="e.g. Handed in by Sgt Dlamini at the front desk; phone flat" />
      </div>
      {error ? <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">{error}</p> : null}
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy || notes.trim().length < 5}>{busy ? 'Saving…' : 'Receive it'}</Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      </div>
    </Modal>
  );
}
