'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import type { ArmouryFirearm } from '@criticom/api';
import { DEPARTMENT_NAMES } from '@criticom/db/onboarding';
import type { Silo } from '@criticom/db/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { cn, formatSaTime } from '@/lib/utils';
import { receiveFirearmAction, setFirearmStatusAction } from './actions';
import { FirearmForm } from './firearm-form';
import { useT } from '@/components/i18n';

export type ArmouryFilter = 'current' | 'Available' | 'Issued' | 'overdue' | 'Maintenance' | 'Retired' | 'all';

const FILTER_LABELS: Record<ArmouryFilter, string> = {
  current: 'In service', Available: 'Available', Issued: 'Booked out', overdue: 'Out over a shift',
  Maintenance: 'Maintenance', Retired: 'Retired', all: 'Everything',
};

const STATUS_TONE: Record<ArmouryFirearm['status'], string> = {
  Available: 'border-success/40 bg-success/10 text-success',
  Issued: 'border-primary/40 bg-primary/10 text-primary',
  Maintenance: 'border-severity-medium/50 bg-severity-medium/10 text-severity-medium-ink',
  Retired: 'border-border bg-muted text-muted-foreground',
};

/** Out longer than a shift (firearmOverdueBefore): kept after the shift, or never handed back. */
const isOverdue = (f: ArmouryFirearm, overdueBefore: string) => f.status === 'Issued' && !!f.issued_at && f.issued_at < overdueBefore;

type Dialog =
  | { kind: 'edit'; firearm: ArmouryFirearm }
  | { kind: 'status'; firearm: ArmouryFirearm }
  | { kind: 'receive'; firearm: ArmouryFirearm }
  | null;

export function ArmouryTable({ firearms, canManage, departments, overdueBefore, initialFilter }: {
  firearms: ArmouryFirearm[]; canManage: boolean; departments: Silo[]; overdueBefore: string; initialFilter: ArmouryFilter;
}) {
  const { t } = useT();
  const [filter, setFilter] = useState<ArmouryFilter>(initialFilter);
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const overdue = (f: ArmouryFirearm) => isOverdue(f, overdueBefore);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return firearms.filter((f) => {
      if (filter === 'current' && f.status === 'Retired') return false;
      if (filter === 'overdue' && !isOverdue(f, overdueBefore)) return false;
      if (filter !== 'current' && filter !== 'overdue' && filter !== 'all' && f.status !== filter) return false;
      if (!needle) return true;
      return [f.serial_number, f.make, f.model, f.calibre, f.station, f.holder?.name, f.firearm_type]
        .some((v) => v?.toLowerCase().includes(needle));
    });
  }, [firearms, filter, q, overdueBefore]);

  const count = (f: ArmouryFilter) => firearms.filter((x) =>
    f === 'all' ? true : f === 'current' ? x.status !== 'Retired' : f === 'overdue' ? overdue(x) : x.status === f).length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(FILTER_LABELS) as ArmouryFilter[]).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
            className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
              filter === f ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted',
              f === 'overdue' && count(f) > 0 && filter !== f && 'border-severity-high/60 text-severity-high-ink')}>
            {FILTER_LABELS[f]} <span className="tabular-nums opacity-80">{count(f)}</span>
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Serial, make, holder, station')} aria-label={t('Search the armoury')} className="pl-8" />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-border bg-bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          {firearms.length ? 'Nothing matches.' : 'No firearms on the register yet. Add them below, or import the armoury list.'}
        </p>
      ) : (
      <div className="overflow-x-auto rounded-xl border border-border bg-bg-card">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">{t('Serial')}</th>
              <th className="px-3 py-2">{t('Firearm')}</th>
              <th className="px-3 py-2">{t('Kept at')}</th>
              <th className="px-3 py-2">{t('Status')}</th>
              <th className="px-3 py-2">{t('Held by')}</th>
              {canManage ? <th className="px-3 py-2"><span className="sr-only">{t('Actions')}</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => (
              <tr key={f.id} className={cn('border-b border-border align-top last:border-0', f.status === 'Retired' && 'opacity-60')}>
                <td className="px-3 py-2 font-mono font-semibold">{f.serial_number}</td>
                <td className="px-3 py-2">
                  {f.make} {f.model}
                  <span className="block text-xs text-muted-foreground">{[f.firearm_type, f.calibre].filter(Boolean).join(' · ')}</span>
                </td>
                <td className="px-3 py-2">
                  {f.station ?? '—'}
                  {departments.length > 1 ? <span className="block text-xs text-muted-foreground">{DEPARTMENT_NAMES[f.silo]}</span> : null}
                </td>
                <td className="px-3 py-2">
                  <span className={cn('inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold', STATUS_TONE[f.status])}>
                    {f.status === 'Issued' ? 'Booked out' : f.status}
                  </span>
                  {f.status_note && f.status !== 'Available' && f.status !== 'Issued' ? (
                    <span className="mt-0.5 block max-w-[16rem] text-xs text-muted-foreground">{f.status_note}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  {f.holder ? (
                    <>
                      <span className="font-medium">{f.holder.name}</span>
                      <span className={cn('block text-xs', overdue(f) ? 'font-semibold text-severity-high-ink' : 'text-muted-foreground')}>
                        {t('since {saTime}{value}', { saTime: formatSaTime(f.holder.since), value: f.holder.rounds !== null ? ` · ${f.holder.rounds} rounds` : '' })}
                      </span>
                    </>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                {canManage ? (
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      {f.status === 'Issued' ? (
                        <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'receive', firearm: f })}>{t('Receive back')}</Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'status', firearm: f })}>{t('Status')}</Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'edit', firearm: f })}>{t('Edit')}</Button>
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
        <Modal title={`Edit ${dialog.firearm.serial_number}`} onClose={() => setDialog(null)} wide>
          <FirearmForm
            id={dialog.firearm.id}
            departments={departments}
            initial={{
              serial_number: dialog.firearm.serial_number, make: dialog.firearm.make, model: dialog.firearm.model,
              calibre: dialog.firearm.calibre ?? '', firearm_type: dialog.firearm.firearm_type, silo: dialog.firearm.silo,
              station: dialog.firearm.station ?? '', notes: dialog.firearm.notes ?? '',
            }}
            onDone={() => setDialog(null)}
          />
        </Modal>
      ) : null}
      {dialog?.kind === 'status' ? <StatusDialog firearm={dialog.firearm} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'receive' ? <ReceiveDialog firearm={dialog.firearm} onClose={() => setDialog(null)} /> : null}
    </section>
  );
}

