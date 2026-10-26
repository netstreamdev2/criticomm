import Constants from 'expo-constants';
import { tNow } from './translator';
import { getSupabase } from '@/lib/supabase';

/**
 * Calls into the Criticom web API from the phone.
 *
 * A few capabilities live behind server routes rather than in the database:
 * anything needing a provider key (the assistant, geocoding, the external
 * feeds) must never hold that key in an app bundle, where it can be extracted
 * from any installed copy.
 *
 * The app has no cookie jar, so it authenticates with the Supabase access token
 * as a bearer. Server-side that resolves to the same RLS-scoped client a
 * browser session would produce (`getRequestSupabase`), so the phone can never
 * see more than the same person sees in the console.
 */

const HOST = (process.env.EXPO_PUBLIC_APP_URL
  ?? (Constants.expoConfig?.extra as { appUrl?: string } | undefined)?.appUrl
  ?? '').replace(/\/$/, '');

export const isApiHostConfigured = Boolean(HOST);

export class ApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiUnavailableError';
  }
}

/** A page on the web console (the POPIA notice, say); null when this build has no web address. */
export function webUrl(path: string): string | null {
  return HOST ? `${HOST}${path}` : null;
}

/**
 * Calls a route that needs no account: activating one with a printed code.
 * Only what the person typed travels, over HTTPS; the server applies the same
 * checks, attempt limits and lockout as the web page.
 */
export async function callPublicApi<T>(path: string, body: unknown): Promise<T> {
  if (!HOST) {
    throw new ApiUnavailableError(
      tNow('This build has no web address configured, so accounts cannot be activated in the app. Use the link on the HikTech website, or ask an administrator to set EXPO_PUBLIC_APP_URL.'),
    );
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20_000);
  try {
    const res = await fetch(`${HOST}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null) as { error?: string; message?: string } | null;
      throw new Error(detail?.message ?? detail?.error ?? `Request failed (${res.status})`);
    }
    return await res.json() as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(tNow('The server took too long to answer. Check your connection and try again.'));
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** A signed-in read from the web API (weather, say); the same bearer rules as callApi. */
export async function getApi<T>(path: string): Promise<T> {
  if (!HOST) throw new ApiUnavailableError(tNow('This build has no web address configured.'));
  const { data: { session } } = await getSupabase().auth.getSession();
  if (!session) throw new ApiUnavailableError(tNow('Your session has expired — sign in again.'));
  const res = await fetch(`${HOST}${path}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!res.ok) {
    const detail = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(detail?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function callApi<T>(path: string, body: unknown): Promise<T> {
  if (!HOST) {
    throw new ApiUnavailableError(
      tNow('This build has no web address configured, so features that run on the server are unavailable. An administrator needs to set EXPO_PUBLIC_APP_URL.'),
    );
  }

  const { data: { session } } = await getSupabase().auth.getSession();
  if (!session) throw new ApiUnavailableError(tNow('Your session has expired — sign in again.'));

  // A server that never answers (wrong address, no route to it) must not
  // leave the screen spinning for ever.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20_000);
  try {
    const res = await fetch(`${HOST}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
      signal: abort.signal,
    });

    if (!res.ok) {
      // Surface the server's own message where it sent one — it is usually more
      // actionable ("not configured on this deployment") than a status code.
      const detail = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(detail?.error ?? `Request failed (${res.status})`);
    }

    return await res.json() as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(tNow('The server took too long to answer. Check your connection and try again.'));
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
