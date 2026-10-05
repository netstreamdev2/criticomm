-- ============================================================================
-- 0053 — Perimeters and zones drawn on the live map
--
-- Command and control-room staff draw a cordon, exclusion or evacuation area,
-- a search area, a road closure, a staging point… on the live map, say why,
-- and choose who sees it:
--
--   private      only the person who drew it (a working draft)
--   department   their own department
--   departments  the departments they pick (Police, Fire, EMS, Disaster, Control Room)
--   incident     every department working the linked call
--   everyone     the whole organisation
--
-- Consoles receive shared zones live (Realtime on this table) and show who
-- set each one, when and why. Nothing here writes to `alerts`, which the
-- officer app reads: sending perimeters to officers' phones is a later phase.
--
-- Writes go only through save_map_zone() and end_map_zone(), which check the
-- role, validate the geometry with PostGIS, record the change history and
-- write the audit log. A zone is never deleted; it is stood down, with a
-- reason, and keeps its history.
-- ============================================================================

create table if not exists public.map_zones (
  id               uuid primary key default uuid_generate_v4(),
  tenant_id        uuid not null default public.current_tenant(),
  -- The department of the person who set it.
  silo             silo not null,
  kind             text not null check (kind in (
                     'cordon', 'exclusion', 'evacuation', 'hazard', 'search',
                     'road_closure', 'route', 'staging', 'command_post', 'rendezvous',
                     'last_seen', 'note')),
  shape            text not null check (shape in ('polygon', 'circle', 'line', 'point')),
  -- GeoJSON (WGS84): Polygon, LineString, or Point — a circle is its centre point.
  geometry         jsonb not null,
  radius_m         double precision,
  -- The shape as PostGIS, a circle buffered from its centre; set by save_map_zone().
  geog             geography,
  -- Geodesic measurements from PostGIS, so every screen shows the same figures.
  area_m2          double precision,
  length_m         double precision,
  name             text not null check (char_length(name) between 1 and 120),
  reason           text check (reason is null or char_length(reason) <= 1000),
  incident_id      uuid references public.incidents(id) on delete set null,
  visibility       text not null check (visibility in ('private', 'department', 'departments', 'incident', 'everyone')),
  shared_silos     silo[] not null default '{}',
  active_until     timestamptz,
  status           text not null default 'active' check (status in ('active', 'ended')),
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_by_name  text,
  created_by_role  user_role,
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null,
  updated_by_name  text,
  updated_at       timestamptz not null default now(),
  ended_by         uuid references auth.users(id) on delete set null,
  ended_by_name    text,
  ended_at         timestamptz,
  end_reason       text,
  constraint map_zones_radius check (
    (shape = 'circle') = (radius_m is not null) and (radius_m is null or radius_m between 1 and 50000)),
  constraint map_zones_shared_needs_reason check (
    visibility = 'private' or char_length(btrim(coalesce(reason, ''))) >= 3),
  constraint map_zones_incident_visibility check (visibility <> 'incident' or incident_id is not null),
  constraint map_zones_departments_chosen check (visibility <> 'departments' or cardinality(shared_silos) > 0),
  constraint map_zones_ended check ((status = 'ended') = (ended_at is not null))
);

create index if not exists map_zones_tenant_idx on public.map_zones (tenant_id);
create index if not exists map_zones_live_idx on public.map_zones (tenant_id, status, active_until);
create index if not exists map_zones_incident_idx on public.map_zones (incident_id);
create index if not exists map_zones_geog_idx on public.map_zones using gist (geog);

-- What happened to each zone, in order: shown on the zone's card.
create table if not exists public.map_zone_events (
  id          bigserial primary key,
  tenant_id   uuid not null default public.current_tenant(),
  zone_id     uuid not null references public.map_zones(id) on delete cascade,
  at          timestamptz not null default now(),
  actor       uuid references auth.users(id) on delete set null default auth.uid(),
  actor_name  text,
  actor_role  user_role,
  action      text not null check (action in ('created', 'edited', 'ended')),
  details     text
);
create index if not exists map_zone_events_zone_idx on public.map_zone_events (zone_id, at);

-- ── Who sees a zone ─────────────────────────────────────────────────────────

-- The control-room tier (is_global) sees every shared zone, as it sees every
-- department's records. A private zone is its author's alone.
create or replace function public.can_see_map_zone(z public.map_zones)
returns boolean language sql stable security definer set search_path = public as $$
  select z.tenant_id = public.current_tenant() and (
    z.created_by = auth.uid()
    or (z.visibility <> 'private' and (
         z.visibility = 'everyone'
      or public.is_global()
      or z.silo = public.current_silo()
      or (z.visibility = 'departments' and public.current_silo() = any (z.shared_silos))
      or (z.visibility = 'incident' and exists (
            select 1 from public.incidents i
             where i.id = z.incident_id
               and (i.silo = public.current_silo()
                    or public.current_silo() = any (coalesce(i.dispatched_silos, '{}'::silo[])))))
    ))
  );
