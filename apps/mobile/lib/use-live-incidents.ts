import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listFieldIncidents, subscribeIncidentUpdates, subscribeNewIncidents, type FieldIncident,
} from '@criticom/api';
import type { IncidentStatus } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';

/** How long a newly dispatched incident is highlighted on the map. */
const FRESH_MS = 90_000;

/**
 * Every live incident this officer can see from the field, kept current by
 * Supabase Realtime: an incident dispatched, assigned or changed anywhere
 * reloads the list within a moment. Incidents that appear after the first
 * load are reported as `fresh` for a while, so the map can drop them in.
 */
export function useLiveIncidents() {
  const { session, silo } = useAuth();
  const { pending } = useSync();
  const [incidents, setIncidents] = useState<FieldIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Map<string, number>>(new Map());
  const known = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const rows = await listFieldIncidents(getSupabase(), silo, session.user.id);
      const seen = known.current;
      if (seen) {
        const arrived = rows.filter((r) => !seen.has(r.id)).map((r) => r.id);
        if (arrived.length) {
          setFresh((cur) => {
            const next = new Map(cur);
            for (const id of arrived) next.set(id, Date.now());
            return next;
          });
        }
      }
      known.current = new Set([...(seen ?? []), ...rows.map((r) => r.id)]);
      setIncidents(rows);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session, silo]);

  // One reload for a burst of changes.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    void load();
    const soon = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => { timer.current = null; void load(); }, 300);
    };
    const sb = getSupabase();
    const offNew = subscribeNewIncidents(sb, 'all', soon);
    const offUpd = subscribeIncidentUpdates(sb, 'all', soon);
    return () => {
      offNew();
      offUpd();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  // Let the highlight lapse.
  useEffect(() => {
    if (fresh.size === 0) return;
    const t = setInterval(() => {
      setFresh((cur) => {
        const now = Date.now();
        const next = new Map([...cur].filter(([, at]) => now - at < FRESH_MS));
        return next.size === cur.size ? cur : next;
      });
    }, 5_000);
    return () => clearInterval(t);
  }, [fresh.size]);

  /** Statuses set on this phone that have not reached the server yet. */
  const queued = useMemo(() => {
    const map = new Map<string, IncidentStatus>();
    for (const e of pending) {
      if (e.op.kind === 'incident_status') map.set(e.op.incidentId, e.op.status as IncidentStatus);
    }
    return map;
  }, [pending]);

  const freshIds = useMemo(() => new Set(fresh.keys()), [fresh]);

  return { incidents, loading, error, refresh: load, queued, freshIds };
}
