'use client';
import { useEffect, useState } from 'react';
import { listActiveIncidents, subscribeIncidentUpdates, subscribeNewIncidents } from '@criticom/api';
import type { Database, Silo } from '@criticom/db';
import { getBrowserSupabase } from '@/lib/supabase-browser';

type Incident = Database['public']['Tables']['incidents']['Row'];

/** A crew stepping through En Route → Arrived → On Scene is one reload, not three. */
const BURST_MS = 400;
/** Covers a socket that dropped without anyone noticing. */
const SAFETY_TICK_MS = 60_000;

/**
 * Open incidents, kept live without a page refresh. A new call or a status
 * change reloads the list through the same query the server used, so RLS and
 * the department scope (own calls plus calls routed in) apply unchanged.
 *
 * `initial` is the server-rendered list, so the first paint has real data.
 */
export function useLiveIncidents(initial: Incident[], silo?: Silo) {
  const [incidents, setIncidents] = useState(initial);

  useEffect(() => {
    let sb: ReturnType<typeof getBrowserSupabase>;
    try {
      sb = getBrowserSupabase();
    } catch {
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const reload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void listActiveIncidents(sb, silo)
          .then((rows) => { if (alive) setIncidents(rows); })
          .catch(() => {});
      }, BURST_MS);
    };

    // 'all', not the silo: a call another department owns but routed here is ours too.
    const offNew = subscribeNewIncidents(sb, 'all', reload);
    const offUpd = subscribeIncidentUpdates(sb, 'all', reload);
    const tick = setInterval(reload, SAFETY_TICK_MS);
    return () => {
      alive = false;
      offNew();
      offUpd();
      clearInterval(tick);
      if (timer) clearTimeout(timer);
    };
  }, [silo]);

  return incidents;
}
