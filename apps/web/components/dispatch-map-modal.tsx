'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Loader2, MapPin, Navigation, Radio, X } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { assignIncident, type OnDutyOfficer } from '@criticom/api';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useOnDutyOfficers } from '@/lib/on-duty';
import { useToast } from '@/components/toast';
import { cn, escapeHtml } from '@/lib/utils';

export type MapIncident = {
  id: string;
  number: string;
  type: string;
  severity: string;
  address: string;
  lat: number;
  lng: number;
};

type Route = { minutes: number; km: number; path: Array<[number, number]> | null; routed: boolean; at: string };

/** How many of the nearest officers get a road route drawn. */
const ROUTED = 6;

function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** A position rounded to about 100 m: an officer moving less than that keeps their route. */
const spot = (o: OnDutyOfficer) => `${o.lat?.toFixed(3)},${o.lng?.toFixed(3)}`;

const SEVERITY_COLOUR: Record<string, string> = { Critical: '#ef4444', High: '#f97316', Medium: '#f59e0b', Low: '#22c55e' };

/**
 * The live dispatch map: the incident, every officer on duty where they are
 * now, the road route from the nearest to the scene and how many minutes they
 * are away. Officers move as their phones report in; routes are redrawn when
 * someone moves. The dispatcher can assign from here.
 */