function StatusDialog({ firearm, onClose }: { firearm: ArmouryFirearm; onClose: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const options = (['Available', 'Maintenance', 'Retired'] as const).filter((s) => s !== firearm.status);
  const [status, setStatus] = useState<(typeof options)[number]>(options[0]!);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setError(null);
    const res = await setFirearmStatusAction(firearm.id, status, reason.trim());
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    router.refresh(); onClose();
  };

  const hint = { Available: 'Back in service: the officers can book it out.', Maintenance: 'With the armourer: nobody can book it out until it is back.', Retired: 'Off the register for good. It stays on record and can be reinstated.' };
  return (
    <Modal title={`${firearm.serial_number} · ${firearm.make} ${firearm.model}`} onClose={onClose} busy={busy}>
      <p className="text-sm text-muted-foreground">{t('Now:')}{' '}<b className="text-fg">{firearm.status}</b>{firearm.status_note ? ` (${firearm.status_note})` : ''}</p>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">{t('Change to')}</legend>
        {options.map((s) => (
          <label key={s} className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm', status === s ? 'border-primary bg-primary/5' : 'border-border')}>
            <input type="radio" name="fa-status" checked={status === s} onChange={() => setStatus(s)} className="mt-1 accent-[rgb(var(--c-primary))]" />
            <span><b>{s === 'Available' && firearm.status === 'Retired' ? 'Reinstate' : s}</b><span className="block text-muted-foreground">{hint[s]}</span></span>
          </label>
        ))}
      </fieldset>
      <div>
        <Label htmlFor="fa-status-reason">{t('Reason (on the firearm’s record)')}</Label>
        <Input id="fa-status-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="mt-1.5"
          placeholder={status === 'Maintenance' ? 'e.g. Trigger sticking, sent to armourer' : status === 'Retired' ? 'e.g. Written off, frame cracked' : 'e.g. Serviced and test-fired'} />
      </div>
      {error ? <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">{error}</p> : null}
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy || reason.trim().length < 5}>{busy ? 'Saving…' : 'Save'}</Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('Cancel')}</Button>
      </div>
    </Modal>
  );
}