$$;

-- Who may change or stand one down: its author, the control room and command
-- tier, and a department's commanders for their own department's zones.
create or replace function public.can_manage_map_zone(z public.map_zones)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_see_map_zone(z) and (
    z.created_by = auth.uid()
    or public.role_in('SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'Supervisor', 'ControlRoom', 'Dispatcher')
    or (public.role_in('Captain', 'FireChief', 'Disaster') and z.silo = public.current_silo())
  );
$$;

alter table public.map_zones enable row level security;
alter table public.map_zone_events enable row level security;

drop policy if exists map_zones_read on public.map_zones;
create policy map_zones_read on public.map_zones for select to authenticated
  using (public.can_see_map_zone(map_zones));

drop policy if exists tenant_isolation on public.map_zones;
create policy tenant_isolation on public.map_zones as restrictive for all to authenticated
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

-- A zone's history is readable by whoever can read the zone.
drop policy if exists map_zone_events_read on public.map_zone_events;
create policy map_zone_events_read on public.map_zone_events for select to authenticated
  using (exists (select 1 from public.map_zones z where z.id = map_zone_events.zone_id));

drop policy if exists tenant_isolation on public.map_zone_events;
create policy tenant_isolation on public.map_zone_events as restrictive for all to authenticated
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

-- Reads only; every write goes through the functions below.
revoke insert, update, delete on public.map_zones from anon, authenticated;
revoke insert, update, delete on public.map_zone_events from anon, authenticated;
revoke all on public.map_zones from anon;
revoke all on public.map_zone_events from anon;
grant select on public.map_zones to authenticated;
grant select on public.map_zone_events to authenticated;

-- ── Saving a zone (new, or a change to one) ─────────────────────────────────

create or replace function public.save_map_zone(
  p_id            uuid,
  p_kind          text,
  p_shape         text,
  p_geometry      jsonb,
  p_radius_m      double precision,
  p_name          text,
  p_reason        text,
  p_incident_id   uuid,
  p_visibility    text,
  p_shared_silos  silo[],
  p_active_until  timestamptz
) returns public.map_zones
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_me        public.profiles;
  v_zone      public.map_zones;
  v_geom      geometry;
  v_geog      geography;
  v_type      text;
  v_area      double precision;
  v_length    double precision;
  v_incident  public.incidents;
  v_shared    silo[] := '{}';
  v_name      text := btrim(coalesce(p_name, ''));
  v_reason    text := nullif(btrim(coalesce(p_reason, '')), '');
  v_changes   text[] := '{}';
begin
  perform public.require_role('SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'Supervisor',
    'Dispatcher', 'ControlRoom', 'IncidentLogger', 'Captain', 'FireChief', 'Disaster');
  select * into v_me from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Your account is not active' using errcode = '42501'; end if;

  if v_name = '' then raise exception 'Give the zone a name' using errcode = '22023'; end if;
  if p_visibility <> 'private' and char_length(coalesce(v_reason, '')) < 3 then
    raise exception 'Say why this zone is being set — the people who receive it will see the reason'
      using errcode = '22023';
  end if;

  -- The drawn shape, read and checked by PostGIS.
  begin
    v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_geometry::text), 4326);
  exception when others then
    raise exception 'The drawn shape could not be read' using errcode = '22023';
  end;
  v_type := GeometryType(v_geom);
  if ST_XMin(v_geom) < -180 or ST_XMax(v_geom) > 180 or ST_YMin(v_geom) < -90 or ST_YMax(v_geom) > 90 then
    raise exception 'The shape has coordinates outside the map' using errcode = '22023';
  end if;

  if p_shape = 'polygon' then
    if v_type <> 'POLYGON' then raise exception 'An area must be a single polygon' using errcode = '22023'; end if;
    if ST_NumInteriorRings(v_geom) > 0 then raise exception 'An area cannot have holes' using errcode = '22023'; end if;
    if ST_NPoints(v_geom) - 1 < 3 then raise exception 'An area needs at least three points' using errcode = '22023'; end if;
    if ST_NPoints(v_geom) > 501 then raise exception 'An area can have at most 500 points' using errcode = '22023'; end if;
    if not ST_IsValid(v_geom) then
      raise exception 'The area''s edges cross each other — move the points so they do not' using errcode = '22023';
    end if;
    v_geog := v_geom::geography;
    v_area := ST_Area(v_geog);
    v_length := ST_Perimeter(v_geog);
  elsif p_shape = 'circle' then
    if v_type <> 'POINT' then raise exception 'A circle is saved as its centre point' using errcode = '22023'; end if;
    if p_radius_m is null or p_radius_m < 1 or p_radius_m > 50000 then
      raise exception 'A circle''s radius must be between 1 m and 50 km' using errcode = '22023';
    end if;
    v_geog := ST_Buffer(v_geom::geography, p_radius_m, 'quad_segs=32');
    v_area := pi() * p_radius_m * p_radius_m;
    v_length := 2 * pi() * p_radius_m;
  elsif p_shape = 'line' then
    if v_type <> 'LINESTRING' then raise exception 'A line must be a single line' using errcode = '22023'; end if;
    if ST_NPoints(v_geom) < 2 then raise exception 'A line needs at least two points' using errcode = '22023'; end if;
    if ST_NPoints(v_geom) > 500 then raise exception 'A line can have at most 500 points' using errcode = '22023'; end if;
    v_geog := v_geom::geography;
    v_length := ST_Length(v_geog);
  elsif p_shape = 'point' then
    if v_type <> 'POINT' then raise exception 'A point must be a single point' using errcode = '22023'; end if;
    v_geog := v_geom::geography;
  else
    raise exception 'Unknown shape %', p_shape using errcode = '22023';
  end if;
  if p_shape <> 'circle' and p_radius_m is not null then
    raise exception 'Only a circle has a radius' using errcode = '22023';
  end if;

  -- The call it belongs to: one this person can see, and still open.
  if p_incident_id is not null then
    select * into v_incident from public.incidents
     where id = p_incident_id and tenant_id = public.current_tenant();
    if not found or not (
      public.is_global() or v_incident.silo = v_me.silo
      or v_me.silo = any (coalesce(v_incident.dispatched_silos, '{}'::silo[]))
    ) then
      raise exception 'That call was not found' using errcode = '22023';
    end if;
    if v_incident.status in ('Closed', 'Resolved') then
      raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text)
        using errcode = '22023';
    end if;
  end if;

  if p_visibility = 'departments' then
    select coalesce(array_agg(distinct s), '{}') into v_shared from unnest(coalesce(p_shared_silos, '{}')) s;
    if cardinality(v_shared) = 0 then
      raise exception 'Choose at least one department to share with' using errcode = '22023';
    end if;
  end if;
  if p_visibility = 'incident' and p_incident_id is null then
    raise exception 'Choose the call whose crews should see this' using errcode = '22023';
  end if;

  if p_active_until is not null and (p_active_until <= now() or p_active_until > now() + interval '30 days') then
    raise exception 'The end time must be in the future and within 30 days' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.map_zones (
      silo, kind, shape, geometry, radius_m, geog, area_m2, length_m, name, reason, incident_id,
      visibility, shared_silos, active_until, created_by, created_by_name, created_by_role,
      updated_by, updated_by_name
    ) values (
      v_me.silo, p_kind, p_shape, p_geometry, p_radius_m, v_geog, v_area, v_length, v_name, v_reason, p_incident_id,
      p_visibility, v_shared, p_active_until, auth.uid(), v_me.full_name, v_me.role,
      auth.uid(), v_me.full_name
    ) returning * into v_zone;

    insert into public.map_zone_events (zone_id, actor_name, actor_role, action, details)
    values (v_zone.id, v_me.full_name, v_me.role, 'created', v_reason);

    insert into public.audit_logs (silo, user_id, user_name, action_type, entity_type, entity_id, details)
    values (v_me.silo, auth.uid(), v_me.full_name, 'MapZoneSet', 'map_zone', v_zone.id::text,
      format('%s "%s" (%s, shared: %s)%s', p_kind, v_name, p_shape, p_visibility,
             coalesce(' — ' || v_reason, '')));
    return v_zone;
  end if;

  select * into v_zone from public.map_zones
   where id = p_id and tenant_id = public.current_tenant()
   for update;
  if not found or not public.can_see_map_zone(v_zone) then
    raise exception 'That zone was not found' using errcode = '22023';
  end if;
  if v_zone.status = 'ended' then
    raise exception 'That zone has been stood down. Draw a new one instead.' using errcode = '22023';
  end if;
  if not public.can_manage_map_zone(v_zone) then
    raise exception 'Only the person who set this zone, the control room or command staff can change it'
      using errcode = '42501';
  end if;

  if v_zone.geometry is distinct from p_geometry or v_zone.radius_m is distinct from p_radius_m
     or v_zone.shape is distinct from p_shape then v_changes := v_changes || 'shape'::text; end if;
  if v_zone.kind is distinct from p_kind then v_changes := v_changes || 'type'::text; end if;
  if v_zone.name is distinct from v_name then v_changes := v_changes || 'name'::text; end if;
  if v_zone.reason is distinct from v_reason then v_changes := v_changes || 'reason'::text; end if;
  if v_zone.incident_id is distinct from p_incident_id then v_changes := v_changes || 'linked call'::text; end if;
  if v_zone.visibility is distinct from p_visibility or v_zone.shared_silos is distinct from v_shared then
    v_changes := v_changes || 'who sees it'::text;
  end if;
  if v_zone.active_until is distinct from p_active_until then v_changes := v_changes || 'end time'::text; end if;
  if cardinality(v_changes) = 0 then return v_zone; end if;

  update public.map_zones set
    kind = p_kind, shape = p_shape, geometry = p_geometry, radius_m = p_radius_m, geog = v_geog,
    area_m2 = v_area, length_m = v_length, name = v_name, reason = v_reason, incident_id = p_incident_id,
    visibility = p_visibility, shared_silos = v_shared, active_until = p_active_until,
    updated_by = auth.uid(), updated_by_name = v_me.full_name, updated_at = now()
  where id = v_zone.id
  returning * into v_zone;

  insert into public.map_zone_events (zone_id, actor_name, actor_role, action, details)
  values (v_zone.id, v_me.full_name, v_me.role, 'edited', 'Changed ' || array_to_string(v_changes, ', '));

  insert into public.audit_logs (silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_zone.silo, auth.uid(), v_me.full_name, 'MapZoneChanged', 'map_zone', v_zone.id::text,
    format('"%s": changed %s', v_zone.name, array_to_string(v_changes, ', ')));
  return v_zone;
