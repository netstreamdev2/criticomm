-- ============================================================================
-- 0112 — The Disaster desk, the eThekwini way
-- ============================================================================
--
-- Run after 0111.
--
-- Follows the eThekwini Municipal Disaster Management Plan (rev. 7 Aug 2012,
-- ratified by EXCO 13 Aug 2013) and its terms: an incident is reported to
-- EMACC; services co-ordinate at a Forward Control Point (FCP); a joint
-- Emergency Operations Centre (EOC) may be set up on site; the Disaster
-- Operations Centre (DOC) is activated and the Strategic Co-ordination Group
-- (SCG) called into session for a major emergency or disaster; sitreps keep
-- everyone informed.
--
--   1. The call, Disaster's way (disaster_call_facts): a short title, the
--      hazard from the Plan's Classification of Potential Hazards, the
--      municipalities affected, and the level of command, control and
--      co-ordination: Bronze (tactical: EMACC and an FCP), Silver
--      (operations: a joint EOC on site), Gold (strategic: the DOC activated
--      and the SCG in session). set_disaster_call(), set_coordination_level().
--   2. Partners are public: organs of state, the City's line functions and
--      civil society relief organisations. Private ambulance, hospital and
--      security companies are taken off the list (kept, switched off, for
--      the record). Each number says whether it has been checked; an
--      administrator confirms or corrects it (save_mutual_aid_partner()).
--   3. Shelters and reception centres (disaster_shelters): council halls and
--      other facilities, with key holders and capacity, kept by the desk.
--      A shelter is opened for a call; arrivals, departures and the relief
--      given (meals, blankets …) are logged against it; space left is
--      capacity minus people there now; it is closed when everyone has
--      left. open_ / update_ / close_disaster_shelter().
--   4. Disaster Management's own officers go out without the app: the desk
--      calls them out like a partner (disaster_call_out with officer_id) and
--      files their on-site assessment for them. Their duty roster
--      (disaster_duty: on duty or on standby, and their duty: Principal
--      Disaster Management Stand-by Officer, MDMC Duty Officer …) and the
--      SCG duty chair for each month (disaster_scg_chairs).
--   5. The post-mortem knows the call: the title, hazard, highest level,
--      municipalities, partners and officers called out, shelters opened and
--      the people sheltered are taken from the record when it is filed.
--
-- Writes only through the functions here (SECURITY DEFINER, checked,
-- audited, on the call's timeline); no writes from a signed-in user directly;
-- nothing for anonymous users. Safe to re-run.
-- ============================================================================

begin;

-- 0112 builds on the assessment (0107) and the Disaster desk (0111).
do $$
begin
  if to_regclass('public.disaster_assessments') is null then
    raise exception 'Run 0107_disaster_standby.sql first, then this one. Nothing was changed.';
  end if;
  if to_regclass('public.disaster_callouts') is null then
    raise exception 'Run 0111_disaster_desk.sql first, then this one. Nothing was changed.';
  end if;
end $$;

-- ── 0. The Plan's lists ─────────────────────────────────────────────────────

-- Classification of Potential Hazards (the Plan, pp. 7–8), each with its group.
create or replace function public.disaster_hazard_group(p text) returns text
language sql immutable as $$
  select case
    when p in ('Cyclone, hurricane or tornado', 'Storm tide', 'Severe storm', 'Wildfire', 'Extreme temperature', 'Drought', 'Flood')
      then 'Natural: meteorological'
    when p in ('Earthquake', 'Landslip or debris flow', 'Erosion', 'Tsunami', 'Major sinkhole')
      then 'Natural: geological'
    when p in ('Epidemic human disease', 'Animal disease', 'Insect or vermin plague', 'Food and crop disease', 'Emerging catastrophic disease')
      then 'Natural: biological'
    when p in ('Civil disturbance or riot', 'Terrorist attack', 'Arson', 'Sabotage of essential services', 'Shooting or massacre',
               'IT virus or systems compromise')
      then 'Non-natural: human caused'
    when p in ('Structural collapse', 'Failure of critical infrastructure or services', 'Hazardous materials accident',
               'Industrial accident', 'Nuclear power accident', 'Dam failure', 'Aeronautical or space', 'Structure or informal settlement fire',
               'Major transport accident')
      then 'Non-natural: technological'
    when p = 'Other' then 'Other'
  end
$$;

create or replace function public.disaster_municipalities() returns text[]
language sql immutable as $$
  select array['eThekwini Metro', 'Amajuba', 'Harry Gwala', 'iLembe', 'King Cetshwayo', 'Ugu', 'uMgungundlovu',
               'uMkhanyakude', 'uMzinyathi', 'uThukela', 'Zululand']
$$;

-- The DOC's initial core team and the stand-by roles (the Plan, p. 18).
create or replace function public.disaster_duties() returns text[]
language sql immutable as $$
  select array['Principal Disaster Management Stand-by Officer', 'MDMC Duty Officer', 'DOC Commander',
               'Disaster Management Officer', 'Stand-by Incident Logger', 'EMACC Operator', 'CCTV Operator']
$$;

create or replace function public.coordination_rank(p text) returns int
language sql immutable as $$ select case p when 'Bronze' then 1 when 'Silver' then 2 when 'Gold' then 3 end $$;

/** A whole number from a form, 0 when blank; refused with the field's name otherwise. */
create or replace function public.desk_whole(p_value text, p_label text) returns int
language plpgsql immutable as $$
begin
  if p_value is null or btrim(p_value) = '' then return 0; end if;
  if btrim(p_value) !~ '^[0-9]{1,6}$' then
    raise exception '% is a whole number.', p_label using errcode = 'P0001';
  end if;
  return btrim(p_value)::int;
end $$;

/** "YYYY-MM-DD HH:MM" as South African time; null when blank, refused when not a time. */
create or replace function public.desk_time(p_value text, p_label text) returns timestamptz
language plpgsql stable as $$
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  if btrim(p_value) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T]([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception '% must be a date and time (YYYY-MM-DD HH:MM).', p_label using errcode = 'P0001';
  end if;
  return (replace(btrim(p_value), 'T', ' ') || ':00')::timestamp at time zone 'Africa/Johannesburg';
end $$;

-- ── 1. The call, Disaster's way ────────────────────────────────────────────

create table if not exists public.disaster_call_facts (
  incident_id      uuid primary key references public.incidents (id) on delete cascade,
  tenant_id        uuid not null default public.current_tenant(),
  silo             public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  short_title      text check (short_title is null or length(short_title) between 1 and 80),
  hazard           text check (hazard is null or public.disaster_hazard_group(hazard) is not null),
  municipalities   text[] not null default '{}',
  level            text not null default 'Bronze' check (level in ('Bronze', 'Silver', 'Gold')),
  highest_level    text not null default 'Bronze' check (highest_level in ('Bronze', 'Silver', 'Gold')),
  level_set_at     timestamptz,
  level_set_by     text,
  fcp_location     text check (fcp_location is null or length(fcp_location) <= 200),
  eoc_location     text check (eoc_location is null or length(eoc_location) <= 200),
  doc_activated_at timestamptz,
  scg_convened_at  timestamptz,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  updated_by_name  text
);
comment on table public.disaster_call_facts is
  'A Disaster call as the Plan names it (0112): short title, hazard, municipalities, Bronze/Silver/Gold. set_disaster_call() and set_coordination_level() only.';

alter table public.disaster_call_facts enable row level security;
drop policy if exists tenant_isolation on public.disaster_call_facts;
create policy tenant_isolation on public.disaster_call_facts as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
drop policy if exists disaster_call_facts_read on public.disaster_call_facts;
create policy disaster_call_facts_read on public.disaster_call_facts for select to authenticated
  using (silo = public.current_silo() or public.is_global() or public.works_disaster_desk()
         or public.can_work_incident(incident_id) or public.role_in('CaseManager', 'SystemController'));
revoke all on public.disaster_call_facts from anon;
revoke insert, update, delete on public.disaster_call_facts from authenticated;
grant select on public.disaster_call_facts to authenticated;

/** The call's facts row, made when first needed. */
create or replace function public.disaster_facts_for(p_inc public.incidents)
returns public.disaster_call_facts language plpgsql security definer set search_path to 'public' as $$
declare
  v public.disaster_call_facts;
begin
  insert into public.disaster_call_facts (incident_id, tenant_id, municipalities)
  values (p_inc.id, p_inc.tenant_id, array['eThekwini Metro'])
  on conflict (incident_id) do nothing;
  select * into v from public.disaster_call_facts where incident_id = p_inc.id for update;
  return v;
end $$;
revoke all on function public.disaster_facts_for(public.incidents) from public, anon, authenticated;

/** Short title, hazard, municipalities affected, FCP and EOC. Keys left out are kept. */
create or replace function public.set_disaster_call(p_incident_id uuid, p_fields jsonb)
returns public.disaster_call_facts
language plpgsql security definer set search_path to 'public' as $$
declare
  f       jsonb := coalesce(p_fields, '{}'::jsonb);
  v       public.disaster_call_facts;
  v_inc   public.incidents;
  v_name  text;
  v_title text;
  v_hazard text;
  v_munis text[];
  v_said  text[] := '{}';
begin
  v_inc := public.disaster_desk_incident(p_incident_id);
  v := public.disaster_facts_for(v_inc);
  select full_name into v_name from public.profiles where id = auth.uid();

  if f ? 'short_title' then
    v_title := nullif(btrim(coalesce(f ->> 'short_title', '')), '');
    if length(v_title) > 80 then raise exception 'Keep the title short: 80 letters or fewer.' using errcode = 'P0001'; end if;
    if v_title is distinct from v.short_title then v_said := v_said || format('title "%s"', coalesce(v_title, '—')); end if;
    v.short_title := v_title;
  end if;
  if f ? 'hazard' then
    v_hazard := nullif(btrim(coalesce(f ->> 'hazard', '')), '');
    if v_hazard is not null and public.disaster_hazard_group(v_hazard) is null then
      raise exception 'Choose the hazard from the list.' using errcode = 'P0001';
    end if;
    if v_hazard is distinct from v.hazard then v_said := v_said || format('hazard %s', coalesce(v_hazard, '—')); end if;
    v.hazard := v_hazard;
  end if;
  if jsonb_typeof(f -> 'municipalities') = 'array' then
    select coalesce(array_agg(m order by array_position(public.disaster_municipalities(), m)), '{}') into v_munis
      from (select distinct x as m from jsonb_array_elements_text(f -> 'municipalities') x
             where x = any (public.disaster_municipalities())) s;
    if cardinality(v_munis) = 0 then raise exception 'Choose at least one municipality.' using errcode = 'P0001'; end if;
    if v_munis is distinct from v.municipalities then v_said := v_said || format('municipalities %s', array_to_string(v_munis, ', ')); end if;
    v.municipalities := v_munis;
  end if;
  if f ? 'fcp_location' then v.fcp_location := nullif(left(btrim(coalesce(f ->> 'fcp_location', '')), 200), ''); end if;
  if f ? 'eoc_location' then v.eoc_location := nullif(left(btrim(coalesce(f ->> 'eoc_location', '')), 200), ''); end if;

  update public.disaster_call_facts
     set short_title = v.short_title, hazard = v.hazard, municipalities = v.municipalities,
         fcp_location = v.fcp_location, eoc_location = v.eoc_location,
         updated_at = now(), updated_by = auth.uid(), updated_by_name = v_name
   where incident_id = v_inc.id
  returning * into v;

  if cardinality(v_said) > 0 then
    insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
    values (v_inc.silo, v_inc.id, format('[DETAILS] %s — %s', array_to_string(v_said, '; '), coalesce(v_name, 'the Disaster desk')),
            auth.uid(), v_name);
  end if;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_CALL_DETAILS',
    'incidents', v_inc.id::text, format('%s · %s', v_inc.incident_number, coalesce(nullif(array_to_string(v_said, '; '), ''), 'locations')));
  return v;
end $$;
revoke all on function public.set_disaster_call(uuid, jsonb) from public, anon;
grant execute on function public.set_disaster_call(uuid, jsonb) to authenticated;

/**
 * Bronze, Silver or Gold (the Plan, pp. 16–18). Gold activates the DOC and
 * calls the SCG into session; it is on the timeline, in the audit and told
 * to the call's chain. Lowering the level is allowed and said as such.
 */
create or replace function public.set_coordination_level(p_incident_id uuid, p_level text, p_note text default null)
returns public.disaster_call_facts
language plpgsql security definer set search_path to 'public' as $$
declare
  v      public.disaster_call_facts;
  v_inc  public.incidents;
  v_name text;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
  v_was  text;
  v_what text;
begin
  if p_level not in ('Bronze', 'Silver', 'Gold') then
    raise exception 'Choose Bronze, Silver or Gold' using errcode = '22023';
  end if;
  v_inc := public.disaster_desk_incident(p_incident_id);
  v := public.disaster_facts_for(v_inc);
  if v.level = p_level then return v; end if;
  v_was := v.level;
  select full_name into v_name from public.profiles where id = auth.uid();

  update public.disaster_call_facts
     set level = p_level,
         highest_level = case when public.coordination_rank(p_level) > public.coordination_rank(highest_level) then p_level else highest_level end,
         level_set_at = now(), level_set_by = v_name,
         doc_activated_at = case when p_level = 'Gold' then coalesce(doc_activated_at, now()) else doc_activated_at end,
         scg_convened_at = case when p_level = 'Gold' then coalesce(scg_convened_at, now()) else scg_convened_at end,
         updated_at = now(), updated_by = auth.uid(), updated_by_name = v_name
   where incident_id = v_inc.id
  returning * into v;

  v_what := case p_level
    when 'Gold' then 'Gold (strategic): DOC activated and SCG called into session'
    when 'Silver' then 'Silver (operations): joint EOC on site'
    else 'Bronze (tactical): services co-ordinate at the FCP' end;
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id,
    format('[LEVEL] %s %s%s — %s',
      case when public.coordination_rank(p_level) > public.coordination_rank(v_was) then 'Raised to' else 'Stood down to' end,
      v_what, case when v_note is not null then ': ' || v_note else '' end, coalesce(v_name, 'the Disaster desk')),
    auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'COORDINATION_LEVEL',
    'incidents', v_inc.id::text, format('%s · %s → %s', v_inc.incident_number, v_was, p_level));
  if p_level = 'Gold' then
    perform public.notify_incident_chain(v_inc, 'incident_update',
      format('%s: DOC activated, SCG called into session', v_inc.incident_number),
      coalesce(v.short_title, v_inc.incident_type));
  end if;
  return v;
