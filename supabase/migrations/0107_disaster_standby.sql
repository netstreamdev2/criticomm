-- ============================================================================
-- 0107 — Disaster Management on standby, and the assessment on site
-- ============================================================================
--
-- Run after 0106.
--
-- eThekwini's Disaster Management officers are not called to every incident.
-- They work a standby roster, continuously on call after hours; the 24-hour
-- Emergency Call Centre or the JOC calls them out when a flood, a fire in the
-- settlements, a storm or a major accident needs them. On site they do the
-- initial and needs assessment, give relief from it, and open a community
-- hall when people are displaced (eThekwini Disaster Management, 2025).
--
--   1. The standby register (disaster_standby): who is on standby, since
--      when, the number the call centre dials, and their kit. start_standby()
--      needs today's readiness check; a missing piece of kit is recorded for
--      the supervisor, not refused. end_standby() ends it. The register
--      follows the duty switch, so going on or off duty any other way (the
--      old switch, the end of shift, the expiry) keeps it right.
--   2. Standby lasts: a Disaster officer's duty expires after
--      disaster.max_standby_hours (Operations Settings, 168 = a week by
--      default, 12 to 336), not the 14-hour shift of the other services.
--   3. The assessment (disaster_assessments), one per place assessed —
--      street, block or hall: households and people affected, displaced,
--      injured, dead and missing, homes destroyed and damaged, the services
--      hit, what people need, the relief handed out and the shelter opened.
--      Filed on site by an officer on the call-out (or by command from the
--      desk) through file_disaster_assessment(), from the phone's outbox; a
--      replay returns the assessment filed. It goes on the timeline and to
--      dispatch and command. Permanent: a correction is a new assessment.
--
-- Safe to re-run.
-- ============================================================================

begin;

-- ── 1. The standby register ────────────────────────────────────────────────

create table if not exists public.disaster_standby (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default public.current_tenant(),
  silo           public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  user_id        uuid not null,
  name           text,
  contact_number text check (contact_number is null or contact_number ~ '^\+27[0-9]{9}$'),
  kit            jsonb not null default '{}'::jsonb,
  kit_missing    text[] not null default '{}',
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  end_reason     text,
  ended_by       uuid
);
comment on table public.disaster_standby is
  'Disaster Management standby register (0107): who is on standby, the number the call centre dials, their kit. Follows personnel.is_on_duty.';

create unique index if not exists disaster_standby_open
  on public.disaster_standby (tenant_id, user_id) where ended_at is null;
create index if not exists disaster_standby_when on public.disaster_standby (tenant_id, started_at desc);

alter table public.disaster_standby enable row level security;
drop policy if exists tenant_isolation on public.disaster_standby;
create policy tenant_isolation on public.disaster_standby as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
-- Disaster Management, and the call centre and control room who call them out.
drop policy if exists disaster_standby_read on public.disaster_standby;
create policy disaster_standby_read on public.disaster_standby for select to authenticated
  using (silo = public.current_silo() or public.is_global() or public.role_in('SystemController'));
revoke all on public.disaster_standby from anon;
revoke insert, update, delete on public.disaster_standby from authenticated;
grant select on public.disaster_standby to authenticated;

/** "+27821234567" from "082 123 4567", "+27 82 123 4567" or "27821234567"; null otherwise. */
create or replace function public.sa_cell(p text) returns text
language sql immutable set search_path to 'public' as $$
  select case
    when d ~ '^\+27[0-9]{9}$' then d
    when d ~ '^0[0-9]{9}$' then '+27' || substr(d, 2)
    when d ~ '^27[0-9]{9}$' then '+' || d
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g') as d) x
$$;

create or replace function public.standby_kit_keys() returns text[]
language sql immutable as $$
  select array['phone', 'vest', 'rain_gear', 'torch', 'id_card', 'transport']
$$;

