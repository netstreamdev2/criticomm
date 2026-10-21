'use client';

import { DismissSos } from './sos-dismiss';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Clock, MapPin, Minus, Radio, Siren, UserRound, Volume2, X } from 'lucide-react';
import { getIncident, type Alert } from '@criticom/api';
import type { Database } from '@criticom/db';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { LeafletMap } from '@/components/leaflet-map';
import { cn, timeAgo } from '@/lib/utils';
import { useT } from '@/components/i18n';

type Incident = Database['public']['Tables']['incidents']['Row'];

/** One wail is this long; it repeats every SIREN_EVERY_MS until acknowledged. */
const SIREN_MS = 3200;
const SIREN_EVERY_MS = 6000;
/** A forgotten tab must not wail forever. */
const SIREN_MAX_MS = 5 * 60_000;

/**
 * A two-tone wail, longer and unlike every other chime in the console, so an
 * SOS is recognised by ear from across the room. Synthesised (WebAudio), so it
 * needs no audio file. Browsers only let a page make sound after it has been
 * clicked once; until then `blocked` is true and the dialog says so.
 */
function useSiren(active: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!active) return;
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = ctxRef.current ?? new Ctor();
    ctxRef.current = ctx;

    const wail = () => {
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
        setBlocked(ctx.state === 'suspended');
      }
      const t0 = ctx.currentTime + 0.02;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      // Up-down sweeps between two pitches, like a police siren.
      for (let i = 0; i < SIREN_MS / 800; i++) {
        osc.frequency.setValueAtTime(620, t0 + i * 0.8);
        osc.frequency.linearRampToValueAtTime(1080, t0 + i * 0.8 + 0.4);
        osc.frequency.linearRampToValueAtTime(620, t0 + i * 0.8 + 0.8);
      }
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.08);
      gain.gain.setValueAtTime(0.12, t0 + SIREN_MS / 1000 - 0.15);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + SIREN_MS / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + SIREN_MS / 1000 + 0.05);
    };

    wail();
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > SIREN_MAX_MS) { clearInterval(timer); return; }
      wail();
    }, SIREN_EVERY_MS);
    return () => clearInterval(timer);
  }, [active]);

  // Minimising unmounts the dialog: release the audio device with it, so a
  // shift of SOS alerts never piles up open AudioContexts.
  useEffect(() => () => {
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
  }, []);

  /** Called on any click in the dialog: lets a blocked siren start. */
  const unlock = () => {
    const ctx = ctxRef.current;
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().then(() => setBlocked(false)).catch(() => {});
    }
  };

  return { blocked, unlock };
}

const hasPoint = (i: Incident | null) => Boolean(i && i.location_lat && i.location_lng);

/**
 * The SOS dialog: an officer pressed the app's SOS button. It takes the screen
 * with a siren, shows where they are, and leads to dispatch — the SOS waits in
 * the pending queue until someone sends it out.
 *
 * It never traps anyone: × clears it (acknowledged, on the record), and
 * minimise — or Escape — folds it into a red bar that stays on screen,
 * silent, until it is reopened or cleared.
 */
