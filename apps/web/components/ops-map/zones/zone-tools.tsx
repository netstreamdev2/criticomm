'use client';

import { Check, Circle, Lock, MapPin, Pentagon, PencilRuler, Spline, Undo2, X } from 'lucide-react';
import type { LiveMapZone } from '@criticom/api';
import type { MapZoneShape, Silo } from '@criticom/db';
import { SHAPE_LABEL, describeShape, roleWords, zoneKind } from '@/lib/ops-map/zones';
import { cn, timeAgo } from '@/lib/utils';
import type { DrawSnapshot } from './draw-controller';
import { useT } from '@/components/i18n';

/** The drawing toolbar, the instructions while placing, and the list of zones in force. */

const SHAPE_ICON: Record<MapZoneShape, typeof Pentagon> = {
  polygon: Pentagon, circle: Circle, line: Spline, point: MapPin,
};

export function DrawToolbar({ active, onPick, disabled }: {
  active: MapZoneShape | null;
  onPick: (shape: MapZoneShape) => void;
  disabled?: string | null;
}) {
  const { t } = useT();
  return (
    <div className="ops-map-chrome ops-glass pointer-events-auto absolute right-3 top-16 z-[5] flex flex-col gap-1 rounded-xl p-1.5">
      <p className="flex items-center justify-center gap-1 px-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
        <PencilRuler className="h-3 w-3" /> {' '}{t('Draw')}</p>
      {(['polygon', 'circle', 'line', 'point'] as const).map((shape) => {
        const Icon = SHAPE_ICON[shape];
        return (
          <button
            key={shape}
            type="button"
            onClick={() => onPick(shape)}
            disabled={Boolean(disabled) || (active !== null && active !== shape)}
            aria-pressed={active === shape}
            title={disabled ?? `Draw ${SHAPE_LABEL[shape] === 'Area' ? 'an area' : `a ${SHAPE_LABEL[shape].toLowerCase()}`}`}
            className={cn(
              'flex w-16 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-40',
              active === shape ? 'bg-sky-400 text-slate-950' : 'text-slate-200 hover:bg-white/10',
            )}
          >
            <Icon className="h-4 w-4" />
            {SHAPE_LABEL[shape]}
          </button>
        );
      })}
    </div>
  );
}

const PLACING_HINT: Record<MapZoneShape, (s: DrawSnapshot) => string> = {
  polygon: (s) => (s.points.length < 3
    ? 'Click each corner of the area. Clicking a call’s pin puts a corner exactly on it.'
    : 'Keep clicking corners. Click the first point, double-click or press Enter to close the area.'),
  line: (s) => (s.points.length < 2
    ? 'Click along the road or route.'
    : 'Keep clicking along it. Double-click or press Enter to finish.'),
  circle: (s) => (s.points.length
    ? 'Move out and click to set the edge — you can type the exact radius next.'
    : 'Click the centre, or a call’s pin to centre on it exactly.'),
  point: () => 'Click where it goes, or on a call’s pin to place it exactly there.',
};

const MIN: Record<MapZoneShape, number> = { polygon: 3, line: 2, circle: 1, point: 1 };

export function PlacingBar({ snapshot, onFinish, onUndo, onCancel }: {
  snapshot: DrawSnapshot;
  onFinish: () => void;
  onUndo: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  // Measure with the pointer included, so the figures move as you draw.
  const preview = snapshot.cursor && (snapshot.shape === 'polygon' || snapshot.shape === 'line') && snapshot.points.length
    ? { ...snapshot, points: [...snapshot.points, snapshot.cursor] }
    : snapshot;
  const canFinish = snapshot.points.length >= MIN[snapshot.shape] && snapshot.shape !== 'circle' && snapshot.shape !== 'point';
  const Icon = SHAPE_ICON[snapshot.shape];
  return (
    <div className="pointer-events-none absolute inset-x-0 top-16 z-[7] flex justify-center px-3">
      <div className="ops-glass pointer-events-auto flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-sky-300">
          <Icon className="h-4 w-4" /> {SHAPE_LABEL[snapshot.shape]}
        </span>
        <span className="min-w-0 flex-1 text-xs text-slate-200">{PLACING_HINT[snapshot.shape](snapshot)}</span>
        {snapshot.points.length > 0 && (
          <span className="w-full font-mono text-xs tabular-nums text-sky-200 sm:w-auto">{describeShape(preview)}</span>
        )}
        <span className="flex gap-1.5">
          <button type="button" onClick={onUndo} disabled={!snapshot.points.length} title={t('Backspace')} className="ops-btn bg-white/10 hover:bg-white/20 disabled:opacity-40">
            <Undo2 className="h-3.5 w-3.5" /> {' '}{t('Undo')}</button>
          {canFinish && (
            <button type="button" onClick={onFinish} title={t('Enter')} className="ops-btn bg-sky-500 text-slate-950 hover:bg-sky-400">
              <Check className="h-3.5 w-3.5" /> {' '}{t('Finish')}</button>
          )}
          <button type="button" onClick={onCancel} title={t('Esc')} className="ops-btn bg-white/10 hover:bg-white/20">
            <X className="h-3.5 w-3.5" /> {' '}{t('Cancel')}</button>
        </span>
      </div>
    </div>
  );
}

export function ZonesList({ zones, meId, deptName, unavailable, onPick, onClose }: {
  zones: readonly LiveMapZone[];
  meId: string;
  deptName: (silo: Silo) => string;
  unavailable: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const shared = zones.filter((z) => z.visibility !== 'private');
  const drafts = zones.filter((z) => z.visibility === 'private' && z.created_by === meId);
  const row = (z: LiveMapZone) => {
    const kind = zoneKind(z.kind);
    return (
      <li key={z.id}>
        <button type="button" onClick={() => onPick(z.id)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/10">
          <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: kind.colour }} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 truncate text-sm font-semibold">
              {z.visibility === 'private' && <Lock className="h-3 w-3 shrink-0 text-slate-400" />}
              {z.name}
            </span>
            <span className="block truncate text-[11px] text-slate-400">
              {kind.label}{z.incident ? ` · ${z.incident.incident_number}` : ''} · {z.created_by_name ?? 'Unknown'}
              {z.created_by_role ? ` (${roleWords(z.created_by_role)}, ${deptName(z.silo)})` : ''} · {timeAgo(z.created_at)}
            </span>
          </span>
        </button>
      </li>
    );
  };
  return (
    <div className="ops-map-chrome ops-glass absolute left-3 top-16 z-[6] max-h-[calc(100%-5.5rem)] w-80 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-xl p-3 text-slate-100 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-300">{t('Perimeters & zones')}</p>
        <button type="button" onClick={onClose} aria-label={t('Close')} className="text-slate-300 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      {unavailable && <p className="mb-2 text-xs text-amber-300">{unavailable}</p>}
      {!unavailable && shared.length === 0 && drafts.length === 0 && (
        <p className="text-xs text-slate-400">{t('No perimeters or zones are in force.')}</p>
      )}
      {shared.length > 0 && (
        <>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-sky-300">{t('In force ({length})', { length: shared.length })}</p>
          <ul className="mb-2 space-y-0.5">{shared.map(row)}</ul>
        </>
      )}
      {drafts.length > 0 && (
        <>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{t('My drafts — only me ({length})', { length: drafts.length })}</p>
          <ul className="space-y-0.5">{drafts.map(row)}</ul>
        </>
      )}
    </div>
  );
}
