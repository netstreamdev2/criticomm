import Constants from 'expo-constants';
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

export async function callApi<T>(path: string, body: unknown): Promise<T> {
  if (!HOST) {
    throw new ApiUnavailableError(
      'This build has no web address configured, so features that run on the server are '
      + 'unavailable. An administrator needs to set EXPO_PUBLIC_APP_URL.',
    );
  }

  const { data: { session } } = await getSupabase().auth.getSession();
  if (!session) throw new ApiUnavailableError('Your session has expired — sign in again.');

  const res = await fetch(`${HOST}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // Surface the server's own message where it sent one — it is usually more
    // actionable ("not configured on this deployment") than a status code.
    const detail = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(detail?.error ?? `Request failed (${res.status})`);
  }

  return res.json() as Promise<T>;
}