function ReceiveDialog({ firearm, onClose }: { firearm: ArmouryFirearm; onClose: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const issued = firearm.holder?.rounds ?? null;
  const [rounds, setRounds] = useState(issued !== null ? String(issued) : '');
  const [mags, setMags] = useState('');
  const [checksOk, setChecksOk] = useState(true);
  const [condition, setCondition] = useState<'clean' | 'requires_cleaning' | 'damaged'>('clean');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ status: string; short: number } | null>(null);

  const r = Number(rounds);
  const short = issued !== null && rounds !== '' && Number.isFinite(r) ? Math.max(issued - r, 0) : 0;
  const valid = rounds !== '' && Number.isInteger(r) && r >= 0 && (issued === null || r <= issued)
    && mags !== '' && Number.isInteger(Number(mags)) && Number(mags) >= 0 && notes.trim().length >= 5;

  const save = async () => {
    setBusy(true); setError(null);
    const res = await receiveFirearmAction({
      firearmId: firearm.id, roundsReturned: r, magazines: Number(mags), checksOk, condition, notes: notes.trim(),
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setDone(res); router.refresh();
  };

  if (done) {
    return (
      <Modal title={t('Received')} onClose={onClose}>
        <p className="text-sm">
          {t('{value} is back in the armoury and is now', { value: firearm.serial_number })}{' '}<b>{done.status === 'Available' ? 'available' : 'with the armourer (maintenance)'}</b>.
          {done.short > 0 ? ` ${done.short} rounds are unaccounted for; command has been alerted.` : ''}
        </p>
        <Button onClick={onClose}>{t('Done')}</Button>
      </Modal>
    );
  }

  return (
    <Modal title={`Receive back ${firearm.serial_number}`} onClose={onClose} busy={busy}>
      <p className="text-sm text-muted-foreground">
        {t('Booked out to')}{' '}<b className="text-fg">{firearm.holder?.name ?? 'an officer'}</b> {' '}{t('since {saTime}{value}. Use this when the officer cannot return it in the app.', { saTime: formatSaTime(firearm.holder?.since), value: issued !== null ? ` with ${issued} rounds` : '' })}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="rcv-rounds">{t('Rounds handed back')}</Label>
          <Input id="rcv-rounds" inputMode="numeric" value={rounds} onChange={(e) => setRounds(e.target.value.replace(/\D/g, ''))} className="mt-1.5" />
          {short > 0 ? <p className="mt-1 text-xs font-semibold text-severity-high-ink">{t('{short} short: say why in the notes. Command is alerted.', { short })}</p> : null}
          {issued !== null && r > issued ? <p className="mt-1 text-xs text-severity-critical-ink">{t('More than the {issued} issued.', { issued })}</p> : null}
        </div>
        <div>
          <Label htmlFor="rcv-mags">{t('Magazines')}</Label>
          <Input id="rcv-mags" inputMode="numeric" value={mags} onChange={(e) => setMags(e.target.value.replace(/\D/g, ''))} className="mt-1.5" />
        </div>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">{t('Condition')}</legend>
        <div className="flex flex-wrap gap-2">
          {([['clean', 'Clean'], ['requires_cleaning', 'Needs cleaning'], ['damaged', 'Damaged']] as const).map(([v, l]) => (
            <label key={v} className={cn('cursor-pointer rounded-md border px-3 py-1.5 text-sm', condition === v ? 'border-primary bg-primary/10 font-semibold' : 'border-border')}>
              <input type="radio" name="rcv-cond" className="sr-only" checked={condition === v} onChange={() => setCondition(v)} />{l}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" checked={checksOk} onChange={(e) => setChecksOk(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[rgb(var(--c-primary))]" />
        <span>{t('Unloaded, serial checked, action and safety work')}</span>
      </label>
      {condition === 'damaged' || !checksOk ? (
        <p className="text-xs text-severity-medium-ink">{t('It will go to maintenance, not back into service.')}</p>
      ) : null}
      <div>
        <Label htmlFor="rcv-notes">{t('Notes (who handed it in, and why here)')}</Label>
        <Input id="rcv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className="mt-1.5"
          placeholder={t('e.g. Handed in by Sgt Dlamini at the front desk; phone flat')} />
      </div>
      {error ? <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">{error}</p> : null}
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy || !valid}>{busy ? 'Saving…' : 'Receive it'}</Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t('Cancel')}</Button>
      </div>
    </Modal>
  );
}