end $$;
revoke all on function public.set_coordination_level(uuid, text, text) from public, anon;
grant execute on function public.set_coordination_level(uuid, text, text) to authenticated;

-- ── 2. Public partners ──────────────────────────────────────────────────────

alter table public.mutual_aid_partners
  add column if not exists sector   text check (sector is null or sector in ('eThekwini', 'Provincial', 'National', 'District', 'Civil society')),
  add column if not exists verified boolean not null default false,
  add column if not exists notes    text check (notes is null or length(notes) <= 300),
  add column if not exists sort     int not null default 100;

-- Direct writes from the browser end here: save_mutual_aid_partner() only.
drop policy if exists mutual_aid_admin on public.mutual_aid_partners;
revoke insert, update, delete on public.mutual_aid_partners from authenticated;
revoke all on public.mutual_aid_partners from anon;
grant select on public.mutual_aid_partners to authenticated;

-- Private companies are not on the City's list: kept for the record, switched off.
update public.mutual_aid_partners
   set is_active = false, notes = 'Private company: not on the City''s list'
 where agency_name in ('Netcare St Augustine''s (Private)', 'Netcare Umhlanga (Private)', 'Busamed Gateway (Private)',
                       'Netcare 911', 'ER24 Ambulance', 'KZN VIP Medical Rescue', 'IPSS Medical Rescue', 'Pending Assignment')
   and is_active;

