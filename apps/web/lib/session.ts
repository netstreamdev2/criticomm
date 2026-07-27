import 'server-only';
import { redirect } from 'next/navigation';
import type { Silo, UserRole } from '@criticom/db';
import { getServerSupabase } from './supabase';

/** Session context every (app) page needs: client + identity claims. */
export async function getSession() {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return {
    supabase,
    user,
    userId: user.id,
    silo: ((user.app_metadata?.silo as Silo | undefined) ?? 'Ethekwini') as Silo,
    role: ((user.app_metadata?.role as UserRole | undefined) ?? 'Viewer') as UserRole,
    fullName: (user.user_metadata?.full_name as string | undefined) ?? user.email ?? 'User',
  };
}

/** For queries: global roles / Ethekwini see all silos → pass undefined filter. */
export function siloFilter(silo: Silo): Silo | undefined {
  return silo === 'Ethekwini' ? undefined : silo;
}
