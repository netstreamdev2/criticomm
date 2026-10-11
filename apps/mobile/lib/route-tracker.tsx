import { useEffect } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useAuth } from '@/lib/auth';
import { useDuty } from '@/lib/duty';
import { refreshRouteStatus, sendRoute, startRoute, stopRoute } from '@/lib/tracker';

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
