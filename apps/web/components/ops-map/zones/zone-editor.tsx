'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Crosshair, X } from 'lucide-react';
import type { MapZoneKind, MapZoneVisibility, Silo } from '@criticom/db';
import {
  END_OPTIONS, MAX_ACTIVE_DAYS, SHAPE_LABEL, SHARE_SILOS, VISIBILITY, describeShape, formatCoord,
  kindsForShape, shapeProblem, zoneKind, zoneProblem, type EndOption, type LatLng, type ZoneDraft,
} from '@/lib/ops-map/zones';
import { cn } from '@/lib/utils';
import type { DrawSnapshot } from './draw-controller';
import { useT } from '@/components/i18n';

/**
 * The form beside a drawing: exact measurements and positions, then what the
 * zone is, why, and who receives it. Checks run as you type (zoneProblem);
 * the database checks again on save.
 */

export type EditorIncident = { id: string; number: string; type: string; address: string; lat: number; lng: number };

export type ZoneFormInit = {
  kind: MapZoneKind | null;
  name: string;
  reason: string;
  incidentId: string | null;
  visibility: MapZoneVisibility | null;
  sharedSilos: Silo[];
  activeUntil: string | null;
};

type SaveResult = { ok: true } | { ok: false; error: string };

const RADIUS_PRESETS = [50, 100, 200, 300, 500, 1000];

const pad = (n: number) => String(n).padStart(2, '0');
/** An instant as the value of a datetime-local input (the browser's local time). */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const field = 'w-full rounded-md border border-white/15 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none';
const caption = 'mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400';

