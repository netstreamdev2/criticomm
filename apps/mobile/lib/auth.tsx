import { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Silo, UserRole } from '@criticom/db/types';
import { getSupabase } from './supabase';

type AuthState = {
  session: Session | null;
  loading: boolean;
  silo: Silo;
  role: UserRole;
  fullName: string;
};

const AuthContext = createContext<AuthState>({
  session: null, loading: true, silo: 'Ethekwini', role: 'Viewer', fullName: '',
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    try {
      const sb = getSupabase();

      // Restoring a session can reject — no signal on a cold start, a corrupt
      // token in AsyncStorage, the auth host unreachable. Without a catch,
      // setLoading(false) never runs and the crew sits on "Restoring your
      // session…" forever, which is indistinguishable from a hang. Failing
      // through to the login screen at least gives them somewhere to go.
      sb.auth.getSession()
        .then(({ data }) => {
          if (cancelled) return;
          setSession(data.session);
        })
        .catch(() => { /* treat as signed out */ })
        .finally(() => { if (!cancelled) setLoading(false); });

      const { data: sub } = sb.auth.onAuthStateChange((_event, s) => {
        if (!cancelled) setSession(s);
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
      unsubscribe?.();
    };
  }, []);

  const user = session?.user;
  const value: AuthState = {
    session,
    loading,
    silo: ((user?.app_metadata?.silo as Silo | undefined) ?? 'Ethekwini'),
    role: ((user?.app_metadata?.role as UserRole | undefined) ?? 'Viewer'),
    fullName: (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? '',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
