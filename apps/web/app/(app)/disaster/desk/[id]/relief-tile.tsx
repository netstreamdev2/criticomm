'use client';

import { useState, useTransition } from 'react';
import { HandHeart, Pencil, Plus, Trash2 } from 'lucide-react';
import { MUNICIPALITIES } from '@criticom/db/disaster-plan';
import { RELIEF_STEPS, RELIEF_STOCK_ITEMS, WARD_PEOPLE, wardCountsProblem, type WardCounts } from '@criticom/db/disaster-relief';
import { CallButton } from '@/components/disaster/call-button';
import { FieldProblem, problemBorder } from '@/components/disaster/field-problem';
import { Fold } from '@/components/disaster/fold';
import { Modal } from '@/components/ui/modal';
import { useT } from '@/components/i18n';
import { checkPhone, checkWard } from '@/lib/disaster-checks';
import { cn } from '@/lib/utils';
import { removeWardReliefAction, wardReliefAction } from '../joc-actions';
import { Checklist, type BoardCouncillor } from './joc-tile';

export type BoardWardRelief = WardCounts & {
  id: string; municipality: string; ward: number; councillor: string | null; councillorPhone: string | null; notes: string | null;
};

/**
 * Needs assessment and relief (revision 2, section 7): the eight steps, then
 * who was helped and what was issued in each ward, through its councillor.
 * Counts only, no names.
 */