/** A number typed exactly: committed on Enter or leaving the field, and kept in step with the map. */
function NumberField({ label, value, onCommit, decimals, min, max, suffix }: {
  label: string; value: number | null; onCommit: (n: number) => void; decimals: number; min: number; max: number; suffix?: string;
}) {
  const [text, setText] = useState(value == null ? '' : value.toFixed(decimals));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value == null ? '' : value.toFixed(decimals));
  }, [value, decimals]);
  const commit = () => {
    const n = Number(text.replace(',', '.'));
    if (Number.isFinite(n) && n >= min && n <= max) onCommit(n);
    else setText(value == null ? '' : value.toFixed(decimals));
  };
  return (
    <label className="block min-w-0 flex-1">
      <span className={caption}>{label}</span>
      <span className="flex items-center gap-1">
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => { focused.current = true; }}
          onBlur={() => { focused.current = false; commit(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          className={cn(field, 'font-mono tabular-nums')}
        />
        {suffix && <span className="text-xs text-slate-400">{suffix}</span>}
      </span>
    </label>
  );
}

export function ZoneEditor({
  mode, snapshot, init, incidents, mySilo, deptName, onKind, onPosition, onRadius, onSave, onCancel,
}: {
  mode: 'new' | 'edit';
  snapshot: DrawSnapshot;
  init: ZoneFormInit;
  incidents: EditorIncident[];
  mySilo: Silo;
  deptName: (silo: Silo) => string;
  onKind: (kind: MapZoneKind) => void;
  onPosition: (p: LatLng) => void;
  onRadius: (metres: number) => void;
  onSave: (draft: ZoneDraft) => Promise<SaveResult>;
  onCancel: () => void;
}) {
  const { t } = useT();
  const kinds = kindsForShape(snapshot.shape);
  const [kind, setKind] = useState<MapZoneKind>(
    init.kind && kinds.some((k) => k.key === init.kind) ? init.kind : kinds[0]!.key,
  );
  const [name, setName] = useState(init.name);
  const [reason, setReason] = useState(init.reason);
  const [incidentId, setIncidentId] = useState<string | null>(init.incidentId);
  const [visibility, setVisibility] = useState<MapZoneVisibility>(
    init.visibility ?? (init.incidentId ? 'incident' : 'department'),
  );
  const [shared, setShared] = useState<Silo[]>(init.sharedSilos);
  const [end, setEnd] = useState<EndOption>(init.activeUntil ? 'custom' : 'none');
  const [customEnd, setCustomEnd] = useState(init.activeUntil ? toLocalInput(init.activeUntil) : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { onKind(kind); }, [kind, onKind]);

  const incident = incidents.find((i) => i.id === incidentId) ?? null;
  const kindDef = zoneKind(kind);
  const suggestedName = `${kindDef.label}${incident ? ` — ${incident.number}` : ''}`;
  const shapeIssue = shapeProblem(snapshot);
  const position = snapshot.points[0] ?? null;
  const placed = snapshot.shape === 'circle' || snapshot.shape === 'point';

  // Worked out on every render, so "1 hour" counts from the moment of saving.
  const hours = END_OPTIONS.find((o) => o.key === end)?.hours;
  const activeUntil = end === 'custom'
    ? (customEnd ? new Date(customEnd).toISOString() : null)
    : hours ? new Date(Date.now() + hours * 3_600_000).toISOString() : null;

  const draft: ZoneDraft = {
    shape: snapshot.shape,
    points: snapshot.points,
    radiusM: snapshot.radiusM,
    kind,
    name: name.trim() || suggestedName,
    reason,
    incidentId,
    visibility,
    sharedSilos: visibility === 'departments' ? shared : [],
    activeUntil,
  };
  const problem = zoneProblem(draft);

  const linkIncident = (id: string | null) => {
    setIncidentId(id);
    if (id && visibility === 'department' && mode === 'new') setVisibility('incident');
    if (!id && visibility === 'incident') setVisibility('department');
  };

  const save = async () => {
    setError(null);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    const result = await onSave(draft);
    setSaving(false);
    if (!result.ok) setError(result.error);
  };

  const copyPosition = () => {
    if (!position) return;
    void navigator.clipboard?.writeText(formatCoord(position)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const otherSilos = SHARE_SILOS.filter((s) => s !== mySilo && s !== 'Ethekwini');

  return (
    <div className="ops-map-chrome ops-glass absolute left-3 top-16 z-[7] max-h-[calc(100%-5.5rem)] w-[22rem] max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-xl p-3 text-slate-100 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-300">
          {mode === 'new' ? `New ${SHAPE_LABEL[snapshot.shape].toLowerCase()}` : 'Change zone'}
        </p>
        <button type="button" onClick={onCancel} aria-label={t('Cancel drawing')} className="text-slate-300 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Measurements and exact position. */}
      <section className="rounded-lg border border-white/10 bg-white/5 p-2.5">
        <p className="font-mono text-xs tabular-nums text-sky-200">{describeShape(snapshot)}</p>
        {shapeIssue && <p className="mt-1 text-xs text-amber-300">{shapeIssue}</p>}
        {!placed && (
          <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
            {t('Drag a point to move it · drag a small dot to add one · right-click or double-click a point to remove it.')}</p>
        )}

        {snapshot.shape === 'circle' && (
          <div className="mt-2.5 space-y-2">
            <NumberField label={t('Radius')} value={snapshot.radiusM} onCommit={onRadius} decimals={0} min={1} max={50_000} suffix="m" />
            <div className="flex flex-wrap gap-1">
              {RADIUS_PRESETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onRadius(m)}
                  className={cn(
                    'rounded px-2 py-0.5 text-[11px] font-semibold',
                    snapshot.radiusM === m ? 'bg-sky-400 text-slate-950' : 'bg-white/10 text-slate-200 hover:bg-white/20',
                  )}
                >
                  {m >= 1000 ? `${m / 1000} km` : `${m} m`}
                </button>
              ))}
            </div>
          </div>
        )}

        {placed && position && (
          <div className="mt-2.5 space-y-2">
            <div className="flex gap-2">
              <NumberField label={t('Latitude')} value={position.lat} decimals={6} min={-90} max={90}
                onCommit={(lat) => onPosition({ lat, lng: position.lng })} />
              <NumberField label={t('Longitude')} value={position.lng} decimals={6} min={-180} max={180}
                onCommit={(lng) => onPosition({ lat: position.lat, lng })} />
            </div>
            <div className="flex items-center gap-2">
              <label className="min-w-0 flex-1">
                <span className="sr-only">{snapshot.shape === 'circle' ? 'Centre on a call' : 'Place on a call'}</span>
                <select
                  value=""
                  onChange={(e) => {
                    const inc = incidents.find((i) => i.id === e.target.value);
                    if (!inc) return;
                    onPosition({ lat: inc.lat, lng: inc.lng });
                    if (!incidentId) linkIncident(inc.id);
                  }}
                  className={cn(field, 'py-1 text-xs')}
                >
                  <option value="">{snapshot.shape === 'circle' ? 'Centre exactly on a call…' : 'Place exactly on a call…'}</option>
                  {incidents.map((i) => <option key={i.id} value={i.id}>{i.number} · {i.type}</option>)}
                </select>
              </label>
              <button type="button" onClick={copyPosition} title={t('Copy coordinates')} className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold hover:bg-white/20">
                <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </section>

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className={caption}>{t('Type')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as MapZoneKind)} className={field}>
            {kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: kindDef.colour }} /> {kindDef.hint}
          </span>
        </label>

        <label className="block">
          <span className={caption}>{t('Name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={suggestedName} className={field} />
        </label>

        <label className="block">
          <span className={caption}>{t('Why {value}', { value: visibility === 'private' ? '(optional for a draft)' : '' })}</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder={t('e.g. Suspect package at the entrance — keep the public 100 m back until the bomb squad clears it.')}
            className={cn(field, 'resize-y')}
          />
        </label>

        <label className="block">
          <span className={caption}>{t('Linked call')}</span>
          <select value={incidentId ?? ''} onChange={(e) => linkIncident(e.target.value || null)} className={field}>
            <option value="">{t('No call')}</option>
            {incidents.map((i) => (
              <option key={i.id} value={i.id}>{i.number} · {i.type} · {i.address}</option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend className={caption}>{t('Who sees it')}</legend>
          <div className="space-y-1">
            {VISIBILITY.map((v) => (
              <label key={v.key} className={cn('flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5', visibility === v.key ? 'bg-white/10' : 'hover:bg-white/5')}>
                <input
                  type="radio"
                  name="zone-visibility"
                  checked={visibility === v.key}
                  onChange={() => setVisibility(v.key)}
                  disabled={v.key === 'incident' && !incidentId}
                  className="mt-0.5 accent-sky-400"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">
                    {v.key === 'department' ? `${v.label} (${deptName(mySilo)})` : v.label}
                  </span>
                  <span className="block text-[11px] text-slate-400">
                    {v.key === 'incident' && !incidentId ? 'Link a call first.' : v.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {visibility === 'departments' && (
            <div className="mt-1.5 grid grid-cols-2 gap-1 pl-6">
              {otherSilos.map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={shared.includes(s)}
                    onChange={() => setShared((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))}
                    className="accent-sky-400"
                  />
                  {deptName(s)}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div>
          <label className="block">
            <span className={caption}>{t('Stands until')}</span>
            <select value={end} onChange={(e) => setEnd(e.target.value as EndOption)} className={field}>
              {END_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
          {end === 'custom' && (
            <label className="mt-1.5 block">
              <span className="sr-only">{t('End time')}</span>
              <input
                type="datetime-local"
                value={customEnd}
                min={toLocalInput(new Date().toISOString())}
                max={toLocalInput(new Date(Date.now() + MAX_ACTIVE_DAYS * 86_400_000).toISOString())}
                onChange={(e) => setCustomEnd(e.target.value)}
                className={field}
              />
            </label>
          )}
        </div>

        {error && <p className="rounded-md border border-red-400/40 bg-red-500/15 px-2 py-1.5 text-xs text-red-200">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-sm font-bold text-slate-950 hover:bg-sky-400 disabled:opacity-60"
          >
            <Crosshair className="h-4 w-4" />
            {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : visibility === 'private' ? 'Save as my draft' : 'Save and share'}
          </button>
          <button type="button" onClick={onCancel} className="rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/10">
            {t('Cancel')}</button>
        </div>
        {!error && problem && <p className="text-[11px] text-slate-400">{problem}</p>}
      </div>
    </div>
  );
}