-- The public list: name, type, number, radio, who answers, sector, checked, note, order.
create temporary table if not exists _partners (
  name text, kind text, phone text, radio text, commander text, sector text, checked boolean, note text, sort int
) on commit drop;
truncate _partners;
insert into _partners values
  -- eThekwini: the call centre, the Centre and the line functions (the Plan, pp. 18–31).
  ('EMACC (Emergency Mobilizing and Communications Centre)', 'eThekwini services', '031 361 0000', null, 'EMACC Operator', 'eThekwini', true, '24 hours: Fire, Metro Police and Disaster', 1),
  ('Municipal Disaster Management Centre (MDMC)', 'eThekwini services', '031 367 0001', null, 'MDMC Duty Officer', 'eThekwini', true, '3 Jelf Taylor Crescent, Durban. Alternate: Pinetown Fire Station', 2),
  ('Safer Cities (reception centres)', 'eThekwini services', '031 361 0000', null, 'Head: Safer Cities', 'eThekwini', false, 'Through EMACC: add the direct line', 10),
  ('Parks, Recreation and Culture (council halls, key holders)', 'eThekwini services', '031 361 0000', null, 'Head: Parks, Recreation and Culture', 'eThekwini', false, 'Through EMACC: add the direct line', 11),
  ('Health Unit', 'eThekwini services', '031 361 0000', null, 'Head: Health', 'eThekwini', false, 'Through EMACC: add the direct line', 12),
  ('Human Settlements (Housing)', 'eThekwini services', '031 361 0000', null, 'Head: Housing', 'eThekwini', false, 'Temporary shelter where halls are full. Through EMACC: add the direct line', 13),
  ('Engineering (roads and stormwater)', 'eThekwini services', '031 361 0000', null, 'Head: Engineering', 'eThekwini', false, 'Through EMACC: add the direct line', 14),
  ('Solid Waste and Cleansing (DSW)', 'eThekwini services', '031 311 8804', null, 'Head: Solid Waste', 'eThekwini', false, null, 15),
  ('City Fleet (transport for evacuation)', 'eThekwini services', '031 361 0000', null, 'Head: City Fleet', 'eThekwini', false, 'Through EMACC: add the direct line', 16),
  ('eThekwini Transport Authority (ETA)', 'eThekwini services', '031 361 0000', null, 'Head: ETA', 'eThekwini', false, 'Through EMACC: add the direct line', 17),
  ('Security Management', 'eThekwini services', '031 361 0000', null, 'Head: Security Management', 'eThekwini', false, 'Through EMACC: add the direct line', 18),
  ('Communications and Public Relations', 'eThekwini services', '031 361 0000', null, 'Media liaison officer', 'eThekwini', false, 'Through EMACC: add the direct line', 19),
  ('CCTV Control Room', 'eThekwini services', '031 361 0000', null, 'CCTV Operator', 'eThekwini', false, 'Through EMACC: add the direct line', 20),
  ('Community Participation', 'eThekwini services', '031 361 0000', null, 'Head: Community Participation', 'eThekwini', false, 'Through EMACC: add the direct line', 21),
  ('eThekwini Electricity (Faults)', 'Utilities', '080 131 3111', 'Grid Control', 'Duty Engineer', 'eThekwini', true, 'Toll-free. WhatsApp 064 761 7930', 30),
  ('eThekwini Water & Sanitation', 'Utilities', '080 131 3013', 'Water Ops', 'Duty Engineer', 'eThekwini', true, '24 hours, toll-free', 31),
  ('Eskom KZN Control Center', 'Utilities', '08600 37566', 'National Grid Ops', 'Regional Engineer', 'National', true, '24 hours', 32),
  ('Transnet National Ports Auth.', 'Utilities', '031 361 8821', 'Port Control 1', 'Harbour Master', 'National', false, null, 33),
  ('SANRAL (Highways/Bridges)', 'Utilities', '033 392 8100', 'Road Mgt Link', 'Infrastructure Eng.', 'National', false, null, 34),
  -- Fire and Emergency Services.
  ('Durban Central Fire Station', 'Fire Stations', '031 361 0000', 'Fire Tac 1', 'Chief Fire Officer', 'eThekwini', true, 'Through EMACC', 40),
  ('Pinetown Fire Station', 'Fire Stations', '031 311 8273', 'Fire Tac 2', 'Station Commander', 'eThekwini', false, 'Alternate MDMC', 41),
  ('Umhlanga Fire Station', 'Fire Stations', '031 561 1111', 'Fire Tac 3', 'Station Commander', 'eThekwini', false, null, 42),
  ('Amanzimtoti Fire Station', 'Fire Stations', '031 311 5880', 'Fire Tac 4', 'Station Commander', 'eThekwini', false, null, 43),
  ('Westville Fire Station', 'Fire Stations', '031 311 5200', 'Fire Tac 5', 'Station Commander', 'eThekwini', false, null, 44),
  ('Chatsworth Fire Station', 'Fire Stations', '031 311 5900', 'Fire Tac 6', 'Station Commander', 'eThekwini', false, null, 45),
  ('Working on Fire (Wildfires)', 'Fire Stations', '0860 040 404', 'WoF Air-to-Ground', 'KZN Dispatch', 'National', false, null, 46),
  -- Law enforcement.
  ('Durban Metro Police HQ', 'Law Enforcement', '031 361 0000', 'Metro Ch 1', 'Duty Commander', 'eThekwini', true, 'Through EMACC', 50),
  ('Metro Police - Pinetown', 'Law Enforcement', '031 311 2809', 'Metro Ch 2', 'Regional Commander', 'eThekwini', false, null, 51),
  ('Metro Police - Umlazi', 'Law Enforcement', '031 311 5000', 'Metro Ch 3', 'Regional Commander', 'eThekwini', false, null, 52),
  ('SAPS Flying Squad (10111)', 'Law Enforcement', '10111', 'SAPS Ops', 'Shift Leader', 'National', true, null, 53),
  ('SAPS Durban Central', 'Law Enforcement', '031 325 4011', 'SAPS Secure', 'Station Commander', 'National', false, null, 54),
  ('SAPS Search & Rescue (KZN)', 'Law Enforcement', '031 325 6711', 'SAR Tac 1', 'Capt. K9 Unit', 'National', false, null, 55),
  ('SAPS Public Order Policing (POP)', 'Law Enforcement', '031 325 6000', 'Riot Control Link', 'POP Commander', 'National', false, null, 56),
  -- Emergency Medical Rescue Services and public hospitals.
  ('KZN Provincial EMS (10177)', 'Ambulance & EMS', '10177', 'Gov EMS Ops', 'Provincial Dispatch', 'Provincial', true, '112 from a cellphone', 60),
  ('Addington Hospital (Public)', 'Hospitals', '031 327 2000', 'Med-Link 1', 'Casualty Manager', 'Provincial', true, 'Casualty 031 327 2311', 70),
  ('King Edward VIII (Public)', 'Hospitals', '031 360 3111', 'Med-Link 2', 'Trauma Head', 'Provincial', true, null, 71),
  ('Albert Luthuli Central (Public)', 'Hospitals', '031 240 1000', 'Med-Link 3', 'Emergency Coordinator', 'Provincial', true, 'Inkosi Albert Luthuli Central Hospital', 72),
  ('Mahatma Gandhi Memorial (Public)', 'Hospitals', '031 502 1719', 'Med-Link 4', 'ER Manager', 'Provincial', true, null, 73),
  ('Prince Mshiyeni Memorial (Public)', 'Hospitals', '031 907 8111', 'Med-Link 5', 'ER Manager', 'Provincial', false, null, 74),
  ('RK Khan Hospital (Public)', 'Hospitals', '031 459 6000', null, 'ER Manager', 'Provincial', true, null, 75),
  -- Government (the Plan's external role players).
  ('KZN Prov. Disaster Management', 'Government', '033 897 5600', 'JOC Command Link', 'PDMC Head', 'Provincial', false, 'Provincial Disaster Management Centre (PDMC)', 80),
  ('SASSA (Relief Funds/Grants)', 'Government', '0800 60 10 11', 'Mobile Cell', 'Crisis Relief Lead', 'National', true, 'Social relief of distress. KZN 033 846 3300', 81),
  ('KZN Social Development', 'Government', '033 264 5402', null, 'Disaster relief', 'Provincial', false, null, 82),
  ('KZN Human Settlements', 'Government', '033 392 6400', null, 'Emergency housing', 'Provincial', false, null, 83),
  ('South African Weather Service', 'Government', '012 367 6000', null, 'Forecaster on duty', 'National', false, 'Ask for the KZN office', 84),
  ('SANDF (Military Aid to Civil Auth)', 'Government', '012 355 6000', 'Mil-Tac Alpha', 'Joint Ops Command', 'National', false, 'Requested through the PDMC', 85),
  -- Neighbouring municipalities' disaster centres, 24 hours (KZN list, 2022).
  ('Ugu Disaster Management Centre', 'Disaster centres', '039 688 5830', null, '24/7 call centre', 'District', true, null, 90),
  ('iLembe Disaster Management Centre', 'Disaster centres', '032 437 9319', null, '24/7 call centre', 'District', true, null, 91),
  ('uMgungundlovu Disaster Management Centre', 'Disaster centres', '0800 864 911', null, '24/7 call centre', 'District', true, null, 92),
  ('Harry Gwala Disaster Management Centre', 'Disaster centres', '039 843 8700', null, '24/7 call centre', 'District', true, null, 93),
  ('King Cetshwayo Disaster Management Centre', 'Disaster centres', '0800 111 258', null, '24/7 call centre', 'District', true, null, 94),
  ('Zululand Disaster Management Centre', 'Disaster centres', '035 874 5510', null, '24/7 call centre', 'District', true, null, 95),
  ('uMkhanyakude Disaster Management Centre', 'Disaster centres', '035 562 4040', null, '24/7 call centre', 'District', true, null, 96),
  ('uThukela Disaster Management Centre', 'Disaster centres', '086 010 4257', null, '24/7 call centre', 'District', true, null, 97),
  ('uMzinyathi Disaster Management Centre', 'Disaster centres', '034 212 2222', null, '24/7 call centre', 'District', true, null, 98),
  ('Amajuba Disaster Management Centre', 'Disaster centres', '034 328 4700', null, '24/7 call centre', 'District', true, null, 99),
  -- Civil society relief (the Plan's religious and welfare organisations).
  ('Gift of the Givers (KZN Ops)', 'Relief & NGO', '0800 786 911', 'Sat-Phone 1', 'KZN coordinator', 'Civil society', true, null, 110),
  ('Red Cross South Africa', 'Relief & NGO', '076 223 8425', 'NGO Link', 'Relief Coordinator', 'Civil society', true, 'KZN office, 201 Kenneth Kaunda Rd, Durban North', 111),
  ('NSRI Station 5 (Durban Port)', 'Relief & NGO', '087 094 9774', 'Marine VHF Ch 16', 'Emergency Operations Centre', 'Civil society', true, 'Water rescue. 112 from a cellphone', 112),
  ('Salvation Army KZN', 'Relief & NGO', '031 202 2181', 'Mobile Cell', 'Disaster Services', 'Civil society', false, null, 113),
  ('SPCA (Animal Rescue)', 'Relief & NGO', '031 579 6500', 'Mobile Cell', 'Inspectorate', 'Civil society', false, 'Durban and Coast SPCA', 114);

update public.mutual_aid_partners m
   set resource_type = p.kind, contact_number = p.phone, radio_frequency = coalesce(p.radio, m.radio_frequency),
       commander_name = p.commander, sector = p.sector, verified = p.checked, notes = p.note, sort = p.sort, is_active = true
  from _partners p
 where m.agency_name = p.name;
-- A partner's name is unique across the system (0006): each new one is added
-- once, for the organisation that already keeps the list (else the first).
insert into public.mutual_aid_partners (tenant_id, silo, agency_name, resource_type, contact_number, radio_frequency,
                                        commander_name, is_active, sector, verified, notes, sort)
select coalesce(
         (select m.tenant_id from public.mutual_aid_partners m where m.tenant_id is not null
           group by m.tenant_id order by count(*) desc, m.tenant_id limit 1),
         (select t.id from public.tenants t order by t.id limit 1)),
       'EthekwiniDisaster', p.name, p.kind, p.phone, p.radio, p.commander, true, p.sector, p.checked, p.note, p.sort
  from _partners p
 where not exists (select 1 from public.mutual_aid_partners m where m.agency_name = p.name)
on conflict (agency_name) do nothing;

/** An administrator confirms or corrects a partner, or adds one. */
create or replace function public.save_mutual_aid_partner(p_id uuid, p_fields jsonb)
returns public.mutual_aid_partners
language plpgsql security definer set search_path to 'public' as $$
declare
  f      jsonb := coalesce(p_fields, '{}'::jsonb);
  v      public.mutual_aid_partners;
  v_name text := nullif(left(btrim(coalesce(f ->> 'agency_name', '')), 200), '');
  v_kind text := nullif(left(btrim(coalesce(f ->> 'resource_type', '')), 100), '');
  v_who  text;
begin
  perform public.require_role('Admin', 'Supervisor', 'SystemAdmin', 'SuperAdmin', 'Disaster');
  if public.current_silo() is distinct from 'EthekwiniDisaster' and not public.role_in('SystemAdmin', 'SuperAdmin') then
    raise exception 'Only Disaster Management keeps the partner list' using errcode = '42501';
  end if;
  if v_name is null then raise exception 'Name the organisation.' using errcode = 'P0001'; end if;
  if v_kind is null then raise exception 'Choose its type.' using errcode = 'P0001'; end if;
  if coalesce(f ->> 'sector', '') <> '' and (f ->> 'sector') not in ('eThekwini', 'Provincial', 'National', 'District', 'Civil society') then
    raise exception 'Choose the sector from the list.' using errcode = 'P0001';
  end if;
  -- Names are unique across the system (0006).
  if exists (select 1 from public.mutual_aid_partners m where lower(m.agency_name) = lower(v_name) and m.id is distinct from p_id) then
    raise exception '% is already on the list.', v_name using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into public.mutual_aid_partners (tenant_id, silo, agency_name, resource_type, is_active)
    values (public.current_tenant(), 'EthekwiniDisaster', v_name, v_kind, true) returning * into v;
  else
    select * into v from public.mutual_aid_partners where id = p_id and tenant_id = public.current_tenant() for update;
    if not found then raise exception 'Partner not found' using errcode = 'P0002'; end if;
  end if;
  update public.mutual_aid_partners
     set agency_name = v_name, resource_type = v_kind,
         contact_number = nullif(left(btrim(coalesce(f ->> 'contact_number', '')), 60), ''),
         radio_frequency = nullif(left(btrim(coalesce(f ->> 'radio_frequency', '')), 60), ''),
         commander_name = nullif(left(btrim(coalesce(f ->> 'commander_name', '')), 120), ''),
         sector = nullif(f ->> 'sector', ''),
         notes = nullif(left(btrim(coalesce(f ->> 'notes', '')), 300), ''),
         verified = case when jsonb_typeof(f -> 'verified') = 'boolean' then (f ->> 'verified')::boolean else verified end,
         is_active = case when jsonb_typeof(f -> 'is_active') = 'boolean' then (f ->> 'is_active')::boolean else is_active end
   where id = v.id returning * into v;
  select full_name into v_who from public.profiles where id = auth.uid();
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v.tenant_id, 'EthekwiniDisaster', auth.uid(), v_who, 'EthekwiniDisaster', 'PARTNER_SAVED', 'mutual_aid_partners',
    v.id::text, format('%s · %s%s', v.agency_name, coalesce(v.contact_number, 'no number'), case when v.verified then ' (checked)' else '' end));
  return v;
end $$;
revoke all on function public.save_mutual_aid_partner(uuid, jsonb) from public, anon;
grant execute on function public.save_mutual_aid_partner(uuid, jsonb) to authenticated;

-- ── 3. Shelters and reception centres ──────────────────────────────────────

create table if not exists public.disaster_shelters (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default public.current_tenant(),
  silo             public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  name             text not null check (length(name) between 1 and 200),
  kind             text not null check (kind in ('Community hall', 'School', 'Church or place of worship', 'Sports centre',
                                                 'Library', 'Temporary structure', 'Other')),
  municipality     text not null default 'eThekwini Metro' check (municipality = any (public.disaster_municipalities())),
  ward             text check (ward is null or length(ward) <= 40),
  address          text check (address is null or length(address) <= 300),
  capacity         int not null default 0 check (capacity between 0 and 100000),
  key_holder       text check (key_holder is null or length(key_holder) <= 120),
  key_holder_phone text check (key_holder_phone is null or length(key_holder_phone) <= 60),
  notes            text check (notes is null or length(notes) <= 1000),
  is_active        boolean not null default true,
  updated_at       timestamptz not null default now(),
  updated_by_name  text
);
comment on table public.disaster_shelters is
  'Halls and facilities for emergency assembly and shelter, with key holders (0112). save_disaster_shelter() only.';

create table if not exists public.disaster_shelter_openings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default public.current_tenant(),
  silo            public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  incident_id     uuid not null references public.incidents (id) on delete cascade,
  shelter_id      uuid not null references public.disaster_shelters (id),
  client_ref      uuid,
  people_now      int not null default 0 check (people_now between 0 and 100000),
  peak_people     int not null default 0 check (peak_people between 0 and 100000),
  households      int not null default 0 check (households between 0 and 100000),
  children        int not null default 0 check (children between 0 and 100000),
  elderly         int not null default 0 check (elderly between 0 and 100000),
  disabled        int not null default 0 check (disabled between 0 and 100000),
  relief          jsonb not null default '{}'::jsonb,
  opened_at       timestamptz not null default now(),
  opened_by       uuid not null default auth.uid(),
  opened_by_name  text,
  closed_at       timestamptz,
  closed_by_name  text
);
comment on table public.disaster_shelter_openings is
  'A shelter opened for a call (0112): people there now, the most at once, who they are and the relief given.';
