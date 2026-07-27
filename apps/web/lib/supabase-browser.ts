'use client';
import { createWebBrowserClient, type CriticomClient } from '@criticom/db';

let _client: CriticomClient | null = null;

export function getBrowserSupabase(): CriticomClient {
  if (_client) return _client;
  _client = createWebBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return _client;
}
