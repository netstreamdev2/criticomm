import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { listAssignedToMe, listMyActiveIncidents, subscribeIncidentUpdates } from '@criticom/api';
import type { IncidentStatus } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/lib/sync';
import { rememberScenes } from '@/lib/arrival-watch';

export type OpenCall = {
  id: string;
  incident_number: string;
  /** My own status on it: the call's for the lead, my row's for backup. */
  status: IncidentStatus | null;
  /** Null while a Responding is still queued on this phone. */
  role: 'lead' | 'backup' | null;
  /** The call's department, for filing its photos; absent while only queued on this phone. */
  silo?: string;
  /** For display; absent while only queued on this phone. */
  incident_type?: string;
  incident_severity?: string;
  location_address?: string;
};

export type AwaitingCall = {
  id: string;
  incident_number: string;
  incident_type?: string;
  incident_severity?: string;
  location_address?: string;
};

/**
 * The calls this officer is responding to and that are not closed out —
 * lead or backup, as many as they hold (migration 0042).
 *
 * A Responding still waiting in the outbox counts too: the officer pressed it
 * in a dead zone and is driving there. Likewise a status queued on the phone
 * shows ahead of the server's, so the officer sees what they did.
 *
 * `openCall` is the call they LEAD (most recent first): a lead cannot go off
 * duty or sign out until its report is filed (0039); backup can.
 *
 * `awaiting` is what dispatch has assigned to them that they have not
 * responded to yet, newest first.
 */
export function useOpenCall() {
  const { session, silo } = useAuth();
  const { pending } = useSync();
  const [serverCalls, setServerCalls] = useState<OpenCall[]>([]);
  const [assigned, setAssigned] = useState<AwaitingCall[]>([]);
  const serverRef = useRef(serverCalls);
  serverRef.current = serverCalls;

  const calls = useMemo(() => {
    const byId = new Map(serverCalls.map((c) => [c.id, { ...c }]));
    for (const e of pending) {
      if (e.op.kind !== 'incident_status') continue;
      const known = byId.get(e.op.incidentId);
      if (known) known.status = e.op.status as IncidentStatus;
      else if (e.op.status === 'En Route') {
        byId.set(e.op.incidentId, {
          id: e.op.incidentId, incident_number: e.op.incidentNumber ?? 'an incident', status: 'En Route', role: null,
        });
      }
    }
    return [...byId.values()];
  }, [serverCalls, pending]);

  // Responding (even still queued on the phone) takes it off the waiting list.
  const awaiting = useMemo(
    () => assigned.filter((a) => !calls.some((c) => c.id === a.id)),
    [assigned, calls],
  );

  const callsRef = useRef(calls);
  callsRef.current = calls;

  const reportQueued = useMemo(() => {
    const ids = new Set<string>();
    for (const e of pending) {
      if (e.op.kind === 'incident_report' || e.op.kind === 'fire_report' || e.op.kind === 'pcr' || e.op.kind === 'post_mortem') ids.add(e.op.incidentId);
    }
    return ids;
  }, [pending]);

  /**
   * Ask the server now and return the call this officer leads, if any.
   * Offline, the last known answer stands — a dropped connection must not
   * unlock sign-out. A queued Responding counts as leading until known.
   */
  const refresh = useCallback(async (): Promise<OpenCall | null> => {
    if (!session) { setServerCalls([]); setAssigned([]); return null; }
    let current = serverRef.current;
    // Separate from the calls below: a failure here must not hide them.
    void listAssignedToMe(getSupabase(), session.user.id).then(setAssigned).catch(() => {});
    try {
      // As this officer's department sees each call (0073): its part finished, the call is no longer theirs.
      const rows = await listMyActiveIncidents(getSupabase(), session.user.id, silo);
      current = rows.map((r) => {
        const mine = r.responders.find((x) => x.user_id === session.user.id);
        const role = mine?.role ?? (r.accepted_by === session.user.id ? 'lead' : 'backup');
        return {
          id: r.id,
          incident_number: r.incident_number,
          status: role === 'lead' ? r.status : (mine?.status ?? null),
          role,
          silo: r.silo,
          incident_type: r.incident_type,
          incident_severity: r.incident_severity,
          location_address: r.location_address,
        };
      });
      setServerCalls(current);
      // The scenes they are driving to, for the phone to spot arrival with no signal.
      void rememberScenes(session.user.id, rows.flatMap((r) => {
        const mine = r.responders.find((x) => x.user_id === session.user.id);
        if (!mine || mine.status !== 'En Route' || mine.arrived_at || r.location_lat == null || r.location_lng == null) return [];
        return [{ incidentId: r.id, incidentNumber: r.incident_number, lat: r.location_lat, lng: r.location_lng, since: mine.joined_at ?? new Date().toISOString() }];
      }));
    } catch {
      // keep `current` as last known
    }
    const queuedOnly = callsRef.current.find((c) => c.role === null && !current.some((s) => s.id === c.id));
    return current.find((c) => c.role === 'lead') ?? queuedOnly ?? null;
  }, [session, silo]);

  useEffect(() => {
    void refresh();
    const off = subscribeIncidentUpdates(getSupabase(), 'all', () => void refresh());
    return off;
  }, [refresh]);

  return {
    calls,
    openCall: calls.find((c) => c.role === 'lead') ?? calls.find((c) => c.role === null) ?? null,
    /** Calls whose report is filed on this phone and waiting to send. */
    reportQueued,
    awaiting,
    refresh,
  };
}

// ── Which call's report screen is open ──────────────────────────────────────

let reportingFor: string | null = null;
const listeners = new Set<() => void>();

/** Called by the report screen as it opens and closes. */
export function setReportingFor(incidentId: string | null) {
  if (reportingFor === incidentId) return;
  reportingFor = incidentId;
  for (const l of listeners) l();
}

/** The incident whose report the officer is writing right now, if any. */
export function useReportingFor() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => reportingFor,
  );
}
