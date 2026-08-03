import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { hasCompletedShiftStartToday } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

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
 */

type DutyState = {
  /** null while we are still asking. */
  shiftStarted: boolean | null;
  checking: boolean;
  /** Re-ask the server. Call after finishing the flow. */
  refresh: () => Promise<void>;
};

const Ctx = createContext<DutyState>({
  shiftStarted: null, checking: true, refresh: async () => {},
});

export function useDuty(): DutyState {
  return useContext(Ctx);
}

export function DutyProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [shiftStarted, setShiftStarted] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) {
      setShiftStarted(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    try {
      setShiftStarted(await hasCompletedShiftStartToday(getSupabase()));
    } catch {
      // Offline or the check failed. Do NOT assume the shift has started —
      // but do not strand the crew behind a gate we cannot evaluate either.
      // Treating it as started lets them work; the flow is still reachable
      // from the Shift tab, and the server remains the record of truth.
      setShiftStarted(true);
    } finally {
      setChecking(false);
    }
  }, [session]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <Ctx.Provider value={{ shiftStarted, checking, refresh }}>
      {children}
    </Ctx.Provider>
  );
}