export function SosAlert({
  alert, waiting, acking, canDispatch, canDismiss = false, canOpen = true, onAcknowledge, onMinimize,
}: {
  /** May open the call (the call logger may not: CALL_LOGGER_PAGES). */
  canOpen?: boolean;
  /** May dismiss an SOS pressed by mistake (0093). */
  canDismiss?: boolean;
  alert: Alert;
  /** Other alerts queued behind this one. */
  waiting: number;
  acking: boolean;
  /** Whether this desk may dispatch; others get "Open incident" only. */
  canDispatch: boolean;
  /** Acknowledge (clears it), then optionally go somewhere. */
  onAcknowledge: (href?: string) => void;
  /** Fold into the SOS bar; the siren stops. */
  onMinimize: () => void;
}) {
  const { t } = useT();
  const [incident, setIncident] = useState<Incident | null>(null);
  const { blocked, unlock } = useSiren(true);

  useEffect(() => {
    if (!alert.incident_id) return;
    void getIncident(getBrowserSupabase(), alert.incident_id).then(setIncident).catch(() => {});
  }, [alert.incident_id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onMinimize(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onMinimize]);

  const raisedAt = incident?.call_timestamp ?? alert.created_at;
  const lateBy = incident ? new Date(alert.created_at).getTime() - new Date(incident.call_timestamp).getTime() : 0;
  const sentOffline = lateBy > 30_000;
  const id = alert.incident_id;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sos-title"
      onPointerDown={unlock}
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
    >
      <div className="alert-modal-enter w-full max-w-3xl overflow-hidden rounded-2xl border-2 border-severity-critical bg-bg-card shadow-2xl ring-4 ring-severity-critical/30">
        {/* Banner */}
        <div className="flex flex-wrap items-center gap-3 bg-severity-critical px-6 py-4">
          <Siren className="h-7 w-7 shrink-0 animate-pulse" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.25em] opacity-90">{t('SOS · officer emergency')}</p>
            <p id="sos-title" className="text-xl font-extrabold leading-tight">{alert.title}</p>
          </div>
          {incident ? (
            <span className="rounded-md bg-black/25 px-2.5 py-1 font-mono text-sm font-bold">{incident.incident_number}</span>
          ) : null}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onMinimize}
              aria-label={t('Minimise SOS')}
              title={t('Minimise (Esc) — stays as a bar, siren off')}
              className="rounded-md p-1.5 hover:bg-black/25"
            >
              <Minus className="h-5 w-5" />
            </button>
            <button
              type="button"
              disabled={acking}
              onClick={() => onAcknowledge()}
              aria-label={t('Clear SOS')}
              title={t('Clear — marks it acknowledged')}
              className="rounded-md p-1.5 hover:bg-black/25 disabled:opacity-60"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {blocked ? (
          <button
            type="button"
            onClick={unlock}
            className="flex w-full items-center justify-center gap-2 bg-severity-critical/15 px-4 py-2 text-xs font-semibold text-severity-critical-ink"
          >
            <Volume2 className="h-4 w-4" /> {' '}{t('Click anywhere to sound the SOS alarm')}</button>
        ) : null}

        <div className="grid gap-5 p-6 md:grid-cols-[1.3fr_1fr]">
          {/* Where */}
          <div className="overflow-hidden rounded-xl border border-border">
            {hasPoint(incident) ? (
              <LeafletMap
                markers={[{ id: incident!.id, lat: incident!.location_lat, lng: incident!.location_lng, kind: 'critical' }]}
                center={[incident!.location_lat, incident!.location_lng]}
                zoom={16}
                height={280}
                satellite
                pin
              />
            ) : (
              <div className="flex h-[280px] flex-col items-center justify-center gap-2 bg-bg-soft p-6 text-center">
                <MapPin className="h-8 w-8 text-severity-critical-ink" />
                <p className="font-bold">{incident ? 'Position unknown' : 'Locating…'}</p>
                {incident ? (
                  <p className="text-sm text-muted-foreground">{t('Raise the officer on the radio for their location.')}</p>
                ) : null}
              </div>
            )}
          </div>

          {/* Who and what */}
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 text-base font-bold">
              <UserRound className="h-4 w-4 text-severity-critical-ink" />
              {alert.created_by_name ?? incident?.responding_officer ?? 'Officer'}
            </p>
            {alert.body ? (
              <p className="flex items-start gap-2 text-muted-foreground">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{alert.body}</span>
              </p>
            ) : null}
            {incident?.notes ? (
              <p className="flex items-start gap-2 rounded-lg border border-severity-medium/40 bg-severity-medium/10 px-3 py-2 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-severity-medium-ink" />
                <span>{incident.notes}</span>
              </p>
            ) : null}
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {t('Raised {localeTimeString} ({timeAgo})', { localeTimeString: new Date(raisedAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), timeAgo: timeAgo(raisedAt) })}{sentOffline ? <span className="font-semibold text-severity-medium-ink">{t('· sent offline, arrived late')}</span> : null}
            </p>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Radio className="h-3.5 w-3.5" />
              {canDispatch
                ? 'Waiting in the dispatch queue — send it to officers on duty or assign it.'
                : 'Waiting in the dispatch queue — the dispatch desk has been alerted.'}
            </p>
            {waiting > 0 ? <p className="text-xs font-semibold">{t('+{waiting} more alert{value} waiting', { waiting, value: waiting === 1 ? '' : 's' })}</p> : null}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border px-6 py-4 sm:flex-row">
          {id && canDispatch ? (
            <button
              type="button"
              disabled={acking}
              onClick={() => onAcknowledge(`/dispatch/assign/${id}`)}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-severity-critical text-sm font-extrabold uppercase tracking-wider disabled:opacity-60"
            >
              <Siren className="h-4 w-4" /> {' '}{t('Dispatch SOS')}</button>
          ) : null}
          {id && canOpen ? (
            <button
              type="button"
              disabled={acking}
              onClick={() => onAcknowledge(`/incidents/${id}`)}
              className={cn('h-12 rounded-lg border border-border px-5 text-sm font-semibold hover:bg-muted disabled:opacity-60', !canDispatch && 'flex-1')}
            >
              {t('Open incident')}</button>
          ) : null}
          {id && canDismiss ? (
            <DismissSos
              incidentId={id} label={t("{value}'s SOS", { value: alert.created_by_name ?? incident?.responding_officer ?? 'the officer' })}
              className="h-12" onDone={() => onAcknowledge()}
            />
          ) : null}
          <button
            type="button"
            disabled={acking}
            onClick={() => onAcknowledge()}
            className={cn('h-12 rounded-lg border border-border px-5 text-sm font-semibold hover:bg-muted disabled:opacity-60', !id && 'flex-1')}
          >
            {t('Acknowledge')}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Minimised SOS alerts: one red bar each, pinned to the bottom of the screen,
 * silent. An SOS that has been put aside is still unanswered, so it stays in
 * sight until someone reopens or clears it.
 */
