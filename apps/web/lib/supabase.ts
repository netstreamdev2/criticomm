import 'server-only';
import { cookies } from 'next/headers';
import { createWebServerClient, createServiceRoleClient } from '@criticom/db/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * True when the public Supabase env reached this build.
 * NEXT_PUBLIC_* are inlined at build time, so a missing value means the vars
 * weren't set in the hosting provider when the app was built.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/** Server component / server action client — honours user session via cookies. */
export async function getServerSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and/or ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY were missing when this app was built. ' +
      'Set them in your hosting environment and redeploy.',
    );
  }
  const cookieStore = await cookies();
  return createWebServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    getAll: () => cookieStore.getAll(),
    setAll: (toSet) => {
      for (const { name, value, options } of toSet) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // setAll throws in server components — middleware refreshes the session anyway.
        }
      }
    },
  });
}

/** Service-role client. NEVER call from a client component / browser bundle. */
export function getServiceSupabase() {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createServiceRoleClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}
