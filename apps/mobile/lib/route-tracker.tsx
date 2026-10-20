import { useEffect } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useAuth } from '@/lib/auth';
import { useDuty } from '@/lib/duty';
import { recordFixes, refreshRouteStatus, sendRoute, startRoute, stopRoute } from '@/lib/tracker';
import { onDutyFix, onDutyTick } from '@/lib/radio-keys';
import { HEARTBEAT_MS, presenceSignedIn, reportPresence } from '@/lib/presence';
import { cameraStandby, checkCamera } from '@/lib/radio-camera';

/**
 * Records the officer's route while they are on duty, whichever screen is
 * open, and sends it whenever there is signal (lib/tracker.ts). Draws
 * nothing.
 *
 * Before this the position went out once a minute only while the Profile
 * tab had been opened, and with no signal only the newest fix was kept, so
 * dispatch never saw where a crew went while offline.
 */
export function RouteTracker() {
  const { session } = useAuth();
  const { onDuty } = useDuty();
  const userId = session?.user.id ?? null;
  const recording = Boolean(userId) && onDuty === true;

  useEffect(() => {
    if (!userId) { void stopRoute(); return; }
    // Unknown until the first read: leave it as it was.
    if (onDuty === null) return;
    if (onDuty) void startRoute(userId);
    else void stopRoute().then(() => sendRoute({ force: true }));
  }, [userId, onDuty]);

  useEffect(() => {
    if (!userId) return;
    void refreshRouteStatus(userId);
    void sendRoute({ force: true });
    const timer = setInterval(() => { void sendRoute(); }, 30_000);
    const offNet = NetInfo.addEventListener((state) => {
      if (state.isInternetReachable ?? state.isConnected) void sendRoute({ force: true });
    });
    // Android starts background recording only with the app open; coming back
    // to the front is the moment to retry if it could not start before.
    const app = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      void sendRoute({ force: true });
      if (recording) void startRoute(userId);
    });
    return () => {
      clearInterval(timer);
      offNet();
      app.remove();
    };
  }, [userId, recording]);

  return null;
}

/**
 * The radio's presence for the Radio Desk (lib/presence.ts): every 30
 * seconds while signed in with the app open, and at once when the app comes
 * to the front or duty starts or ends. Draws nothing.
 */
export function RadioPresence() {
  const { session } = useAuth();
  const { onDuty } = useDuty();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!userId) return;
    presenceSignedIn();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void reportPresence();
      timer = setInterval(() => { void reportPresence(); }, HEARTBEAT_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === 'active') start();
    const app = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    return () => {
      stop();
      app.remove();
    };
  }, [userId]);

  // On or off duty: the desk sees it now (and the position stops off duty).
  useEffect(() => {
    if (userId && onDuty !== null) void reportPresence();
  }, [userId, onDuty]);

  // The standby's wake-up (screen off, no position needed) and, without
  // Google services, its GPS: the same report, camera check and route as
  // everywhere else.
  useEffect(() => {
    if (!userId) return;
    const offTick = onDutyTick(() => {
      void reportPresence({ minGapMs: 30_000 });
      void checkCamera();
    });
    const offFix = onDutyFix((f) => {
      void recordFixes([{
        timestamp: f.time,
        coords: {
          latitude: f.lat, longitude: f.lng, accuracy: f.accuracy ?? null, speed: f.speed ?? null, heading: f.heading ?? null,
          altitude: null, altitudeAccuracy: null,
        },
      }]);
    });
    return () => {
      offTick();
      offFix();
    };
  }, [userId]);

  // The radio's camera for the control room (0091): its standby starts only
  // with the app on screen, on duty; the check runs every few seconds while
  // open (with the screen off, the route recorder runs it).
  useEffect(() => {
    if (!userId || onDuty === null) return;
    const standby = () => { if (AppState.currentState === 'active') void cameraStandby(onDuty); };
    standby();
    if (!onDuty) return;
    const timer = setInterval(() => { void checkCamera(); }, 8_000);
    void checkCamera();
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') { standby(); void checkCamera(); } });
    return () => {
      clearInterval(timer);
      app.remove();
    };
  }, [userId, onDuty]);

  return null;
}