create unique index if not exists disaster_shelter_openings_client_ref
  on public.disaster_shelter_openings (tenant_id, client_ref) where client_ref is not null;
create unique index if not exists disaster_shelter_openings_open
  on public.disaster_shelter_openings (incident_id, shelter_id) where closed_at is null;
create index if not exists disaster_shelter_openings_shelter on public.disaster_shelter_openings (shelter_id) where closed_at is null;

create table if not exists public.disaster_shelter_entries (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default public.current_tenant(),
  silo           public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  opening_id     uuid not null references public.disaster_shelter_openings (id) on delete cascade,
  incident_id    uuid not null references public.incidents (id) on delete cascade,
  client_ref     uuid,
  kind           text not null check (kind in ('Opened', 'Arrived', 'Left', 'Relief', 'Note', 'Closed')),
  people         int not null default 0 check (people between 0 and 100000),
  relief         jsonb not null default '{}'::jsonb,
  note           text check (note is null or length(note) <= 1000),
  logged_by      uuid not null default auth.uid(),
  logged_by_name text,
  logged_at      timestamptz not null default now()
);
comment on table public.disaster_shelter_entries is
  'What happened at a shelter for a call (0112): arrivals, departures, relief, notes. Permanent.';
create unique index if not exists disaster_shelter_entries_client_ref
  on public.disaster_shelter_entries (tenant_id, client_ref) where client_ref is not null;
create index if not exists disaster_shelter_entries_opening on public.disaster_shelter_entries (opening_id, logged_at);

do $$
declare t text;
begin
  foreach t in array array['disaster_shelters', 'disaster_shelter_openings', 'disaster_shelter_entries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated
      using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant())', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated
      using (silo = public.current_silo() or public.is_global() or public.works_disaster_desk()
             or public.role_in(''CaseManager'', ''SystemController''))', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create or replace function public.guard_disaster_shelter_entry() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  raise exception 'A shelter entry stays on record. Log a new one.' using errcode = 'P0001';
end $$;
drop trigger if exists guard_disaster_shelter_entry on public.disaster_shelter_entries;
create trigger guard_disaster_shelter_entry before update or delete on public.disaster_shelter_entries
  for each row execute function public.guard_disaster_shelter_entry();

/** The relief handed out, as counts: meals, blankets, mattresses, food parcels, hygiene packs, clothing. */
create or replace function public.desk_relief(p jsonb) returns jsonb
language plpgsql immutable as $$
declare
  k text;
  v jsonb := '{}'::jsonb;
  n int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return v; end if;
  foreach k in array array['hot_meals', 'blankets', 'mattresses', 'food_parcels', 'hygiene_packs', 'clothing'] loop
    n := public.desk_whole(p ->> k, 'Relief');
    if n > 0 then v := v || jsonb_build_object(k, n); end if;
  end loop;
  return v;
end $$;

/** Add two relief tallies. */
create or replace function public.desk_relief_add(a jsonb, b jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(k, s), '{}'::jsonb) from (
    select k, sum(n)::int as s from (
      select key as k, value::text::int as n from jsonb_each(coalesce(a, '{}'::jsonb))
      union all select key, value::text::int from jsonb_each(coalesce(b, '{}'::jsonb))
    ) x group by k
  ) y
$$;

create or replace function public.save_disaster_shelter(p_id uuid, p_fields jsonb)
returns public.disaster_shelters
language plpgsql security definer set search_path to 'public' as $$
declare
  f      jsonb := coalesce(p_fields, '{}'::jsonb);
  v      public.disaster_shelters;
  v_name text := nullif(left(btrim(coalesce(f ->> 'name', '')), 200), '');
  v_kind text := coalesce(nullif(btrim(coalesce(f ->> 'kind', '')), ''), 'Community hall');
  v_muni text := coalesce(nullif(btrim(coalesce(f ->> 'municipality', '')), ''), 'eThekwini Metro');
  v_who  text;
begin
  if not public.works_disaster_desk() then raise exception 'Only the Disaster desk does this' using errcode = '42501'; end if;
  if v_name is null then raise exception 'Name the hall or facility.' using errcode = 'P0001'; end if;
  if v_kind not in ('Community hall', 'School', 'Church or place of worship', 'Sports centre', 'Library', 'Temporary structure', 'Other') then
    raise exception 'Choose the type from the list.' using errcode = 'P0001';
  end if;
  if not v_muni = any (public.disaster_municipalities()) then raise exception 'Choose the municipality from the list.' using errcode = 'P0001'; end if;
  select full_name into v_who from public.profiles where id = auth.uid();
  if p_id is null then
    insert into public.disaster_shelters (tenant_id, name, kind, municipality) values (public.current_tenant(), v_name, v_kind, v_muni)
    returning * into v;
  else
    select * into v from public.disaster_shelters where id = p_id and tenant_id = public.current_tenant() for update;
    if not found then raise exception 'Shelter not found' using errcode = 'P0002'; end if;
  end if;
  update public.disaster_shelters
     set name = v_name, kind = v_kind, municipality = v_muni,
         ward = nullif(left(btrim(coalesce(f ->> 'ward', '')), 40), ''),
         address = nullif(left(btrim(coalesce(f ->> 'address', '')), 300), ''),
         capacity = public.desk_whole(f ->> 'capacity', 'Capacity'),
         key_holder = nullif(left(btrim(coalesce(f ->> 'key_holder', '')), 120), ''),
         key_holder_phone = nullif(left(btrim(coalesce(f ->> 'key_holder_phone', '')), 60), ''),
         notes = nullif(left(btrim(coalesce(f ->> 'notes', '')), 1000), ''),
         is_active = case when jsonb_typeof(f -> 'is_active') = 'boolean' then (f ->> 'is_active')::boolean else is_active end,
         updated_at = now(), updated_by_name = v_who
   where id = v.id returning * into v;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v.tenant_id, 'EthekwiniDisaster', auth.uid(), v_who, 'EthekwiniDisaster', 'SHELTER_SAVED', 'disaster_shelters',
    v.id::text, format('%s · %s · capacity %s', v.name, v.municipality, v.capacity));
  return v;
end $$;
revoke all on function public.save_disaster_shelter(uuid, jsonb) from public, anon;
grant execute on function public.save_disaster_shelter(uuid, jsonb) to authenticated;

/** Open a shelter for a call, with the people who came in first. The same client reference returns the one opened. */
create or replace function public.open_disaster_shelter(p_incident_id uuid, p_shelter_id uuid, p_client_ref uuid, p_fields jsonb)
returns public.disaster_shelter_openings
language plpgsql security definer set search_path to 'public' as $$
declare
  f       jsonb := coalesce(p_fields, '{}'::jsonb);
  v       public.disaster_shelter_openings;
  v_inc   public.incidents;
  v_hall  public.disaster_shelters;
  v_name  text;
  v_people int := public.desk_whole(p_fields ->> 'people', 'People');
  v_note  text := nullif(left(btrim(coalesce(p_fields ->> 'note', '')), 1000), '');
