'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const EVERY_MS = 5 * 60_000;

/**
 * While any Disaster screen is open, ask the server every five minutes for
 * new SA Weather Service warnings (it reads the feed at most that often,
 * however many screens ask), and refresh the screen when one for eThekwini
 * arrived. Nothing shows; the warning strip on top does the telling.
 */
export function WarningWatcher() {
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      fetch('/api/disaster/warnings/sync', { method: 'POST', cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { forUs?: number } | null) => { if (alive && j?.forUs) router.refresh(); })
        .catch(() => undefined);
    };
    const first = setTimeout(check, 5_000);
    const timer = setInterval(check, EVERY_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [router]);
  return null;
}