export function DispatchMapModal({
  incident, initialOfficers, canAssign, onClose,
}: {
  incident: MapIncident;
  initialOfficers: OnDutyOfficer[];
  canAssign: boolean;
  onClose: () => void;
}) {
  const officers = useOnDutyOfficers(initialOfficers);
  const [showBusy, setShowBusy] = useState(false);
  const [routes, setRoutes] = useState<Record<string, Route>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  const router = useRouter();
  const toast = useToast();

  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const routedSpots = useRef<Record<string, string>>({});

  // Officers with a position, nearest first; busy ones only when asked for.
  const ranked = useMemo(() => officers
    .filter((o) => o.lat !== null && o.lng !== null)
    .filter((o) => showBusy || o.activeCalls === 0)
    .map((o) => ({ o, km: kmBetween(o.lat as number, o.lng as number, incident.lat, incident.lng) }))
    .sort((a, b) => {
      const ra = routes[a.o.userId];
      const rb = routes[b.o.userId];
      if (ra && rb) return ra.minutes - rb.minutes;
      return a.km - b.km;
    }), [officers, showBusy, routes, incident.lat, incident.lng]);
  const noPosition = officers.filter((o) => (o.lat === null || o.lng === null) && (showBusy || o.activeCalls === 0));

  useEffect(() => { setUpdatedAt(new Date()); }, [officers]);

  // Road routes for the nearest few, refetched only when one of them has moved.
  useEffect(() => {
    const nearest = [...ranked].sort((a, b) => a.km - b.km).slice(0, ROUTED);
    for (const { o, km } of nearest) {
      if (routedSpots.current[o.userId] === spot(o)) continue;
      routedSpots.current[o.userId] = spot(o);
      const q = new URLSearchParams({
        fromLat: String(o.lat), fromLng: String(o.lng), toLat: String(incident.lat), toLng: String(incident.lng), geometry: '1',
      });
      void fetch(`/api/route?${q}`)
        .then((r) => r.json() as Promise<{ routed: boolean; minutes?: number; km?: number; path?: Array<[number, number]> }>)
        .then((r) => {
          setRoutes((cur) => ({
            ...cur,
            [o.userId]: r.routed && r.minutes !== undefined
              ? { minutes: r.minutes, km: r.km ?? km, path: r.path ?? null, routed: true, at: new Date().toISOString() }
              // No road route: a straight-line estimate at urban speed, said as such.
              : { minutes: Math.max(1, Math.round(((km * 1.35) / 40) * 60)), km: Math.round(km * 10) / 10, path: null, routed: false, at: new Date().toISOString() },
          }));
        })
        .catch(() => {});
    }
  }, [ranked, incident.lat, incident.lng]);

  // The map itself, once.
  useEffect(() => {
    let disposed = false;
    void import('leaflet').then((L) => {
      if (disposed || !el.current) return;
      leafletRef.current = L;
      const map = L.map(el.current, { zoomControl: true }).setView([incident.lat, incident.lng], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 50);
    });
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [incident.lat, incident.lng]);

  // Markers and routes, redrawn as officers move.
  const fitted = useRef(false);
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();

    const sev = SEVERITY_COLOUR[incident.severity] ?? '#38bdf8';
    L.marker([incident.lat, incident.lng], {
      icon: L.divIcon({
        className: '',
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        html: `<span style="position:relative;display:block;width:34px;height:34px">
          <span class="animate-ping" style="position:absolute;inset:0;border-radius:9999px;background:${sev};opacity:.45"></span>
          <span style="position:absolute;inset:7px;border-radius:9999px;background:${sev};border:3px solid #fff;box-shadow:0 0 0 2px ${sev}"></span>
        </span>`,
      }),
      zIndexOffset: 1000,
    }).addTo(layer).bindTooltip(`<strong>${escapeHtml(incident.number)}</strong><br/>${escapeHtml(incident.address)}`);

    for (const { o } of ranked) {
      const route = routes[o.userId];
      const isSel = o.userId === selected;
      if (route?.path) {
        L.polyline(route.path, {
          color: isSel ? '#3b82f6' : o.activeCalls ? '#f97316' : '#22c55e',
          weight: isSel ? 6 : 3,
          opacity: isSel ? 0.95 : 0.45,
        }).addTo(layer);
      }
      const colour = o.activeCalls ? '#f97316' : '#22c55e';
      L.marker([o.lat as number, o.lng as number], {
        icon: L.divIcon({
          className: '',
          iconSize: [26, 26],
          iconAnchor: [13, 13],
          html: `<span style="position:relative;display:block;width:26px;height:26px">
            ${o.activeCalls ? '' : `<span class="animate-ping" style="position:absolute;inset:0;border-radius:9999px;background:${colour};opacity:.35"></span>`}
            <span style="position:absolute;inset:5px;border-radius:9999px;background:${isSel ? '#3b82f6' : colour};border:2px solid #fff"></span>
          </span>`,
        }),
      })
        .addTo(layer)
        .on('click', () => setSelected(o.userId))
        .bindTooltip(`<strong>${escapeHtml(o.name)}</strong>${o.unitNumber ? ` · ${escapeHtml(o.unitNumber)}` : ''}<br/>${
          route ? `${route.minutes} min · ${route.km} km` : 'Working out the route…'}`);
    }

    if (!fitted.current && ranked.length) {
      fitted.current = true;
      const pts: Array<[number, number]> = [[incident.lat, incident.lng], ...ranked.slice(0, ROUTED).map(({ o }) => [o.lat as number, o.lng as number] as [number, number])];
      map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 });
    }
  }, [ranked, routes, selected, incident]);

  // Selecting an officer frames their route.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const route = selected ? routes[selected] : undefined;
    const o = officers.find((x) => x.userId === selected);
    if (!L || !map || !o || o.lat === null || o.lng === null) return;
    const pts = route?.path ?? [[o.lat, o.lng], [incident.lat, incident.lng]];
    map.fitBounds(L.latLngBounds(pts as Array<[number, number]>), { padding: [50, 50], maxZoom: 16 });
  }, [selected]);

  const onKey = useCallback((e: KeyboardEvent) => { if (e.key === 'Escape' && !assigning) onClose(); }, [assigning, onClose]);
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  const assign = async (o: OnDutyOfficer) => {
    setAssigning(o.userId);
    try {
      await assignIncident(getBrowserSupabase(), { incident_id: incident.id, user_id: o.userId });
      void fetch('/api/push/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentId: incident.id, userId: o.userId }),
      }).catch(() => {});
      toast.push({ title: `${incident.number} assigned`, body: `Assigned to ${o.name}.`, tone: 'success' });
      onClose();
      router.refresh();
    } catch (e) {
      toast.push({ title: 'Not assigned', body: (e as Error).message, tone: 'critical' });
    } finally {
      setAssigning(null);
    }
  };

  const available = officers.filter((o) => o.activeCalls === 0).length;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-label={`Live map for ${incident.number}`}>
      <div className="flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-border bg-bg-card shadow-2xl">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-bold">
              <MapPin className="h-4 w-4 text-accent" aria-hidden />
              <span className="font-mono">{incident.number}</span>
              <span className="severity-pill" data-sev={incident.severity}>{incident.severity}</span>
              <span className="truncate font-normal text-muted-foreground">{incident.type}</span>
            </p>
            <p className="truncate text-xs text-muted-foreground">{incident.address}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs text-severity-low-ink">
              <span className="h-2 w-2 animate-pulse rounded-full bg-severity-low" aria-hidden />
              Live · {available} available · updated {updatedAt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <label className="inline-flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={showBusy} onChange={(e) => setShowBusy(e.target.checked)} />
              Show officers on calls
            </label>
            <button type="button" onClick={onClose} disabled={Boolean(assigning)} aria-label="Close" className="rounded p-1 text-muted-foreground hover:text-fg">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_360px]">
          <div ref={el} className="min-h-[320px]" />
          <aside className="min-h-0 overflow-y-auto border-t border-border lg:border-l lg:border-t-0">
            <p className="sticky top-0 border-b border-border bg-bg-card px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Nearest by road
            </p>
            {ranked.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                {officers.length === 0 ? 'No one is on duty.' : 'No available officer has a position yet.'}
              </p>
            ) : null}
            <ul>
              {ranked.map(({ o, km }) => {
                const route = routes[o.userId];
                const isSel = o.userId === selected;
                return (
                  <li key={o.userId} className={cn('border-b border-border/60', isSel && 'bg-accent/10')}>
                    <button type="button" onClick={() => setSelected(o.userId)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50">
                      <span className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', o.activeCalls ? 'bg-severity-high' : 'bg-severity-low')} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{o.name}{o.badge ? ` #${o.badge}` : ''}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {o.unitNumber ? `${o.unitNumber} · ` : ''}{o.activeCalls ? `On ${o.busyWith?.number ?? 'a call'}` : 'Available'}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-lg font-bold leading-none tabular-nums">
                          {route ? route.minutes : <Loader2 className="inline h-4 w-4 animate-spin" />}
                          {route ? <span className="text-xs font-normal"> min</span> : null}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {route ? `${route.km} km${route.routed ? '' : ' (est.)'}` : `${km.toFixed(1)} km`}
                        </span>
                      </span>
                    </button>
                    {isSel && canAssign && !o.activeCalls ? (
                      <div className="px-4 pb-3">
                        <button
                          type="button"
                          onClick={() => void assign(o)}
                          disabled={Boolean(assigning)}
                          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-accent text-sm font-semibold disabled:opacity-60"
                        >
                          {assigning === o.userId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
                          Assign {o.name.split(' ').slice(-1)[0]}
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {noPosition.length ? (
              <p className="flex items-start gap-2 px-4 py-3 text-xs text-muted-foreground">
                <Radio className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {noPosition.length} on duty without a position yet: {noPosition.map((o) => o.name).join(', ')}.
              </p>
            ) : null}
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}
