import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useAuth } from '@/lib/auth';
import { useDuty } from '@/lib/duty';
import { recordFixes, refreshRouteStatus, sendRoute, startRoute, stopRoute } from '@/lib/tracker';
import { armWatchdog, askBatteryAtShiftStart, initRadioButtons, keepHardHatAwake, keepJsRunning, onDutyFix, onDutyTick, watchdogBeat } from '@/lib/radio-keys';
import { HEARTBEAT_MS, presenceSignedIn, reportPresence } from '@/lib/presence';
import { cameraStandby, checkCamera } from '@/lib/radio-camera';
import { checkTalk, startTalkWatch, stopTalkWatch } from '@/lib/radio-talk';
import { startHatPairing } from '@/lib/hat-pairing';
import { deptChannel } from '@criticom/api';
import { useFeature } from '@/lib/features';

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
  const { session, silo } = useAuth();
  const talkAlwaysOn = useFeature('mobile.talkAlwaysOn');
  const { onDuty } = useDuty();
  const userId = session?.user.id ?? null;

  // The taught buttons, and a radio set to open when switched on (modules/radio-keys).
  useEffect(() => { void initRadioButtons(); }, []);

  // A hard hat signed in: its buttons can pair it to an officer's radio (0105).
  useEffect(() => (userId ? startHatPairing() : undefined), [userId]);

  // On duty on a hard hat: the screen stays on (its maker freezes apps once it is off on battery).
  useEffect(() => {
    if (onDuty === null) return;
    const on = Boolean(userId) && onDuty;
    keepHardHatAwake(on);
    // Timers keep running with the screen off (camera, Talk), radios and hard hats.
    keepJsRunning(on);
    if (!on) return;
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') keepHardHatAwake(true); });
    return () => app.remove();
  }, [userId, onDuty]);

  // On duty on a radio or hard hat: the watchdog keeps the app on the air.
  // Off duty the app is quiet by design, so the watchdog is off too.
  useEffect(() => {
    if (onDuty === null) return;
    armWatchdog(Boolean(userId) && onDuty);
    if (userId && onDuty) watchdogBeat();
  }, [userId, onDuty]);

  // On duty: battery saving must not stop the route, the camera and Talk.
  useEffect(() => {
    if (userId && onDuty && AppState.currentState === 'active') void askBatteryAtShiftStart();
  }, [userId, onDuty]);

  useEffect(() => {
    if (!userId) return;
    presenceSignedIn();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void reportPresence();
      timer = setInterval(() => { watchdogBeat(); void reportPresence(); }, HEARTBEAT_MS);
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
      // Alive: the watchdog waits again (it opens the app when these stop).
      watchdogBeat();
      void reportPresence({ minGapMs: 30_000 });
      void checkCamera();
      void checkTalk();
    });
    const offFix = onDutyFix((f) => {
      void recordFixes([{
        timestamp: f.time,
        coords: {
          latitude: f.lat, longitude: f.lng, accuracy: f.accuracy ?? null, speed: f.speed ?? null, heading: f.heading ?? null,
          altitude: null, altitudeAccuracy: null,
        },
        mocked: f.mocked === true,
      }]);
    });
    return () => {
      offTick();
      offFix();
    };
  }, [userId]);

  // The radio's camera for the control room (0091): its standby starts on
  // duty with the app on screen; the check runs every few seconds while open
  // (with the screen off, the route recorder runs it). Before Android 12 (the
  // H1 hard hat) it may also start with the screen off, so an app restarted
  // in the background (an update, a crash) comes back by itself: a hard hat
  // has no one to open it.
  useEffect(() => {
    if (!userId || onDuty === null) return;
    const mayStartUnseen = Platform.OS === 'android' && Number(Platform.Version) < 31;
    const standby = () => { if (AppState.currentState === 'active' || mayStartUnseen) void cameraStandby(onDuty); };
    standby();
    if (!onDuty) return;
    // The console's calls (0095): heard with the screen off, no Talk screen needed.
    startTalkWatch(deptChannel(silo), { alwaysOn: talkAlwaysOn });
    const timer = setInterval(() => { void checkCamera(); }, 8_000);
    void checkCamera();
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') { standby(); void checkCamera(); } });
    return () => {
      clearInterval(timer);
      app.remove();
      void stopTalkWatch();
    };
  }, [userId, onDuty, silo, talkAlwaysOn]);

  return null;
}