create or replace function public.standby_kit_label(p text) returns text
language sql immutable as $$
  select case p
    when 'phone' then 'Phone charged and on loud' when 'vest' then 'Reflective vest'
    when 'rain_gear' then 'Raincoat and boots' when 'torch' then 'Torch'
    when 'id_card' then 'Work ID card' when 'transport' then 'Transport to get to a call-out' end
$$;

-- The register follows the duty switch: on standby is on duty for Disaster.
create or replace function public.follow_disaster_standby() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.silo is distinct from 'EthekwiniDisaster' or new.user_id is null then return null; end if;
  if new.is_on_duty and not exists (
       select 1 from public.disaster_standby s
        where s.tenant_id = new.tenant_id and s.user_id = new.user_id and s.ended_at is null) then
    insert into public.disaster_standby (tenant_id, user_id, name, contact_number)
    values (new.tenant_id, new.user_id, btrim(concat_ws(' ', nullif(btrim(coalesce(new.rank, '')), ''), new.first_name, new.last_name)),
            public.sa_cell(new.work_cellphone));
  elsif not new.is_on_duty then
    update public.disaster_standby
       set ended_at = now(), ended_by = auth.uid(),
           end_reason = coalesce(end_reason, case when auth.uid() is null then 'Ended automatically' else 'Off duty' end)
     where tenant_id = new.tenant_id and user_id = new.user_id and ended_at is null;
  end if;
  return null;
end $$;
revoke all on function public.follow_disaster_standby() from public, anon, authenticated;

drop trigger if exists follow_disaster_standby on public.personnel;
create trigger follow_disaster_standby after update of is_on_duty on public.personnel
  for each row when (old.is_on_duty is distinct from new.is_on_duty)
  execute function public.follow_disaster_standby();

-- ── 2. Starting and ending standby ─────────────────────────────────────────

create or replace function public.start_standby(p_fields jsonb)
returns public.disaster_standby
language plpgsql security definer set search_path to 'public' as $$
declare
  f        jsonb := coalesce(p_fields, '{}'::jsonb);
  v_kit    jsonb := case when jsonb_typeof(p_fields -> 'kit') = 'object' then p_fields -> 'kit' else '{}'::jsonb end;
  v_number text := public.sa_cell(p_fields ->> 'contact_number');
  v_person public.personnel;
  v_row    public.disaster_standby;
  v_key    text;
  v_clean  jsonb := '{}'::jsonb;
  v_missing text[] := '{}';
begin
  perform public.require_role('Disaster', 'Supervisor');
  if public.current_silo() is distinct from 'EthekwiniDisaster' then
    raise exception 'Only Disaster Management goes on standby' using errcode = '42501';
  end if;
  select * into v_person from public.personnel
   where user_id = auth.uid() and tenant_id = public.current_tenant();
  if not found then raise exception 'No personnel record is linked to this account' using errcode = 'P0001'; end if;
  if not public.shift_readiness_passed_today() then
    raise exception 'Complete today''s readiness check first' using errcode = 'P0001';
  end if;
  if v_number is null then
    raise exception 'Enter the number the call centre can call you on.' using errcode = 'P0001';
  end if;
  foreach v_key in array public.standby_kit_keys() loop
    if jsonb_typeof(v_kit -> v_key) is distinct from 'boolean' then
      raise exception 'Answer Yes or No for every item of kit.' using errcode = 'P0001';
    end if;
    v_clean := v_clean || jsonb_build_object(v_key, (v_kit ->> v_key)::boolean);
    if not (v_kit ->> v_key)::boolean then v_missing := v_missing || public.standby_kit_label(v_key); end if;
  end loop;

  -- Already on standby (a second tap, or the register opened by the duty
  -- switch): the number and kit are brought up to date.
  update public.disaster_standby
     set contact_number = v_number, kit = v_clean, kit_missing = v_missing
   where tenant_id = public.current_tenant() and user_id = auth.uid() and ended_at is null
  returning * into v_row;
  if not found then
    insert into public.disaster_standby (tenant_id, user_id, name, contact_number, kit, kit_missing)
    values (public.current_tenant(), auth.uid(),
            btrim(concat_ws(' ', nullif(btrim(coalesce(v_person.rank, '')), ''), v_person.first_name, v_person.last_name)),
            v_number, v_clean, v_missing)
    returning * into v_row;
  end if;

  if not v_person.is_on_duty then
    update public.personnel set is_on_duty = true, last_login = now() where id = v_person.id;
  end if;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_row.tenant_id, 'EthekwiniDisaster', auth.uid(), v_row.name, 'EthekwiniDisaster', 'STANDBY_STARTED', 'disaster_standby',
    v_row.id::text, format('On standby, reachable on %s%s', v_number,
      case when cardinality(v_missing) > 0 then '. Kit missing: ' || array_to_string(v_missing, ', ') else '' end));
  return v_row;
