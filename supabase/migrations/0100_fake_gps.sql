-- ============================================================================
-- 0100 — Fake GPS: positions from a location-faking app count for nothing
-- ============================================================================
--
-- Run after 0099.
--
-- Arrival is now proven by the phone's position (0099), so the obvious way
-- round it is an app that fakes the phone's location. Android marks every fix
-- such an app gives, and the officer app now sends that mark with the fix
-- ("mock": true). Here:
--
--   * a faked fix is kept on file (duty_tracks.mocked) as evidence, but it
--     never moves the officer's marker and never counts towards arriving
--     (fix_near, check_gps_arrivals);
--   * the officer's record notes when it last happened (personnel.fake_gps_at);
--   * the officer's Supervisors, Captains and Admins, and the control room,
--     are told — at most once an hour per officer.
--
-- Older app builds do not send the mark: their fixes are treated as before.
--
-- Safe to re-run.
-- ============================================================================

alter table public.duty_tracks add column if not exists mocked boolean not null default false;
alter table public.personnel add column if not exists fake_gps_at timestamptz;

comment on column public.duty_tracks.mocked is 'The phone said a location-faking app gave this fix (0100). Kept as evidence; used for nothing.';
comment on column public.personnel.fake_gps_at is 'When this officer''s phone last sent a faked location (0100).';

