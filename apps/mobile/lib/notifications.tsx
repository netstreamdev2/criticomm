import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { Vibration } from 'react-native';
import { subscribeAlerts, type Alert } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

/**
 * Alerts on the responder app.
 *
 * NOTE — OS push is deliberately not built into this app right now.
 * expo-notifications registers Firebase messaging services in the Android
 * manifest, and without google-services.json that initialises before any JS
 * runs and takes the process down at launch. An app that will not start is a
 * far worse failure for a responder than one without background push.
 *
 * The primary channel is unaffected: a Supabase realtime subscription on
 * `alerts` delivers everything while the app is open, which is the state a
 * crew on shift is actually in. Re-enable push by adding an FCM
 * google-services.json and restoring expo-notifications.
 *
 * What remains here:
 *
 *   • A Supabase realtime subscription on `alerts`. Instant, no round trip
 *     through a push service. Non-urgent alerts become an in-app banner;
 *     High/Critical dispatch assignments become a full-screen interrupt
 *     (rendered by <AssignmentAlert/>).
 */

export type Banner = {
  id: string;
  title: string;
  body?: string;
  severity: string;
  incidentId?: string | null;
};

type NotificationsApi = {
  /** Non-blocking in-app banner. */
  banner: (b: Omit<Banner, 'id'> & { id?: string }) => void;
  dismissBanner: (id: string) => void;
  banners: Banner[];
  /** Blocking assignment alerts, oldest first. */
  assignments: Alert[];
  clearAssignment: (id: string) => void;
  /** Whether OS notification permission was granted. */
  pushEnabled: boolean;
};

const Ctx = createContext<NotificationsApi | null>(null);

export function useNotifications(): NotificationsApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationsProvider>');
  return ctx;
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { session, silo } = useAuth();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [assignments, setAssignments] = useState<Alert[]>([]);
  // Push is off on this build; realtime carries every alert while the app is open.
  const pushEnabled = false;
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

  // Live alert stream while the app is open.
  useEffect(() => {
    if (!session) return;
    let sb;
    try {
      sb = getSupabase();
    } catch {
      return;
    }

    const off = subscribeAlerts(sb, { silo }, (alert) => {
      if (alert.target_user_id && alert.target_user_id !== session.user.id) return;

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
    () => ({ banner, dismissBanner, banners, assignments, clearAssignment, pushEnabled }),
    [banner, dismissBanner, banners, assignments, clearAssignment, pushEnabled],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/**
 * Deep-link entry point for an alert tap.
 *
 * Currently inert: OS push is not wired on this build (see the note at the top
 * of this file). Kept as the single place routing will live once FCM exists,
 * so callers do not change when it comes back.
 */
export function useNotificationRouting(_onOpenIncident: (incidentId: string) => void) {
  // no-op
}
