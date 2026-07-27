'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { subscribeNewIncidents, subscribeIncidentUpdates } from '@criticom/api';

/** Subscribes to Realtime; when an incident is added or status changes,
 *  the server component above is re-rendered via router.refresh(). */
export function PendingRealtimeBridge() {
  const router = useRouter();
  useEffect(() => {
    const sb = getBrowserSupabase();
    const offNew = subscribeNewIncidents(sb, 'all', () => router.refresh());
    const offUpd = subscribeIncidentUpdates(sb, 'all', () => router.refresh());
    return () => {
      offNew();
      offUpd();
    };
  }, [router]);
  return null;
}
