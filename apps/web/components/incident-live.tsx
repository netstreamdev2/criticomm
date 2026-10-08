'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { subscribeIncidentTimeline, subscribeIncidentUpdates, subscribeNewIncidents } from '@criticom/api';
import { getBrowserSupabase } from '@/lib/supabase-browser';

/**
 * Keeps an incident page (or a list of incidents) live. When a crew presses
 * En Route, On Scene or Transporting on the phone, files a report, or adds a
 * note or photo, the server component re-renders with the new state — the
 * desk never has to reload to see where a crew is.
 *
 * With `incidentId`, only that incident's changes count; without it, any
 * incident's (lists and department dashboards).
 */
export function IncidentLive({ incidentId }: { incidentId?: string }) {
  const router = useRouter();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(() => router.refresh(), 400);
    };
    const offs: Array<() => void> = [];
    try {
      const sb = getBrowserSupabase();
      offs.push(subscribeIncidentUpdates(sb, 'all', (incident) => {
        if (!incidentId || incident.id === incidentId) refresh();
      }));
      if (incidentId) offs.push(subscribeIncidentTimeline(sb, incidentId, refresh));
      else offs.push(subscribeNewIncidents(sb, 'all', refresh));
    } catch {
      /* no realtime config — the minute tick still refreshes */
    }
    const tick = setInterval(() => router.refresh(), 60_000);
    return () => {
      for (const off of offs) off();
      clearInterval(tick);
      if (pending.current) clearTimeout(pending.current);
    };
  }, [router, incidentId]);

  return null;
}
