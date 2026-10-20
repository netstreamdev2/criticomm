import { useCallback } from 'react';
import { tNow } from './translator';
import { Alert } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { cleanupOnLogout } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useNotifications } from '@/lib/notifications';
import { sendRoute, stopRoute } from '@/lib/tracker';
import { reportSignedOut } from '@/lib/presence';

/**
 * Signing out, the same way from every screen: send the route still on the
 * phone and stop recording it, drop the push registration (after signOut the
 * session can no longer satisfy the RLS check on push_tokens, and a row left
 * behind sends this person's calls to whoever carries the handset next),
 * then free the vehicle and clear duty (V4 AuthController.Logout), then end
 * the session.
 *
 * Not with no signal: the vehicle and duty would stay held on the server,
 * and dispatch would keep sending calls to someone who has gone.
 */
export function useSignOut() {
  const { releasePushToken } = useNotifications();
  return useCallback(async () => {
    const net = await NetInfo.fetch().catch(() => null);
    if (net && (net.isConnected === false || net.isInternetReachable === false)) {
      Alert.alert(tNow('No connection'), tNow('Sign out when you have signal, so dispatch knows you are off duty.'));
      return;
    }
    const sb = getSupabase();
    await sendRoute({ force: true }).catch(() => {});
    await stopRoute().catch(() => {});
    await releasePushToken().catch(() => {});
    // The Radio Desk shows the radio signed out now, not after two quiet minutes.
    await reportSignedOut().catch(() => {});
    await cleanupOnLogout(sb).catch(() => {});
    await sb.auth.signOut();
  }, [releasePushToken]);
}
