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
    const sb = getSupabase();
    void sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
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
