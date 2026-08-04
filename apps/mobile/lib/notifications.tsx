import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { AppState, Platform, Vibration } from 'react-native';
import Constants from 'expo-constants';
import { registerPushToken, subscribeAlerts, unregisterPushToken, type Alert } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import {
  clearBadge, installForegroundHandler, isPushSupported, onNotificationTap,
  presentLocal, registerForPush, type PushPayload,
} from '@/lib/push';

/**
 * Alerts on the responder app — two channels, deliberately overlapping.
 *
 *   • **Supabase realtime** is the primary. It delivers every alert the moment
 *     it is written, with no round trip through a push service, for as long as
 *     the app is open. That is the state a crew on shift is normally in.
 *
 *   • **OS push** covers the phone whose screen is locked in a cab. It needs a
 *     native module and, on Android, an FCM registration; where either is
 *     missing this degrades to realtime-only rather than failing (see
 *     `lib/push.ts` and `app.config.ts`).
 *
 * The overlap is on purpose. Either channel alone has a blind spot, and a
 * missed dispatch is not a recoverable error. Duplicates are cheap by
 * comparison, and are deduped by alert id where they meet.
 *
 * Presentation follows the alert, not the channel: `presentation: 'modal'`
 * (High/Critical dispatch) becomes a full-screen interrupt that must be
 * acknowledged; everything else is a corner banner.
 */

export type Banner = {
  id: string;
  title: string;
  body?: string;
  severity: string;
  incidentId?: string | null;
};

export type PushStatus =
  | 'checking'
  | 'enabled'
  | 'denied'
  | 'unsupported'
  | 'simulator'
  | 'error';

type NotificationsApi = {
  /** Non-blocking in-app banner. */
  banner: (b: Omit<Banner, 'id'> & { id?: string }) => void;
  dismissBanner: (id: string) => void;
  banners: Banner[];
  /** Blocking assignment alerts, oldest first. */
  assignments: Alert[];
  clearAssignment: (id: string) => void;
  /** Whether this device will ring when the app is closed. */
  pushEnabled: boolean;
  /** Why not, when it will not — surfaced on the profile screen. */
  pushStatus: PushStatus;
  /**
   * Drop this device's push registration. Call *before* signing out, while the
   * session can still satisfy the RLS check on `push_tokens`; otherwise the row
   * survives and the next person to carry the phone gets the last one's calls.
   */
  releasePushToken: () => Promise<void>;
};

const Ctx = createContext<NotificationsApi | null>(null);

export function useNotifications(): NotificationsApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationsProvider>');
  return ctx;
}

const PUSH_STATUS_FROM_REASON: Record<string, PushStatus> = {
  denied: 'denied',
  unsupported: 'unsupported',
  simulator: 'simulator',
  error: 'error',
};

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { session, silo } = useAuth();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [assignments, setAssignments] = useState<Alert[]>([]);
  const [pushStatus, setPushStatus] = useState<PushStatus>(
    isPushSupported() ? 'checking' : 'unsupported',
  );
  const tokenRef = useRef<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismissBanner = useCallback((id: string) => {
    setBanners((cur) => cur.filter((b) => b.id !== id));
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
  }, []);

  const banner = useCallback((input: Omit<Banner, 'id'> & { id?: string }) => {
    const id = input.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setBanners((cur) => [...cur.filter((b) => b.id !== id), { ...input, id }].slice(-3));
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    timers.current.set(id, setTimeout(() => dismissBanner(id), 6000));
  }, [dismissBanner]);

  const clearAssignment = useCallback((id: string) => {
    setAssignments((cur) => cur.filter((a) => a.id !== id));
  }, []);

  /* ── Push registration ────────────────────────────────────────────── */

  useEffect(() => {
    if (!session) {
      setPushStatus(isPushSupported() ? 'checking' : 'unsupported');
      return;
    }
    let cancelled = false;

    installForegroundHandler();

    void (async () => {
      const { token, reason } = await registerForPush();
      if (cancelled) return;

      if (!token) {
        setPushStatus(PUSH_STATUS_FROM_REASON[reason ?? 'error'] ?? 'error');
        return;
      }

      tokenRef.current = token;
      try {
        await registerPushToken(getSupabase(), {
          token,
          platform: Platform.OS,
          // Named so a supervisor can tell which handset stopped reporting.
          deviceName: Constants.deviceName ?? undefined,
          silo,
        });
        if (!cancelled) setPushStatus('enabled');
      } catch (e) {
        // The token exists but we could not store it: this phone will not be
        // in the fanout. Realtime still works, so say so honestly rather than
        // claiming push is on.
        console.warn('[criticom] could not store push token', e);
        if (!cancelled) setPushStatus('error');
      }
    })();

    return () => { cancelled = true; };
  }, [session, silo]);

  const releasePushToken = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    tokenRef.current = null;
    try {
      await unregisterPushToken(getSupabase(), token);
    } catch {
      // Best effort. A stale token fails to deliver and Expo prunes it; that is
      // a far smaller problem than blocking a sign-out.
    }
  }, []);

  /* ── Live alert stream ────────────────────────────────────────────── */

  useEffect(() => {
    if (!session) return;
    let sb: ReturnType<typeof getSupabase>;
    try {
      sb = getSupabase();
    } catch {
      return;
    }

    const off = subscribeAlerts(sb, { silo }, (alert) => {
      if (alert.target_user_id && alert.target_user_id !== session.user.id) return;

      // Backgrounded but still connected: the socket delivered the alert to a
      // screen nobody is looking at. Raise it through the OS so it reaches the
      // responder, and let push dedupe against it if it arrives too.
      if (AppState.currentState !== 'active') {
        void presentLocal({
          title: alert.title,
          body: alert.body ?? undefined,
          channel: alert.presentation === 'modal' ? 'dispatch' : 'alerts',
          data: { alertId: alert.id, incidentId: alert.incident_id ?? undefined, severity: alert.severity },
        });
      }

      if (alert.presentation === 'modal') {
        setAssignments((cur) => (cur.some((a) => a.id === alert.id) ? cur : [...cur, alert]));
        Vibration.vibrate([0, 400, 200, 400]);
      } else {
        banner({
          id: alert.id,
          title: alert.title,
          body: alert.body ?? undefined,
          severity: alert.severity,
          incidentId: alert.incident_id,
        });
        Vibration.vibrate(120);
      }
    });

    return off;
  }, [session, silo, banner]);

  // Clear pending timers if we unmount mid-flight.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const api = useMemo<NotificationsApi>(
    () => ({
      banner,
      dismissBanner,
      banners,
      assignments,
      clearAssignment,
      pushEnabled: pushStatus === 'enabled',
      pushStatus,
      releasePushToken,
    }),
    [banner, dismissBanner, banners, assignments, clearAssignment, pushStatus, releasePushToken],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/**
 * Deep-link entry point for a notification tap.
 *
 * Covers the cold-start case too (see `onNotificationTap`): tapping a dispatch
 * on a locked phone has to land on the call, not the incident list.
 */
export function useNotificationRouting(onOpenIncident: (incidentId: string) => void) {
  useEffect(() => {
    const off = onNotificationTap((payload: PushPayload) => {
      void clearBadge();
      if (payload.incidentId) onOpenIncident(payload.incidentId);
    });
    return off;
  }, [onOpenIncident]);
}
