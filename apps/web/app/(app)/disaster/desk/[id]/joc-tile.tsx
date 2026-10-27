'use client';

import { useRef, useState, useTransition } from 'react';
import { ClipboardCheck, Landmark, Plus, X } from 'lucide-react';
import {
  JOC_ACTIVATION, JOC_DUTIES, JOC_EXTERNAL_AGENCIES, JOC_INTERNAL_UNITS, JOC_MEMBER_KINDS, SILVER_CHECKS, type Check,
} from '@criticom/db/disaster-joc';
import { levelRank, type CoordinationLevel } from '@criticom/db/disaster-plan';
import { CallButton } from '@/components/disaster/call-button';
import { Fold } from '@/components/disaster/fold';
import { useT } from '@/components/i18n';
import { formatSaTime } from '@/lib/utils';
import { incidentCheckAction, jocMemberAction, jocSessionAction, removeJocMemberAction } from '../joc-actions';

export type BoardJocMember = { id: string; kind: string; name: string; representative: string | null; phone: string | null };
export type BoardJocSession = { id: string; at: string; attended: string | null; notes: string | null; by: string | null };
export type BoardCouncillor = { ward: number | null; name: string; phone: string | null };

/** "YYYY-MM-DDTHH:MM" now, South African time, for a datetime field. */
function localNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

