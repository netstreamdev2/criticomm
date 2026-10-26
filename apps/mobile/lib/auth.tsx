import { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import type { Silo, UserRole } from '@criticom/db/types';
import { getSupabase, readSavedSession } from './supabase';
import { clearOfflineCache, setCacheOwner } from './offline-cache';

type AuthState = {
  session: Session | null;
  loading: boolean;
  silo: Silo;
  role: UserRole;
  fullName: string;
  /**
   * True while the app runs on the sign-in saved on the phone because there
   * was no signal to renew it. It is renewed the moment signal returns.
   */
  offline: boolean;
};

const AuthContext = createContext<AuthState>({
  session: null, loading: true, silo: 'Ethekwini', role: 'Viewer', fullName: '', offline: false,
});

/**
 * A hand-over (lib/pin-sign-in.ts) signs out but keeps the officer's saved
 * screens: they are filed under that officer (offline-cache.ts), so the next
 * person sees none of them, and they are there again if the officer takes
 * the device back up with no signal. Any other sign-out clears them.
 */
let keepCache = false;
export function keepCacheAtNextSignOut(keep = true) {
  keepCache = keep;
}

/** The provider's restore, so a sign-in put back by a PIN with no signal is taken up at once. */
let adopt: (() => Promise<void>) | null = null;
export async function adoptSavedSession(): Promise<void> {
  await adopt?.();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    // The cache owner is set with the session, before any screen reads: the
    // screens' first reads run before this provider's own effects would.
    const use = (s: Session | null, fromPhone: boolean) => {
      setCacheOwner(s?.user.id ?? null);
      setSession(s);
      setOffline(Boolean(s) && fromPhone);
    };

    try {
      const sb = getSupabase();

      /**
       * The sign-in lasts an hour and is renewed in the background. With no
       * signal at the moment it is due — the phone opened in a dead zone, or
       * after airplane mode — supabase-js keeps it on the phone but answers
       * "no session", which used to send the crew to the login screen. Then
       * the saved one is used, and renewed when signal returns. A sign-in
       * the server refused (account deactivated, signed out elsewhere) is
       * deleted by supabase-js and is not brought back.
       */
      const restore = async () => {
        try {
          const { data, error } = await sb.auth.getSession();
          if (cancelled) return;
          if (data.session) { use(data.session, false); return; }
          if (error && isAuthRetryableFetchError(error)) {
            const saved = await readSavedSession();
            if (!cancelled && saved) use(saved, true);
          }
        } catch {
          // Restoring can reject on a corrupt saved token; that is signed out.
        }
      };

      // Without the finally the crew could sit on "Restoring your session…"
      // forever, which is indistinguishable from a hang.
      void restore().finally(() => { if (!cancelled) setLoading(false); });
      adopt = restore;

      const { data: sub } = sb.auth.onAuthStateChange((event, s) => {
        if (cancelled) return;
        if (s) { use(s, false); return; }
        // Only a real sign-out ends the session. "No session" at start-up,
        // offline, is the saved sign-in waiting for signal (restore above).
        if (event === 'SIGNED_OUT') {
          use(null, false);
          // The next person on this handset sees nothing of this one's.
          if (keepCache) keepCache = false;
          else void clearOfflineCache();
        }
      });
      unsubscribe = () => sub.subscription.unsubscribe();
    } catch (e) {
      // Supabase could not be constructed at all (missing or malformed
      // config). Nothing will work, but the app must still render.
      console.warn('[criticom] auth unavailable', e);
      setLoading(false);
    }

    return () => {
      cancelled = true;
      adopt = null;
      unsubscribe?.();
    };
  }, []);

  // Running on the saved sign-in: renew it as soon as there is signal, or the
  // app comes back to the front. supabase-js also retries every half minute.
  useEffect(() => {
    if (!offline) return;
    const renew = () => {
      void getSupabase().auth.getSession().then(({ data }) => {
        if (data.session) {
          setCacheOwner(data.session.user.id);
          setSession(data.session);
          setOffline(false);
        }
      }).catch(() => {});
    };
    const offNet = NetInfo.addEventListener((state) => {
      if (state.isInternetReachable ?? state.isConnected) renew();
    });
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') renew(); });
    return () => {
      offNet();
      app.remove();
    };
  }, [offline]);

  const user = session?.user;
  const value: AuthState = {
    session,
    loading,
    silo: ((user?.app_metadata?.silo as Silo | undefined) ?? 'Ethekwini'),
    role: ((user?.app_metadata?.role as UserRole | undefined) ?? 'Viewer'),
    fullName: (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? '',
    offline,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