begin
  if p_client_ref is null then raise exception 'No reference; try again' using errcode = '22023'; end if;
  v_inc := public.disaster_desk_incident(p_incident_id);
  select * into v from public.disaster_shelter_openings where tenant_id = v_inc.tenant_id and client_ref = p_client_ref;
  if found then return v; end if;
  select * into v_hall from public.disaster_shelters where id = p_shelter_id and tenant_id = v_inc.tenant_id and is_active;
  if not found then raise exception 'That shelter is not in the register.' using errcode = 'P0001'; end if;
  select * into v from public.disaster_shelter_openings where incident_id = v_inc.id and shelter_id = v_hall.id and closed_at is null;
  if found then return v; end if;
  select full_name into v_name from public.profiles where id = auth.uid();

  insert into public.disaster_shelter_openings (tenant_id, incident_id, shelter_id, client_ref, people_now, peak_people,
    households, children, elderly, disabled, opened_by, opened_by_name)
  values (v_inc.tenant_id, v_inc.id, v_hall.id, p_client_ref, v_people, v_people,
    public.desk_whole(f ->> 'households', 'Households'), public.desk_whole(f ->> 'children', 'Children'),
    public.desk_whole(f ->> 'elderly', 'Elderly'), public.desk_whole(f ->> 'disabled', 'People with disabilities'),
    auth.uid(), v_name)
  returning * into v;
  insert into public.disaster_shelter_entries (tenant_id, opening_id, incident_id, kind, people, note, logged_by, logged_by_name)
  values (v.tenant_id, v.id, v_inc.id, 'Opened', v_people, v_note, auth.uid(), v_name);

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id, format('[SHELTER] %s opened as a reception centre%s%s — %s', v_hall.name,
    case when v_people > 0 then format(', %s people', v_people) else '' end,
    case when v_note is not null then ': ' || v_note else '' end, coalesce(v_name, 'the Disaster desk')), auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'SHELTER_OPENED', 'disaster_shelter_openings',
    v.id::text, format('%s · %s · %s people', v_inc.incident_number, v_hall.name, v_people));
  return v;
end $$;
revoke all on function public.open_disaster_shelter(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.open_disaster_shelter(uuid, uuid, uuid, jsonb) to authenticated;

/**
 * What happened at an open shelter: people arrived or left, relief handed
 * out, who is there (households, children, elderly, people with
 * disabilities, as they are now), a note. The same client reference returns
 * the shelter as it was saved.
 */
create or replace function public.update_disaster_shelter(p_opening_id uuid, p_client_ref uuid, p_fields jsonb)
returns public.disaster_shelter_openings
language plpgsql security definer set search_path to 'public' as $$
declare
  f        jsonb := coalesce(p_fields, '{}'::jsonb);
  v        public.disaster_shelter_openings;
  v_inc    public.incidents;
  v_hall   public.disaster_shelters;
  v_name   text;
  v_in     int := public.desk_whole(p_fields ->> 'arrived', 'Arrived');
  v_out    int := public.desk_whole(p_fields ->> 'left', 'Left');
  v_relief jsonb := public.desk_relief(p_fields -> 'relief');
  v_note   text := nullif(left(btrim(coalesce(p_fields ->> 'note', '')), 1000), '');
  v_said   text[] := '{}';
begin
  if p_client_ref is null then raise exception 'No reference; try again' using errcode = '22023'; end if;
  select * into v from public.disaster_shelter_openings where id = p_opening_id and tenant_id = public.current_tenant();
  if not found then raise exception 'Shelter not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.disaster_shelter_entries e where e.tenant_id = v.tenant_id and e.client_ref = p_client_ref) then
    return v;
  end if;
  v_inc := public.disaster_desk_incident(v.incident_id);
  select * into v from public.disaster_shelter_openings where id = p_opening_id for update;
  if v.closed_at is not null then raise exception 'This shelter is closed for the call.' using errcode = 'P0001'; end if;
  if v_out > v.people_now + v_in then
    raise exception 'Only % people are there.', v.people_now + v_in using errcode = 'P0001';
  end if;
  if v_in = 0 and v_out = 0 and v_relief = '{}'::jsonb and v_note is null
     and not (f ?| array['households', 'children', 'elderly', 'disabled']) then
    raise exception 'Nothing to log yet.' using errcode = 'P0001';
  end if;
  select * into v_hall from public.disaster_shelters where id = v.shelter_id;
  select full_name into v_name from public.profiles where id = auth.uid();

  update public.disaster_shelter_openings
     set people_now = people_now + v_in - v_out,
         peak_people = greatest(peak_people, people_now + v_in - v_out),
         households = case when f ? 'households' then public.desk_whole(f ->> 'households', 'Households') else households end,
         children = case when f ? 'children' then public.desk_whole(f ->> 'children', 'Children') else children end,
         elderly = case when f ? 'elderly' then public.desk_whole(f ->> 'elderly', 'Elderly') else elderly end,
         disabled = case when f ? 'disabled' then public.desk_whole(f ->> 'disabled', 'People with disabilities') else disabled end,
         relief = public.desk_relief_add(relief, v_relief)
   where id = v.id returning * into v;

  if v_in > 0 then
    insert into public.disaster_shelter_entries (tenant_id, opening_id, incident_id, client_ref, kind, people, note, logged_by, logged_by_name)
    values (v.tenant_id, v.id, v.incident_id, p_client_ref, 'Arrived', v_in, v_note, auth.uid(), v_name);
    v_said := v_said || format('%s arrived', v_in);
  end if;
  if v_out > 0 then
    insert into public.disaster_shelter_entries (tenant_id, opening_id, incident_id, client_ref, kind, people, note, logged_by, logged_by_name)
    values (v.tenant_id, v.id, v.incident_id, case when v_in > 0 then null else p_client_ref end, 'Left', v_out, v_note, auth.uid(), v_name);
    v_said := v_said || format('%s left', v_out);
  end if;
  if v_relief <> '{}'::jsonb then
    insert into public.disaster_shelter_entries (tenant_id, opening_id, incident_id, client_ref, kind, relief, note, logged_by, logged_by_name)
    values (v.tenant_id, v.id, v.incident_id, case when v_in + v_out > 0 then null else p_client_ref end, 'Relief', v_relief, v_note,
            auth.uid(), v_name);
    v_said := v_said || (select string_agg(format('%s %s', value, replace(key, '_', ' ')), ', ') from jsonb_each_text(v_relief));
  end if;
  if v_in + v_out = 0 and v_relief = '{}'::jsonb then
    insert into public.disaster_shelter_entries (tenant_id, opening_id, incident_id, client_ref, kind, note, logged_by, logged_by_name)
    values (v.tenant_id, v.id, v.incident_id, p_client_ref, 'Note', v_note, auth.uid(), v_name);
  end if;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id, format('[SHELTER] %s: %s%s — %s people there now — %s', v_hall.name,
    coalesce(nullif(array_to_string(v_said, '; '), ''), 'note'), case when v_note is not null then ': ' || v_note else '' end,
    v.people_now, coalesce(v_name, 'the Disaster desk')), auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'SHELTER_UPDATED', 'disaster_shelter_openings',
    v.id::text, format('%s · %s · %s now', v_inc.incident_number, v_hall.name, v.people_now));
  return v;
end $$;
revoke all on function public.update_disaster_shelter(uuid, uuid, jsonb) from public, anon;
grant execute on function public.update_disaster_shelter(uuid, uuid, jsonb) to authenticated;

/** Close a shelter for a call once everyone has left. */
create or replace function public.close_disaster_shelter(p_opening_id uuid, p_note text default null)
returns public.disaster_shelter_openings
language plpgsql security definer set search_path to 'public' as $$
declare
  v      public.disaster_shelter_openings;
  v_inc  public.incidents;
  v_hall public.disaster_shelters;
  v_name text;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
begin
  select * into v from public.disaster_shelter_openings where id = p_opening_id and tenant_id = public.current_tenant();
  if not found then raise exception 'Shelter not found' using errcode = 'P0002'; end if;
  if v.closed_at is not null then return v; end if;
  v_inc := public.disaster_desk_incident(v.incident_id);
  select * into v from public.disaster_shelter_openings where id = p_opening_id for update;
  if v.people_now > 0 then
    raise exception '% people are still there. Log them leaving first.', v.people_now using errcode = 'P0001';
  end if;
  select * into v_hall from public.disaster_shelters where id = v.shelter_id;
  select full_name into v_name from public.profiles where id = auth.uid();
  update public.disaster_shelter_openings set closed_at = now(), closed_by_name = v_name where id = v.id returning * into v;
  insert into public.disaster_shelter_entries (tenant_id, opening_id, incident_id, kind, note, logged_by, logged_by_name)
  values (v.tenant_id, v.id, v.incident_id, 'Closed', v_note, auth.uid(), v_name);
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id, format('[SHELTER] %s closed (most at once: %s)%s — %s', v_hall.name, v.peak_people,
    case when v_note is not null then ': ' || v_note else '' end, coalesce(v_name, 'the Disaster desk')), auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'SHELTER_CLOSED', 'disaster_shelter_openings',
    v.id::text, format('%s · %s', v_inc.incident_number, v_hall.name));
  return v;
end $$;
revoke all on function public.close_disaster_shelter(uuid, text) from public, anon;
grant execute on function public.close_disaster_shelter(uuid, text) to authenticated;

-- ── 4. Call-out officers, their roster and the SCG duty chair ──────────────

alter table public.disaster_callouts add column if not exists officer_id uuid;
create unique index if not exists disaster_callouts_open_officer
  on public.disaster_callouts (incident_id, officer_id)
  where officer_id is not null and status in ('Called', 'On the way', 'On scene');

create table if not exists public.disaster_duty (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default public.current_tenant(),
  silo         public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  personnel_id uuid,
  name         text not null check (length(name) between 1 and 160),
  phone        text check (phone is null or length(phone) <= 60),
  duty         text not null check (duty = any (public.disaster_duties())),
  status       text not null check (status in ('On duty', 'On standby')),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  note         text check (note is null or length(note) <= 300),
  created_by   uuid not null default auth.uid(),
  created_by_name text,
  created_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);
comment on table public.disaster_duty is
  'Disaster Management''s duty roster (0112): who is on duty or on standby, when, and their duty. save_ / end_disaster_duty() only.';
create index if not exists disaster_duty_when on public.disaster_duty (tenant_id, starts_at, ends_at);

create table if not exists public.disaster_scg_chairs (
  tenant_id  uuid not null default public.current_tenant(),
  silo       public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  year       int not null check (year between 2020 and 2100),
  month      int not null check (month between 1 and 12),
  name       text not null check (length(name) between 1 and 160),
  phone      text check (phone is null or length(phone) <= 60),
  updated_by_name text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, year, month)
);
comment on table public.disaster_scg_chairs is
  'The SCG duty chairperson for each calendar month: the City Manager or a Deputy City Manager on stand-by (0112).';

