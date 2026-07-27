/**
 * Server-only Supabase client factories.
 * Never import this from a client/browser bundle — it accepts cookies + service-role keys.
 */

import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types.generated';
import type { CriticomClient } from './client';

/**
 * Server-side client for Next.js server components / actions / route handlers.
 * Pass cookie adapters from `next/headers`.
 */
export function createWebServerClient(
  url: string,
  anonKey: string,
  cookies: CookieMethodsServer,
): CriticomClient {
  return createServerClient<Database>(url, anonKey, { cookies });
}

/**
 * Service-role client — bypasses RLS. Use for: seed scripts, admin endpoints,
 * Edge Functions that genuinely need elevated privilege.
 * NEVER expose to a browser bundle.
 */
export function createServiceRoleClient(url: string, serviceRoleKey: string): CriticomClient {
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
