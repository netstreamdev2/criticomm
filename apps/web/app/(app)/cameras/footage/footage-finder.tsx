'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, Film, Loader2 } from 'lucide-react';
import { useToast } from '@/components/toast';

type CctvCamera = {
  id: string;
  name: string;
  source: 'hikvision' | 'sanral';
  streamable: boolean;
  detail: string | null;
};

/** Local-time value for <input type="datetime-local">, minus `minsAgo`. */
function localStamp(minsAgo = 0) {
  const d = new Date(Date.now() - minsAgo * 60_000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** HikCentral wants ISO-8601 with the numeric offset, not Z. */
function toOffsetIso(local: string) {
  const d = new Date(local);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  return `${local}:00${sign}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
}

export function FootageFinder() {
  const toast = useToast();
  const [cameras, setCameras] = useState<CctvCamera[]>([]);
  const [source, setSource] = useState<'hikvision' | 'sanral' | null>(null);
  const [cameraId, setCameraId] = useState('');
  const [begin, setBegin] = useState(() => localStamp(60));
  const [end, setEnd] = useState(() => localStamp(0));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string; protocol: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/cctv/cameras');
        const data = (await res.json()) as { source: 'hikvision' | 'sanral'; cameras: CctvCamera[] };
        setSource(data.source);
        const streamable = (data.cameras ?? []).filter((c) => c.streamable);
        setCameras(streamable);
        if (streamable[0]) setCameraId(streamable[0].id);
      } catch {
        setError('Could not load the camera list.');
      }
    })();
  }, []);

  const windowValid = useMemo(() => {
    const b = new Date(begin).getTime();
    const e = new Date(end).getTime();
    return Number.isFinite(b) && Number.isFinite(e) && e > b && e - b <= 24 * 3_600_000;
  }, [begin, end]);

  const fetchFootage = async () => {
    if (!cameraId || !windowValid) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/cctv/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cameraIndexCode: cameraId,
          beginIso: toOffsetIso(begin),
          endIso: toOffsetIso(end),
        }),
      });
      const data = (await res.json()) as { url?: string; protocol?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? 'No playback URL returned.');
      setResult({ url: data.url, protocol: data.protocol ?? 'stream' });
      await navigator.clipboard?.writeText(data.url).catch(() => {});
      toast.push({ title: 'Footage URL issued', body: 'Copied to the clipboard.', tone: 'success' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = 'h-11 w-full rounded-lg border border-border bg-bg-soft px-3 text-sm focus:border-accent focus:outline-none';
  const label = 'mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground';

  if (source === 'sanral') {
    return (
      <p className="rounded-xl border border-severity-medium/40 bg-severity-medium/10 px-4 py-6 text-center text-sm">
        Recorded footage arrives with the Hikvision cut-over. The room is currently on the
        SANRAL matrix, which has no playback API — enable Hikvision under Admin → Integrations
        once the platform is stood up.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
      <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="cam">Camera</label>
          <select id="cam" className={field} value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
            {cameras.length === 0 && <option value="">Loading cameras…</option>}
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.detail ? ` — ${c.detail}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="from">From</label>
          <input id="from" type="datetime-local" className={field} value={begin} onChange={(e) => setBegin(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="to">To</label>
          <input id="to" type="datetime-local" className={field} value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border bg-bg-soft/50 px-5 py-3">
        <button
          type="button"
          onClick={() => void fetchFootage()}
          disabled={busy || !cameraId || !windowValid}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-bold disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
          {busy ? 'Requesting…' : 'Get footage'}
        </button>
        {!windowValid ? (
          <p className="text-xs text-severity-medium-ink">Window must be valid and at most 24 hours.</p>
        ) : null}
        {error ? <p className="text-xs text-severity-critical-ink">{error}</p> : null}
      </div>

      {result ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3.5">
          <span className="rounded-full bg-severity-low/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-severity-low-ink">
            {result.protocol.toUpperCase()}
          </span>
          <code className="min-w-0 flex-1 truncate rounded-md bg-bg-soft px-2.5 py-1.5 font-mono text-xs">{result.url}</code>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(result.url)}
            aria-label="Copy URL"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-fg"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          {result.url.startsWith('http') ? (
            <a
              href={result.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-semibold hover:bg-muted"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
