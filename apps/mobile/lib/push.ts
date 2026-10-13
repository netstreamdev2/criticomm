import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * OS push notifications for the responder app.
 *
 * Push is the *secondary* alert channel. The primary one is the Supabase
 * realtime subscription in `lib/notifications.tsx`, which delivers everything
 * while the app is open — the state a crew on shift is normally in. Push exists
 * for the phone locked in a cab holster, which is exactly when a dispatch must
 * still land.
 *
 * Everything in this module is defensive. `expo-notifications` needs a native
 * module, and on Android remote push additionally needs a Firebase (FCM)
 * registration — see `app.config.ts`, which refuses to produce an Android build
 * without `google-services.json` rather than shipping one that cannot register.
 * But the app also runs in contexts where none of that is true (Expo Go, a web
 * preview, a development client built before this module existed). In those,
 * every function here degrades to a no-op and the realtime channel carries the
 * load. An alerting subsystem must never be the reason a responder cannot open
 * the app.
 */

/** Loaded lazily so a missing/broken native module cannot throw at import time. */
type NotificationsModule = typeof import('expo-notifications');

let cached: NotificationsModule | null | undefined;

function load(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-notifications') as NotificationsModule;
  } catch {
    cached = null;
  }
  return cached;
}

/** True when the native module is present and remote push can plausibly work. */
export function isPushSupported(): boolean {
  if (Platform.OS === 'web') return false;
  return load() !== null;
}

/* ── Android channels ───────────────────────────────────────────────── */

/**
 * Android routes every notification through a channel, and the channel — not
 * the message — owns importance, sound and whether it may interrupt Do Not
 * Disturb. A dispatch has to be able to break through a silenced phone; a
 * routine broadcast must not. So we register two, and the server picks the
 * channel per message (`channelId` in `/api/push/notify`).
 *
 * Importance is fixed at channel creation on Android 8+: changing these values
 * later will not affect a phone that already has the channel. Renaming the
 * channel id is the only way to re-prompt, which is why the ids are explicit
 * and stable.
 */
export const PUSH_CHANNELS = {
  dispatch: 'dispatch',
  alerts: 'alerts',
} as const;

/**
 * The buttons under an incident notification: Open, Navigate and Acknowledge,
 * the same three as the alert on screen. Push messages from the server and
 * local notifications both carry this category.
 */
export const INCIDENT_CATEGORY = 'incident';

async function ensureCategories(N: NotificationsModule): Promise<void> {
  try {
    await N.setNotificationCategoryAsync(INCIDENT_CATEGORY, [
      { identifier: 'open', buttonTitle: 'Open', options: { opensAppToForeground: true } },
      { identifier: 'navigate', buttonTitle: 'Navigate', options: { opensAppToForeground: true } },
      { identifier: 'acknowledge', buttonTitle: 'Acknowledge', options: { opensAppToForeground: false } },
    ]);
  } catch (e) {
    console.warn('[criticom] notification buttons unavailable', e);
  }
}

async function ensureChannels(N: NotificationsModule): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await N.setNotificationChannelAsync(PUSH_CHANNELS.dispatch, {
      name: 'Dispatch assignments',
      importance: N.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 400, 200, 400],
      lightColor: '#dc3545',
      bypassDnd: true,
      lockscreenVisibility: N.AndroidNotificationVisibility.PUBLIC,
      enableVibrate: true,
    });
    await N.setNotificationChannelAsync(PUSH_CHANNELS.alerts, {
      name: 'Operational alerts',
      importance: N.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 200],
      lightColor: '#3b82f6',
      lockscreenVisibility: N.AndroidNotificationVisibility.PRIVATE,
    });
  } catch (e) {
    console.warn('[criticom] notification channels unavailable', e);
  }
}

/* ── Foreground presentation ────────────────────────────────────────── */

let handlerSet = false;

/**
 * By default a notification that arrives while the app is foregrounded is
 * swallowed — the assumption being that the app is already showing it. That
 * assumption breaks here: a responder can be filling in a PCR when a Critical
 * call lands, and the realtime banner is easy to miss with a keyboard up. We
 * show it anyway, and let the alert layer dedupe by id.
 */
export function installForegroundHandler(): void {
  if (handlerSet) return;
  const N = load();
  if (!N) return;
  try {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    handlerSet = true;
  } catch (e) {
    console.warn('[criticom] notification handler unavailable', e);
  }
}

/* ── Registration ───────────────────────────────────────────────────── */

export type PushRegistration = {
  token: string | null;
  /** Why there is no token, for the diagnostics row on the profile screen. */
  reason?: 'unsupported' | 'denied' | 'simulator' | 'error';
};

function projectId(): string | undefined {
  const cfg = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return cfg?.eas?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
}

/**
 * Ask for permission and mint this device's Expo push token.
 *
 * Returns a null token rather than throwing for every failure mode, because
 * every failure mode here is survivable: the crew still gets realtime alerts.
 * The `reason` is surfaced on the profile screen so a supervisor can tell
 * "this phone will not ring" apart from "this phone is fine".
 */
