-- ============================================================================
-- 0022 — Make the unread alert count live
-- ============================================================================
--
-- `alerts` was already in the realtime publication, so new alerts did stream.
-- `alert_reads` was not — so reading an alert produced no realtime event and
-- the unread badge had no way to go down. The bell worked around it by zeroing
-- itself when you navigated to /notifications, which meant the count was wrong
-- in every other case: reading from the alert centre, reading in another tab,
-- or reading on the phone while the console sat open on the wall.
--
-- Adding alert_reads to the publication fixes the decrement. Its RLS policy is
-- `user_id = auth.uid()`, so a subscriber receives only their own receipts —
-- the stream carries nothing about anyone else's reading habits.
--
-- Also adds an authoritative count the client can re-seed from, so a dropped
-- socket cannot leave the badge permanently drifted.
-- ============================================================================

alter publication supabase_realtime add table public.alert_reads;

-- UPDATE/DELETE payloads carry the old row, so a receipt being withdrawn (an
-- alert marked unread) is actionable by subscribers rather than opaque.
alter table public.alert_reads replica identity full;

/**
 * Unread alerts for the caller.
 *
 * Deliberately SECURITY INVOKER (the default): RLS on `alerts` already decides
 * which alerts this user can see, and RLS on `alert_reads` which receipts are
 * theirs, so the count comes out correct per-user with no privileged code and
 * nothing to get wrong. Contrast with the SECURITY DEFINER RPCs in 0019 —
 * there is no reason to reach for that here.
 *
 * Expired alerts are excluded: an alert that has aged out is not something the
 * operator still needs to act on, and counting it makes the badge a liar.
 */
create or replace function public.count_unread_alerts()
returns integer
language sql
stable
set search_path to 'public'
as $$
  select count(*)::int
  from public.alerts a
  where (a.expires_at is null or a.expires_at > now())
    and not exists (
      select 1 from public.alert_reads r
      where r.alert_id = a.id and r.user_id = auth.uid()
    );
$$;

comment on function public.count_unread_alerts() is
  'Authoritative unread count for the signed-in user. SECURITY INVOKER so RLS does the scoping.';

revoke execute on function public.count_unread_alerts() from public, anon;
grant execute on function public.count_unread_alerts() to authenticated, service_role;

-- The badge query runs on every page load and on every socket reconnect, so
-- the NOT EXISTS lookup gets an index rather than a scan per alert.
create index if not exists alert_reads_user_alert_idx on public.alert_reads (user_id, alert_id);
create index if not exists alerts_live_idx on public.alerts (expires_at, created_at desc);
