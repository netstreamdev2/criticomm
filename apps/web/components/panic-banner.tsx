import Link from 'next/link';
import { X } from 'lucide-react';
import { listMyOpenSos } from '@criticom/api';
import { receivesLiveOperations, type UserRole } from '@criticom/db';
import { getServerSupabase } from '@/lib/supabase';
import { timeAgo } from '@/lib/utils';
import { clearSosAction } from './panic-banner-actions';

/**
 * Live officer-emergency banner.
 *
 * A panic raised from the responder app interrupts the desks it was sent to
 * with a pop-up. This is for the minutes after, and for a desk that was not
 * signed in when it fired: a standing reminder, above the page, that a
 * colleague is still calling for help.
 *
 * It shows only the SOS alerts addressed to you (the officer's department
 * desk, the central control room, department command — 0047) that you have
 * not cleared, and only while the incident is open. × clears it for you, as
 * × on the pop-up does. The SuperAdmin is never paged by operations.
 *
 * Renders nothing when there is nothing to say — this must never become
 * furniture that operators learn to scroll past.
 */
export async function PanicBanner({ userId, role }: { userId: string; role: UserRole }) {
  if (!receivesLiveOperations(role)) return null;

  const supabase = await getServerSupabase();
  const panics = await listMyOpenSos(supabase, userId).catch(() => []);
  if (panics.length === 0) return null;

  return (
    <div className="space-y-2" role="alert" aria-live="assertive">
      {panics.map(({ incident: panic, alertId }) => (
        <div
          key={panic.id}
          className="flex items-center gap-2 rounded-lg border-2 border-severity-critical bg-severity-critical/10 pr-2 transition hover:bg-severity-critical/20"
        >
          <Link
            href={`/incidents/${panic.id}`}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
          >
            <span className="flex items-center gap-2 font-bold uppercase tracking-wide text-severity-critical">
              <span
                className="inline-block size-2.5 animate-pulse rounded-full bg-severity-critical"
                aria-hidden
              />
              Officer emergency
            </span>
            <span className="font-semibold">{panic.responding_officer ?? panic.caller_name}</span>
            <span className="text-sm text-muted-foreground">{panic.location_address}</span>
            <span className="ml-auto text-sm tabular-nums text-muted-foreground">
              {timeAgo(panic.incident_created_at)} · {panic.incident_number}
            </span>
          </Link>
          <form action={clearSosAction}>
            <input type="hidden" name="alert_id" value={alertId} />
            <button
              type="submit"
              aria-label={`Clear SOS ${panic.incident_number}`}
              title="Clear — marks it acknowledged for you"
              className="rounded-md p-1.5 text-severity-critical hover:bg-severity-critical/20"
            >
              <X className="h-4 w-4" />
            </button>
          </form>
        </div>
      ))}
    </div>
  );
}
