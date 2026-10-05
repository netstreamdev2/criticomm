'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { onDutyFlip, subscribePersonnel } from '@criticom/api';
import { getBrowserSupabase } from '@/lib/supabase-browser';

/**
 * Keeps today's shift board current: an officer going on or off duty
 * refreshes it at once, and a minute tick picks up kit booked out or handed
 * back in between.
 */
export function ShiftBoardLive() {
  const router = useRouter();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(() => router.refresh(), 800);
    };
    let off = () => {};
    try {
      off = subscribePersonnel(getBrowserSupabase(), onDutyFlip(refresh));
    } catch {
      /* no realtime config: the minute tick still refreshes */
    }
    const tick = setInterval(() => router.refresh(), 60_000);
    return () => {
      off();
      clearInterval(tick);
      if (pending.current) clearTimeout(pending.current);
    };
  }, [router]);

  return null;
}