export function SosBar({
  alerts, canDispatch, canDismiss = false, onExpand, onAcknowledge,
}: {
  alerts: Alert[];
  canDispatch: boolean;
  /** May dismiss an SOS pressed by mistake (0093). */
  canDismiss?: boolean;
  onExpand: (alert: Alert) => void;
  onAcknowledge: (alert: Alert, href?: string) => void;
}) {
  const { t } = useT();
  if (alerts.length === 0) return null;
  return (
    <div aria-live="polite" className="fixed inset-x-4 bottom-4 z-[85] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="flex w-full max-w-md items-center gap-2 rounded-xl border-2 border-severity-critical bg-severity-critical px-3 py-2 shadow-2xl"
        >
          <Siren className="h-5 w-5 shrink-0 animate-pulse" />
          <button
            type="button"
            onClick={() => onExpand(alert)}
            className="min-w-0 flex-1 text-left"
            title={t('Show the SOS')}
          >
            <span className="block text-[10px] font-bold uppercase tracking-[0.2em] opacity-90">{t('SOS · unanswered')}</span>
            <span className="block truncate text-sm font-extrabold">{alert.created_by_name ?? alert.title}</span>
          </button>
          {canDispatch && alert.incident_id ? (
            <button
              type="button"
              onClick={() => onAcknowledge(alert, `/dispatch/assign/${alert.incident_id}`)}
              className="shrink-0 rounded-md bg-black/25 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider hover:bg-black/35"
            >
              {t('Dispatch')}</button>
          ) : null}
          {canDismiss && alert.incident_id ? (
            <DismissSos
              incidentId={alert.incident_id} tone="icon" className="shrink-0"
              label={t("{value}'s SOS", { value: alert.created_by_name ?? 'the officer' })}
              onDone={() => onAcknowledge(alert)}
            />
          ) : null}
          <button
            type="button"
            onClick={() => onAcknowledge(alert)}
            aria-label={t('Clear SOS')}
            title={t('Clear — marks it acknowledged')}
            className="shrink-0 rounded-md p-1.5 hover:bg-black/25"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