end $$;

-- ── Standing a zone down ────────────────────────────────────────────────────

create or replace function public.end_map_zone(p_id uuid, p_reason text)
returns public.map_zones
language plpgsql security definer set search_path = public as $$
declare
  v_me     public.profiles;
  v_zone   public.map_zones;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_me from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Your account is not active' using errcode = '42501'; end if;

  select * into v_zone from public.map_zones
   where id = p_id and tenant_id = public.current_tenant()
   for update;
  if not found or not public.can_see_map_zone(v_zone) then
    raise exception 'That zone was not found' using errcode = '22023';
  end if;
  if v_zone.status = 'ended' then return v_zone; end if;
  if not public.can_manage_map_zone(v_zone) then
    raise exception 'Only the person who set this zone, the control room or command staff can stand it down'
      using errcode = '42501';
  end if;
  if v_zone.visibility <> 'private' and char_length(coalesce(v_reason, '')) < 3 then
    raise exception 'Say why it is being stood down' using errcode = '22023';
  end if;

  update public.map_zones set
    status = 'ended', ended_by = auth.uid(), ended_by_name = v_me.full_name, ended_at = now(),
    end_reason = v_reason, updated_by = auth.uid(), updated_by_name = v_me.full_name, updated_at = now()
  where id = v_zone.id
  returning * into v_zone;

  insert into public.map_zone_events (zone_id, actor_name, actor_role, action, details)
  values (v_zone.id, v_me.full_name, v_me.role, 'ended', v_reason);

  insert into public.audit_logs (silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_zone.silo, auth.uid(), v_me.full_name, 'MapZoneStoodDown', 'map_zone', v_zone.id::text,
    format('"%s" stood down%s', v_zone.name, coalesce(' — ' || v_reason, '')));
  return v_zone;
end $$;

revoke all on function public.can_see_map_zone(public.map_zones) from public, anon;
revoke all on function public.can_manage_map_zone(public.map_zones) from public, anon;
revoke all on function public.save_map_zone(uuid, text, text, jsonb, double precision, text, text, uuid, text, silo[], timestamptz)
  from public, anon;
revoke all on function public.end_map_zone(uuid, text) from public, anon;
grant execute on function public.can_see_map_zone(public.map_zones) to authenticated;
grant execute on function public.can_manage_map_zone(public.map_zones) to authenticated;
grant execute on function public.save_map_zone(uuid, text, text, jsonb, double precision, text, text, uuid, text, silo[], timestamptz)
  to authenticated;
grant execute on function public.end_map_zone(uuid, text) to authenticated;

-- Consoles watch zones appear, change and stand down.
do $$
begin
  alter publication supabase_realtime add table public.map_zones;
exception when duplicate_object then null;
          when undefined_object then null;
end $$;
