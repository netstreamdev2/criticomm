'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { countUnreadAlerts, subscribeAlerts } from '@criticom/api';
import { GLOBAL_ROLES, type Silo, type UserRole } from '@criticom/db';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { UnreadBadge } from '@/components/toast';
import { cn } from '@/lib/utils';

/**
 * Topbar bell with a live unread count. Seeds from the database on mount, then
 * increments off the same realtime stream the alert centre listens to, so the
 * badge moves the instant a call is routed rather than on the next page load.
 */
export function AlertBell({ silo, role }: { silo: string; role: string }) {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let sb;
    try {
      sb = getBrowserSupabase();
    } catch {
      return;
    }

    let live = true;
    void countUnreadAlerts(sb).then((n) => { if (live) setUnread(n); }).catch(() => {});

    const isGlobal = GLOBAL_ROLES.includes(role as UserRole) || silo === 'Ethekwini';
    const scope: Silo | 'all' = isGlobal ? 'all' : (silo as Silo);
    const off = subscribeAlerts(sb, { silo: scope }, () => setUnread((n) => n + 1));

    return () => { live = false; off(); };
  }, [silo, role]);

  // Opening the feed is as good as reading it.
  useEffect(() => {
    if (pathname.startsWith('/notifications')) setUnread(0);
  }, [pathname]);

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
