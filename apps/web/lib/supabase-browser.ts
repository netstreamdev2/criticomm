'use client';
import { createWebBrowserClient, type CriticomClient } from '@criticom/db';

let _client: CriticomClient | null = null;

/** True when the public Supabase env is present in this (client) bundle. */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function getBrowserSupabase(): CriticomClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // These are inlined at build time. A blank value here means the env vars
    // weren't set when the app was built (e.g. missing in Vercel → redeploy needed).
    throw new Error(
      'Supabase is not configured for this deployment. Set NEXT_PUBLIC_SUPABASE_URL and ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment and redeploy.',
    );
  }
  _client = createWebBrowserClient(url, key);
  return _client;
}
