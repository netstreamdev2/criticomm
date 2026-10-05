import { useCallback } from 'react';
import { cleanupOnLogout } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useNotifications } from '@/lib/notifications';

/**
 * Signing out, the same way from every screen: drop the push registration
 * first (after signOut the session can no longer satisfy the RLS check on
 * push_tokens, and a row left behind sends this person's calls to whoever
 * carries the handset next), then free the vehicle and clear duty (V4
 * AuthController.Logout), then end the session.
 */
export function useSignOut() {
  const { releasePushToken } = useNotifications();
  return useCallback(async () => {
    const sb = getSupabase();
    await releasePushToken().catch(() => {});
    await cleanupOnLogout(sb).catch(() => {});
    await sb.auth.signOut();
  }, [releasePushToken]);
}
