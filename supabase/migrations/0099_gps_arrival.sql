-- ============================================================================
-- 0099 — On scene by GPS: arrival proven by where the phone was, not by a tap
-- ============================================================================
--
-- Run after 0098.
--
-- En route and on scene were buttons the crew pressed: a crew could press On
-- Scene from anywhere and then file the report. Now arriving is proven by the
-- phone's own position fixes, the ones the route recorder already sends
-- (0071), offline ones included:
--
--   * The first fix inside the scene radius after the crew accepted the call
--     marks them on scene, at the time of that fix (a crew that had no signal
--     arrives when they arrived, not when the phone found signal). The radius
--     is an Operations Setting, dispatch.arrive_radius_m (150 m by default),
--     with the fix's own accuracy allowed for (up to 100 m).
--
--   * Pressing "I'm on scene" still works, so a dead GPS never stops an
--     emergency, but the press is checked against where the phone was at that
--     moment. Near the scene: verified. Far away, or no position: it counts,
--     it is flagged "not verified" with the distance, and dispatch and command
--     are told at once. If fixes uploaded later show the crew was there, the
--     flag clears itself.
--
--   * The desk marking a radio crew on scene says so ("marked by dispatch").
--
-- Reports already need the crew on scene, so a report can no longer be filed
-- from across town without it showing.
--
-- Each responder also keeps where they set off from, so the dispatch screens
-- can show how far along they are.
--
--   incident_responders     + start_lat, start_lng, start_distance_m,
--                             arrived_at, arrived_by (gps | officer | desk),
--                             arrived_distance_m, arrived_verified, arrive_note
--   incident_departments    + arrived_by, arrived_distance_m, arrived_verified
--   distance_m()            metres between two points
--   arrive_radius_m()       the scene radius (Operations Settings)
--   fix_near()              the phone's fix nearest a moment
--   arrive_on_scene()       marks a responder on scene (internal)
--   check_gps_arrivals()    after each upload of fixes (internal)
--   update_responder_status()  + p_reason; arriving is checked as above
--   set_department_status()    the desk's arrival says "desk"
--   record_track()             checks for arrivals after each upload
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. What is kept ─────────────────────────────────────────────────────────

alter table public.incident_responders
  add column if not exists start_lat          double precision,
  add column if not exists start_lng          double precision,
  add column if not exists start_distance_m   integer,
  add column if not exists arrived_at         timestamptz,
  add column if not exists arrived_by         text,
  add column if not exists arrived_distance_m integer,
  add column if not exists arrived_verified   boolean,
  add column if not exists arrive_note        text;

alter table public.incident_departments
  add column if not exists arrived_by         text,
  add column if not exists arrived_distance_m integer,
  add column if not exists arrived_verified   boolean;

do $$
begin
  alter table public.incident_responders drop constraint if exists incident_responders_arrived_by_check;
  alter table public.incident_responders add constraint incident_responders_arrived_by_check
    check (arrived_by is null or arrived_by in ('gps', 'officer', 'desk'));
  alter table public.incident_responders drop constraint if exists incident_responders_arrive_note_length;
  alter table public.incident_responders add constraint incident_responders_arrive_note_length
    check (arrive_note is null or length(arrive_note) <= 300);
  alter table public.incident_departments drop constraint if exists incident_departments_arrived_by_check;
  alter table public.incident_departments add constraint incident_departments_arrived_by_check
    check (arrived_by is null or arrived_by in ('gps', 'officer', 'desk'));
end $$;

comment on column public.incident_responders.arrived_by is
  'How this responder''s arrival was recorded (0099): gps (their phone reached the scene), officer (pressed; see arrived_verified) or desk.';
comment on column public.incident_responders.arrived_verified is
  'Their phone was at the scene when they arrived (0099). False: marked on scene from elsewhere, or with no position.';

-- ── 2. Helpers ──────────────────────────────────────────────────────────────

/** Metres between two points (haversine). */
create or replace function public.distance_m(p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision)
returns double precision language sql immutable set search_path to 'public' as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  )))
$$;
grant execute on function public.distance_m(double precision, double precision, double precision, double precision) to authenticated, service_role;