do $$
declare t text;
begin
  foreach t in array array['disaster_duty', 'disaster_scg_chairs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated
      using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant())', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated
      using (silo = public.current_silo() or public.is_global() or public.works_disaster_desk()
             or public.role_in(''SystemController''))', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

/**
 * Put someone on the roster: a Disaster Management member (personnel_id) or
 * a name and number; their duty; on duty or on standby; from and until
 * ("YYYY-MM-DD HH:MM"), at most a month.
 */
create or replace function public.save_disaster_duty(p_id uuid, p_fields jsonb)
returns public.disaster_duty
language plpgsql security definer set search_path to 'public' as $$
declare
  f       jsonb := coalesce(p_fields, '{}'::jsonb);
  v       public.disaster_duty;
  v_p     public.personnel;
  v_name  text := nullif(left(btrim(coalesce(p_fields ->> 'name', '')), 160), '');
  v_phone text := nullif(left(btrim(coalesce(p_fields ->> 'phone', '')), 60), '');
  v_duty  text := btrim(coalesce(p_fields ->> 'duty', ''));
  v_state text := btrim(coalesce(p_fields ->> 'status', ''));
  v_from  timestamptz := public.desk_time(p_fields ->> 'starts_at', 'From');
  v_until timestamptz := public.desk_time(p_fields ->> 'ends_at', 'Until');
  v_who   text;
begin
  if not public.works_disaster_desk() then raise exception 'Only the Disaster desk does this' using errcode = '42501'; end if;
  if coalesce(f ->> 'personnel_id', '') ~ '^[0-9a-fA-F-]{36}$' then
    select * into v_p from public.personnel
     where id = (f ->> 'personnel_id')::uuid and tenant_id = public.current_tenant() and silo = 'EthekwiniDisaster';
    if not found then raise exception 'That person is not in Disaster Management.' using errcode = 'P0001'; end if;
    v_name := btrim(concat_ws(' ', nullif(btrim(coalesce(v_p.rank, '')), ''), v_p.first_name, v_p.last_name));
    v_phone := coalesce(v_phone, v_p.work_cellphone);
  end if;
  if v_name is null then raise exception 'Choose who is on duty.' using errcode = 'P0001'; end if;
  if not v_duty = any (public.disaster_duties()) then raise exception 'Choose their duty from the list.' using errcode = 'P0001'; end if;
  if v_state not in ('On duty', 'On standby') then raise exception 'Choose on duty or on standby.' using errcode = 'P0001'; end if;
  if v_from is null or v_until is null then raise exception 'Say from when and until when.' using errcode = 'P0001'; end if;
  if v_until <= v_from then raise exception 'Until must be after From.' using errcode = 'P0001'; end if;
  if v_until - v_from > interval '31 days' then raise exception 'Put someone on for a month at most.' using errcode = 'P0001'; end if;
  select full_name into v_who from public.profiles where id = auth.uid();
  if p_id is null then
    insert into public.disaster_duty (tenant_id, personnel_id, name, phone, duty, status, starts_at, ends_at, note, created_by, created_by_name)
    values (public.current_tenant(), v_p.id, v_name, v_phone, v_duty, v_state, v_from, v_until,
            nullif(left(btrim(coalesce(f ->> 'note', '')), 300), ''), auth.uid(), v_who)
    returning * into v;
  else
    update public.disaster_duty
       set personnel_id = v_p.id, name = v_name, phone = v_phone, duty = v_duty, status = v_state, starts_at = v_from, ends_at = v_until,
           note = nullif(left(btrim(coalesce(f ->> 'note', '')), 300), '')
     where id = p_id and tenant_id = public.current_tenant()
    returning * into v;
    if not found then raise exception 'Roster entry not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v.tenant_id, 'EthekwiniDisaster', auth.uid(), v_who, 'EthekwiniDisaster', 'DUTY_ROSTERED', 'disaster_duty',
    v.id::text, format('%s · %s · %s · %s to %s', v.name, v.duty, v.status,
      to_char(v.starts_at at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI'),
      to_char(v.ends_at at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI')));
  return v;
end $$;
revoke all on function public.save_disaster_duty(uuid, jsonb) from public, anon;
grant execute on function public.save_disaster_duty(uuid, jsonb) to authenticated;

/** Take someone off the roster now (or remove a future entry). */
create or replace function public.end_disaster_duty(p_id uuid)
returns public.disaster_duty
language plpgsql security definer set search_path to 'public' as $$
declare
  v     public.disaster_duty;
  v_who text;
begin
  if not public.works_disaster_desk() then raise exception 'Only the Disaster desk does this' using errcode = '42501'; end if;
  select * into v from public.disaster_duty where id = p_id and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'Roster entry not found' using errcode = 'P0002'; end if;
  if v.ends_at <= now() then return v; end if;
  select full_name into v_who from public.profiles where id = auth.uid();
  -- A future entry ends where it starts: it never happened, and stays on record.
  update public.disaster_duty
     set ends_at = greatest(now(), starts_at + interval '1 second'),
         note = left(concat_ws(' · ', note, 'Taken off by ' || coalesce(v_who, 'the desk')), 300)
   where id = v.id returning * into v;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v.tenant_id, 'EthekwiniDisaster', auth.uid(), v_who, 'EthekwiniDisaster', 'DUTY_ENDED', 'disaster_duty', v.id::text,
    format('%s · %s', v.name, v.duty));
  return v;
end $$;
revoke all on function public.end_disaster_duty(uuid) from public, anon;
grant execute on function public.end_disaster_duty(uuid) to authenticated;

create or replace function public.set_scg_chair(p_year int, p_month int, p_name text, p_phone text default null)
returns public.disaster_scg_chairs
language plpgsql security definer set search_path to 'public' as $$
declare
  v     public.disaster_scg_chairs;
  v_who text;
  v_name text := nullif(left(btrim(coalesce(p_name, '')), 160), '');
begin
  if not public.works_disaster_desk() then raise exception 'Only the Disaster desk does this' using errcode = '42501'; end if;
  if p_year not between 2020 and 2100 or p_month not between 1 and 12 then
    raise exception 'Choose the month.' using errcode = '22023';
  end if;
  select full_name into v_who from public.profiles where id = auth.uid();
  if v_name is null then
    delete from public.disaster_scg_chairs where tenant_id = public.current_tenant() and year = p_year and month = p_month
    returning * into v;
  else
    insert into public.disaster_scg_chairs (tenant_id, year, month, name, phone, updated_by_name)
    values (public.current_tenant(), p_year, p_month, v_name, nullif(left(btrim(coalesce(p_phone, '')), 60), ''), v_who)
    on conflict (tenant_id, year, month) do update
      set name = excluded.name, phone = excluded.phone, updated_by_name = excluded.updated_by_name, updated_at = now()
    returning * into v;
  end if;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (public.current_tenant(), 'EthekwiniDisaster', auth.uid(), v_who, 'EthekwiniDisaster', 'SCG_CHAIR', 'disaster_scg_chairs',
    format('%s-%s', p_year, p_month), coalesce(v_name, 'Not rostered'));
  return v;
end $$;
revoke all on function public.set_scg_chair(int, int, text, text) from public, anon;
grant execute on function public.set_scg_chair(int, int, text, text) to authenticated;

-- disaster_call_out (0111) also calls out a Disaster Management officer
-- (p_fields.officer_id, a personnel id): their name and work cellphone.
create or replace function public.disaster_call_out(p_incident_id uuid, p_client_ref uuid, p_fields jsonb)
returns public.disaster_callouts
language plpgsql security definer set search_path to 'public' as $$
declare
  f         jsonb := coalesce(p_fields, '{}'::jsonb);
  v         public.disaster_callouts;
  v_inc     public.incidents;
  v_partner public.mutual_aid_partners;
  v_officer public.personnel;
  v_pid     uuid;
  v_agency  text := nullif(left(btrim(coalesce(p_fields ->> 'agency_name', '')), 200), '');
  v_how     text := btrim(coalesce(p_fields ->> 'how', ''));
  v_reason  text := nullif(left(btrim(coalesce(p_fields ->> 'reason', '')), 500), '');
  v_kind    text;
  v_phone   text;
  v_eta     int;
  v_name    text;
  v_dept    public.incident_departments;
begin
  if p_client_ref is null then
    raise exception 'The call-out has no reference; try again' using errcode = '22023';
  end if;
  v_inc := public.disaster_desk_incident(p_incident_id);
  select * into v from public.disaster_callouts
   where tenant_id = v_inc.tenant_id and client_ref = p_client_ref;
  if found then return v; end if;

  if v_how not in ('Call', 'Radio', 'WhatsApp', 'Other') then
    raise exception 'Say how you reached them: call, radio, WhatsApp or other.' using errcode = 'P0001';
  end if;
  if coalesce(f ->> 'officer_id', '') ~ '^[0-9a-fA-F-]{36}$' then
    select * into v_officer from public.personnel
     where id = (f ->> 'officer_id')::uuid and tenant_id = v_inc.tenant_id and silo = 'EthekwiniDisaster';
    if not found then raise exception 'That officer is not in Disaster Management.' using errcode = 'P0001'; end if;
    select * into v from public.disaster_callouts
     where incident_id = v_inc.id and officer_id = v_officer.id and status in ('Called', 'On the way', 'On scene');
    if found then return v; end if;
    v_agency := btrim(concat_ws(' ', nullif(btrim(coalesce(v_officer.rank, '')), ''), v_officer.first_name, v_officer.last_name));
    v_kind := 'Disaster Management officer';
    v_phone := v_officer.work_cellphone;
  elsif coalesce(f ->> 'partner_id', '') ~ '^[0-9a-fA-F-]{36}$' then
    v_pid := (f ->> 'partner_id')::uuid;
    select * into v_partner from public.mutual_aid_partners
     where id = v_pid and tenant_id = v_inc.tenant_id and is_active;
    if not found then raise exception 'That partner is not in the directory.' using errcode = 'P0001'; end if;
    select * into v from public.disaster_callouts
     where incident_id = v_inc.id and partner_id = v_pid and status in ('Called', 'On the way', 'On scene');
    if found then return v; end if;
  elsif v_agency is null then
    raise exception 'Choose who you called out.' using errcode = 'P0001';
  end if;
  if coalesce(f ->> 'eta_minutes', '') <> '' then
    if (f ->> 'eta_minutes') !~ '^[0-9]{1,4}$' or (case when (f ->> 'eta_minutes') ~ '^[0-9]{1,4}$' then (f ->> 'eta_minutes')::int > 1440 end) then
      raise exception 'Arrival time is in minutes, up to a day.' using errcode = 'P0001';
    end if;
    v_eta := (f ->> 'eta_minutes')::int;
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.disaster_callouts (
    tenant_id, incident_id, client_ref, partner_id, officer_id, agency_name, resource_type, contact_number, radio_frequency,
    how, reason, suggested_by_ai, eta_minutes, called_by, called_by_name
  ) values (
    v_inc.tenant_id, v_inc.id, p_client_ref, v_partner.id, v_officer.id, coalesce(v_partner.agency_name, v_agency),
    coalesce(v_partner.resource_type, v_kind, nullif(left(btrim(coalesce(f ->> 'resource_type', '')), 100), '')),
    coalesce(v_partner.contact_number, v_phone, nullif(left(btrim(coalesce(f ->> 'contact_number', '')), 60), '')),
    v_partner.radio_frequency, v_how, v_reason,
    case when jsonb_typeof(f -> 'suggested_by_ai') = 'boolean' then (f ->> 'suggested_by_ai')::boolean else false end, v_eta,
    auth.uid(), v_name
  ) returning * into v;

  -- Disaster is on the call: its part is dispatched by the first call-out.
  if not ('EthekwiniDisaster' = any (coalesce(v_inc.dispatched_silos, '{}'))) and v_inc.silo <> 'EthekwiniDisaster' then
    update public.incidents set dispatched_silos = coalesce(dispatched_silos, '{}') || 'EthekwiniDisaster'::public.silo,
           updated_at = now()
     where id = v_inc.id returning * into v_inc;
  end if;
  perform public.ensure_incident_departments(v_inc);
  select * into v_dept from public.incident_departments
   where incident_id = v_inc.id and silo = 'EthekwiniDisaster' for update;
  if found and v_dept.status = 'Waiting' then
    update public.incident_departments
       set status = 'Dispatched', dispatched_at = now(), dispatched_by = auth.uid(), dispatched_by_name = v_name,
           updated_at = now()
     where id = v_dept.id;
    update public.incidents set dispatch_time = coalesce(dispatch_time, now()), updated_at = now() where id = v_inc.id;
  end if;
  v_inc := public.sync_incident_from_departments(v_inc.id);
  perform public.disaster_facts_for(v_inc);

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id,
    format('[CALL-OUT] %s called out by %s%s%s — %s',
      v.agency_name, lower(case v.how when 'Call' then 'phone' when 'Other' then 'other means' else v.how end),
      case when v.eta_minutes is not null then format(', expected in %s min', v.eta_minutes) else '' end,
      case when v.reason is not null then ': ' || v.reason else '' end,
      coalesce(v_name, 'the Disaster desk')),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_CALL_OUT',
    'disaster_callouts', v.id::text, format('%s · %s by %s%s', v_inc.incident_number, v.agency_name, v.how,
      case when v.suggested_by_ai then ' (suggested by Criti)' else '' end));

  return v;
end $$;
revoke all on function public.disaster_call_out(uuid, uuid, jsonb) from public, anon;
grant execute on function public.disaster_call_out(uuid, uuid, jsonb) to authenticated;

-- ── 5. The on-site assessment, filed by the desk for its officers ──────────

alter table public.disaster_assessments add column if not exists reported_by_name text
  check (reported_by_name is null or length(reported_by_name) <= 160);

-- As 0107, with the changes marked "0112": the Disaster desk files an
-- officer's assessment for them, as they report it, and says who reported it.
create or replace function public.file_disaster_assessment(p_incident_id uuid, p_client_ref uuid, p_fields jsonb)
returns public.disaster_assessments
language plpgsql security definer set search_path to 'public' as $$
declare
  f          jsonb := coalesce(p_fields, '{}'::jsonb);
  v          public.disaster_assessments;
  v_incident public.incidents;
  v_me       public.incident_responders;
  -- 0112: or the Disaster desk.
  v_command  boolean := public.role_in('Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin') or public.works_disaster_desk();
  v_place    text := nullif(left(btrim(coalesce(p_fields ->> 'place', '')), 200), '');
  v_ward     text := nullif(left(btrim(coalesce(p_fields ->> 'ward', '')), 40), '');
  v_hazard   text := btrim(coalesce(p_fields ->> 'hazard', ''));
  v_shelter  text := nullif(left(btrim(coalesce(p_fields ->> 'shelter_name', '')), 200), '');
  v_notes    text := nullif(btrim(coalesce(p_fields ->> 'notes', '')), '');
  v_reporter text := nullif(left(btrim(coalesce(p_fields ->> 'reported_by', '')), 160), '');
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
  perform public.require_role('Disaster', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin',
    'Dispatcher', 'ControlRoom', 'Operator', 'SystemController', 'System', 'Chief', 'FireChief', 'Captain');
  if public.current_silo() is distinct from 'EthekwiniDisaster' and not public.works_disaster_desk() then
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
    services, needs, relief, shelter_name, people_sheltered, notes, lat, lng, accuracy, filed_by, filed_by_name, reported_by_name
  ) values (
    v_incident.tenant_id, v_incident.id, p_client_ref, v_place, v_ward, v_hazard,
    coalesce(p_fields ->> 'households_affected', '0')::int, coalesce(p_fields ->> 'people_affected', '0')::int,
    coalesce(p_fields ->> 'people_displaced', '0')::int, coalesce(p_fields ->> 'injured', '0')::int,
    coalesce(p_fields ->> 'deaths', '0')::int, coalesce(p_fields ->> 'missing', '0')::int,
    coalesce(p_fields ->> 'homes_destroyed', '0')::int, coalesce(p_fields ->> 'homes_damaged', '0')::int,
    v_services, v_needs, v_relief, v_shelter, coalesce(p_fields ->> 'people_sheltered', '0')::int, v_notes,
    v_lat, v_lng, v_acc, auth.uid(), v_name, v_reporter
  ) returning * into v;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[ASSESSMENT] %s: %s households affected, %s displaced, %s homes destroyed, %s damaged%s%s — %s',
      v.place, v.households_affected, v.people_displaced, v.homes_destroyed, v.homes_damaged,
      case when v.injured + v.deaths + v.missing > 0
           then format('; %s injured, %s dead, %s missing', v.injured, v.deaths, v.missing) else '' end,
      case when v.people_sheltered > 0 then format('; %s sheltered at %s', v.people_sheltered, v.shelter_name) else '' end,
      -- 0112: as reported by the officer, filed from the desk.
      case when v_reporter is not null then format('%s, filed from the desk by %s', v_reporter, coalesce(v_name, 'the desk'))
           else coalesce(v_name, 'Disaster Management') end),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_ASSESSMENT',
    'incidents', v_incident.id::text, format('%s · %s · %s households, %s displaced%s', v_incident.incident_number, v.place,
      v.households_affected, v.people_displaced, case when v_reporter is not null then ' · reported by ' || v_reporter else '' end));

  perform public.notify_incident_chain(
    v_incident, 'incident_update',
    format('%s: assessment at %s', v_incident.incident_number, v.place),
    format('%s households affected · %s displaced · %s homes destroyed', v.households_affected, v.people_displaced, v.homes_destroyed));

  return v;
