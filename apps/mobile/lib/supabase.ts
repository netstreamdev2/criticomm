import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createGenericClient, type CriticomClient } from '@criticom/db/client';

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

export function getSupabase(): CriticomClient {
  if (!client) {
    client = createGenericClient(SAFE_URL, SAFE_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