-- ── The fix nearest a moment: real fixes only ──────────────────────────────
-- As 0099, without faked fixes.
create or replace function public.fix_near(p_user uuid, p_at timestamptz, p_window interval)
returns table (lat double precision, lng double precision, accuracy real, recorded_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select x.lat, x.lng, x.accuracy, x.recorded_at from (
    (select d.lat, d.lng, d.accuracy, d.recorded_at, 0 as pref
       from public.duty_tracks d
      where d.tenant_id = public.current_tenant() and d.user_id = p_user
        and d.recorded_at between p_at - p_window and p_at + p_window
        and not d.mocked
      order by abs(extract(epoch from d.recorded_at - p_at))
      limit 1)
    union all
    (select p.latitude, p.longitude, null::real, p.location_at, 1
       from public.personnel p
      where p.tenant_id = public.current_tenant() and p.user_id = p_user
        and p.latitude is not null and p.longitude is not null
        and p.location_at between p_at - p_window and p_at + p_window
      limit 1)
  ) x
  order by x.pref
  limit 1
$$;
revoke all on function public.fix_near(uuid, timestamptz, interval) from public, anon, authenticated;

-- ── Arrival by GPS: real fixes only ────────────────────────────────────────
-- As 0099, without faked fixes.
create or replace function public.check_gps_arrivals(p_user uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  r        record;
  v_radius integer;
  v_t      timestamptz;
  v_d      double precision;
  v_label  text;
begin
  for r in
    select ir.id, ir.incident_id, ir.silo, ir.role, ir.status, ir.joined_at, ir.arrived_at, ir.arrived_by,
           ir.arrived_verified, ir.name, i.location_lat, i.location_lng, i.tenant_id, i.silo as incident_silo
      from public.incident_responders ir
      join public.incidents i on i.id = ir.incident_id
     where ir.user_id = p_user and ir.tenant_id = public.current_tenant()
       and i.status not in ('Resolved', 'Closed')
       and i.location_lat is not null and i.location_lng is not null
       and ((ir.status = 'En Route' and ir.arrived_at is null)
            or (ir.arrived_by = 'officer' and ir.arrived_verified is false))
  loop
    v_radius := public.arrive_radius_m(r.tenant_id);
    if r.arrived_at is null then
      select d.recorded_at, public.distance_m(d.lat, d.lng, r.location_lat, r.location_lng)
        into v_t, v_d
        from public.duty_tracks d
       where d.tenant_id = r.tenant_id and d.user_id = p_user and not d.mocked
         and d.recorded_at >= r.joined_at - interval '2 minutes'
         and public.distance_m(d.lat, d.lng, r.location_lat, r.location_lng) - least(coalesce(d.accuracy, 0), 100) <= v_radius
       order by d.recorded_at
       limit 1;
      if v_t is not null then
        perform public.arrive_on_scene(r.incident_id, p_user, v_t, 'gps', round(v_d)::int, true, null);
      end if;
    else
      select d.recorded_at, public.distance_m(d.lat, d.lng, r.location_lat, r.location_lng)
        into v_t, v_d
        from public.duty_tracks d
       where d.tenant_id = r.tenant_id and d.user_id = p_user and not d.mocked
         and d.recorded_at between r.arrived_at - interval '15 minutes' and r.arrived_at + interval '15 minutes'
         and public.distance_m(d.lat, d.lng, r.location_lat, r.location_lng) - least(coalesce(d.accuracy, 0), 100) <= 2 * v_radius
       order by abs(extract(epoch from d.recorded_at - r.arrived_at))
       limit 1;
      if v_t is not null then
        update public.incident_responders
           set arrived_verified = true, arrived_distance_m = round(v_d)::int, updated_at = now()
         where id = r.id;
        update public.incident_departments
           set arrived_verified = true, arrived_distance_m = round(v_d)::int, updated_at = now()
         where incident_id = r.incident_id and silo = r.silo and arrived_by = 'officer'
           and lead_id is not distinct from p_user;
        v_label := public.department_label(r.silo);
        insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
        values (r.incident_silo, r.incident_id,
          format('[STATUS] Arrival confirmed by GPS · %s — %s was %s from the scene',
            v_label, coalesce(r.name, 'the crew'), public.distance_words(round(v_d)::int)),
          p_user, r.name);
        update public.incidents set updated_at = now() where id = r.incident_id;
      end if;
    end if;
    v_t := null;
  end loop;
end $$;
revoke all on function public.check_gps_arrivals(uuid) from public, anon, authenticated;

-- ── Recording fixes: the mark kept, faked fixes used for nothing ───────────
-- As 0099, with the changes marked 0100.
create or replace function public.record_track(p_points jsonb)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_person public.personnel;
  v_sent   integer;
  v_t      timestamptz;
  v_lat    double precision;
  v_lng    double precision;
  v_fake   integer;
  v_name   text;
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
      case when jsonb_typeof(e -> 'hdg') = 'number' then least((e ->> 'hdg')::double precision, 360)::real end as hdg,
      -- 0100: the phone says a location-faking app gave this fix.
      coalesce(jsonb_typeof(e -> 'mock') = 'boolean' and (e ->> 'mock')::boolean, false) as mocked
    from jsonb_array_elements(p_points) e
  ), ok as (
    select distinct on (least(t, now())) least(t, now()) as t, lat, lng, acc, spd, hdg, mocked
      from parsed
     where t is not null and lat is not null and lng is not null
       and lat between -90 and 90 and lng between -180 and 180
       and not (lat = 0 and lng = 0)
       and t > now() - interval '72 hours'
       and t <= now() + interval '5 minutes'
     order by least(t, now())
  ), ins as (
    insert into public.duty_tracks (tenant_id, silo, user_id, recorded_at, lat, lng, accuracy, speed, heading, mocked)
    select v_person.tenant_id, v_person.silo, auth.uid(), t, lat, lng, acc, spd, hdg, mocked from ok
    on conflict (tenant_id, user_id, recorded_at) do nothing
    returning 1
  )
  select (select count(*) from ins)::integer, n.t, n.lat, n.lng, (select count(*) from ok where mocked)::integer
    into v_sent, v_t, v_lat, v_lng, v_fake
    from (select 1) one
    -- 0100: a faked fix never moves the marker.
    left join lateral (select t, lat, lng from ok where not mocked order by t desc limit 1) n on true;

  -- 0100: a faked location is kept as evidence, used for nothing, and
  -- command is told (at most once an hour per officer).
  if v_fake > 0 then
    if v_person.fake_gps_at is null or v_person.fake_gps_at < now() - interval '1 hour' then
      v_name := coalesce(nullif(trim(concat_ws(' ', v_person.first_name, v_person.last_name)), ''),
                         (select full_name from public.profiles where id = auth.uid()), 'An officer');
      insert into public.alerts (
        tenant_id, silo, target_user_id, kind, severity, title, body, link,
        presentation, requires_ack, created_by, created_by_name, expires_at
      )
      select v_person.tenant_id, p.silo, p.id, 'fake_location', 'High',
             format('Fake location on %s''s phone', v_name),
             'An app on the phone is faking its location. Those positions were not used for the map or for arrival.',
             '/command', 'toast', false, auth.uid(), v_name, now() + interval '7 days'
        from public.profiles p
       where p.tenant_id = v_person.tenant_id
         and p.deactivated_at is null
         and p.id is distinct from auth.uid()
         and (p.role = 'SystemController'
              or (p.role in ('Supervisor', 'Captain', 'Admin') and p.silo = v_person.silo));
    end if;
    update public.personnel set fake_gps_at = now() where id = v_person.id;
    v_person.fake_gps_at := now();
  end if;

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

  -- Arrival by GPS (0099): any call this officer is heading to that these
  -- points reach is marked on scene, at the time of the point.
  perform public.check_gps_arrivals(auth.uid());

  return coalesce(v_sent, 0);
end $$;
revoke all on function public.record_track(jsonb) from public, anon;
grant execute on function public.record_track(jsonb) to authenticated;

notify pgrst, 'reload schema';