end $$;
revoke all on function public.file_disaster_assessment(uuid, uuid, jsonb) from public, anon;
grant execute on function public.file_disaster_assessment(uuid, uuid, jsonb) to authenticated;

-- ── 6. The post-mortem knows the call ──────────────────────────────────────

alter table public.post_mortem_reports
  add column if not exists short_title                text,
  add column if not exists hazard                     text,
  add column if not exists coordination_level         text,
  add column if not exists municipalities             text[] not null default '{}',
  add column if not exists households_affected        int not null default 0,
  add column if not exists homes_destroyed            int not null default 0,
  add column if not exists homes_damaged              int not null default 0,
  add column if not exists people_sheltered           int not null default 0,
  add column if not exists doc_activated              boolean not null default false,
  add column if not exists scg_convened               boolean not null default false,
  add column if not exists local_disaster_recommended boolean not null default false,
  add column if not exists response                   jsonb not null default '{}'::jsonb;

-- As 0111, with the changes marked "0112".
create or replace function public.file_post_mortem(p_incident_id uuid, p_fields jsonb)
returns public.post_mortem_reports
language plpgsql security definer set search_path to 'public' as $$
declare
  f          jsonb := coalesce(p_fields, '{}'::jsonb);
  v_radio    uuid;
  v_incident public.incidents;
  v_person   public.personnel;
  v_report   public.post_mortem_reports;
  v_facts    public.disaster_call_facts;
  v_name     text;
  v_officer  text := nullif(trim(coalesce(f ->> 'reporting_officer', '')), '');
  v_cause    text := nullif(trim(coalesce(f ->> 'root_cause', '')), '');
  v_lessons  text := nullif(trim(coalesce(f ->> 'lessons_learned', '')), '');
  v_start    timestamptz;
  v_end      timestamptz;
  v_command  boolean := public.role_in('Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin');
  v_desk     boolean := public.works_disaster_desk();
  v_count    text;
  v_timeline jsonb;
  v_response jsonb;
  v_now      timestamptz := now();