end $$;

revoke all on function public.start_standby(jsonb) from public, anon;
grant execute on function public.start_standby(jsonb) to authenticated;

create or replace function public.end_standby(p_reason text default null)
returns public.disaster_standby
language plpgsql security definer set search_path to 'public' as $$
declare
  v_row public.disaster_standby;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 300), '');
begin
  perform public.require_role('Disaster', 'Supervisor');
  if public.current_silo() is distinct from 'EthekwiniDisaster' then
    raise exception 'Only Disaster Management goes on standby' using errcode = '42501';
  end if;
  update public.disaster_standby
     set ended_at = now(), ended_by = auth.uid(), end_reason = coalesce(v_reason, 'Ended standby')
   where tenant_id = public.current_tenant() and user_id = auth.uid() and ended_at is null
  returning * into v_row;
  -- Off duty too; an officer leading an open call-out is held (0073) and
  -- the whole end is refused with its message.
  update public.personnel set is_on_duty = false
   where user_id = auth.uid() and tenant_id = public.current_tenant() and is_on_duty;
  if v_row.id is not null then
    insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
    values (v_row.tenant_id, 'EthekwiniDisaster', auth.uid(), v_row.name, 'EthekwiniDisaster', 'STANDBY_ENDED', 'disaster_standby',
      v_row.id::text, coalesce(v_reason, 'Ended standby'));
  end if;
  return v_row;
end $$;

revoke all on function public.end_standby(text) from public, anon;
grant execute on function public.end_standby(text) to authenticated;

-- ── 3. Standby lasts the roster's week, not a shift ────────────────────────

-- As 0041; a Disaster officer's duty is their standby, which expires after
-- disaster.max_standby_hours (default a week). Officers on an open call are
-- still held by hold_duty_during_call() until they file.
create or replace function public.expire_stale_duty() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  update public.personnel p
  set is_on_duty = false
  where p.is_on_duty
    and p.duty_started_at < now() - make_interval(hours => (case
      when p.silo = 'EthekwiniDisaster' then greatest(12, least(336, coalesce((
        select case when jsonb_typeof(s.value) = 'number' then (s.value)::text::numeric end
          from public.app_settings s
         where s.tenant_id = p.tenant_id and s.key = 'disaster.max_standby_hours'), 168)))
      else greatest(4, least(24, coalesce((
        select case when jsonb_typeof(s.value) = 'number' then (s.value)::text::numeric end
          from public.app_settings s
         where s.tenant_id = p.tenant_id and s.key = 'duty.max_shift_hours'), 14)))
    end)::int);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.expire_stale_duty() from public, anon, authenticated;

-- ── 4. The assessment on site ──────────────────────────────────────────────

