import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  countOnDuty, getMyPersonnel, hasCompletedShiftStartToday, onDutyFlip, subscribePersonnel, toggleDuty,
} from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { bookThisDevice } from '@/lib/kit';

/**
 * Start-of-duty gate.
 *
 * A responder may not take incidents until they have completed today's
 * readiness flow — mental check, vehicle selection, vehicle inspection. That
 * is not a UI preference: the mental check is a fitness-for-duty declaration
 * (substance use, emotional regulation, reaction time) and the vehicle
 * inspection is a roadworthiness record. Letting someone answer a call before
 * either exists means there is no record that they were fit to attend, which
 * is exactly the record that matters after an incident goes wrong.
 *
 * `hasCompletedShiftStartToday()` is the authority — it resets daily, so the
 * flow is re-run at the start of every shift rather than once per install.
 *
 * Alongside it, live: whether this officer is on duty (and so receives
 * dispatches) and how many in their department are. Both follow the personnel
 * table in real time — toggled here, on the Shift tab, or by the server.
 *
 * Off duty the app is open: home, the roster, leave, the profile. Only the
 * duty screens (DUTY_ROUTES: calls, their reports, Talk, the map, fines) ask
 * for today's start of shift and being on duty first (`cleared`).
 */

export { DUTY_ROUTES, clearedForDuty, isDutyRoute } from './duty-policy.ts';
import { clearedForDuty } from './duty-policy.ts';

type DutyState = {
  /** null while we are still asking. */
  shiftStarted: boolean | null;
  checking: boolean;
  /** Re-ask the server. Call after finishing the flow. */
  refresh: () => Promise<boolean>;
  /** On duty right now — the flag dispatch reads. null until known. */
  onDuty: boolean | null;
  /** Officers on duty in this department right now. null until known. */
  teamOnDuty: number | null;
  /** May open the duty screens (clearedForDuty). */
  cleared: boolean;
  /** Back on duty, when today's start of shift is already done. True when cleared. */
  goOnDuty: () => Promise<boolean>;
};

const Ctx = createContext<DutyState>({
  shiftStarted: null, checking: true, refresh: async () => false, onDuty: null, teamOnDuty: null,
  cleared: false, goOnDuty: async () => false,
});

export function useDuty(): DutyState {
  return useContext(Ctx);
}

export function DutyProvider({ children }: { children: React.ReactNode }) {
  const { session, silo } = useAuth();
  const [shiftStarted, setShiftStarted] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);
  const [onDuty, setOnDuty] = useState<boolean | null>(null);
  const [teamOnDuty, setTeamOnDuty] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setShiftStarted(null);
      setChecking(false);
      return false;
    }
    setChecking(true);
    try {
      const cleared = await hasCompletedShiftStartToday(getSupabase());
      setShiftStarted(cleared);
      // A successful sign-on must update the dashboard even if the realtime
      // socket is reconnecting. Failed reads preserve the last known values.
      await Promise.all([
        getMyPersonnel(getSupabase(), session.user.id).then((me) => setOnDuty(Boolean(me?.is_on_duty))).catch(() => {}),
        countOnDuty(getSupabase(), silo).then(setTeamOnDuty).catch(() => {}),
      ]);
      return cleared;
    } catch {
      // The server is the authority for today's clearance. With no signal,
      // the answer it gave this person earlier today stands (the offline
      // cache answers only on the day it was saved); with none, it is locked.
      setShiftStarted(false);
      return false;
    } finally {
      setChecking(false);
    }
  }, [session, silo]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!session) { setOnDuty(null); setTeamOnDuty(null); return; }
    const sb = getSupabase();
    const userId = session.user.id;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      // Offline, the last known values stand.
      void getMyPersonnel(sb, userId).then((me) => setOnDuty(Boolean(me?.is_on_duty))).catch(() => {});
      void countOnDuty(sb, silo).then(setTeamOnDuty).catch(() => {});
    };
    read();
    // RLS limits the stream to this department's people; GPS heartbeats are
    // filtered out, only on/off duty flips re-read.
    const off = subscribePersonnel(sb, onDutyFlip(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(read, 250);
    }));
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [session, silo]);

  const goOnDuty = useCallback(async () => {
    await toggleDuty(getSupabase(), { onDuty: true });
    setOnDuty(true);
    return refresh();
  }, [refresh]);

  // On duty on a registered radio or smart hard hat: it is booked to them (0101).
  useEffect(() => {
    if (session && onDuty) void bookThisDevice(session.user.id).catch(() => null);
  }, [session, onDuty]);

  const cleared = clearedForDuty(shiftStarted, onDuty);

  return (
    <Ctx.Provider value={{ shiftStarted, checking, refresh, onDuty, teamOnDuty, cleared, goOnDuty }}>
      {children}
    </Ctx.Provider>
  );
}