begin
  perform public.require_role('Disaster', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin',
    'Dispatcher', 'ControlRoom', 'Operator', 'SystemController', 'System', 'Chief', 'FireChief', 'Captain');
  if public.current_silo() is distinct from 'EthekwiniDisaster' and nullif(f ->> 'radioed_by', '') is null and not v_desk then
    raise exception 'Only Disaster Management files a post-mortem' using errcode = '42501';
  end if;

  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;
  v_incident := public.incident_for_department(v_incident, 'EthekwiniDisaster');
  if v_desk and not v_command and nullif(f ->> 'radioed_by', '') is null
     and v_incident.accepted_by is distinct from auth.uid() and v_incident.report_filed_at is null
     and not exists (select 1 from public.disaster_callouts c where c.incident_id = p_incident_id) then
    raise exception 'Call a partner out to % before filing its post-mortem', v_incident.incident_number using errcode = 'P0001';
  end if;
  if not (v_incident.silo = 'EthekwiniDisaster' or 'EthekwiniDisaster' = any(coalesce(v_incident.dispatched_silos, '{}'))) then
    raise exception '% is not a Disaster Management incident', v_incident.incident_number using errcode = 'P0001';
  end if;

  if v_incident.report_filed_at is not null then
    select * into v_report from public.post_mortem_reports
    where incident_id = p_incident_id and report_number is not null order by report_filed_at limit 1;
    if found then return v_report; end if;
    raise exception '% is already closed', v_incident.incident_number using errcode = 'P0001';
  end if;
  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text) using errcode = 'P0001';
  end if;

  v_desk := v_desk and nullif(f ->> 'radioed_by', '') is null
            and exists (select 1 from public.disaster_callouts c where c.incident_id = p_incident_id);
  v_radio := case when v_desk then null
                  else public.radio_filer(p_incident_id, 'EthekwiniDisaster', f, v_incident.accepted_by) end;
  if (v_command or v_desk) and v_radio is null then
    if v_incident.status not in ('Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting', 'Active') then
      raise exception 'Deploy resources to % before filing its post-mortem', v_incident.incident_number using errcode = 'P0001';
    end if;
  else
    if v_radio is null and v_incident.accepted_by is distinct from auth.uid() then
      raise exception 'Only the officer leading % files its post-mortem', v_incident.incident_number using errcode = 'P0001';
    end if;
    if v_incident.status not in ('Arrived', 'On Scene', 'Transporting') then
      raise exception 'Mark yourself on scene before filing the post-mortem for %', v_incident.incident_number using errcode = 'P0001';
    end if;
  end if;

  if coalesce(f ->> 'start_time', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T]([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Start Time must be a date and time (YYYY-MM-DD HH:MM).' using errcode = 'P0001';
  end if;
  if coalesce(f ->> 'end_time', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T]([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Resolved Time must be a date and time (YYYY-MM-DD HH:MM).' using errcode = 'P0001';
  end if;
  v_start := (replace(f ->> 'start_time', 'T', ' ') || ':00')::timestamp at time zone 'Africa/Johannesburg';
  v_end   := (replace(f ->> 'end_time', 'T', ' ') || ':00')::timestamp at time zone 'Africa/Johannesburg';
  if v_end < v_start then raise exception 'Resolved Time cannot be before Start Time.' using errcode = 'P0001'; end if;
  if v_end > v_now + interval '5 minutes' then raise exception 'Resolved Time cannot be in the future.' using errcode = 'P0001'; end if;
  -- 0112: and the Plan's impact counts.
  foreach v_count in array array['injuries', 'fatalities', 'displaced_people', 'households_affected', 'homes_destroyed',
                                 'homes_damaged', 'people_sheltered'] loop
    if coalesce(f ->> v_count, '0') !~ '^[0-9]{1,6}$' then
      raise exception 'Counts must be whole numbers.' using errcode = 'P0001';
    end if;
  end loop;
  if v_cause is null then raise exception 'Root Cause Analysis is required.' using errcode = 'P0001'; end if;
  if v_lessons is null then raise exception 'Lessons Learned / Recommendations is required.' using errcode = 'P0001'; end if;
  if v_officer is null then raise exception 'Reporting Officer Name is required.' using errcode = 'P0001'; end if;
  if length(v_cause) > 4000 or length(v_lessons) > 4000 then
    raise exception 'Keep each answer under 4000 characters.' using errcode = 'P0001';
  end if;

  select * into v_person from public.personnel
  where user_id = coalesce(v_radio, auth.uid()) and tenant_id = public.current_tenant();
  select full_name into v_name from public.profiles where id = auth.uid();
  select * into v_facts from public.disaster_call_facts where incident_id = p_incident_id;

  select coalesce(jsonb_agg(e order by e ->> 'timestamp'), '[]'::jsonb) into v_timeline from (
    select jsonb_build_object('timestamp', to_char(u.timestamp at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI'),
                              'text', u.message) as e
      from public.incident_updates u where u.incident_id = p_incident_id
    union all
    select jsonb_build_object('timestamp',
             case when coalesce(x ->> 'timestamp', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                  then to_char((x ->> 'timestamp')::timestamptz at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI')
                  else coalesce(x ->> 'timestamp', '') end,
             'text', coalesce(x ->> 'text', ''))
      from public.disaster_logs d, jsonb_array_elements(coalesce(d.updates, '[]'::jsonb)) x
     where d.incident_id = p_incident_id
  ) s;

  -- 0112: the response, from the record: who was called out and when, the
  -- shelters opened and the people in them, the relief handed out.
  v_response := jsonb_build_object(
    'callouts', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', c.agency_name, 'type', c.resource_type, 'officer', c.officer_id is not null, 'how', c.how, 'status', c.status,
        'called', to_char(c.called_at at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI'),
        'on_scene', to_char(c.on_scene_at at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI'),
        'left', to_char(c.left_at at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI')) order by c.called_at), '[]'::jsonb)
      from public.disaster_callouts c where c.incident_id = p_incident_id),
    'shelters', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', s.name, 'peak', o.peak_people, 'households', o.households, 'children', o.children, 'elderly', o.elderly,
        'disabled', o.disabled, 'relief', o.relief,
        'opened', to_char(o.opened_at at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI'),
        'closed', to_char(o.closed_at at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI')) order by o.opened_at), '[]'::jsonb)
      from public.disaster_shelter_openings o join public.disaster_shelters s on s.id = o.shelter_id where o.incident_id = p_incident_id),
    'fcp', v_facts.fcp_location, 'eoc', v_facts.eoc_location);

  insert into public.post_mortem_reports (
    tenant_id, silo, incident_id, incident_number, report_number, filed_by,
    incident_type, location, start_time, end_time, total_duration_hours,
    injuries, fatalities, displaced_people, root_cause, lessons_learned,
    timeline_snapshot, reporting_officer, report_filed_at,
    short_title, hazard, coordination_level, municipalities, households_affected, homes_destroyed, homes_damaged,
    people_sheltered, doc_activated, scg_convened, local_disaster_recommended, response
  ) values (
    v_incident.tenant_id, 'EthekwiniDisaster', v_incident.id, v_incident.incident_number,
    'PM-' || v_incident.incident_number, auth.uid(),
    coalesce(nullif(trim(coalesce(v_incident.disaster_type, '')), ''), v_incident.incident_type),
    v_incident.location_address, v_start, v_end,
    round((extract(epoch from (v_end - v_start)) / 3600)::numeric, 2),
    (f ->> 'injuries')::int, (f ->> 'fatalities')::int, (f ->> 'displaced_people')::int,
    v_cause, v_lessons, v_timeline, v_officer, v_now,
    v_facts.short_title, v_facts.hazard, coalesce(v_facts.highest_level, 'Bronze'), coalesce(v_facts.municipalities, '{}'),
    coalesce(f ->> 'households_affected', '0')::int, coalesce(f ->> 'homes_destroyed', '0')::int,
    coalesce(f ->> 'homes_damaged', '0')::int, coalesce(f ->> 'people_sheltered', '0')::int,
    v_facts.doc_activated_at is not null, v_facts.scg_convened_at is not null,
    case when jsonb_typeof(f -> 'local_disaster_recommended') = 'boolean' then (f ->> 'local_disaster_recommended')::boolean
         else coalesce(f ->> 'local_disaster_recommended', '') in ('true', 'yes', 'Yes') end,
    v_response
  ) returning * into v_report;

  update public.disaster_callouts
     set status = 'Left scene', left_at = coalesce(left_at, v_now), updated_at = v_now
   where incident_id = p_incident_id and status = 'On scene';
  update public.disaster_callouts
     set status = 'Stood down', left_at = coalesce(left_at, v_now), updated_at = v_now
   where incident_id = p_incident_id and status in ('Called', 'On the way');

  v_incident := public.finish_department_by_report(p_incident_id, 'EthekwiniDisaster', v_now);

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[REPORT] Post-mortem %s filed by %s (%s injured, %s fatalities, %s displaced)',
      v_report.report_number, v_officer, v_report.injuries, v_report.fatalities, v_report.displaced_people),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'REPORT_FILED', 'incidents',
    v_incident.id::text, format('Post-mortem %s filed for %s%s', v_report.report_number, v_incident.incident_number,
      case when v_desk then ' from the Disaster desk' else '' end));

  perform public.notify_incident_chain(
    v_incident, case when v_incident.status = 'Resolved' then 'resolved' else 'report_filed' end,
    format('%s: post-mortem filed by %s', v_incident.incident_number, v_officer),
    format('%s · %s displaced', v_report.incident_type, v_report.displaced_people)
  );

  if v_radio is not null then perform public.note_radio_filing(p_incident_id, 'EthekwiniDisaster', v_radio); end if;

  return v_report;
end $$;
revoke all on function public.file_post_mortem(uuid, jsonb) from public, anon;
grant execute on function public.file_post_mortem(uuid, jsonb) to authenticated;

-- ── 7. Prove it ────────────────────────────────────────────────────────────

do $$
declare
  v_bad text;
  v_tables text[] := array['disaster_call_facts', 'disaster_shelters', 'disaster_shelter_openings', 'disaster_shelter_entries',
                           'disaster_duty', 'disaster_scg_chairs'];
begin
  select string_agg(t, ', ') into v_bad from unnest(v_tables) t
   where not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t
                      and p.policyname = 'tenant_isolation' and p.permissive = 'RESTRICTIVE');
  if v_bad is not null then raise exception 'No tenant wall on: % — nothing was changed', v_bad; end if;
  select string_agg(tablename || '.' || policyname, ', ') into v_bad from pg_policies
   where schemaname = 'public' and tablename = any (v_tables || array['mutual_aid_partners'])
     and permissive = 'PERMISSIVE' and cmd <> 'SELECT';
  if v_bad is not null then raise exception 'Write policies found on %: nothing was changed', v_bad; end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('set_disaster_call', 'set_coordination_level', 'save_mutual_aid_partner', 'save_disaster_shelter',
                       'open_disaster_shelter', 'update_disaster_shelter', 'close_disaster_shelter', 'save_disaster_duty',
                       'end_disaster_duty', 'set_scg_chair', 'disaster_call_out', 'file_disaster_assessment', 'file_post_mortem',
                       'disaster_facts_for')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then raise exception 'Anonymous users could run: % — nothing was changed', v_bad; end if;
end $$;

commit;

notify pgrst, 'reload schema';
