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
 * Client acting as the holder of a Supabase access token.
 *
 * For callers that authenticate with an `Authorization: Bearer` header instead
 * of cookies — the mobile app hitting a web API route, and any future
 * machine-to-machine integration. RLS applies exactly as it would for that user
 * in a browser: the token is the identity, and nothing here elevates it.
 *
 * Distinct from the service-role client, which bypasses RLS entirely. If you
 * are reaching for that to serve a user request, this is what you actually
 * want.
 */
export function createBearerClient(
  url: string,
  anonKey: string,
  accessToken: string,
): CriticomClient {
  return createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    // There is no session to persist or refresh: the caller owns the token's
    // lifecycle and sends a fresh one per request.
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
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
