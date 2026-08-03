import 'server-only';
import { cookies } from 'next/headers';
import { createWebServerClient, createServiceRoleClient, createBearerClient } from '@criticom/db/server';

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
  // Read cookies FIRST: this opts the route into dynamic rendering. Throwing
  // before this would run during static prerendering and fail the build on a
  // deployment that has no env, instead of surfacing at request time.
  const cookieStore = await cookies();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and/or ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY were missing when this app was built. ' +
      'Set them in your hosting environment and redeploy.',
    );
  }
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

/**
 * Session client for an API route, accepting either authentication scheme.
 *
 * Browsers send the Supabase session in cookies. The responder app has no
 * cookie jar, so it sends `Authorization: Bearer <access_token>` instead.
 * Both end up as the same RLS-scoped client, so route handlers do not have to
 * care which surface called them.
 *
 * The bearer path is checked first only because a request carrying one is
 * unambiguously an API client. An invalid token simply produces a client whose
 * `getUser()` returns null, which every caller already treats as unauthorised.
 */
export async function getRequestSupabase(req: Request) {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (token && SUPABASE_URL && SUPABASE_ANON_KEY) {
    return createBearerClient(SUPABASE_URL, SUPABASE_ANON_KEY, token);
  }
  return getServerSupabase();
}

/** Service-role client. NEVER call from a client component / browser bundle. */
export function getServiceSupabase() {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createServiceRoleClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}