/** The scene radius in metres: Operations Settings, dispatch.arrive_radius_m (50–1000, default 150). */
create or replace function public.arrive_radius_m(p_tenant uuid)
returns integer language sql stable security definer set search_path to 'public' as $$
  select greatest(50, least(1000, coalesce((
    select case when jsonb_typeof(s.value) = 'number' then (s.value)::text::numeric end
      from public.app_settings s
     where s.tenant_id = p_tenant and s.key = 'dispatch.arrive_radius_m'
  ), 150)))::int
$$;
revoke all on function public.arrive_radius_m(uuid) from public, anon;
grant execute on function public.arrive_radius_m(uuid) to authenticated, service_role;

/** The person's position fix nearest a moment, within a window; else their last known position if it is in the window. */
create or replace function public.fix_near(p_user uuid, p_at timestamptz, p_window interval)
returns table (lat double precision, lng double precision, accuracy real, recorded_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select x.lat, x.lng, x.accuracy, x.recorded_at from (
    (select d.lat, d.lng, d.accuracy, d.recorded_at, 0 as pref
       from public.duty_tracks d
      where d.tenant_id = public.current_tenant() and d.user_id = p_user
        and d.recorded_at between p_at - p_window and p_at + p_window
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
-- Positions are for the server's own checks: nobody reads another's this way.
revoke all on function public.fix_near(uuid, timestamptz, interval) from public, anon, authenticated;

/** "38 m" or "2.4 km". */
create or replace function public.distance_words(p_m integer)
returns text language sql immutable set search_path to 'public' as $$
  select case when p_m is null then null
              when p_m < 1000 then p_m::text || ' m'
              else to_char(p_m / 1000.0, 'FM9990.0') || ' km' end
$$;

-- ── 3. Arriving ─────────────────────────────────────────────────────────────

/**
 * Mark one responder on scene: their own row, and their department's part if
 * they lead it, with how the arrival was recorded. Never twice, never before
 * they accepted, never on a finished part. Internal: called by the status
 * function and by the GPS check, as the officer.
 */
create or replace function public.arrive_on_scene(
  p_incident uuid, p_user uuid, p_at timestamptz, p_by text,
  p_distance integer, p_verified boolean, p_note text
)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_me       public.incident_responders;
  v_dept     public.incident_departments;
  v_found    boolean;
  v_lead     boolean;
  v_name     text;
  v_label    text;
  v_at       timestamptz;
  v_note     text := left(nullif(btrim(coalesce(p_note, '')), ''), 300);
  v_how      text;
begin
  select * into v_incident from public.incidents where id = p_incident for update;
  if not found or v_incident.status in ('Resolved', 'Closed') then return v_incident; end if;
  select * into v_me from public.incident_responders
   where incident_id = p_incident and user_id = p_user for update;
  if not found or v_me.arrived_at is not null then return v_incident; end if;
  select * into v_dept from public.incident_departments
   where incident_id = p_incident and silo = v_me.silo for update;
  v_found := found;
  if v_found and not public.department_open(v_dept.status) then return v_incident; end if;

  v_at := greatest(p_at, v_me.joined_at);
  v_name := coalesce(v_me.name, (select full_name from public.profiles where id = p_user), 'Responder');
  v_label := public.department_label(v_me.silo);
  v_lead := v_found and v_me.role = 'lead' and v_dept.lead_id is not distinct from p_user;

  update public.incident_responders
     set status = case when status = 'En Route' then 'On Scene'::incident_status else status end,
         arrived_at = v_at, arrived_by = p_by, arrived_distance_m = p_distance,
         arrived_verified = p_verified, arrive_note = v_note, updated_at = now()
   where id = v_me.id;

  if v_lead then
    update public.incident_departments
       set status = case when public.department_step_rank('On Scene') > public.department_step_rank(status)
                         then 'On Scene' else status end,
           arrived_verified = case when arrived_by is null then p_verified else arrived_verified end,
           arrived_distance_m = case when arrived_by is null then p_distance else arrived_distance_m end,
           arrived_by = coalesce(arrived_by, p_by),
           arrived_at = coalesce(arrived_at, v_at),
           updated_at = now()
     where id = v_dept.id;
    update public.incidents
       set arrived_timestamp = coalesce(arrived_timestamp, v_at), updated_at = now()
     where id = p_incident;
    v_incident := public.sync_incident_from_departments(p_incident);
  else
    update public.incidents set updated_at = now() where id = p_incident
    returning * into v_incident;
  end if;

  v_how := case
    when p_by = 'gps' then format(' — GPS: %s from the scene', public.distance_words(p_distance))
    when p_verified then format(' — marked by %s, GPS: %s from the scene', v_name, public.distance_words(p_distance))
    when p_verified is null then format(' — marked by %s; the call has no map position to check', v_name)
    when p_distance is null then format(' — marked by %s, NOT verified: no position from the phone', v_name)
    else format(' — marked by %s, NOT verified: %s from the scene', v_name, public.distance_words(p_distance))
  end || case when v_note is not null then format(' (%s)', v_note) else '' end;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name, timestamp)
  values (v_incident.silo, v_incident.id,
    case when v_lead then '[STATUS] On Scene · ' || v_label else format('[BACKUP] %s — On Scene · %s', v_name, v_label) end || v_how,
    p_user, v_name, v_at);

  -- Not verified: dispatch and command hear of it straight away.
  if p_verified is false then
    perform public.notify_incident_chain(
      v_incident, 'incident_update',
      format('%s: %s marked on scene, not verified', v_incident.incident_number, v_name),
      format('%s%s', coalesce(public.distance_words(p_distance) || ' from the scene', 'No position from the phone'),
                     coalesce(' · ' || v_note, '')));
  end if;

  return v_incident;
end $$;
revoke all on function public.arrive_on_scene(uuid, uuid, timestamptz, text, integer, boolean, text) from public, anon, authenticated;

/**
 * After an upload of fixes: each call this person is heading to that a fix
 * reaches (inside the radius, the fix's accuracy allowed for) marks them on
 * scene at that fix's time; an arrival they pressed and that was not
 * verified is confirmed if a fix near that time was at the scene. Internal.
 */
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
       where d.tenant_id = r.tenant_id and d.user_id = p_user
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
       where d.tenant_id = r.tenant_id and d.user_id = p_user
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

-- ── 4. The crew's own status: arriving is checked ───────────────────────────

drop function if exists public.update_responder_status(uuid, incident_status, timestamptz);
create or replace function public.update_responder_status(
  p_incident_id uuid,
  p_status      incident_status,
  p_occurred_at timestamptz default null,
  p_reason      text default null
)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_dept     public.incident_departments;
  v_silo     public.silo;
  v_name     text := coalesce((select full_name from public.profiles where id = auth.uid()), 'Responder');
  v_at       timestamptz;
  v_queued   boolean;
  v_field    boolean;
  v_person   public.personnel;
  v_me       public.incident_responders;
  v_joining  boolean := false;
  v_lead     boolean := true;
  v_unit     text;
  v_count    int;
  v_fix      record;
  v_dist     integer;
  v_radius   integer;
  v_verified boolean;
  -- The field ladder, so a late offline replay never moves anyone backwards.
  v_rank     constant jsonb := '{"En Route":1,"Arrived":2,"On Scene":3,"Transporting":4}';
begin
  perform public.require_role(
    'Responder','Police','Officer','Metro','Security','Firefighter','Paramedic','Doctor','Disaster',
    'Captain','Chief','FireChief','Supervisor','Dispatcher','ControlRoom','Operator',
    'Admin','SystemAdmin','SuperAdmin','System'
  );

  v_at := case
    when p_occurred_at is null then now()
    when p_occurred_at > now() then now()
    when p_occurred_at < now() - interval '12 hours' then now()
    else p_occurred_at
  end;
  v_queued := p_occurred_at is not null and v_at < now() - interval '30 seconds';

  -- The row lock makes leading first-come: a second crew member waits here,
  -- then joins as backup.
  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;

  if p_status = 'Closed' then
    raise exception 'Close % from its case file: closing is recorded with who closed it and why', v_incident.incident_number;
  end if;
  if p_status = 'Resolved' then
    raise exception 'Each department finishes % with its report, or is marked Not needed', v_incident.incident_number
      using hint = 'The lead files the report from the app.';
  end if;
  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text);
  end if;
  if p_status::text not in ('En Route', 'Arrived', 'On Scene', 'Transporting') then
    raise exception 'Choose En Route, Arrived, On Scene or Transporting' using errcode = '22023';
  end if;

  v_field := public.role_in('Responder','Police','Officer','Metro','Security','Firefighter',
                            'Paramedic','Doctor','Disaster','Captain');

  if not v_field then
    -- The desk or command: their own department, else the one under way.
    v_silo := coalesce(public.desk_silo(), nullif(public.current_silo(), 'Ethekwini'));
    if v_silo is null then
      select count(*), min(d.silo::text)::public.silo into v_count, v_silo
        from public.incident_departments d
       where d.incident_id = p_incident_id and public.department_open(d.status) and d.status <> 'Waiting';
      if v_count <> 1 then
        raise exception 'Choose the department on % to mark', v_incident.incident_number using errcode = '22023';
      end if;
    end if;
    return public.set_department_status(p_incident_id, v_silo, p_status);
  end if;

  select * into v_person from public.personnel
  where user_id = auth.uid() and tenant_id = public.current_tenant();
  v_silo := coalesce(v_person.silo, public.current_silo());

  perform public.ensure_incident_departments(v_incident);
  select * into v_dept from public.incident_departments
   where incident_id = p_incident_id and silo = v_silo
   for update;
  if not found or (v_dept.status = 'Waiting' and v_dept.assigned_to is distinct from auth.uid()) then
    raise exception '% was not sent to you', v_incident.incident_number;
  end if;
  if not public.department_open(v_dept.status) then
    raise exception '% — % has finished its part', v_incident.incident_number, public.department_label(v_silo);
  end if;

  select * into v_me from public.incident_responders
  where incident_id = p_incident_id and user_id = auth.uid();

  if not found then
    if p_status <> 'En Route' then
      raise exception 'Press Responding on % first', v_incident.incident_number;
    end if;
    if not coalesce(v_person.is_on_duty, false) then
      raise exception 'Go on duty to respond to incidents';
    end if;

    -- The assigned crew member leads their department's part; an open
    -- dispatch is led by whoever of the department responds first.
    v_lead := v_dept.lead_id is null
              and (v_dept.assigned_to is null or v_dept.assigned_to = auth.uid());

    insert into public.incident_responders (
      tenant_id, incident_id, user_id, silo, name, unit_id, role, status, joined_at
    ) values (
      v_incident.tenant_id, v_incident.id, auth.uid(), v_silo, v_name,
      v_person.assigned_apparatus_id, case when v_lead then 'lead' else 'backup' end, 'En Route', v_at
    ) returning * into v_me;
    v_joining := true;

    -- Where they set off from (0099): the progress line on the dispatch screens.
    select * into v_fix from public.fix_near(auth.uid(), v_at, interval '10 minutes');
    if v_fix.lat is not null and v_incident.location_lat is not null and v_incident.location_lng is not null then
      update public.incident_responders
         set start_lat = v_fix.lat, start_lng = v_fix.lng,
             start_distance_m = round(public.distance_m(v_fix.lat, v_fix.lng, v_incident.location_lat, v_incident.location_lng))::int
       where id = v_me.id
      returning * into v_me;
    end if;
  else
    v_lead := v_me.role = 'lead' and v_dept.lead_id is not distinct from auth.uid();

    -- Arriving (0099): the press is checked against where the phone was at
    -- that moment. Near the scene it is verified; far away (or no position)
    -- it still counts, so a dead GPS never stops an emergency, but it is
    -- flagged as not verified and dispatch and command are told at once.
    if p_status in ('Arrived', 'On Scene') and v_me.status = 'En Route' and v_me.arrived_at is null then
      v_dist := null;
      v_verified := null;
      if v_incident.location_lat is not null and v_incident.location_lng is not null then
        select * into v_fix from public.fix_near(auth.uid(), v_at, interval '3 minutes');
        v_radius := public.arrive_radius_m(v_incident.tenant_id);
        if v_fix.lat is not null then
          v_dist := round(public.distance_m(v_fix.lat, v_fix.lng, v_incident.location_lat, v_incident.location_lng))::int;
          v_verified := v_dist - least(coalesce(v_fix.accuracy, 0), 100) <= 2 * v_radius;
        else
          v_verified := false;
        end if;
      end if;
      return public.arrive_on_scene(p_incident_id, auth.uid(), v_at, 'officer', v_dist, v_verified, p_reason);
    end if;

    -- Replays and steps backwards along the ladder are no-ops.
    if v_rank ? p_status::text
       and (v_rank ->> p_status::text)::int <= coalesce((v_rank ->> v_me.status::text)::int, 0) then
      return v_incident;
    end if;
    if not v_lead and p_status not in ('Arrived', 'On Scene') then
      raise exception 'Backup marks en route and on scene; the lead closes % for %',
        v_incident.incident_number, public.department_label(v_silo);
    end if;
    update public.incident_responders
       set status = p_status, updated_at = now()
     where id = v_me.id;
  end if;

  if v_lead then
    update public.incident_departments
       set status      = case when public.department_step_rank(p_status::text) > public.department_step_rank(status)
                              then p_status::text else status end,
           lead_id     = case when v_joining then auth.uid() else lead_id end,
           lead_name   = case when v_joining then v_name else lead_name end,
           accepted_at = case when v_joining then v_at else accepted_at end,
           arrived_at  = case when p_status in ('Arrived', 'On Scene', 'Transporting') and arrived_at is null then v_at else arrived_at end,
           updated_at  = now()
     where id = v_dept.id;

    -- The call's own lead is the first department's lead.
    update public.incidents
       set acceptance          = case when p_status = 'En Route' then true else acceptance end,
           accepted_by         = case when v_joining and accepted_by is null then auth.uid() else accepted_by end,
           accepted_at         = case when v_joining and accepted_at is null then v_at else accepted_at end,
           unit_id             = case when v_joining and unit_id is null then v_person.assigned_apparatus_id else unit_id end,
           arrived_timestamp   = case
                                   when p_status in ('Arrived','On Scene','Transporting') and arrived_timestamp is null then v_at
                                   else arrived_timestamp
                                 end,
           responding_officer  = case when v_joining and accepted_by is null then v_name else coalesce(responding_officer, v_name) end,
           updated_at          = now()
     where id = p_incident_id;
    v_incident := public.sync_incident_from_departments(p_incident_id);
  else
    -- Backup leaves the status alone; the touch refreshes live screens.
    update public.incidents set updated_at = now() where id = p_incident_id
    returning * into v_incident;
  end if;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name, timestamp)
  values (
    v_incident.silo, v_incident.id,
    case when v_lead then '[STATUS] ' else format('[BACKUP] %s — ', v_name) end
      || p_status::text || ' · ' || public.department_label(v_silo)
      || case when v_queued then format(' (recorded offline, delivered %s later)', to_char(now() - v_at, 'HH24:MI:SS'))
              else '' end,
    auth.uid(), v_name, v_at
  );

  if v_joining then
    select unit_number into v_unit from public.apparatus where id = v_me.unit_id;
    insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name, timestamp)
    values (v_incident.silo, v_incident.id,
      format('[RESPONDING] %s%s responding%s', v_name, coalesce(' (' || v_unit || ')', ''),
             case when v_lead then format(' — leads %s', public.department_label(v_silo)) else ' as backup' end),
      auth.uid(), v_name, v_at);

    perform public.notify_incident_chain(
      v_incident, 'responding',
      case when v_lead then format('%s responding to %s (%s)', v_name, v_incident.incident_number, public.department_label(v_silo))
           else format('%s joined %s as backup', v_name, v_incident.incident_number) end,
      format('%s%s · %s', coalesce(v_unit || ' · ', ''), v_incident.incident_type, v_incident.location_address)
    );

    -- The department's lead hears about backup on the way.
    if not v_lead and v_dept.lead_id is not null and v_dept.lead_id <> auth.uid() then
      insert into public.alerts (
        tenant_id, silo, target_user_id, kind, severity, title, body, incident_id, link,
        presentation, requires_ack, created_by, created_by_name
      )
      select v_incident.tenant_id, p.silo, v_dept.lead_id, 'backup', v_incident.incident_severity::text,
             format('%s is joining you on %s', v_name, v_incident.incident_number),
             format('Backup%s en route', coalesce(' · ' || v_unit, '')),
             v_incident.id, format('/incidents/%s', v_incident.id),
             'toast', false, auth.uid(), v_name
      from public.personnel p
      where p.user_id = v_dept.lead_id and p.tenant_id = v_incident.tenant_id
      limit 1;
    end if;
  end if;

  return v_incident;
