'use client';

import { useCallback, useEffect, useState } from 'react';
import { Camera, Copy, ExternalLink, Loader2, MapPin, RefreshCw, Video } from 'lucide-react';
import type { CctvCamera } from '@/app/api/cctv/cameras/route';
import { cn } from '@/lib/utils';
import { useT } from '@/components/i18n';

type Inventory = { source: 'sanral'; total: number; cameras: CctvCamera[] };

/** The SANRAL freeway camera wall: each camera's feed page on i-traffic. */
export function LiveWall() {
  const { t } = useT();
  const [inv, setInv] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

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

  const cameras = (inv?.cameras ?? []).filter((c) =>
    !filter.trim()
    || c.name.toLowerCase().includes(filter.toLowerCase())
    || (c.detail ?? '').toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-soft px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Video className="h-4 w-4 text-accent" /> {' '}{t('Camera wall')}</h2>
        {inv ? (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
            {t('SANRAL registry')}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('Filter cameras…')}
            className="h-8 w-44 rounded-md border border-border bg-bg px-2.5 text-xs focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label={t('Refresh cameras')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-fg disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {error ? (
        <p className="px-4 py-8 text-center text-sm text-severity-critical-ink">{error}</p>
      ) : loading && !inv ? (
        <p className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {' '}{t('Loading the cameras…')}</p>
      ) : cameras.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          {filter ? 'No cameras match the filter.' : 'No cameras available yet — run the import.'}
        </p>
      ) : (
        <ul className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
          {cameras.slice(0, 60).map((c) => (
            <li key={c.id} className="flex items-start gap-3 bg-bg-card p-3.5">
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
                  {c.url ? (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold hover:bg-muted"
                    >
                      <ExternalLink className="h-3 w-3" /> {' '}{t('Open feed')}</a>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground/70">
                      <Copy className="h-3 w-3" /> {' '}{t('No feed')}</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cameras.length > 60 ? (
        <p className="border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">
          {t('Showing 60 of {length} — narrow with the filter.', { length: cameras.length })}</p>
      ) : null}
    </div>
  );
}