export async function registerForPush(): Promise<PushRegistration> {
  const N = load();
  if (!N) return { token: null, reason: 'unsupported' };

  try {
    await ensureChannels(N);
    await ensureCategories(N);
    installForegroundHandler();

    const existing = await N.getPermissionsAsync();
    let granted = existing.granted
      || existing.ios?.status === N.IosAuthorizationStatus.PROVISIONAL;

    if (!granted && existing.canAskAgain !== false) {
      const asked = await N.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
          // Critical calls should be able to pierce a silenced phone. iOS only
          // honours this with an Apple-granted entitlement; asking without one
          // is harmless and simply falls back to a normal alert.
          allowCriticalAlerts: true,
        },
      });
      granted = asked.granted
        || asked.ios?.status === N.IosAuthorizationStatus.PROVISIONAL;
    }

    if (!granted) return { token: null, reason: 'denied' };

    const id = projectId();
    const res = await N.getExpoPushTokenAsync(id ? { projectId: id } : undefined);
    return { token: res.data ?? null };
  } catch (e) {
    // Simulators and emulators without Play Services cannot mint a token. That
    // is expected during development and is not worth a scary message.
    const msg = e instanceof Error ? e.message : String(e);
    const simulator = /simulator|emulator|must be a physical device/i.test(msg);
    if (!simulator) console.warn('[criticom] push registration failed', e);
    return { token: null, reason: simulator ? 'simulator' : 'error' };
  }
}

/* ── Tap routing ────────────────────────────────────────────────────── */

export type PushPayload = {
  incidentId?: string;
  alertId?: string;
  severity?: string;
  /** Which button was tapped; undefined for the notification itself. */
  action?: 'open' | 'navigate' | 'acknowledge';
  /** A screen to open instead of a call: 'schedule' for shifts, leave and swaps (0072). */
  screen?: 'schedule';
  kind?: string;
};

function payloadOf(data: unknown, actionIdentifier?: string): PushPayload {
  const d = (data ?? {}) as Record<string, unknown>;
  const action = actionIdentifier === 'open' || actionIdentifier === 'navigate' || actionIdentifier === 'acknowledge'
    ? actionIdentifier : undefined;
  return {
    incidentId: typeof d.incidentId === 'string' ? d.incidentId : undefined,
    alertId: typeof d.alertId === 'string' ? d.alertId : undefined,
    severity: typeof d.severity === 'string' ? d.severity : undefined,
    action,
    screen: d.screen === 'schedule' ? 'schedule' : undefined,
    kind: typeof d.kind === 'string' ? d.kind : undefined,
  };
}

/**
 * Subscribe to notification taps. Also replays the notification that *launched*
 * the app from cold, which the live listener never sees — without that, tapping
 * a dispatch on a locked phone opens the app on the incident list instead of
 * the call, which is the one moment the crew has no time to go looking.
 */
export function onNotificationTap(handler: (payload: PushPayload) => void): () => void {
  const N = load();
  if (!N) return () => {};

  let disposed = false;
  let sub: { remove: () => void } | undefined;

  try {
    sub = N.addNotificationResponseReceivedListener((response) => {
      handler(payloadOf(response.notification.request.content.data, response.actionIdentifier));
    });

    void N.getLastNotificationResponseAsync()
      .then((response) => {
        if (disposed || !response) return;
        handler(payloadOf(response.notification.request.content.data, response.actionIdentifier));
      })
      .catch(() => { /* cold-start replay is best effort */ });
  } catch (e) {
    console.warn('[criticom] notification listener unavailable', e);
  }

  return () => {
    disposed = true;
    try { sub?.remove(); } catch { /* already gone */ }
  };
}

/* ── Local notifications ────────────────────────────────────────────── */

/**
 * Raise a notification from the device itself. Used when a realtime alert
 * arrives while the app is backgrounded but the socket is still up — the push
 * may be seconds behind, or absent entirely on a build without FCM, and a
 * dispatch that only exists inside a backgrounded app has not been delivered.
 */
export async function presentLocal(args: {
  title: string;
  body?: string;
  channel?: keyof typeof PUSH_CHANNELS;
  data?: PushPayload;
}): Promise<void> {
  const N = load();
  if (!N) return;
  try {
    await N.scheduleNotificationAsync({
      content: {
        title: args.title,
        body: args.body ?? '',
        sound: 'default',
        priority: N.AndroidNotificationPriority.MAX,
        data: (args.data ?? {}) as Record<string, unknown>,
        // An incident notification carries the Open / Navigate / Acknowledge buttons.
        ...(args.data?.incidentId ? { categoryIdentifier: INCIDENT_CATEGORY } : {}),
      },
      trigger: null,
    });
  } catch {
    // A missed local notification is not worth a log line on every alert.
  }
}

/* ── Scheduled (on the phone) ───────────────────────────────────────── */

/** Notifications this app has scheduled whose identifier starts with `prefix`. */
export async function scheduledIds(prefix: string): Promise<string[]> {
  const N = load();
  if (!N) return [];
  try {
    const all = await N.getAllScheduledNotificationsAsync();
    return all.map((r) => r.identifier).filter((id) => id.startsWith(prefix));
  } catch {
    return [];
  }
}

export async function cancelScheduled(ids: readonly string[]): Promise<void> {
  const N = load();
  if (!N) return;
  for (const id of ids) {
    try { await N.cancelScheduledNotificationAsync(id); } catch { /* already fired or gone */ }
  }
}

/**
 * A notification the phone shows by itself at a time — with no signal, the
 * screen locked, the app closed. Used for shift reminders.
 */
export async function scheduleAt(args: {
  identifier: string;
  at: number;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const N = load();
  if (!N || args.at <= Date.now()) return;
  try {
    await ensureChannels(N);
    await N.scheduleNotificationAsync({
      identifier: args.identifier,
      content: { title: args.title, body: args.body, sound: 'default', data: args.data ?? {} },
      trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: new Date(args.at), channelId: PUSH_CHANNELS.alerts },
    });
  } catch {
    // No permission, or the platform refused: the in-app schedule still shows it.
  }
}

/** Clear the app-icon badge — called when the alert inbox is opened. */
export async function clearBadge(): Promise<void> {
  const N = load();
  if (!N) return;
  try {
    await N.setBadgeCountAsync(0);
  } catch { /* not supported on this platform */ }
}
