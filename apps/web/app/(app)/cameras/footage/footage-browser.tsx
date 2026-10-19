'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Film, Search } from 'lucide-react';
import { windowFor } from '@criticom/db/bodycams';
import { BodycamViewer, type ViewReason } from '@/components/bodycam/bodycam-viewer';
import { cn, formatSaTime } from '@/lib/utils';
import { useT } from '@/components/i18n';

export type FootageBooking = {
  id: string;
  bodycamId: string;
  serial: string;
  officer: string | null;
  officerId: string;
  bookedAt: string;
  returnedAt: string | null;
};

/** An ISO time as <input type="datetime-local"> wants it, in this browser's time. */
function localStamp(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The part of a booking inside the search window, at most a day. */
function playWindow(b: FootageBooking, win: { from: string; to: string }) {
  const from = b.bookedAt > win.from ? b.bookedAt : win.from;
  const end = !b.returnedAt || b.returnedAt > win.to ? win.to : b.returnedAt;
  return windowFor(from, end);
}

export function FootageBrowser({ bookings, window: win, capped, incident, officerId }: {
  bookings: FootageBooking[];
  window: { from: string; to: string };
  capped: boolean;
  incident: { id: string; number: string } | null;
  officerId: string | null;
}) {
  const { t } = useT();
  const router = useRouter();
  const [from, setFrom] = useState(() => localStamp(win.from));
  const [to, setTo] = useState(() => localStamp(win.to));
  const [officer, setOfficer] = useState(officerId ?? '');
  const [playing, setPlaying] = useState<FootageBooking | null>(null);
  const [lastReason, setLastReason] = useState<ViewReason | null>(null);

  const officers = [...new Map(bookings.map((b) => [b.officerId, b.officer ?? 'An officer'])).entries()];

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const f = new Date(from);
    const t = new Date(to);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || t <= f) return;
    const qs = new URLSearchParams({ from: f.toISOString(), to: t.toISOString() });
    if (officer) qs.set('officer', officer);
    setPlaying(null);
    router.push(`/cameras/footage?${qs.toString()}`);
  };

  const played = playing ? playWindow(playing, win) : null;

  return (
    <div className="space-y-4">
      {incident ? (
        <p className="rounded-lg border border-border bg-bg-card px-4 py-3 text-sm">
          {t('Bodycams worn by the officers on')}{' '}<b>{incident.number}</b>{t(', from when it was logged{value}.{value2}', { value: ` (${formatSaTime(win.from)}) to ${formatSaTime(win.to)}`, value2: capped ? ' The incident ran longer than a day: this shows its first 24 hours.' : '' })}
        </p>
      ) : (
        <form onSubmit={search} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-bg-card p-4">
          <label className="text-xs font-semibold text-muted-foreground">{t('From')}<input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)}
              className="mt-1 block h-9 rounded-md border border-border bg-bg-soft px-2 text-sm text-fg" />
          </label>
          <label className="text-xs font-semibold text-muted-foreground">{t('To')}<input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)}
              className="mt-1 block h-9 rounded-md border border-border bg-bg-soft px-2 text-sm text-fg" />
          </label>
          <label className="text-xs font-semibold text-muted-foreground">{t('Officer')}<select value={officer} onChange={(e) => setOfficer(e.target.value)}
              className="mt-1 block h-9 min-w-[12rem] rounded-md border border-border bg-bg-soft px-2 text-sm text-fg">
              <option value="">{t('Everyone in the window')}</option>
              {officers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <button type="submit" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
            <Search className="h-4 w-4" /> {' '}{t('Find footage')}</button>
          {capped ? <p className="w-full text-xs text-severity-medium-ink">{t('Windows are capped at 24 hours: this shows the first day.')}</p> : null}
        </form>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <section aria-label={t('Bookings in the window')}>
          {bookings.length === 0 ? (
            <p className="rounded-xl border border-border bg-bg-card px-4 py-8 text-center text-sm text-muted-foreground">
              {t('No bodycam was out with {value} in this window.', { value: incident ? 'these officers' : officerId ? 'this officer' : 'anyone' })}</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-bg-card">
              {bookings.map((b) => (
                <li key={b.id} className={cn('flex items-start gap-3 px-3 py-2.5', playing?.id === b.id && 'bg-primary/5')}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{b.officer ?? 'An officer'}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {b.serial} · {formatSaTime(b.bookedAt)} – {b.returnedAt ? formatSaTime(b.returnedAt) : 'still out'}
                    </p>
                  </div>
                  <button type="button" onClick={() => setPlaying(b)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted">
                    <Film className="h-3.5 w-3.5" /> {' '}{t('Play')}</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label={t('Footage')}>
          {playing && played ? (
            <BodycamViewer
              key={`${playing.id}-${played.from}`}
              target={{ bodycamId: playing.bodycamId, serial: playing.serial, officer: playing.officer }}
              kind="footage"
              incident={incident}
              window={{ from: played.from, to: played.to }}
              defaultReason={lastReason ?? { code: 'investigation', note: '' }}
              onReason={setLastReason}
              onClose={() => setPlaying(null)}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-border bg-bg-card p-4 text-center text-sm text-muted-foreground">
              {t('Choose a booking to play its footage here.')}</div>
          )}
        </section>
      </div>
    </div>
  );
}
