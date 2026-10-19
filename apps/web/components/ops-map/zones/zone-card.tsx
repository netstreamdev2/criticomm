'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, Lock, Pencil, ShieldOff, X } from 'lucide-react';
import { listMapZoneEvents, type LiveMapZone, type MapZoneEvent } from '@criticom/api';
import { canManageMapZone, type Silo, type UserRole } from '@criticom/db';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import {
  describeAudience, describeShape, formatCoord, fromGeometry, roleWords, shapeCentre, zoneKind,
} from '@/lib/ops-map/zones';
import { cn, formatSaTime, timeAgo } from '@/lib/utils';
import { endZoneAction } from '@/app/(app)/incidents/map/actions';
import { useT } from '@/components/i18n';

/**
 * Everything about one zone: what it is, who set it and why, who receives
 * it, its exact measurements, and every change since. Its author, the
 * control room or the department's commander can change or stand it down.
 */

const ACTION_WORDS: Record<MapZoneEvent['action'], string> = { created: 'Set', edited: 'Changed', ended: 'Stood down' };

export function ZoneCard({
  zone, me, deptName, onClose, onEdit, onEnded,
}: {
  zone: LiveMapZone;
  me: { id: string; role: UserRole; silo: Silo };
  deptName: (silo: Silo) => string;
  onClose: () => void;
  onEdit: () => void;
  /** Stood down: the map closes the card and drops the zone straight away. */
  onEnded: () => void;
}) {
  const { t } = useT();
  const kind = zoneKind(zone.kind);
  const points = fromGeometry(zone.shape, zone.geometry);
  const centre = shapeCentre({ shape: zone.shape, points, radiusM: zone.radius_m });
  const canManage = canManageMapZone(zone, me);
  const mine = zone.created_by === me.id;

  const [events, setEvents] = useState<MapZoneEvent[] | null>(null);
  const [ending, setEnding] = useState(false);
  const [endReason, setEndReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setEvents(null);
    try {
      listMapZoneEvents(getBrowserSupabase(), zone.id)
        .then((rows) => { if (alive) setEvents(rows); })
        .catch(() => { if (alive) setEvents([]); });
    } catch {
      setEvents([]);
    }
    return () => { alive = false; };
  }, [zone.id, zone.updated_at]);

  const standDown = async () => {
    setError(null);
    setBusy(true);
    const result = await endZoneAction(zone.id, endReason);
    setBusy(false);
    if (result.ok) onEnded();
    else setError(result.error);
  };

  const copy = () => {
    if (!centre) return;
    void navigator.clipboard?.writeText(formatCoord(centre)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const setBy = [zone.created_by_name ?? 'Unknown', roleWords(zone.created_by_role), deptName(zone.silo)]
    .filter(Boolean).join(' · ');

  return (
    <div className="ops-map-chrome ops-glass absolute left-3 top-16 z-[7] max-h-[calc(100%-5.5rem)] w-[22rem] max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-xl p-3 text-slate-100 shadow-2xl">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: kind.colour }}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: kind.colour }} /> {kind.label}
            {zone.visibility === 'private' && (
              <span className="ml-1 inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300">
                <Lock className="h-3 w-3" /> {' '}{t('Only you')}</span>
            )}
          </p>
          <h3 className="mt-1 text-lg font-bold leading-tight">{zone.name}</h3>
        </div>
        <button type="button" onClick={onClose} aria-label={t('Close')} className="text-slate-300 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <dl className="mt-3 space-y-2.5 text-sm">
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t('Set by')}</dt>
          <dd>{setBy}</dd>
          <dd className="text-xs text-slate-400">{formatSaTime(zone.created_at)} · {timeAgo(zone.created_at)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t('Why')}</dt>
          <dd className="whitespace-pre-wrap">{zone.reason || <span className="text-slate-400">{t('No reason given (a private draft).')}</span>}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t('Who sees it')}</dt>
          <dd>{describeAudience(zone, deptName, zone.incident?.incident_number)}</dd>
        </div>
        {zone.incident && (
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t('Linked call')}</dt>
            <dd>
              <Link href={`/incidents/${zone.incident.id}`} className="text-sky-300 hover:underline">
                {zone.incident.incident_number}
              </Link>{' '}
              · {zone.incident.incident_type} · {zone.incident.status}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t('Stands until')}</dt>
          <dd>{zone.active_until ? `${formatSaTime(zone.active_until)}` : 'Stood down by hand'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t('Measurements')}</dt>
          <dd className="font-mono text-xs tabular-nums">
            {describeShape(
              { shape: zone.shape, points, radiusM: zone.radius_m },
              zone.area_m2 != null || zone.length_m != null ? { areaM2: zone.area_m2, lengthM: zone.length_m } : undefined,
            )}
          </dd>
          {centre && (
            <dd className="mt-0.5 flex items-center gap-2 font-mono text-xs tabular-nums text-slate-300">
              {zone.shape === 'circle' || zone.shape === 'point' ? 'Centre' : 'Middle'} {formatCoord(centre)}
              <button type="button" onClick={copy} title={t('Copy coordinates')} className="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 font-sans text-[10px] font-semibold hover:bg-white/20">
                <Copy className="h-3 w-3" /> {copied ? 'Copied' : 'Copy'}
              </button>
            </dd>
          )}
        </div>
      </dl>

      <div className="mt-3 border-t border-white/10 pt-2.5">
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">{t('History')}</p>
        {events === null ? (
          <p className="text-xs text-slate-400">{t('Loading…')}</p>
        ) : events.length === 0 ? (
          <p className="text-xs text-slate-400">{t('No history recorded.')}</p>
        ) : (
          <ol className="space-y-1.5">
            {events.map((ev) => (
              <li key={ev.id} className="text-xs">
                <span className="font-semibold">{ACTION_WORDS[ev.action]}</span>{' '}{t('by {value}{value2}', { value: ev.actor_name ?? 'unknown', value2: ev.actor_role ? ` (${roleWords(ev.actor_role)})` : '' })}
                <span className="text-slate-400"> · {formatSaTime(ev.at)}</span>
                {ev.details && <span className="block text-slate-300">{ev.details}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>

      {canManage && (
        <div className="mt-3 border-t border-white/10 pt-3">
          {!ending ? (
            <div className="flex gap-2">
              <button type="button" onClick={onEdit} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/20">
                <Pencil className="h-4 w-4" /> {mine && zone.visibility === 'private' ? 'Edit or share' : 'Change'}
              </button>
              <button type="button" onClick={() => setEnding(true)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-1.5 text-sm font-semibold text-red-200 hover:bg-red-500/30">
                <ShieldOff className="h-4 w-4" /> {' '}{t('Stand down')}</button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {t('Why is it being stood down?')}</span>
                <textarea
                  value={endReason}
                  onChange={(e) => setEndReason(e.target.value)}
                  rows={2}
                  maxLength={1000}
                  placeholder={t('e.g. Scene cleared by the bomb squad at 14:20.')}
                  className="w-full rounded-md border border-white/15 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
                />
              </label>
              {error && <p className="text-xs text-red-300">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={standDown}
                  disabled={busy}
                  className={cn('flex-1 rounded-lg bg-red-500 px-3 py-1.5 text-sm font-bold text-white hover:bg-red-400', busy && 'opacity-60')}
                >
                  {busy ? 'Standing down…' : 'Confirm stand down'}
                </button>
                <button type="button" onClick={() => { setEnding(false); setError(null); }} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/10">
                  {t('Keep it')}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
