'use client';
import { useEffect, useState } from 'react';
import {
  listOnDutyOfficers, onDutyFlip, subscribeIncidentUpdates, subscribePersonnel, type OnDutyOfficer,
} from '@criticom/api';
import type { Silo } from '@criticom/db';
import { getBrowserSupabase } from '@/lib/supabase-browser';

/** Duty flips and calls taken show at once; GPS heartbeats can wait a little. */
const FAST_MS = 250;
const POSITION_MS = 5_000;

/**
 * Who is on duty right now, kept live: an officer flipping on or off duty in
 * the app shows here within a moment, no refresh. Officers taking or closing
 * a call (busy / free) come through the incidents stream.
 *
 * `initial` is the server-rendered list, so the page paints with real numbers
 * before the socket connects.
 */
export function useOnDutyOfficers(initial: OnDutyOfficer[], silos?: Silo[], enabled = true) {
  const [officers, setOfficers] = useState(initial);
  const key = silos?.join(',') ?? '';

  useEffect(() => {
    if (!enabled) return;
    let sb: ReturnType<typeof getBrowserSupabase>;
    try {
      sb = getBrowserSupabase();
    } catch {
      return;
    }
    const scope = key ? (key.split(',') as Silo[]) : undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let due = Number.POSITIVE_INFINITY;

    // One reload for a burst; a pending sooner reload is never pushed back.
    const reload = (delay: number) => {
      const at = Date.now() + delay;
      if (timer && due <= at) return;
      if (timer) clearTimeout(timer);
      due = at;
      timer = setTimeout(() => {
        timer = null;
        due = Number.POSITIVE_INFINITY;
        void listOnDutyOfficers(sb, scope).then(setOfficers).catch(() => {});
      }, delay);
    };

    const flip = onDutyFlip(() => reload(FAST_MS));
    const offPeople = subscribePersonnel(sb, (change) => {
      flip(change);
      reload(POSITION_MS);
    });
    const offCalls = subscribeIncidentUpdates(sb, 'all', () => reload(FAST_MS));
    return () => {
      offPeople();
      offCalls();
      if (timer) clearTimeout(timer);
    };
  }, [key, enabled]);

  return officers;
}
