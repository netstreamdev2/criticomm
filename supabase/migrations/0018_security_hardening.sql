-- =====================================================================
-- CRITICOMM V5 — 0018  SECURITY HARDENING
--
-- Findings from the production-readiness audit, highest severity first.
-- =====================================================================

-- ── 1. CRITICAL: citizen share tokens were world-readable ────────────
-- `citizen_share_select ... using (true)` let ANY caller — including
-- unauthenticated ones holding only the public anon key — list every live
-- GPS-share token together with its incident_id.
--
-- A share token is a bearer credential: whoever holds it can call
-- citizen_update_location() and write a position onto that incident. Being
-- able to enumerate them meant an attacker could plant false coordinates on
-- any active emergency and send responders to the wrong address.
--
-- Nothing reads this table through the API: the public share page only calls
-- the SECURITY DEFINER function, which looks the token up itself. So the
-- policy bought nothing and is dropped outright.
drop policy if exists citizen_share_select on public.citizen_share_tokens;

-- Staff who run the GPS-share flow still need to see what they issued.
create policy citizen_share_staff_read on public.citizen_share_tokens for select
  using (public.is_global() or public.role_in(
    'Dispatcher','Operator','ControlRoom','IncidentLogger','SystemAdmin','SuperAdmin','Admin'
  ));

-- ── 2. Expired tokens should stop being useful, and stop accumulating ─
-- citizen_update_location already rejects expired/used tokens, but leaving
-- dead rows around widens the window for any future mistake.
create index if not exists citizen_share_tokens_expiry_idx
  on public.citizen_share_tokens (expires_at)
  where used_at is null;

create or replace function public.purge_expired_share_tokens()
returns integer
language plpgsql security definer set search_path = public as $$
declare removed integer;
begin
  delete from public.citizen_share_tokens
   where expires_at < now() - interval '7 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_expired_share_tokens() from public;
grant execute on function public.purge_expired_share_tokens() to service_role;

-- ── 3. Data integrity on the incident lifecycle ──────────────────────
-- A closed incident must have a closure time, and coordinates must be real
-- coordinates. These are cheap guards against bad writes from any client.
alter table public.incidents drop constraint if exists incidents_coords_valid;
alter table public.incidents add constraint incidents_coords_valid
  check (
    location_lat between -90 and 90
    and location_lng between -180 and 180
  ) not valid;

-- `not valid` skips the historical backfill check; new and updated rows are
-- still enforced. Validate separately once legacy rows are cleaned.

-- ── 4. Alerts should not accumulate forever ──────────────────────────
create index if not exists alerts_expiry_idx
  on public.alerts (expires_at)
  where expires_at is not null;
