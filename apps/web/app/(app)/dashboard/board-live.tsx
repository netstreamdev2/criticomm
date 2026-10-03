'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  onDutyFlip, subscribeIncidentUpdates, subscribeNewIncidents, subscribePersonnel,
} from '@criticom/api';
import { getBrowserSupabase } from '@/lib/supabase-browser';

/**
 * Keeps the dashboards live. They are server components, so a change to any
 * incident, or an officer going on or off duty, re-renders them with fresh
 * counts. Bursts — a crew stepping through En Route → Arrived → On Scene —
 * collapse into one refresh, and a slow minute tick keeps the critical-wait
 * clock honest when nothing moves.
 */
export function BoardLive() {
  const router = useRouter();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(() => router.refresh(), 500);
    };

    let offNew = () => {};
    let offUpd = () => {};
    let offDuty = () => {};
    try {
      const sb = getBrowserSupabase();
      offNew = subscribeNewIncidents(sb, 'all', refresh);
      offUpd = subscribeIncidentUpdates(sb, 'all', refresh);
      // An officer going on or off duty in the app moves the on-duty figures.
      offDuty = subscribePersonnel(sb, onDutyFlip(refresh));
    } catch {
      /* no realtime config — the minute tick still refreshes */
    }
    const tick = setInterval(() => router.refresh(), 60_000);

    return () => {
      offNew();
      offUpd();
      offDuty();
      clearInterval(tick);
      if (pending.current) clearTimeout(pending.current);
    };
  }, [router]);

  return null;
}
