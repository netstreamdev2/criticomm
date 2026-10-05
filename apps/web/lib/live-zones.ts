'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listLiveMapZones, subscribeMapZones, type LiveMapZone } from '@criticom/api';
import { getBrowserSupabase } from '@/lib/supabase-browser';

/** A zone's end time passing is not an event, so look again every minute. */
const EXPIRY_TICK_MS = 60_000;
const BURST_MS = 250;

/**
 * The perimeters and zones this person may see, kept live: one set, changed
 * or stood down anywhere shows here at once. `unavailable` explains an empty
 * list that is not really empty (the migration has not been run).
 */
export function useLiveZones() {
  const [zones, setZones] = useState<LiveMapZone[]>([]);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  /** False until the first answer arrives, so an empty list is not mistaken for "none". */
  const [loaded, setLoaded] = useState(false);
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    let sb: ReturnType<typeof getBrowserSupabase>;
    try {
      sb = getBrowserSupabase();
    } catch {
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        listLiveMapZones(sb)
          .then((rows) => {
            if (!alive) return;
            setZones(rows);
            setUnavailable(null);
            setLoaded(true);
          })
          .catch((e: { code?: string; message?: string }) => {
            if (!alive) return;
            const missing = e?.code === 'PGRST205' || e?.code === '42P01' || /map_zones/.test(e?.message ?? '');
            setUnavailable(missing
              ? 'Perimeters are not set up yet — run migration 0053_map_zones.sql.'
              : 'Perimeters could not be loaded.');
          });
      }, BURST_MS);
    };
    loadRef.current = load;
    load();
    const off = subscribeMapZones(sb, load);
    const tick = setInterval(load, EXPIRY_TICK_MS);
    return () => {
      alive = false;
      loadRef.current = () => {};
      off();
      clearInterval(tick);
      if (timer) clearTimeout(timer);
    };
  }, []);

  /** Look again now — after this console saves or stands one down. */
  const reload = useCallback(() => loadRef.current(), []);

  return { zones, loaded, unavailable, reload };
}
