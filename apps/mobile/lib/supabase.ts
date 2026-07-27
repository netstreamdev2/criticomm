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

if (!URL_ || !KEY) {
  console.warn('Supabase not configured — set EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY');
}

let client: CriticomClient | null = null;

export function getSupabase(): CriticomClient {
  if (!client) {
    client = createGenericClient(URL_, KEY, {
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
