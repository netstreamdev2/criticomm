import Link from 'next/link';
import { listActivePanics } from '@criticom/api';
import { getServerSupabase } from '@/lib/supabase';
import { timeAgo } from '@/lib/utils';

/**
 * Live officer-emergency banner.
 *
 * A panic raised from the responder app already interrupts every open screen
 * with a blocking alert. This is for the minutes after: an operator who
 * acknowledged the pop-up, went back to the queue, and now has no standing
 * reminder that a colleague is still calling for help. It sits above the page
 * content, on every screen that carries it, until the incident is closed.
 *
 * Renders nothing when there is nothing to say — this must never become
 * furniture that operators learn to scroll past.
 */
export async function PanicBanner() {
  const supabase = await getServerSupabase();

  // RLS scopes this to the caller's department, plus everything for global
  // roles — the same visibility as the incident it points at.
  const panics = await listActivePanics(supabase).catch(() => []);
  if (panics.length === 0) return null;

  return (
    <div className="space-y-2" role="alert" aria-live="assertive">
      {panics.map((panic) => (
        <Link
          key={panic.id}
          href={`/incidents/${panic.id}`}
          className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border-2 border-severity-critical bg-severity-critical/10 px-4 py-3 transition hover:bg-severity-critical/20"
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
      ))}
    </div>
  );
}
