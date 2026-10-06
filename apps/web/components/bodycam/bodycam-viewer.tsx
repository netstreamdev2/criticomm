'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Film, Loader2, ShieldAlert, Video, X } from 'lucide-react';
import type { BodycamViewReason } from '@criticom/db';
import {
  BODYCAM_VIEW_REASONS, bodycamReasonLabel, liveFeedState, secondsToAnswer, VIEW_HEARTBEAT_MS, viewReasonError,
} from '@criticom/db/bodycams';
import { cn, formatSaTime } from '@/lib/utils';
import { HlsVideo } from './hls-video';

export type BodycamTarget = { bodycamId: string; serial: string; officer: string | null };
export type ViewReason = { code: Exclude<BodycamViewReason, 'incident'>; note: string };

type Open = {
  viewId: string;
  url: string;
  test: boolean;
  insecure: boolean;
  officer: string | null;
  startedAt: number;
};

const ENDPOINT = '/api/bodycams/view';

function post(body: Record<string, unknown>) {
  return fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
}

/** Closes a view even when the tab is going away. */
function endNow(viewId: string, endReason: 'closed' | 'timeout' | 'failed') {
  const body = JSON.stringify({ action: 'end', viewId, endReason });
  if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'text/plain' }))) return;
  void fetch(ENDPOINT, { method: 'POST', body, keepalive: true }).catch(() => {});
}

const ENDED: Record<string, string> = {
  stopped: 'The bodycam was handed back, so the live view ended.',
  timeout: 'The view stopped because nobody confirmed it was still being watched.',
  closed: 'This view was closed.',
  failed: 'The stream could not be shown.',
};

/**
 * One bodycam view, live or recorded. Without an incident it asks why first;
 * the database decides whether it may open and writes the record. A live
 * view confirms every half minute, asks "Still watching?" after ten minutes
 * and stops a minute later if nobody answers; closing it, leaving the page or
 * closing the tab ends the view on the record.
 */