create table if not exists public.disaster_assessments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null default public.current_tenant(),
  silo                public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  incident_id         uuid not null references public.incidents (id) on delete cascade,
  client_ref          uuid,
  place               text not null check (length(place) between 1 and 200),
  ward                text check (ward is null or length(ward) <= 40),
  hazard              text not null check (hazard in ('Flooding', 'Storm or wind', 'Fire', 'Landslide', 'Building collapse',
                                                      'Hazardous spill', 'Major accident', 'Other')),
  households_affected int not null default 0 check (households_affected between 0 and 999999),
  people_affected     int not null default 0 check (people_affected between 0 and 999999),
  people_displaced    int not null default 0 check (people_displaced between 0 and 999999),
  injured             int not null default 0 check (injured between 0 and 999999),
  deaths              int not null default 0 check (deaths between 0 and 999999),
  missing             int not null default 0 check (missing between 0 and 999999),
  homes_destroyed     int not null default 0 check (homes_destroyed between 0 and 999999),
  homes_damaged       int not null default 0 check (homes_damaged between 0 and 999999),
  services            text[] not null default '{}',
  needs               text[] not null default '{}',
  relief              jsonb not null default '{}'::jsonb,
  shelter_name        text check (shelter_name is null or length(shelter_name) <= 200),
  people_sheltered    int not null default 0 check (people_sheltered between 0 and 999999),
  notes               text check (notes is null or length(notes) <= 2000),
  lat                 double precision,
  lng                 double precision,
  accuracy            real,
  filed_by            uuid not null default auth.uid(),
  filed_by_name       text,
  filed_at            timestamptz not null default now()
);
comment on table public.disaster_assessments is
  'Disaster Management initial and needs assessment (0107), one per place assessed; filed by file_disaster_assessment() only, permanent.';

create unique index if not exists disaster_assessments_client_ref
  on public.disaster_assessments (tenant_id, client_ref) where client_ref is not null;
create index if not exists disaster_assessments_incident on public.disaster_assessments (incident_id, filed_at);

alter table public.disaster_assessments enable row level security;
drop policy if exists tenant_isolation on public.disaster_assessments;
create policy tenant_isolation on public.disaster_assessments as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
drop policy if exists disaster_assessments_read on public.disaster_assessments;
create policy disaster_assessments_read on public.disaster_assessments for select to authenticated
  using (silo = public.current_silo() or public.is_global() or public.can_work_incident(incident_id)
         or public.role_in('CaseManager', 'SystemController'));
revoke all on public.disaster_assessments from anon;
revoke insert, update, delete on public.disaster_assessments from authenticated;
grant select on public.disaster_assessments to authenticated;

create or replace function public.guard_disaster_assessment() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  raise exception 'A filed assessment cannot be changed or deleted. File a new one.' using errcode = 'P0001';
end $$;
drop trigger if exists guard_disaster_assessment on public.disaster_assessments;
create trigger guard_disaster_assessment before update or delete on public.disaster_assessments
  for each row execute function public.guard_disaster_assessment();

create or replace function public.file_disaster_assessment(p_incident_id uuid, p_client_ref uuid, p_fields jsonb)
returns public.disaster_assessments
language plpgsql security definer set search_path to 'public' as $$
declare
  f          jsonb := coalesce(p_fields, '{}'::jsonb);
  v          public.disaster_assessments;
  v_incident public.incidents;
  v_me       public.incident_responders;
  v_command  boolean := public.role_in('Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin');
  v_place    text := nullif(left(btrim(coalesce(p_fields ->> 'place', '')), 200), '');
  v_ward     text := nullif(left(btrim(coalesce(p_fields ->> 'ward', '')), 40), '');
  v_hazard   text := btrim(coalesce(p_fields ->> 'hazard', ''));
  v_shelter  text := nullif(left(btrim(coalesce(p_fields ->> 'shelter_name', '')), 200), '');
  v_notes    text := nullif(btrim(coalesce(p_fields ->> 'notes', '')), '');
  v_key      text;
  v_txt      text;
  v_relief   jsonb := '{}'::jsonb;
  v_services text[];
  v_needs    text[];
  v_lat      double precision;
  v_lng      double precision;
  v_acc      real;
  v_name     text;
