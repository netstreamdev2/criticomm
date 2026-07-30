'use client';

import { useCallback, useEffect, useState } from 'react';
import { Camera, Copy, ExternalLink, Loader2, MapPin, RefreshCw, Video } from 'lucide-react';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';

type CctvCamera = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  source: 'hikvision' | 'sanral';
  streamable: boolean;
  url: string | null;
  detail: string | null;
};

type Inventory = {
  source: 'hikvision' | 'sanral';
  total: number;
  cameras: CctvCamera[];
  warning?: string;
};

/**
 * The camera wall. Serves whichever platform is switched on: the SANRAL
 * registry today, the HikCentral estate the moment the Hikvision integration
 * is enabled — same wall, different `source` badge.
 */
export function LiveWall() {
  const toast = useToast();
  const [inv, setInv] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cctv/cameras');
      if (!res.ok) throw new Error(`Camera inventory failed (${res.status})`);
      setInv((await res.json()) as Inventory);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openLive = async (camera: CctvCamera) => {
    setBusyId(camera.id);
    try {
      const res = await fetch('/api/cctv/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cameraIndexCode: camera.id }),
      });
      const data = (await res.json()) as { url?: string; protocol?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? 'No stream URL returned.');

      await navigator.clipboard?.writeText(data.url).catch(() => {});
      toast.push({
        title: `${camera.name} — live URL issued`,
        body: `${(data.protocol ?? 'stream').toUpperCase()} address copied to the clipboard. HLS opens in a browser tab; RTSP paste into VLC or the video wall.`,
        tone: 'success',
      });
      if (data.url.startsWith('http')) window.open(data.url, '_blank', 'noopener');
    } catch (e) {
      toast.push({ title: `${camera.name}: stream unavailable`, body: (e as Error).message, tone: 'warning' });
    } finally {
      setBusyId(null);
    }
  };

  const cameras = (inv?.cameras ?? []).filter((c) =>
    !filter.trim()
    || c.name.toLowerCase().includes(filter.toLowerCase())
    || (c.detail ?? '').toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-soft px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Video className="h-4 w-4 text-accent" /> Camera wall
        </h2>
        {inv ? (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
              inv.source === 'hikvision'
                ? 'bg-severity-low/15 text-severity-low-ink'
                : 'bg-accent/15 text-accent',
            )}
          >
            {inv.source === 'hikvision' ? 'Hikvision · live' : 'SANRAL registry'}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter cameras…"
            className="h-8 w-44 rounded-md border border-border bg-bg px-2.5 text-xs focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh cameras"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-fg disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {inv?.warning ? (
        <p className="border-b border-severity-medium/40 bg-severity-medium/10 px-4 py-2 text-xs text-severity-medium-ink">
          {inv.warning}
        </p>
      ) : null}

      {error ? (
        <p className="px-4 py-8 text-center text-sm text-severity-critical-ink">{error}</p>
      ) : loading && !inv ? (
        <p className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the camera estate…
        </p>
      ) : cameras.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          {filter ? 'No cameras match the filter.' : 'No cameras available yet — run the import, or enable Hikvision under Admin → Integrations.'}
        </p>
      ) : (
        <ul className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
          {cameras.slice(0, 60).map((c) => (
            <li key={`${c.source}-${c.id}`} className="flex items-start gap-3 bg-bg-card p-3.5">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Camera className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{c.name}</p>
                {c.detail ? <p className="truncate text-xs text-muted-foreground">{c.detail}</p> : null}
                {c.latitude != null && c.longitude != null ? (
                  <p className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                    <MapPin className="h-3 w-3" /> {c.latitude.toFixed(4)}, {c.longitude.toFixed(4)}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.streamable ? (
                    <button
                      type="button"
                      onClick={() => void openLive(c)}
                      disabled={busyId === c.id}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-bold disabled:opacity-60"
                    >
                      {busyId === c.id
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Video className="h-3 w-3" />}
                      Live view
                    </button>
                  ) : c.url ? (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold hover:bg-muted"
                    >
                      <ExternalLink className="h-3 w-3" /> Open feed
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground/70">
                      <Copy className="h-3 w-3" /> No feed
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cameras.length > 60 ? (
        <p className="border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">
          Showing 60 of {cameras.length} — narrow with the filter.
        </p>
      ) : null}
    </div>
  );
}
