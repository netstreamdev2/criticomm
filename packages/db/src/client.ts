/**
 * Browser-safe Supabase client factory.
 * Used by:
 *   - Next.js client components (apps/web)
 *   - React Native (apps/mobile, with AsyncStorage adapter)
 */

import { createBrowserClient } from '@supabase/ssr';
import { createClient as createPlainClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types.generated';

export type CriticomClient = SupabaseClient<Database>;

/** Next.js browser client — uses cookie storage via @supabase/ssr. */
export function createWebBrowserClient(url: string, anonKey: string): CriticomClient {
  return createBrowserClient<Database>(url, anonKey);
}

/** Generic client (React Native, scripts). Caller supplies storage adapter. */
export function createGenericClient(
  url: string,
  anonKey: string,
  options?: Parameters<typeof createPlainClient>[2],
): CriticomClient {
  return createPlainClient<Database>(url, anonKey, options);
}
