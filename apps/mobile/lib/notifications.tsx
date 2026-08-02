import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { registerPushToken, subscribeAlerts, type Alert } from '@criticom/api';
import type { Silo } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

/**
 * Notifications on the responder app come in two flavours and this module owns
 * both:
 *
 *   • In app  — a Supabase realtime subscription on `alerts`. Instant, no
 *               round trip through a push service. Non-urgent alerts become an
 *               in-app banner; High/Critical dispatch assignments become a
 *               full-screen interrupt (rendered by <AssignmentAlert/>).
 *   • Backgrounded / closed — Expo push, addressed to the token this device
 *               registers on sign-in. The server fans these out when a call is
 *               routed to the crew's department.
 *
 * Both paths carry the same payload shape so a crew sees the same thing either
 * way.
 */

// Alerts must break through even when the phone is on silent-ish settings —
// this is a dispatch app.
//
// Wrapped because this runs at module scope, before React mounts: if the
// native notifications module is unavailable (no FCM credentials on Android,
// a stripped build, an OS that refused the module) an unguarded throw here
// takes the whole app down at launch with no error anyone can read. Push is
// the secondary alert channel — the primary one is the Supabase realtime
// subscription below, which needs none of this. Losing push must never cost
// a responder the app.
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
} catch (e) {
  console.warn('[criticom] notification handler unavailable; push disabled', e);
}

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

/** Ask for permission, then hand the Expo token to the backend. */
async function registerForPush(silo: Silo): Promise<boolean> {
  if (!Device.isDevice) return false;   // simulators cannot receive push

  if (Platform.OS === 'android') {
    // A dedicated max-importance channel so dispatch alerts bypass the
    // default channel's quieter treatment.
    await Notifications.setNotificationChannelAsync('dispatch', {
      name: 'Dispatch alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 200, 400],
      lightColor: '#dc3545',
      sound: 'default',
      bypassDnd: true,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  if (status !== 'granted') return false;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;

  try {
    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    await registerPushToken(getSupabase(), {
      token: token.data,
      platform: Platform.OS,
      deviceName: Device.deviceName ?? undefined,
      silo,
    });
    return true;
  } catch {
    // No EAS project id yet (bare `expo start`), or the push service is
    // unreachable. Realtime still delivers everything while the app is open.
    return false;
  }
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { session, silo } = useAuth();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [assignments, setAssignments] = useState<Alert[]>([]);
  const [pushEnabled, setPushEnabled] = useState(false);
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

  // Register for push once signed in.
  useEffect(() => {
    if (!session) return;
    let live = true;
    void registerForPush(silo).then((ok) => { if (live) setPushEnabled(ok); });
    return () => { live = false; };
  }, [session, silo]);

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

      // Also raise an OS notification so it lands in the shade — a crew member
      // glancing away should still find it later.
      void Notifications.scheduleNotificationAsync({
        content: {
          title: alert.title,
          body: alert.body ?? '',
          data: { incidentId: alert.incident_id, alertId: alert.id },
          sound: 'default',
          ...(Platform.OS === 'android' ? { channelId: 'dispatch' } : {}),
        },
        trigger: null,
      }).catch(() => {});
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
 * Tap handling for OS notifications: opening one should land on the incident,
 * whether the app was backgrounded or cold-started.
 */
export function useNotificationRouting(onOpenIncident: (incidentId: string) => void) {
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const id = response.notification.request.content.data?.incidentId;
      if (typeof id === 'string') onOpenIncident(id);
    });

    // Cold start: the notification that launched the app.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const id = response?.notification.request.content.data?.incidentId;
      if (typeof id === 'string') onOpenIncident(id);
    });

    return () => sub.remove();
  }, [onOpenIncident]);
}