end $$;

revoke all on function public.update_responder_status(uuid, incident_status, timestamptz, text) from public, anon;
grant execute on function public.update_responder_status(uuid, incident_status, timestamptz, text) to authenticated, service_role;

-- ── 5. The desk marking a radio crew ────────────────────────────────────────

create or replace function public.set_department_status(p_incident_id uuid, p_silo public.silo, p_status incident_status)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_dept     public.incident_departments;
  v_name     text;
begin
  perform public.require_role(
    'Captain','Chief','FireChief','Supervisor','Dispatcher','ControlRoom','Operator',
    'Admin','SystemAdmin','SuperAdmin','SystemController','System'
  );
  select * into v_incident from public.incidents
   where id = p_incident_id and tenant_id = public.current_tenant()
   for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;
  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text);
  end if;
  if p_status::text not in ('En Route', 'Arrived', 'On Scene', 'Transporting') then
    raise exception 'Choose En Route, Arrived, On Scene or Transporting' using errcode = '22023';
  end if;
  if not public.can_direct_department(p_silo) then
    raise exception 'Only % dispatch or command, or the control room, marks its crew', public.department_label(p_silo)
      using errcode = '42501';
  end if;

  select * into v_dept from public.incident_departments
   where incident_id = p_incident_id and silo = p_silo
   for update;
  if not found or v_dept.status = 'Waiting' then
    raise exception '% has not dispatched % yet', public.department_label(p_silo), v_incident.incident_number
      using errcode = '22023';
  end if;
  if not public.department_open(v_dept.status) then
    raise exception '% has already finished its part on %', public.department_label(p_silo), v_incident.incident_number
      using errcode = '22023';
  end if;
  if public.department_step_rank(p_status::text) <= public.department_step_rank(v_dept.status) then
    return v_incident;
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  update public.incident_departments
     set status     = p_status::text,
         arrived_at = case when p_status in ('Arrived', 'On Scene', 'Transporting') and arrived_at is null then now() else arrived_at end,
         -- A crew on the radio, marked by the desk (0099): said so, not passed off as GPS.
         arrived_by = case when p_status in ('Arrived', 'On Scene', 'Transporting') and arrived_at is null then 'desk' else arrived_by end,
         updated_at = now()
   where id = v_dept.id;
  update public.incidents
     set arrived_timestamp = case when p_status in ('Arrived', 'On Scene', 'Transporting') and arrived_timestamp is null
                                  then now() else arrived_timestamp end,
         updated_at = now()
   where id = p_incident_id;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[STATUS] %s · %s (marked from the console by %s)', p_status, public.department_label(p_silo), coalesce(v_name, 'the desk')),
    auth.uid(), v_name);

  return public.sync_incident_from_departments(p_incident_id);
end $$;

-- ── 6. Each upload of fixes checks for arrivals ─────────────────────────────

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

  -- Arrival by GPS (0099): any call this officer is heading to that these
  -- points reach is marked on scene, at the time of the point.
  perform public.check_gps_arrivals(auth.uid());

  return coalesce(v_sent, 0);
end $$;

notify pgrst, 'reload schema';