begin
  perform public.require_role('Disaster', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin');
  if public.current_silo() is distinct from 'EthekwiniDisaster' then
    raise exception 'Only Disaster Management files an assessment' using errcode = '42501';
  end if;
  if p_client_ref is null then
    raise exception 'The assessment has no reference; open it again and file it' using errcode = '22023';
  end if;
  select * into v from public.disaster_assessments
   where tenant_id = public.current_tenant() and client_ref = p_client_ref;
  if found then return v; end if;

  select * into v_incident from public.incidents
   where id = p_incident_id and tenant_id = public.current_tenant();
  if not found then raise exception 'Incident % not found', p_incident_id using errcode = 'P0002'; end if;
  if not (v_incident.silo = 'EthekwiniDisaster'
          or 'EthekwiniDisaster' = any (coalesce(v_incident.dispatched_silos, '{}'))
          or 'EthekwiniDisaster' = any (coalesce(v_incident.tagged_silos, '{}'))) then
    raise exception '% was not sent to Disaster Management', v_incident.incident_number using errcode = 'P0001';
  end if;
  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text) using errcode = 'P0001';
  end if;

  -- On site: an officer on the call-out, there (by GPS, by hand, or marked by
  -- the desk); command may file from the desk.
  if not v_command then
    select * into v_me from public.incident_responders
     where incident_id = p_incident_id and user_id = auth.uid();
    if not found then
      raise exception 'Accept the call-out to % first', v_incident.incident_number using errcode = 'P0001';
    end if;
    if v_me.arrived_at is null and v_me.status::text not in ('Arrived', 'On Scene', 'Transporting') then
      raise exception 'You are not at % yet: the assessment is done on site', v_incident.incident_number using errcode = 'P0001';
    end if;
  end if;

  if v_place is null then raise exception 'Say where you assessed (street, block or hall).' using errcode = 'P0001'; end if;
  if v_hazard not in ('Flooding', 'Storm or wind', 'Fire', 'Landslide', 'Building collapse', 'Hazardous spill', 'Major accident', 'Other') then
    raise exception 'Choose what happened.' using errcode = 'P0001';
  end if;
  foreach v_key in array array['households_affected', 'people_affected', 'people_displaced', 'injured', 'deaths', 'missing',
                               'homes_destroyed', 'homes_damaged', 'people_sheltered'] loop
    v_txt := coalesce(p_fields ->> v_key, '0');
    if v_txt !~ '^[0-9]{1,6}$' then raise exception 'Counts are whole numbers.' using errcode = 'P0001'; end if;
  end loop;
  if jsonb_typeof(f -> 'relief') = 'object' then
    foreach v_key in array array['blankets', 'mattresses', 'food_parcels', 'hygiene_packs', 'hot_meals'] loop
      v_txt := coalesce(f -> 'relief' ->> v_key, '0');
      if v_txt !~ '^[0-9]{1,6}$' then raise exception 'Counts are whole numbers.' using errcode = 'P0001'; end if;
      v_relief := v_relief || jsonb_build_object(v_key, v_txt::int);
    end loop;
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_services
    from jsonb_array_elements_text(case when jsonb_typeof(f -> 'services') = 'array' then f -> 'services' else '[]'::jsonb end) x
   where x in ('Roads', 'Bridges', 'Electricity', 'Water', 'Sanitation', 'Schools', 'Clinics');
  select coalesce(array_agg(distinct x order by x), '{}') into v_needs
    from jsonb_array_elements_text(case when jsonb_typeof(f -> 'needs') = 'array' then f -> 'needs' else '[]'::jsonb end) x
   where x in ('Food', 'Blankets', 'Mattresses', 'Hygiene packs', 'Shelter', 'Drinking water', 'Clothing',
               'School uniforms', 'Building material', 'Medical care', 'Counselling');
  if (p_fields ->> 'people_sheltered')::int > 0 and v_shelter is null then
    raise exception 'Name the hall or shelter.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_notes, '')) > 2000 then
    raise exception 'Keep the notes under 2000 characters.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(f -> 'lat') = 'number' and jsonb_typeof(f -> 'lng') = 'number' then
    v_lat := (f ->> 'lat')::double precision;
    v_lng := (f ->> 'lng')::double precision;
    if v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      v_lat := null; v_lng := null;
    elsif jsonb_typeof(f -> 'accuracy') = 'number' then
      v_acc := least((f ->> 'accuracy')::numeric, 100000)::real;
    end if;
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();

  insert into public.disaster_assessments (
    tenant_id, incident_id, client_ref, place, ward, hazard,
    households_affected, people_affected, people_displaced, injured, deaths, missing, homes_destroyed, homes_damaged,
    services, needs, relief, shelter_name, people_sheltered, notes, lat, lng, accuracy, filed_by, filed_by_name
  ) values (
    v_incident.tenant_id, v_incident.id, p_client_ref, v_place, v_ward, v_hazard,
    coalesce(p_fields ->> 'households_affected', '0')::int, coalesce(p_fields ->> 'people_affected', '0')::int,
    coalesce(p_fields ->> 'people_displaced', '0')::int, coalesce(p_fields ->> 'injured', '0')::int,
    coalesce(p_fields ->> 'deaths', '0')::int, coalesce(p_fields ->> 'missing', '0')::int,
    coalesce(p_fields ->> 'homes_destroyed', '0')::int, coalesce(p_fields ->> 'homes_damaged', '0')::int,
    v_services, v_needs, v_relief, v_shelter, coalesce(p_fields ->> 'people_sheltered', '0')::int, v_notes,
    v_lat, v_lng, v_acc, auth.uid(), v_name
  ) returning * into v;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[ASSESSMENT] %s: %s households affected, %s displaced, %s homes destroyed, %s damaged%s%s — %s',
      v.place, v.households_affected, v.people_displaced, v.homes_destroyed, v.homes_damaged,
      case when v.injured + v.deaths + v.missing > 0
           then format('; %s injured, %s dead, %s missing', v.injured, v.deaths, v.missing) else '' end,
      case when v.people_sheltered > 0 then format('; %s sheltered at %s', v.people_sheltered, v.shelter_name) else '' end,
      coalesce(v_name, 'Disaster Management')),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_ASSESSMENT',
    'incidents', v_incident.id::text, format('%s · %s · %s households, %s displaced', v_incident.incident_number, v.place,
      v.households_affected, v.people_displaced));

  perform public.notify_incident_chain(
    v_incident, 'incident_update',
    format('%s: assessment at %s', v_incident.incident_number, v.place),
    format('%s households affected · %s displaced · %s homes destroyed', v.households_affected, v.people_displaced, v.homes_destroyed));

  return v;
end $$;

revoke all on function public.file_disaster_assessment(uuid, uuid, jsonb) from public, anon;
grant execute on function public.file_disaster_assessment(uuid, uuid, jsonb) to authenticated;

-- ── 5. Prove it ────────────────────────────────────────────────────────────

do $$
declare
  v_bad text;
begin
  select string_agg(t, ', ') into v_bad
    from unnest(array['disaster_standby', 'disaster_assessments']) t
   where not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t
                      and p.policyname = 'tenant_isolation' and p.permissive = 'RESTRICTIVE');
  if v_bad is not null then raise exception 'No tenant wall on: % — nothing was changed', v_bad; end if;
  select string_agg(tablename || '.' || policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'public' and tablename in ('disaster_standby', 'disaster_assessments')
     and permissive = 'PERMISSIVE' and cmd <> 'SELECT';
  if v_bad is not null then raise exception 'Write policies found on %: nothing was changed', v_bad; end if;
end $$;

commit;

notify pgrst, 'reload schema';
