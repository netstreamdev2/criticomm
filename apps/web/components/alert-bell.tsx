'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { countUnreadAlerts, subscribeAlerts, subscribeMyAlertReads } from '@criticom/api';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { UnreadBadge } from '@/components/toast';
import { cn } from '@/lib/utils';

/**
 * Topbar bell with a genuinely live unread count.
 *
 * Three things keep it honest, because a dispatch console that under-reports
 * waiting alerts is worse than one with no badge at all:
 *
 *  1. New alerts arrive on the `alerts` stream and increment it.
 *  2. Read receipts arrive on this user's own `alert_reads` stream and
 *     decrement it — so reading in another tab, on the phone, or from the
 *     alert centre all move this badge. That stream did not exist before
 *     migration 0022, which is why the count only ever went up.
 *  3. Anything optimistic is reconciled against `count_unread_alerts()` —
 *     on mount, whenever the socket (re)subscribes, when the tab regains
 *     focus, and after navigating to the feed. A missed event or a dropped
 *     websocket therefore self-corrects instead of drifting for the shift.
 */
export function AlertBell() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  // Alert ids we've already counted, so a duplicate delivery (reconnect replay,
  // two channels seeing the same row) cannot double-count.
  const seen = useRef<Set<string>>(new Set());
  const reseedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reseed = useCallback(async () => {
    try {
      const sb = getBrowserSupabase();
      const n = await countUnreadAlerts(sb);
      setUnread(n);
      seen.current.clear();
    } catch {
      /* offline or misconfigured — keep the last known value rather than lying with 0 */
    }
  }, []);

  /** Coalesce bursts: a fanout to five departments should re-seed once. */
  const scheduleReseed = useCallback(() => {
    if (reseedTimer.current) clearTimeout(reseedTimer.current);
    reseedTimer.current = setTimeout(() => { void reseed(); }, 1200);
  }, [reseed]);

  useEffect(() => {
    let sb: ReturnType<typeof getBrowserSupabase>;
    try {
      sb = getBrowserSupabase();
    } catch {
      return;
    }

    let live = true;
    void reseed();

    // RLS delivers only the notifications meant for this person (0084).
    const offAlerts = subscribeAlerts(sb, (alert) => {
      if (!live) return;
      if (alert?.id) {
        if (seen.current.has(alert.id)) return;
        seen.current.add(alert.id);
      }
      setUnread((n) => n + 1);
      // The optimistic bump is instant; this confirms it against the database
      // shortly after, which also catches alerts RLS filtered out of the socket.
      scheduleReseed();
    });

    let offReads = () => {};
    void sb.auth.getUser().then(({ data: { user } }) => {
      if (!live || !user) return;
      offReads = subscribeMyAlertReads(sb, { userId: user.id }, {
        onChange: ({ type, alertId }) => {
          if (!live) return;
          if (type === 'read') {
            if (alertId) seen.current.delete(alertId);
            setUnread((n) => Math.max(0, n - 1));
          } else {
            setUnread((n) => n + 1);
          }
          scheduleReseed();
        },
        // A fresh SUBSCRIBED means we may have missed events while away.
        onStatus: (status) => { if (live && status === 'SUBSCRIBED') void reseed(); },
      });
    });

    const onFocus = () => { if (live) void reseed(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      live = false;
      offAlerts();
      offReads();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      if (reseedTimer.current) clearTimeout(reseedTimer.current);
    };
  }, [reseed, scheduleReseed]);

  // Opening the feed marks alerts read server-side; re-seed once that has had
  // a moment to land rather than optimistically zeroing a count that may still
  // have unread items behind it.
  useEffect(() => {
    if (pathname.startsWith('/notifications')) scheduleReseed();
  }, [pathname, scheduleReseed]);

  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-fg',
        pathname.startsWith('/notifications') ? 'text-fg' : 'text-muted-foreground',
      )}
    >
      <UnreadBadge count={unread} />
    </Link>
  );
}
