-- ============================================================================
-- 0071 — The route a crew drove, offline included
-- ============================================================================
--
-- Run after 0070 (it uses 0068's desk_silo()).
--
-- The officer app records its position while the officer is on duty, with
-- or without signal, and keeps every fix on the phone until it is delivered
-- (apps/mobile/lib/tracker.ts). This is where those fixes land:
--
--   duty_tracks          every fix, with when it was taken and when it
--                        reached the server, so a stretch recorded with no
--                        signal shows as such on the console map
--   personnel.location_at  when the position dispatch sees was taken, which
--                        is no longer the same as when the row last changed
--   record_track()       the phone's delivery: up to 1,000 fixes at a time,
--                        safe to resend; moves the officer's marker to the
--                        newest fix and stamps the contact time (last_login,
--                        as the old one-minute heartbeat did)
--   list_duty_tracks()   the routes for the console map, thinned to one fix
--                        per 15 seconds, at most a day back
--   purge_old_duty_tracks()  fixes are kept for duty.track_retention_days
--                        (Operations Settings, default 90, 7 to 365), then
--                        deleted every night
--
-- Who sees a route: the officer, and the desks and command who oversee
-- crews (dispatch, control room, supervisors, captains, chiefs, the admin
-- tier), only for people they can already see in personnel. Nobody writes
-- the table except record_track(), and only for themselves.
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. When the position was taken ──────────────────────────────────────────

alter table public.personnel add column if not exists location_at timestamptz;

-- Any writer that moves the position without saying when (toggle_duty(), an
-- older app's heartbeat, an admin edit) moved it now.
create or replace function public.stamp_location_at()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if (new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude)
     and new.location_at is not distinct from old.location_at
     and new.latitude is not null and new.longitude is not null then
    new.location_at := now();
  end if;
  return new;
end $$;
revoke all on function public.stamp_location_at() from public, anon, authenticated;

drop trigger if exists stamp_location_at on public.personnel;
create trigger stamp_location_at before update of latitude, longitude, location_at on public.personnel
  for each row execute function public.stamp_location_at();

-- ── 2. The fixes ────────────────────────────────────────────────────────────

create table if not exists public.duty_tracks (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null default public.current_tenant(),
  silo        public.silo not null,
  user_id     uuid not null,
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  accuracy    real,
  speed       real,
  heading     real,
  unique (tenant_id, user_id, recorded_at)
);

create index if not exists duty_tracks_person_time on public.duty_tracks (tenant_id, user_id, recorded_at desc);
create index if not exists duty_tracks_time on public.duty_tracks (recorded_at);

alter table public.duty_tracks enable row level security;

drop policy if exists tenant_isolation on public.duty_tracks;
create policy tenant_isolation on public.duty_tracks as restrictive for all to authenticated
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

-- The personnel subquery runs under the reader's own rules, so a route shows
-- only when its officer does; a department's dispatch desk (0068) follows its
-- own department's crews only.
drop policy if exists duty_tracks_read on public.duty_tracks;
create policy duty_tracks_read on public.duty_tracks for select to authenticated using (
  user_id = auth.uid()
  or (
    public.role_in('SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'Supervisor', 'Captain', 'FireChief',
                   'Dispatcher', 'ControlRoom', 'System')
    and ((select public.desk_silo()) is null or duty_tracks.silo = (select public.desk_silo()))
    and exists (select 1 from public.personnel p where p.user_id = duty_tracks.user_id)
  )
);

revoke all on public.duty_tracks from anon;
revoke insert, update, delete on public.duty_tracks from authenticated;
grant select on public.duty_tracks to authenticated;

-- ── 3. Delivery from the phone ──────────────────────────────────────────────
-- Each point: {"t": ISO time, "lat": n, "lng": n, "acc"?: n, "spd"?: n, "hdg"?: n}.
-- A fix already delivered is skipped, so a resend after a dropped answer is
-- harmless. Fixes more than 72 hours old, or in the future, are not taken.

create or replace function public.record_track(p_points jsonb)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_person public.personnel;
  v_sent   integer;
  v_t      timestamptz;
  v_lat    double precision;
  v_lng    double precision;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into v_person from public.personnel
   where user_id = auth.uid() and tenant_id = public.current_tenant()
   limit 1;
  if not found then
    raise exception 'No personnel record is linked to this account' using errcode = 'P0001';
  end if;
  if p_points is null or jsonb_typeof(p_points) <> 'array' then
    raise exception 'Send the points as a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_points) > 1000 then
    raise exception 'Send at most 1,000 points at a time' using errcode = '22023';
  end if;

  with parsed as (
    select
      case when jsonb_typeof(e -> 't') = 'string'
            and (e ->> 't') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$'
           then (e ->> 't')::timestamptz end as t,
      case when jsonb_typeof(e -> 'lat') = 'number' then (e ->> 'lat')::double precision end as lat,
      case when jsonb_typeof(e -> 'lng') = 'number' then (e ->> 'lng')::double precision end as lng,
      case when jsonb_typeof(e -> 'acc') = 'number' then least((e ->> 'acc')::double precision, 1e6)::real end as acc,
      case when jsonb_typeof(e -> 'spd') = 'number' then least((e ->> 'spd')::double precision, 1e4)::real end as spd,
      case when jsonb_typeof(e -> 'hdg') = 'number' then least((e ->> 'hdg')::double precision, 360)::real end as hdg
    from jsonb_array_elements(p_points) e
  ), ok as (
    select distinct on (least(t, now())) least(t, now()) as t, lat, lng, acc, spd, hdg
      from parsed
     where t is not null and lat is not null and lng is not null
       and lat between -90 and 90 and lng between -180 and 180
       and not (lat = 0 and lng = 0)
       and t > now() - interval '72 hours'
       and t <= now() + interval '5 minutes'
     order by least(t, now())
  ), ins as (
    insert into public.duty_tracks (tenant_id, silo, user_id, recorded_at, lat, lng, accuracy, speed, heading)
    select v_person.tenant_id, v_person.silo, auth.uid(), t, lat, lng, acc, spd, hdg from ok
    on conflict (tenant_id, user_id, recorded_at) do nothing
    returning 1
  )
  select (select count(*) from ins)::integer, n.t, n.lat, n.lng
    into v_sent, v_t, v_lat, v_lng
    from (select 1) one
    left join lateral (select t, lat, lng from ok order by t desc limit 1) n on true;

  -- The marker moves only forward in time: a stretch recorded offline and
  -- delivered late never drags it back to where the crew used to be.
  update public.personnel p
     set latitude    = case when p.is_on_duty and v_t is not null and (p.location_at is null or v_t >= p.location_at)
                            then v_lat else p.latitude end,
         longitude   = case when p.is_on_duty and v_t is not null and (p.location_at is null or v_t >= p.location_at)
                            then v_lng else p.longitude end,
         location_at = case when p.is_on_duty and v_t is not null and (p.location_at is null or v_t >= p.location_at)
                            then v_t else p.location_at end,
         last_login  = case when p.is_on_duty then now() else p.last_login end
   where p.id = v_person.id;

  return coalesce(v_sent, 0);
end $$;

revoke all on function public.record_track(jsonb) from public, anon;
grant execute on function public.record_track(jsonb) to authenticated;

-- ── 4. Routes for the console map ───────────────────────────────────────────
-- Runs as the reader, so the rules above decide whose routes come back.

create or replace function public.list_duty_tracks(p_since timestamptz, p_user_ids uuid[] default null)
returns table (user_id uuid, recorded_at timestamptz, lat double precision, lng double precision, offline boolean)
language sql stable security invoker set search_path to 'public' as $$
  select x.user_id, x.recorded_at, x.lat, x.lng, x.offline
    from (
      select distinct on (t.user_id, floor(extract(epoch from t.recorded_at) / 15))
             t.user_id, t.recorded_at, t.lat, t.lng,
             (t.received_at - t.recorded_at) > interval '2 minutes' as offline
        from public.duty_tracks t
       where t.recorded_at >= greatest(coalesce(p_since, now() - interval '12 hours'), now() - interval '24 hours')
         and (p_user_ids is null or t.user_id = any (p_user_ids))
       order by t.user_id, floor(extract(epoch from t.recorded_at) / 15), t.recorded_at
    ) x
   order by x.user_id, x.recorded_at
   limit 60000;
$$;

revoke all on function public.list_duty_tracks(timestamptz, uuid[]) from public, anon;
grant execute on function public.list_duty_tracks(timestamptz, uuid[]) to authenticated;

-- ── 5. How long routes are kept ─────────────────────────────────────────────

create or replace function public.purge_old_duty_tracks() returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  v_count integer;
begin
  delete from public.duty_tracks t
   where t.recorded_at < now() - make_interval(days => greatest(7, least(365, coalesce((
     select case when jsonb_typeof(s.value) = 'number' then (s.value)::text::numeric end
       from public.app_settings s
      where s.tenant_id = t.tenant_id and s.key = 'duty.track_retention_days'
   ), 90)))::int);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.purge_old_duty_tracks() from public, anon, authenticated;

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%). Call public.purge_old_duty_tracks() from an external scheduler.', sqlerrm;
    return;
  end;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not present. Call public.purge_old_duty_tracks() from an external scheduler.';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'criticom-duty-tracks-purge';
  -- 01:30 in South Africa.
  perform cron.schedule('criticom-duty-tracks-purge', '30 23 * * *', $job$ select public.purge_old_duty_tracks(); $job$);
  raise notice 'Scheduled criticom-duty-tracks-purge nightly.';
end $$;

notify pgrst, 'reload schema';