export function BodycamViewer({
  target, kind, incident = null, window: footage = null, defaultReason = null, onReason, onClose, tone = 'card', className,
}: {
  target: BodycamTarget;
  kind: 'live' | 'footage';
  /** Opened for this incident: that is the reason, and it opens straight away. */
  incident?: { id: string; number: string } | null;
  /** The footage window (kind 'footage'). */
  window?: { from: string; to: string } | null;
  /** The last reason given on this screen, offered again. */
  defaultReason?: ViewReason | null;
  onReason?: (reason: ViewReason) => void;
  onClose: () => void;
  tone?: 'card' | 'map';
  className?: string;
}) {
  const [reason, setReason] = useState<ViewReason | null>(defaultReason);
  const [phase, setPhase] = useState<'reason' | 'starting' | 'open' | 'ended'>(incident ? 'starting' : 'reason');
  const [open, setOpen] = useState<Open | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [since, setSince] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const viewRef = useRef<string | null>(null);

  const start = useCallback(async (why: ViewReason | null) => {
    setPhase('starting');
    setError(null);
    try {
      const res = await post({
        action: 'start', bodycamId: target.bodycamId, kind,
        incidentId: incident?.id ?? null, reason: incident ? null : why?.code ?? null, note: incident ? null : why?.note ?? null,
        from: footage?.from ?? null, to: footage?.to ?? null,
      });
      const data = (await res.json()) as { viewId?: string; url?: string; test?: boolean; insecure?: boolean; officer?: string | null; error?: string };
      if (!res.ok || !data.viewId || !data.url) throw new Error(data.error ?? 'The bodycam could not be opened.');
      viewRef.current = data.viewId;
      const at = Date.now();
      setOpen({ viewId: data.viewId, url: data.url, test: Boolean(data.test), insecure: Boolean(data.insecure), officer: data.officer ?? target.officer, startedAt: at });
      setSince(at);
      setPhase('open');
    } catch (e) {
      setError((e as Error).message);
      setPhase(incident ? 'ended' : 'reason');
    }
  }, [target.bodycamId, target.officer, kind, incident, footage?.from, footage?.to]);

  // From an incident it opens straight away: the incident is the reason.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!incident || autoStarted.current) return;
    autoStarted.current = true;
    void start(null);
  }, [incident, start]);

  const finish = useCallback((endReason: 'closed' | 'timeout' | 'failed', message: string | null) => {
    const id = viewRef.current;
    viewRef.current = null;
    if (id) endNow(id, endReason);
    setOpen(null);
    setEnded(message);
    setPhase('ended');
  }, []);

  // Keep it open on the record; stop if the bodycam is handed back.
  useEffect(() => {
    if (phase !== 'open' || !open) return;
    const t = setInterval(() => {
      void post({ action: 'touch', viewId: open.viewId })
        .then((r) => r.json() as Promise<{ active?: boolean; reason?: string }>)
        .then((d) => {
          if (d.active === false && viewRef.current === open.viewId) {
            viewRef.current = null;
            setOpen(null);
            setEnded(ENDED[d.reason ?? 'closed'] ?? ENDED.closed!);
            setPhase('ended');
          }
        })
        .catch(() => {});
    }, VIEW_HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [phase, open]);

  // "Still watching?" — live views only; recorded footage is played on purpose.
  useEffect(() => {
    if (phase !== 'open' || kind !== 'live') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase, kind]);
  const feed = phase === 'open' && kind === 'live' ? liveFeedState(since, now) : 'watching';
  useEffect(() => {
    if (feed === 'expired') finish('timeout', ENDED.timeout!);
  }, [feed, finish]);

  // Leaving the page or closing the tab ends the view on the record.
  useEffect(() => {
    const onHide = () => {
      if (viewRef.current) endNow(viewRef.current, 'closed');
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      onHide();
      viewRef.current = null;
    };
  }, []);

  const close = () => {
    if (viewRef.current) finish('closed', null);
    onClose();
  };

  const reasonError = reason ? viewReasonError({ reason: reason.code, note: reason.note }) : 'Say why you are opening this bodycam.';
  const dark = tone === 'map';
  const muted = dark ? 'text-slate-400' : 'text-muted-foreground';
  const officer = open?.officer ?? target.officer;

  return (
    <div className={cn(
      'flex flex-col overflow-hidden rounded-xl border',
      dark ? 'border-white/10 bg-slate-950/90 text-slate-100' : 'border-border bg-bg-card',
      className,
    )}>
      <div className={cn('flex items-start gap-2 px-3 py-2', dark ? 'border-b border-white/10' : 'border-b border-border')}>
        {kind === 'live'
          ? <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"><Video className="h-3 w-3" /> Live</span>
          : <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-sky-700 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"><Film className="h-3 w-3" /> Footage</span>}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{officer ?? 'Bodycam'} <span className={cn('font-mono text-xs', muted)}>· {target.serial}</span></p>
          <p className={cn('truncate text-xs', muted)}>
            {incident ? `For ${incident.number}` : reason && phase !== 'reason' ? bodycamReasonLabel(reason.code) : kind === 'live' ? 'Live from the officer’s camera' : 'Recorded footage'}
            {footage ? ` · ${formatSaTime(footage.from)} – ${formatSaTime(footage.to)}` : ''}
          </p>
        </div>
        <button type="button" onClick={close} aria-label="Close this bodycam" className={cn('rounded p-1', dark ? 'text-slate-300 hover:text-white' : 'text-muted-foreground hover:text-fg')}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative aspect-video w-full bg-black">
        {phase === 'open' && open ? (
          <>
            <HlsVideo src={open.url} label={`${kind === 'live' ? 'Live video' : 'Footage'} from bodycam ${target.serial}`}
              onError={(m) => finish('failed', m)} />
            {open.test ? (
              <span className="pointer-events-none absolute left-2 top-2 rounded bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-slate-950">
                Test video — not the bodycam
              </span>
            ) : null}
            {feed === 'asking' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 p-4 text-center text-white">
                <p className="text-base font-semibold">Still watching?</p>
                <p className="text-sm text-slate-300">This feed stops in {secondsToAnswer(since, now)} s to save the bodycam’s mobile data.</p>
                <button type="button" onClick={() => {
                  setSince(Date.now());
                  if (open) void post({ action: 'touch', viewId: open.viewId }).catch(() => {});
                }} className="rounded-md bg-sky-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-sky-400">
                  Keep watching
                </button>
              </div>
            ) : null}
            {open.insecure ? (
              <p className="absolute inset-x-0 bottom-0 bg-amber-500/90 px-2 py-1 text-[11px] font-semibold text-slate-950">
                The platform sent an insecure (http) stream address, which the browser may refuse. Ask Hikvision to stream over HTTPS.
              </p>
            ) : null}
          </>
        ) : phase === 'starting' ? (
          <p className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" /> Opening…
          </p>
        ) : phase === 'ended' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm text-slate-300">
            <p>{error ?? ended ?? 'Closed.'}</p>
            <button type="button" onClick={() => { setEnded(null); setError(null); if (incident) void start(null); else setPhase('reason'); }}
              className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10">
              Open again
            </button>
          </div>
        ) : (
          <form
            className="absolute inset-0 flex flex-col gap-2 overflow-y-auto bg-slate-950 p-3 text-slate-100"
            onSubmit={(e) => {
              e.preventDefault();
              if (!reason || reasonError) return;
              onReason?.(reason);
              void start(reason);
            }}
          >
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-sky-300">
              <ShieldAlert className="h-3.5 w-3.5" /> Why are you opening this bodycam?
            </p>
            <div className="grid gap-1 sm:grid-cols-2">
              {BODYCAM_VIEW_REASONS.map((r) => (
                <label key={r.code} className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs',
                  reason?.code === r.code ? 'border-sky-400 bg-sky-400/10' : 'border-white/10 hover:bg-white/5')}>
                  <input type="radio" name={`reason-${target.bodycamId}`} checked={reason?.code === r.code}
                    onChange={() => setReason({ code: r.code, note: reason?.note ?? '' })} className="accent-sky-400" />
                  {r.label}
                </label>
              ))}
            </div>
            <input
              value={reason?.note ?? ''}
              onChange={(e) => setReason((cur) => ({ code: cur?.code ?? 'other', note: e.target.value }))}
              maxLength={300}
              placeholder={reason?.code === 'other' ? 'Say why (required)' : 'Note (optional)'}
              aria-label="Note on why"
              className="h-8 rounded-md border border-white/15 bg-slate-900 px-2 text-xs text-slate-100 placeholder:text-slate-500"
            />
            {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : null}
            <div className="mt-auto flex items-center gap-2">
              <button type="submit" disabled={Boolean(reasonError)}
                className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-sky-400 disabled:opacity-40">
                {kind === 'live' ? 'Watch live' : 'Play footage'}
              </button>
              <span className="text-[11px] text-slate-400">Recorded with your name and reason.</span>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