export function ReliefTile({ incidentId, checks, wards, councillors, live, onError }: {
  incidentId: string; checks: Record<string, { at: string; by: string }>; wards: BoardWardRelief[]; councillors: BoardCouncillor[];
  live: boolean; onError: (e: string) => void;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState<BoardWardRelief | 'new' | null>(null);
  const [pending, start] = useTransition();
  const sum = (k: keyof WardCounts) => wards.reduce((n, w) => n + (w[k] ?? 0), 0);
  const done = RELIEF_STEPS.filter((s) => s.key in checks).length;
  const remove = (w: BoardWardRelief) => {
    if (!window.confirm(t('Take ward {ward} off the relief list?', { ward: w.ward }))) return;
    start(async () => {
      const res = await removeWardReliefAction(incidentId, w.id);
      if ('error' in res) onError(res.error);
    });
  };
  return (
    <Fold id="board.relief" icon={HandHeart} title={t('Needs assessment and relief')} defaultOpen={false}
      summary={t('{done} of {all} steps · {p} people helped in {w} wards', { done, all: RELIEF_STEPS.length, p: sum('people'), w: wards.length })}
      info={t('The Disaster Management Centre assesses damage and needs; relief follows the findings and is coordinated through the ward councillors.')}>
      <Checklist incidentId={incidentId} items={RELIEF_STEPS} checks={checks} live={live} onError={onError} />
      <div className="space-y-3 border-t border-border p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{t('Beneficiaries and relief by ward')}</h3>
          {live ? (
            <button type="button" onClick={() => setEditing('new')} data-guide="board.ward-relief"
              className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
              <Plus className="h-4 w-4" aria-hidden />{t('Add ward beneficiaries')}
            </button>
          ) : null}
        </div>
        {wards.length === 0 ? <p className="text-sm text-muted-foreground">{t('No beneficiaries recorded yet.')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">{t('Ward')}</th><th className="py-2 pr-3">{t('Councillor')}</th>
                  {WARD_PEOPLE.map((x) => <th key={x.key} className="py-2 pr-3 text-right">{t(x.label)}</th>)}
                  {RELIEF_STOCK_ITEMS.map((x) => <th key={x.key} className="py-2 pr-3 text-right">{t(x.label)}</th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {wards.map((w) => (
                  <tr key={w.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 font-semibold">{w.ward}{w.municipality !== 'eThekwini Metro' ? <span className="block text-xs font-normal text-muted-foreground">{w.municipality}</span> : null}</td>
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">{w.councillor ?? '—'}{w.councillorPhone ? <CallButton number={w.councillorPhone} size="sm" /> : null}</span>
                    </td>
                    {WARD_PEOPLE.map((x) => <td key={x.key} className="py-2 pr-3 text-right tabular-nums">{w[x.key]}</td>)}
                    {RELIEF_STOCK_ITEMS.map((x) => <td key={x.key} className="py-2 pr-3 text-right tabular-nums">{w[x.key]}</td>)}
                    <td className="py-2 text-right">
                      {live ? (
                        <span className="inline-flex gap-1">
                          <button type="button" onClick={() => setEditing(w)} aria-label={t('Change ward {ward}', { ward: w.ward })}
                            className="grid h-10 w-10 place-items-center rounded-md border border-border hover:bg-muted"><Pencil className="h-4 w-4" aria-hidden /></button>
                          <button type="button" onClick={() => remove(w)} disabled={pending} aria-label={t('Take ward {ward} off', { ward: w.ward })}
                            className="grid h-10 w-10 place-items-center rounded-md border border-border hover:bg-muted"><Trash2 className="h-4 w-4" aria-hidden /></button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2 pr-3" colSpan={2}>{t('All wards')}</td>
                  {WARD_PEOPLE.map((x) => <td key={x.key} className="py-2 pr-3 text-right tabular-nums">{sum(x.key)}</td>)}
                  {RELIEF_STOCK_ITEMS.map((x) => <td key={x.key} className="py-2 pr-3 text-right tabular-nums">{sum(x.key)}</td>)}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing ? (
        <WardForm incidentId={incidentId} ward={editing === 'new' ? null : editing} councillors={councillors} onClose={() => setEditing(null)} />
      ) : null}
    </Fold>
  );
}

function WardForm({ incidentId, ward, councillors, onClose }: {
  incidentId: string; ward: BoardWardRelief | null; councillors: BoardCouncillor[]; onClose: () => void;
}) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const keys = [...WARD_PEOPLE, ...RELIEF_STOCK_ITEMS].map((x) => x.key);
  const [v, setV] = useState<Record<string, string>>(() => ({
    municipality: ward?.municipality ?? 'eThekwini Metro', ward: ward ? String(ward.ward) : '', councillor: ward?.councillor ?? '',
    councillor_phone: ward?.councillorPhone ?? '', notes: ward?.notes ?? '',
    ...Object.fromEntries(keys.map((k) => [k, ward ? String(ward[k as keyof WardCounts] ?? 0) : ''])),
  }));
  // The ward's councillor from the list, when the desk has not typed one.
  const setWard = (w: string) => {
    const n = Number(w.replace(/\D/g, ''));
    const c = v.municipality === 'eThekwini Metro' ? councillors.find((x) => x.ward === n) : undefined;
    setV((cur) => ({ ...cur, ward: w, councillor: cur.councillor || c?.name || '', councillor_phone: cur.councillor_phone || c?.phone || '' }));
  };
  const counts = Object.fromEntries(keys.map((k) => [k, Number(v[k] || 0)])) as WardCounts;
  const problem = wardCountsProblem(counts);
  const wardText = v.ward ?? '';
  const bad = { ward: checkWard(wardText, v.municipality) ?? (wardText.trim() ? null : { text: 'Give the ward number, like 76.' }), phone: checkPhone(v.councillor_phone) };
  const save = () => start(async () => {
    setError(null);
    const res = await wardReliefAction(incidentId, v);
    if ('error' in res) { setError(res.error); return; }
    onClose();
  });
  const field = 'mt-1 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-[15px]';
  const num = (k: string, label: string) => (
    <label key={k} className="block text-sm font-medium">{t(label)}
      <input value={v[k]} inputMode="numeric" onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/\D/g, '').slice(0, 6) })} className={field} />
    </label>
  );
  return (
    <Modal title={ward ? t('Ward {ward}', { ward: ward.ward }) : t('Add ward beneficiaries')} onClose={onClose} busy={pending} wide
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="h-11 rounded-md border border-border px-5 text-sm font-semibold hover:bg-muted">{t('Cancel')}</button>
          <button type="button" onClick={save} disabled={pending || Boolean(bad.ward || bad.phone || problem)}
            className="h-11 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? t('Saving…') : t('Save')}</button>
        </div>
      )}>
      <div className="space-y-4">
        {error ? <p role="alert" className="rounded-md border border-severity-critical px-3 py-2 text-sm font-medium text-severity-critical-ink">{error}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">{t('Municipality')}
            <select value={v.municipality} disabled={Boolean(ward)} onChange={(e) => setV({ ...v, municipality: e.target.value })} className={field}>
              {MUNICIPALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">{t('Ward')}
            <input value={v.ward} disabled={Boolean(ward)} inputMode="numeric" onChange={(e) => setWard(e.target.value)} className={cn(field, problemBorder(bad.ward))} />
            <FieldProblem problem={v.ward ? bad.ward : null} />
          </label>
          <label className="block text-sm font-medium">{t('Ward councillor')}
            <input value={v.councillor} maxLength={160} onChange={(e) => setV({ ...v, councillor: e.target.value })} className={field} />
          </label>
          <label className="block text-sm font-medium">{t('Councillor’s cellphone')}
            <input value={v.councillor_phone} maxLength={30} inputMode="tel" onChange={(e) => setV({ ...v, councillor_phone: e.target.value })} className={cn(field, problemBorder(bad.phone))} />
            <FieldProblem problem={bad.phone} />
          </label>
        </div>
        <fieldset>
          <legend className="text-sm font-semibold">{t('Who was helped')}</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">{WARD_PEOPLE.map((x) => num(x.key, x.label))}</div>
          {problem ? <p role="alert" className="mt-2 text-sm font-medium text-severity-critical-ink">{t(problem)}</p> : null}
        </fieldset>
        <fieldset>
          <legend className="text-sm font-semibold">{t('What was issued')}</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-4">{RELIEF_STOCK_ITEMS.map((x) => num(x.key, x.label))}</div>
        </fieldset>
        <label className="block text-sm font-medium">{t('Notes')}
          <textarea value={v.notes} maxLength={1000} rows={2} onChange={(e) => setV({ ...v, notes: e.target.value })}
            className="mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-[15px]" />
        </label>
      </div>
    </Modal>
  );
}
