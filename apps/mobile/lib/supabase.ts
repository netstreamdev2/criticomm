import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { createGenericClient, type CriticomClient } from '@criticom/db/client';
import { createOfflineFetch } from './offline-cache';

/**
 * Supabase client for React Native — AsyncStorage-backed session,
 * config via EXPO_PUBLIC_* env or app.json extra.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;
const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl ?? '';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.supabaseAnonKey ?? '';

export const isSupabaseConfigured = Boolean(URL_ && KEY);

if (!isSupabaseConfigured) {
  console.warn('Supabase not configured — set EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY');
}

/**
 * supabase-js throws from createClient when the URL or key is blank. That
 * throw would propagate out of whichever screen happened to call getSupabase()
 * first — around twenty call sites, each of which would have to guard it
 * separately. Falling back to a syntactically valid but unreachable host keeps
 * construction total: requests then fail as ordinary network errors, which
 * every screen already renders through its existing error state.
 *
 * Misconfiguration should look like "cannot reach the server", not a crash.
 */
const SAFE_URL = URL_ || 'https://unconfigured.invalid';
const SAFE_KEY = KEY || 'unconfigured';

let client: CriticomClient | null = null;

/**
 * While a registered device is handed over (lib/pin-sign-in.ts): the sign-in
 * supabase-js removes is captured as it goes, and it is not ended at the
 * server, so the officer can take it back up with their PIN with no signal.
 */
let handingOver: { captured: string | null } | null = null;

const authStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: async (key: string) => {
    // Read as it is removed: whatever renewal ran last, this is the newest.
    if (handingOver && key === sessionStorageKey()) handingOver.captured = await AsyncStorage.getItem(key).catch(() => null);
    await AsyncStorage.removeItem(key);
  },
};

const urlOf = (input: RequestInfo | URL) => (typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);

/** The network, except that a hand-over's sign-out stays on the phone. */
const network: typeof fetch = (input, init) => {
  if (handingOver && urlOf(input).includes('/auth/v1/logout')) return Promise.resolve(new Response(null, { status: 204 }));
  return fetch(input, init);
};

export function getSupabase(): CriticomClient {
  if (!client) {
    client = createGenericClient(SAFE_URL, SAFE_KEY, {
      auth: {
        storage: authStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      // Reads are kept on the phone and answered from it with no signal
      // (lib/offline-cache.ts); writes go through the outbox.
      global: { fetch: createOfflineFetch(network, SAFE_KEY) },
    });
    keepUserOffline(client);
  }
  return client;
}

/**
 * Many reads first ask the sign-in server who is signed in (auth.getUser).
 * With no signal that question fails, and the read behind it never runs, so
 * the screen comes up empty even with its answer saved on the phone. Offline,
 * the saved sign-in's person answers instead. Only a failed connection does
 * this: a server that says the sign-in is gone is believed, and the database
 * still checks every read and write against the real sign-in.
 */
function keepUserOffline(sb: CriticomClient) {
  const auth = sb.auth as { getUser: CriticomClient['auth']['getUser'] };
  const getUser = sb.auth.getUser.bind(sb.auth);
  auth.getUser = async (jwt?: string) => {
    const result = await getUser(jwt);
    if (jwt || result.data.user || !isAuthRetryableFetchError(result.error)) return result;
    const saved = await readSavedSession();
    return saved ? { data: { user: saved.user }, error: null } : result;
  };
}

/** Where supabase-js keeps the sign-in on the phone (its default key for this project). */
function sessionStorageKey(): string {
  const set = (getSupabase() as unknown as { storageKey?: string }).storageKey;
  if (set) return set;
  try {
    return `sb-${new URL(SAFE_URL).hostname.split('.')[0]}-auth-token`;
  } catch {
    return 'sb-unconfigured-auth-token';
  }
}

/**
 * The sign-in saved on the phone, as it was last renewed, without trying to
 * renew it. supabase-js answers "signed out" when the sign-in is due for
 * renewal and there is no signal to renew it, although it keeps it saved;
 * this reads the saved one so a crew offline stays in the app, and it is
 * renewed the moment signal returns. A sign-in the server refused is deleted
 * by supabase-js, so this never brings back a revoked one.
 */
/**
 * Signs this device out without ending the sign-in at the server, and
 * returns the sign-in exactly as supabase-js kept it, to be set aside at a
 * hand-over. Everything else about signing out happens as usual (the
 * screens are told, the renewal stops). Needs signal if the sign-in is due
 * for renewal, as signing out does.
 */
export async function signOutKeepingSession(): Promise<string | null> {
  handingOver = { captured: null };
  try {
    const { error } = await getSupabase().auth.signOut({ scope: 'local' });
    if (error) throw error;
    return handingOver.captured;
  } finally {
    handingOver = null;
  }
}

/** Puts a sign-in set aside at hand-over back where supabase-js keeps it. */
export async function writeSavedSession(raw: string): Promise<void> {
  await AsyncStorage.setItem(sessionStorageKey(), raw);
}

export async function readSavedSession(): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(sessionStorageKey());
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<Session> | null;
    if (!saved?.access_token || !saved.refresh_token || !saved.user?.id) return null;
    return saved as Session;
  } catch {
    return null;
  }
}