/** One checklist: each line ticked says who and when. */
export function Checklist({ incidentId, items, checks, live, onError }: {
  incidentId: string; items: Check[]; checks: Record<string, { at: string; by: string }>; live: boolean; onError: (e: string) => void;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const tick = (key: string, done: boolean) => {
    setBusy(key);
    start(async () => {
      const res = await incidentCheckAction(incidentId, key, done);
      if ('error' in res) onError(res.error);
      setBusy(null);
    });
  };
  return (
    <ul className="divide-y divide-border">
      {items.map((c) => {
        const done = checks[c.key];
        return (
          <li key={c.key} className="px-5 py-2.5">
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input type="checkbox" checked={Boolean(done)} disabled={!live || busy === c.key} onChange={(e) => tick(c.key, e.target.checked)} className="h-6 w-6 shrink-0" />
              <span className="min-w-0">
                <span className="block font-medium">{t(c.label)}</span>
                {done ? <span className="block text-xs text-muted-foreground">{t('Done by {by}, {at}', { by: done.by, at: formatSaTime(done.at) })}</span> : null}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Silver's checklist (step 6), and once Gold is reached the JOC: who was
 * called in and told (step 8), who sits on it (step 9), its sessions
 * (step 10) and its duties (step 11).
 */
export function JocTile({ incidentId, level, highestLevel, checks, members, sessions, councillors, live, onError }: {
  incidentId: string; level: CoordinationLevel; highestLevel: CoordinationLevel; checks: Record<string, { at: string; by: string }>;
  members: BoardJocMember[]; sessions: BoardJocSession[]; councillors: BoardCouncillor[]; live: boolean; onError: (e: string) => void;
}) {
  const { t } = useT();
  const count = (items: Check[]) => items.filter((c) => c.key in checks).length;
  if (levelRank(highestLevel) < 2) return null;
  return (
    <div className="space-y-6">
      <Fold id="board.silver" icon={ClipboardCheck} title={t('Silver checklist')} defaultOpen={level === 'Silver'}
        summary={t('{done} of {all} done', { done: count(SILVER_CHECKS), all: SILVER_CHECKS.length })}
        info={t('Once a joint EOC runs the incident: EMACC notified, the Duty Officer and Stand-by Officer told, resources assessed, heads of departments on standby, sitreps flowing.')}>
        <Checklist incidentId={incidentId} items={SILVER_CHECKS} checks={checks} live={live} onError={onError} />
      </Fold>
      {levelRank(highestLevel) >= 3 ? (
        <Fold id="board.joc" icon={Landmark} title={t('The JOC')} defaultOpen={level === 'Gold'}
          summary={t('{m} members · {s} sessions', { m: members.length, s: sessions.length })}
          info={t('The Joint Operations Centre at the DOC: the core team called in, the DCM on stand-by told, the units and agencies sitting on it, its daily sessions and its duties.')}>
          <div className="grid gap-6 p-5 xl:grid-cols-2">
            <section>
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t('Called in and told')}</h3>
              <div className="rounded-lg border border-border"><Checklist incidentId={incidentId} items={JOC_ACTIVATION} checks={checks} live={live} onError={onError} /></div>
              <h3 className="mb-1 mt-5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t('The JOC’s duties')}</h3>
              <div className="rounded-lg border border-border"><Checklist incidentId={incidentId} items={JOC_DUTIES} checks={checks} live={live} onError={onError} /></div>
            </section>
            <section className="space-y-5">
              <Members incidentId={incidentId} members={members} councillors={councillors} live={live} onError={onError} />
              <Sessions incidentId={incidentId} sessions={sessions} live={live} onError={onError} />
            </section>
          </div>
        </Fold>
      ) : null}
    </div>
  );
}

function Members({ incidentId, members, councillors, live, onError }: {
  incidentId: string; members: BoardJocMember[]; councillors: BoardCouncillor[]; live: boolean; onError: (e: string) => void;
}) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState({ kind: 'Internal unit', name: '', representative: '', phone: '' });
  const options: readonly string[] = v.kind === 'Internal unit' ? JOC_INTERNAL_UNITS : v.kind === 'External agency' ? JOC_EXTERNAL_AGENCIES
    : councillors.map((c) => (c.ward != null ? `Ward ${c.ward}: ${c.name}` : c.name));
  const pickCouncillor = (label: string) => {
    const c = councillors.find((x) => (x.ward != null ? `Ward ${x.ward}: ${x.name}` : x.name) === label);
    setV({ ...v, name: label, representative: c?.name ?? v.representative, phone: c?.phone ?? v.phone });
  };
  const add = () => start(async () => {
    const res = await jocMemberAction(incidentId, v);
    if ('error' in res) { onError(res.error); return; }
    setV({ kind: v.kind, name: '', representative: '', phone: '' });
    setAdding(false);
  });
  const remove = (id: string) => start(async () => {
    const res = await removeJocMemberAction(incidentId, id);
    if ('error' in res) onError(res.error);
  });
  const field = 'mt-1 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t('On the JOC ({n})', { n: members.length })}</h3>
        {live && !adding ? (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">
            <Plus className="h-4 w-4" aria-hidden />{t('Add')}
          </button>
        ) : null}
      </div>
      {members.length === 0 ? <p className="text-sm text-muted-foreground">{t('Nobody added yet. Add the units, agencies and ward councillors the JOC needs.')}</p> : null}
      <ul className="space-y-2">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{m.name}</p>
              <p className="truncate text-xs text-muted-foreground">{t(m.kind)}{m.representative ? ` · ${m.representative}` : ''}</p>
            </div>
            {m.phone ? <CallButton number={m.phone} /> : null}
            {live ? (
              <button type="button" onClick={() => remove(m.id)} disabled={pending} aria-label={t('Take {name} off the JOC', { name: m.name })}
                className="grid h-10 w-10 place-items-center rounded-md border border-border hover:bg-muted"><X className="h-4 w-4" aria-hidden /></button>
            ) : null}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="mt-3 space-y-3 rounded-lg border border-accent/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">{t('Who')}
              <select value={v.kind} onChange={(e) => setV({ kind: e.target.value, name: '', representative: '', phone: '' })} className={field}>
                {JOC_MEMBER_KINDS.map((k) => <option key={k} value={k}>{t(k)}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">{v.kind === 'Ward councillor' ? t('Councillor') : t('Which one')}
              <input list={`joc-${v.kind}`} value={v.name} maxLength={160}
                onChange={(e) => (v.kind === 'Ward councillor' ? pickCouncillor(e.target.value) : setV({ ...v, name: e.target.value }))} className={field} />
              <datalist id={`joc-${v.kind}`}>{options.map((o) => <option key={o} value={o} />)}</datalist>
            </label>
            <label className="block text-sm font-medium">{t('Representative')}
              <input value={v.representative} onChange={(e) => setV({ ...v, representative: e.target.value })} maxLength={160} className={field} />
            </label>
            <label className="block text-sm font-medium">{t('Their number')}
              <input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} maxLength={30} inputMode="tel" className={field} />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={add} disabled={pending || v.name.trim().length < 2} className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{t('Add to the JOC')}</button>
            <button type="button" onClick={() => setAdding(false)} className="h-11 rounded-md border border-border px-4 text-sm hover:bg-muted">{t('Cancel')}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Sessions({ incidentId, sessions, live, onError }: { incidentId: string; sessions: BoardJocSession[]; live: boolean; onError: (e: string) => void }) {
  const { t } = useT();
  const ref = useRef(crypto.randomUUID());
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ held_at: localNow(), attended: '', notes: '' });
  const save = () => start(async () => {
    const res = await jocSessionAction(incidentId, ref.current, v);
    if ('error' in res) { onError(res.error); return; }
    ref.current = crypto.randomUUID();
    setV({ held_at: localNow(), attended: '', notes: '' });
    setOpen(false);
  });
  const field = 'mt-1 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t('JOC sessions ({n})', { n: sessions.length })}</h3>
        {live && !open ? (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">
            <Plus className="h-4 w-4" aria-hidden />{t('Record a session')}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="mb-3 space-y-3 rounded-lg border border-accent/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">{t('When it met')}
              <input type="datetime-local" value={v.held_at} onChange={(e) => setV({ ...v, held_at: e.target.value })} className={field} />
            </label>
            <label className="block text-sm font-medium">{t('Who was there')}
              <input value={v.attended} onChange={(e) => setV({ ...v, attended: e.target.value })} maxLength={1000} className={field} />
            </label>
          </div>
          <label className="block text-sm font-medium">{t('The damage, each department’s progress, and what was decided')}
            <textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} rows={4} maxLength={4000}
              className="mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-sm" />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={pending || !v.notes.trim()} className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{t('Save the session')}</button>
            <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-md border border-border px-4 text-sm hover:bg-muted">{t('Cancel')}</button>
          </div>
        </div>
      ) : null}
      {sessions.length === 0 && !open ? <p className="text-sm text-muted-foreground">{t('No session recorded yet. The JOC meets daily, or as needed.')}</p> : null}
      <ul className="space-y-2">
        {sessions.map((s) => (
          <li key={s.id} className="rounded-lg border border-border px-3 py-2 text-sm">
            <p className="text-xs text-muted-foreground">{formatSaTime(s.at)} · {s.by}</p>
            {s.attended ? <p className="mt-0.5"><span className="text-muted-foreground">{t('Attended:')}</span> {s.attended}</p> : null}
            <p className="mt-0.5 whitespace-pre-line">{s.notes}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
