-- ============================================================================
-- 0077 — The call: details by type, incident codes, and the new incident number
-- ============================================================================
--
-- Run after 0076.
--
-- The incident number shows the departments a call was sent to, the date and
-- time it was sent, and its number of the day:
--
--   MP-20261010-1115-0034          Metro Police
--   MPFD-20261010-1115-0034        Metro Police and Fire
--   MPFD-MD-20261010-1115-0034     and EMS
--   MPFD-MDDM-20261010-1115-0034   all four
--
-- The codes (MP, FD, MD, DM) go in that order, joined in pairs. Date and time
-- are South African, at the moment the call is sent to dispatch: logged,
-- sent early, or an officer's SOS. One counter per organisation per day, so
-- no two calls share a number (the old counter was per department, and two
-- departments could both have INC-…-0001). The number never changes, even if
-- a department is added later. Calls already on record keep their INC- numbers.
--
-- Also:
--   - incidents.details: the details the call taker filled in for the type
--     (what was taken, the suspects, the vehicles…), kept apart from the
--     caller's words.
--   - incidents.incident_code: the type's code when the call was logged.
--   - Every organisation gets V4's incident types and codes (10-50 PI, 10-33…),
--     our own codes for the rest (CR-01, TR-01, FI-01, ME-01, PO-01, DI-01),
--     and two more groups (Animals, Police service). Codes an administrator
--     set are kept; 0007's placeholder codes (10-1 Assault…) are replaced.
--     "Suspicious person or vehicle" becomes V4's two types.
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. The incident number ──────────────────────────────────────────────────

create table if not exists public.incident_day_counters (
  tenant_id uuid not null,
  day       date not null,
  last_seq  integer not null default 0,
  primary key (tenant_id, day)
);
comment on table public.incident_day_counters is
  'The number of the day for incident numbers, one counter per organisation per day (0077). Written only by next_incident_number().';
alter table public.incident_day_counters enable row level security;
-- No policies: nobody reads or writes it but next_incident_number().

/** MP, MPFD, MPFD-MD, MPFD-MDDM: the departments, in order, joined in pairs. */
create or replace function public.incident_number_prefix(p_tags silo[])
returns text language plpgsql immutable set search_path to 'public' as $$
declare
  v_codes text[] := '{}';
  v_out   text := '';
  i       integer;
begin
  if 'MetroPolice' = any (coalesce(p_tags, '{}')) then v_codes := array_append(v_codes, 'MP'); end if;
  if 'MetroFire' = any (coalesce(p_tags, '{}')) then v_codes := array_append(v_codes, 'FD'); end if;
  if 'Medical' = any (coalesce(p_tags, '{}')) then v_codes := array_append(v_codes, 'MD'); end if;
  if 'EthekwiniDisaster' = any (coalesce(p_tags, '{}')) then v_codes := array_append(v_codes, 'DM'); end if;
  -- No department named (an SOS raised from the control room).
  if cardinality(v_codes) = 0 then return 'CR'; end if;
  for i in 1 .. cardinality(v_codes) loop
    v_out := v_out || v_codes[i];
    if i % 2 = 0 and i < cardinality(v_codes) then v_out := v_out || '-'; end if;
  end loop;
  return v_out;
end $$;

create or replace function public.next_incident_number(p_silo silo, p_tags silo[], p_at timestamptz default now())
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid := public.current_tenant();
  v_local  timestamp := coalesce(p_at, now()) at time zone 'Africa/Johannesburg';
  v_seq    integer;
begin
  insert into public.incident_day_counters (tenant_id, day, last_seq)
  values (v_tenant, v_local::date, 1)
  on conflict (tenant_id, day)
    do update set last_seq = public.incident_day_counters.last_seq + 1
  returning last_seq into v_seq;

  return public.incident_number_prefix(coalesce(nullif(p_tags, '{}'), array[p_silo]))
      || '-' || to_char(v_local, 'YYYYMMDD') || '-' || to_char(v_local, 'HH24MI')
      || '-' || case when v_seq < 10000 then lpad(v_seq::text, 4, '0') else v_seq::text end;
end $$;

-- Anything still asking with the department alone gets the new number too.
create or replace function public.next_incident_number(p_silo silo)
returns text language sql security definer set search_path to 'public' as $$
  select public.next_incident_number(p_silo, array[p_silo], now())
$$;

revoke all on function public.incident_number_prefix(silo[]) from public, anon, authenticated;
revoke all on function public.next_incident_number(silo, silo[], timestamptz) from public, anon, authenticated;
revoke all on function public.next_incident_number(silo) from public, anon, authenticated;
grant execute on function public.incident_number_prefix(silo[]) to service_role;
grant execute on function public.next_incident_number(silo, silo[], timestamptz) to service_role;
grant execute on function public.next_incident_number(silo) to service_role;

-- Unique within the organisation. Numbers from before 0077 (INC-…) could
-- repeat between departments, so they are left out.
create unique index if not exists incidents_tenant_number_key
  on public.incidents (tenant_id, incident_number)
  where incident_number not like 'INC-%';

-- ── 2. The call's details and code ──────────────────────────────────────────

alter table public.incidents
  add column if not exists details jsonb not null default '{}'::jsonb,
  add column if not exists incident_code text;
comment on column public.incidents.details is
  'The details the call taker filled in for the type: what was taken, the suspects, the vehicles… (0077).';
comment on column public.incidents.incident_code is
  'The incident type''s code when the call was logged, e.g. 10-50 PI or CR-03 (0077).';

/** The details as kept: an object of short answers or lists of them, at most 8 KB. */
create or replace function public.clean_details(p jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare
  k   text;
  v   jsonb;
  out jsonb := '{}'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return '{}'::jsonb; end if;
  if octet_length(p::text) > 8000 then
    raise exception 'The details are too long' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p) loop
    continue when length(k) > 200;
    if jsonb_typeof(v) = 'string' then
      if btrim(v #>> '{}') <> '' then out := out || jsonb_build_object(k, left(btrim(v #>> '{}'), 200)); end if;
    elsif jsonb_typeof(v) = 'array' then
      out := out || jsonb_build_object(k, (
        select coalesce(jsonb_agg(left(btrim(e #>> '{}'), 60) order by o), '[]'::jsonb)
          from jsonb_array_elements(v) with ordinality as a(e, o)
         where jsonb_typeof(e) = 'string' and btrim(e #>> '{}') <> '' and o <= 20));
    end if;
  end loop;
  return out;
end $$;

/** The organisation's code for a type, as configured now. */
create or replace function public.incident_code_for(p_type text, p_category text)
returns text language sql stable security definer set search_path to 'public' as $$
  select nullif(btrim(c.code), '')
    from public.command_records c
   where c.tenant_id = public.current_tenant() and c.module = 'IncidentCategory' and c.detail1 is not null
     and lower(c.name) = lower(btrim(coalesce(p_type, '')))
   order by (lower(c.detail1) = lower(btrim(coalesce(p_category, '')))) desc, (c.status = 'Active') desc, c.created_at
   limit 1
$$;

revoke all on function public.clean_details(jsonb) from public, anon, authenticated;
revoke all on function public.incident_code_for(text, text) from public, anon, authenticated;
grant execute on function public.clean_details(jsonb) to service_role;
grant execute on function public.incident_code_for(text, text) to service_role;

-- ── 3. Every organisation's incident types and codes ────────────────────────

do $$
declare
  t record;
begin
  for t in select id from public.tenants loop
    insert into public.command_records (tenant_id, module, name, detail1, code, status)
    select t.id, 'IncidentCategory', g.name, null, g.code, 'Active'
      from (values ('Crime', '10'), ('Traffic', '20'), ('Fire', '30'), ('Medical', '40'), ('Public Order', '50'), ('Disaster', '60'), ('Animals', '70'), ('Police service', '80')) as g(name, code)
     where not exists (select 1 from public.command_records c
                        where c.tenant_id = t.id and c.module = 'IncidentCategory' and c.detail1 is null
                          and lower(c.name) = lower(g.name));

    -- Types the organisation does not have yet, with their codes and questions.
    insert into public.command_records (tenant_id, module, name, detail1, code, detail2, status)
    select t.id, 'IncidentCategory', v.name, v.grp, v.code, nullif(v.prompts, ''), 'Active'
      from (values
        ('Crime', 'Assault', 'CR-01', 'Is anyone hurt?
Is the attacker still there?'),
        ('Crime', 'Robbery', 'CR-02', 'Were weapons used?
Which way did they go?'),
        ('Crime', 'Burglary', 'CR-03', 'Are the suspects still inside?
Is anyone home?'),
        ('Crime', 'Shooting / gunshot wound', 'CR-04', 'Is the shooter still there?
Where was the person shot?
Is the person breathing?'),
        ('Crime', 'Stabbing', 'CR-05', 'Is the attacker still there?
Where is the wound?
Is the bleeding heavy?'),
        ('Crime', 'Armed robbery', 'CR-06', 'How many suspects, and what weapons?
Which way did they go, and in what vehicle?'),
        ('Crime', 'Hijacking', 'CR-07', 'What vehicle: make, colour, registration?
Which way did they go?
Is anyone hurt?'),
        ('Crime', 'Cash-in-transit heist', 'CR-08', 'How many suspects and vehicles?
Are shots being fired?'),
        ('Crime', 'Kidnapping / abduction', 'CR-09', 'Who was taken, and what do they look like?
What vehicle, and which way?'),
        ('Crime', 'Domestic violence', '10-16', 'Is the attacker still there?
Is anyone hurt?
Are there children in the house?'),
        ('Crime', 'Rape / sexual assault', 'CR-10', 'Is the person safe now?
Does the person need medical help?'),
        ('Crime', 'Child abuse', 'CR-11', 'Is the child safe now?
Is the child hurt?'),
        ('Crime', 'Murder / body found', 'CR-12', 'Is anyone else in danger?
Has anyone touched the body?'),
        ('Crime', 'Gang violence', 'CR-13', 'Are weapons being used?
How many people?'),
        ('Crime', 'Housebreaking in progress', 'CR-14', 'Are you safe where you are?
How many suspects?'),
        ('Crime', 'Theft of motor vehicle', 'CR-15', 'Make, colour and registration?
When was it last seen?'),
        ('Crime', 'Theft', 'CR-16', 'What was taken?
Is the suspect still there?'),
        ('Crime', 'Shoplifting', 'CR-17', 'Is the suspect being held?'),
        ('Crime', 'Missing person', 'CR-18', 'Name, age and what they were wearing?
Where and when were they last seen?'),
        ('Crime', 'Suspicious Person', '10-37', 'What do they look like, and where are they now?'),
        ('Crime', 'Suspicious Vehicle', '10-38', 'Make, colour and registration?'),
        ('Crime', 'Drug dealing', 'CR-19', 'Where exactly, and how many people?'),
        ('Crime', 'Malicious damage to property', 'CR-20', 'What was damaged?
Is the person still there?'),
        ('Crime', 'Trespassing', 'CR-21', 'Is the person still on the property?'),
        ('Crime', 'Emergency / Officer Needs Assistance', '10-33', 'Where is the officer, and what is happening?'),
        ('Crime', 'Armed Individual / Subject with Gun', '10-32', 'What weapon, and what do they look like?
Which way are they going?'),
        ('Crime', 'Crime in Progress', '10-31', 'What crime is happening?
How many suspects?'),
        ('Crime', 'Bomb Threat', '10-89', 'What was said, and is there a device?
Have people been moved away?'),
        ('Crime', 'Bank Alarm / Holdup', '10-90', 'Which bank or business?
Are the robbers still inside?'),
        ('Crime', 'Prison Break', '10-98', 'How many escaped, and what do they look like?
Which way did they go?'),
        ('Crime', 'Fight / Physical Altercation', '10-10', 'How many people are involved?
Are weapons being used?
Is anyone hurt?'),
        ('Crime', 'Prowler Report', '10-14', 'Where is the person now, and what do they look like?'),
        ('Crime', 'Stolen / Wanted Vehicle or Person', '10-99', 'Description or registration?
Where was it seen, and which way?'),
        ('Traffic', 'Motor Vehicle Accident', '10-50', 'Is anyone hurt or trapped?
How many vehicles?
Is the road blocked?'),
        ('Traffic', 'Traffic Violation', 'TR-01', 'Registration and direction of travel?'),
        ('Traffic', 'Crash with injuries', '10-50 PI', 'How many people are hurt?
Is anyone trapped?
Is there fuel leaking or fire?'),
        ('Traffic', 'Crash with people trapped', 'TR-02', 'How many are trapped?
Is there fire or leaking fuel?
Are they conscious?'),
        ('Traffic', 'Pedestrian knocked down', 'TR-03', 'Is the person conscious and breathing?
Did the driver stay?'),
        ('Traffic', 'Bus or taxi crash', 'TR-04', 'How many passengers are hurt?
Is anyone trapped?'),
        ('Traffic', 'Hit and run', '10-57', 'Vehicle make, colour and registration?
Is anyone hurt?'),
        ('Traffic', 'Truck overturned', 'TR-05', 'What is it carrying?
Is anything leaking?'),
        ('Traffic', 'Drunk driver', '10-55', 'Vehicle, registration and direction?'),
        ('Traffic', 'Road blocked', '10-53', 'What is blocking the road?'),
        ('Traffic', 'Traffic lights out', '10-49', 'Which intersection?'),
        ('Traffic', 'Abandoned vehicle', 'TR-06', 'Is it blocking traffic?'),
        ('Traffic', 'Accident (Property Damage)', '10-50 PD', 'How many vehicles?
What was damaged?'),
        ('Traffic', 'Accident (Fatality)', '10-50 F', 'How many vehicles?
Is anyone else trapped?'),
        ('Traffic', 'Vehicular Chase', '10-80', 'Vehicle and registration?
Which way is it going?'),
        ('Traffic', 'Illegal Street Racing', '10-94', 'How many vehicles?'),
        ('Traffic', 'Disabled Vehicle / Assist Motorist', '10-46', 'Is the vehicle blocking traffic?'),
        ('Traffic', 'Tow Truck / Wrecker Needed', '10-51', 'What vehicle?'),
        ('Traffic', 'Roadblock / Checkpoint Setup', '10-93', ''),
        ('Traffic', 'Illegally Parked Vehicle', '10-92', 'Registration?'),
        ('Traffic', 'Road Repair Needed', '10-47', 'What is the damage?'),
        ('Traffic', 'Traffic Sign Repair Needed', '10-48', 'Which sign, and what is wrong?'),
        ('Traffic', 'Direct Traffic / Point Duty', '10-58', ''),
        ('Fire', 'Structure Fire', 'FI-01', 'Is anyone inside?
Which floor, and how big is the fire?'),
        ('Fire', 'Veld/Wildland Fire', 'FI-02', 'Is it near homes?
Which way is the wind blowing it?'),
        ('Fire', 'House fire', 'FI-03', 'Is anyone still inside?
Is the fire spreading to neighbours?'),
        ('Fire', 'Informal settlement fire', 'FI-04', 'How many homes are burning?
Is anyone missing or trapped?'),
        ('Fire', 'Fire with people trapped', 'FI-05', 'How many are trapped, and where?
Can they get to a window?'),
        ('Fire', 'Vehicle fire', 'FI-06', 'Is anyone in the vehicle?
Is it near fuel pumps or buildings?'),
        ('Fire', 'Gas leak', '10-25', 'Can people leave the building?
Is anyone feeling ill?'),
        ('Fire', 'Hazardous chemical spill', '10-25', 'What is the substance, if known?
Is anyone feeling ill?'),
        ('Fire', 'Explosion', 'FI-07', 'Is anyone hurt or trapped?
Is there still fire?'),
        ('Fire', 'Building collapse', 'FI-08', 'Is anyone trapped?
How many people were inside?'),
        ('Fire', 'Person trapped (rescue)', 'FI-09', 'Where is the person trapped?
Are they hurt?'),
        ('Fire', 'Electrical fire or sparking cables', 'FI-10', 'Is anyone near the cables?'),
        ('Fire', 'Power lines down', 'FI-11', 'Is anyone touching or near the lines?'),
        ('Fire', 'Smoke seen', '10-73', 'Where is the smoke coming from?'),
        ('Fire', 'Rubbish fire', 'FI-12', 'Is it near buildings or cars?'),
        ('Fire', 'Animal rescue', 'FI-13', 'What animal, and where is it stuck?'),
        ('Fire', 'Fire Alarm / Report', '10-70', 'What is burning?
Is anyone inside?'),
        ('Fire', 'Nature of Fire (Specify in Notes)', '10-71', ''),
        ('Medical', 'Cardiac', 'ME-01', 'Is the person breathing?
Is the person awake?'),
        ('Medical', 'Trauma', 'ME-02', 'Where is the person hurt?
Is there heavy bleeding?'),
        ('Medical', 'Heart attack / chest pain', 'ME-03', 'Is the person awake and breathing?
Their age?'),
        ('Medical', 'Not breathing / choking', 'ME-04', 'Is the person awake?
What did they choke on?'),
        ('Medical', 'Unconscious person', 'ME-05', 'Is the person breathing?'),
        ('Medical', 'Stroke', 'ME-06', 'When did it start?
Is the face drooping or speech slurred?'),
        ('Medical', 'Severe bleeding', 'ME-07', 'Where is the bleeding from?
Can someone press on the wound?'),
        ('Medical', 'Drowning', 'ME-08', 'Is the person out of the water?
Are they breathing?'),
        ('Medical', 'Electrocution', 'ME-09', 'Is the person still touching the power?'),
        ('Medical', 'Seizure / fits', 'ME-10', 'Is the person still fitting?
Are they breathing?'),
        ('Medical', 'Breathing difficulty / asthma', 'ME-11', 'Can the person speak?
Do they have a pump?'),
        ('Medical', 'Diabetic emergency', 'ME-12', 'Is the person awake?'),
        ('Medical', 'Pregnancy / labour', 'ME-13', 'How far along is she?
Is the baby coming now?'),
        ('Medical', 'Overdose / poisoning', 'ME-14', 'What was taken, and how much?
Is the person awake?'),
        ('Medical', 'Allergic reaction', 'ME-15', 'Is the throat swelling or breathing hard?'),
        ('Medical', 'Burns', 'ME-16', 'How big are the burns, and where?'),
        ('Medical', 'Fall / injury', 'ME-17', 'From how high?
Can the person move?'),
        ('Medical', 'Mental health crisis / suicide attempt', '10-96', 'Is the person alone?
Do they have a weapon or pills?'),
        ('Medical', 'Sick person', 'ME-18', 'What are the symptoms?
Their age?'),
        ('Medical', 'Dog bite / animal attack', '10-11C', 'Is the animal still there?
What animal?'),
        ('Medical', 'Ambulance Requested', '10-52', 'What is wrong with the person?
Is the person awake and breathing?'),
        ('Medical', 'Intoxicated Individual (Pedestrian)', '10-56', 'Is the person hurt?
Is the person in the road?'),
        ('Medical', 'Coroner / Mortuary Van Needed', '10-79', 'Has the death been confirmed?'),
        ('Public Order', 'Protest', 'PO-01', 'How many people?
Is it peaceful?'),
        ('Public Order', 'Violent protest / riot', '10-34', 'Is anyone hurt?
Is property being burnt?'),
        ('Public Order', 'Road barricaded / burning tyres', 'PO-02', 'Which road, and where exactly?'),
        ('Public Order', 'Public violence', 'PO-03', 'How many people, and any weapons?'),
        ('Public Order', 'Illegal gathering', 'PO-04', 'How many people?'),
        ('Public Order', 'Noise complaint', '10-15', 'Where exactly?'),
        ('Disaster', 'Flooding', 'DI-01', 'Are people trapped by the water?
How many homes are flooded?'),
        ('Disaster', 'People trapped by flood water', 'DI-02', 'How many people, and where?'),
        ('Disaster', 'Storm damage', 'DI-03', 'Is anyone hurt?
How many homes are damaged?'),
        ('Disaster', 'Landslide / mudslide', 'DI-04', 'Are homes or people buried?'),
        ('Disaster', 'Tree fallen on a home or road', 'DI-05', 'Is anyone trapped or hurt?'),
        ('Disaster', 'Sinkhole', 'DI-06', 'Is it near homes or the road?'),
        ('Disaster', 'Coastal surge / high seas', 'DI-07', 'Are people or homes in danger?'),
        ('Disaster', 'People displaced', 'DI-08', 'How many people need shelter?'),
        ('Animals', 'Animal Case (General)', '10-11', 'What animal, and what is the problem?'),
        ('Animals', 'Pick up Animal', '10-11A', 'What animal?'),
        ('Animals', 'Stray Animal', '10-11B', 'What animal?'),
        ('Animals', 'Dead Animal Removal', '10-11D', 'What animal?'),
        ('Animals', 'Injured Animal', '10-11E', 'What animal?'),
        ('Animals', 'Animal Carcass in Road', '10-45', 'Is it blocking the road?'),
        ('Animals', 'Livestock on Road', '10-54', 'What animals, and how many?
Is the road blocked?'),
        ('Police service', 'Meet Complainant', '10-17', ''),
        ('Police service', 'Call Complainant (Telephone)', '10-21', ''),
        ('Police service', 'Escort (Funeral / VIP)', '10-59', 'What escort, and which route?'),
        ('Police service', 'Pick up Subject / Prisoner Transport', '10-91', ''),
        ('Police service', 'Request Assistance (Non-Emergency)', '10-78', '')
      ) as v(grp, name, code, prompts)
     where not exists (select 1 from public.command_records c
                        where c.tenant_id = t.id and c.module = 'IncidentCategory' and c.detail1 is not null
                          and lower(c.name) = lower(v.name));

    -- Codes: filled in where there is none, or where 0007's placeholder is still there.
    update public.command_records c
       set code = v.code
      from (values
        ('Assault', 'CR-01', '10-1'),
        ('Robbery', 'CR-02', '10-2'),
        ('Burglary', 'CR-03', '10-3'),
        ('Shooting / gunshot wound', 'CR-04', null),
        ('Stabbing', 'CR-05', null),
        ('Armed robbery', 'CR-06', null),
        ('Hijacking', 'CR-07', null),
        ('Cash-in-transit heist', 'CR-08', null),
        ('Kidnapping / abduction', 'CR-09', null),
        ('Domestic violence', '10-16', null),
        ('Rape / sexual assault', 'CR-10', null),
        ('Child abuse', 'CR-11', null),
        ('Murder / body found', 'CR-12', null),
        ('Gang violence', 'CR-13', null),
        ('Housebreaking in progress', 'CR-14', null),
        ('Theft of motor vehicle', 'CR-15', null),
        ('Theft', 'CR-16', null),
        ('Shoplifting', 'CR-17', null),
        ('Missing person', 'CR-18', null),
        ('Suspicious Person', '10-37', null),
        ('Suspicious Vehicle', '10-38', null),
        ('Drug dealing', 'CR-19', null),
        ('Malicious damage to property', 'CR-20', null),
        ('Trespassing', 'CR-21', null),
        ('Emergency / Officer Needs Assistance', '10-33', null),
        ('Armed Individual / Subject with Gun', '10-32', null),
        ('Crime in Progress', '10-31', null),
        ('Bomb Threat', '10-89', null),
        ('Bank Alarm / Holdup', '10-90', null),
        ('Prison Break', '10-98', null),
        ('Fight / Physical Altercation', '10-10', null),
        ('Prowler Report', '10-14', null),
        ('Stolen / Wanted Vehicle or Person', '10-99', null),
        ('Motor Vehicle Accident', '10-50', '20-1'),
        ('Traffic Violation', 'TR-01', '20-2'),
        ('Crash with injuries', '10-50 PI', null),
        ('Crash with people trapped', 'TR-02', null),
        ('Pedestrian knocked down', 'TR-03', null),
        ('Bus or taxi crash', 'TR-04', null),
        ('Hit and run', '10-57', null),
        ('Truck overturned', 'TR-05', null),
        ('Drunk driver', '10-55', null),
        ('Road blocked', '10-53', null),
        ('Traffic lights out', '10-49', null),
        ('Abandoned vehicle', 'TR-06', null),
        ('Accident (Property Damage)', '10-50 PD', null),
        ('Accident (Fatality)', '10-50 F', null),
        ('Vehicular Chase', '10-80', null),
        ('Illegal Street Racing', '10-94', null),
        ('Disabled Vehicle / Assist Motorist', '10-46', null),
        ('Tow Truck / Wrecker Needed', '10-51', null),
        ('Roadblock / Checkpoint Setup', '10-93', null),
        ('Illegally Parked Vehicle', '10-92', null),
        ('Road Repair Needed', '10-47', null),
        ('Traffic Sign Repair Needed', '10-48', null),
        ('Direct Traffic / Point Duty', '10-58', null),
        ('Structure Fire', 'FI-01', '30-1'),
        ('Veld/Wildland Fire', 'FI-02', '30-2'),
        ('House fire', 'FI-03', null),
        ('Informal settlement fire', 'FI-04', null),
        ('Fire with people trapped', 'FI-05', null),
        ('Vehicle fire', 'FI-06', null),
        ('Gas leak', '10-25', null),
        ('Hazardous chemical spill', '10-25', null),
        ('Explosion', 'FI-07', null),
        ('Building collapse', 'FI-08', null),
        ('Person trapped (rescue)', 'FI-09', null),
        ('Electrical fire or sparking cables', 'FI-10', null),
        ('Power lines down', 'FI-11', null),
        ('Smoke seen', '10-73', null),
        ('Rubbish fire', 'FI-12', null),
        ('Animal rescue', 'FI-13', null),
        ('Fire Alarm / Report', '10-70', null),
        ('Nature of Fire (Specify in Notes)', '10-71', null),
        ('Cardiac', 'ME-01', '40-1'),
        ('Trauma', 'ME-02', '40-2'),
        ('Heart attack / chest pain', 'ME-03', null),
        ('Not breathing / choking', 'ME-04', null),
        ('Unconscious person', 'ME-05', null),
        ('Stroke', 'ME-06', null),
        ('Severe bleeding', 'ME-07', null),
        ('Drowning', 'ME-08', null),
        ('Electrocution', 'ME-09', null),
        ('Seizure / fits', 'ME-10', null),
        ('Breathing difficulty / asthma', 'ME-11', null),
        ('Diabetic emergency', 'ME-12', null),
        ('Pregnancy / labour', 'ME-13', null),
        ('Overdose / poisoning', 'ME-14', null),
        ('Allergic reaction', 'ME-15', null),
        ('Burns', 'ME-16', null),
        ('Fall / injury', 'ME-17', null),
        ('Mental health crisis / suicide attempt', '10-96', null),
        ('Sick person', 'ME-18', null),
        ('Dog bite / animal attack', '10-11C', null),
        ('Ambulance Requested', '10-52', null),
        ('Intoxicated Individual (Pedestrian)', '10-56', null),
        ('Coroner / Mortuary Van Needed', '10-79', null),
        ('Protest', 'PO-01', '50-1'),
        ('Violent protest / riot', '10-34', null),
        ('Road barricaded / burning tyres', 'PO-02', null),
        ('Public violence', 'PO-03', null),
        ('Illegal gathering', 'PO-04', null),
        ('Noise complaint', '10-15', null),
        ('Flooding', 'DI-01', '60-1'),
        ('People trapped by flood water', 'DI-02', null),
        ('Storm damage', 'DI-03', null),
        ('Landslide / mudslide', 'DI-04', null),
        ('Tree fallen on a home or road', 'DI-05', null),
        ('Sinkhole', 'DI-06', null),
        ('Coastal surge / high seas', 'DI-07', null),
        ('People displaced', 'DI-08', null),
        ('Animal Case (General)', '10-11', null),
        ('Pick up Animal', '10-11A', null),
        ('Stray Animal', '10-11B', null),
        ('Dead Animal Removal', '10-11D', null),
        ('Injured Animal', '10-11E', null),
        ('Animal Carcass in Road', '10-45', null),
        ('Livestock on Road', '10-54', null),
        ('Meet Complainant', '10-17', null),
        ('Call Complainant (Telephone)', '10-21', null),
        ('Escort (Funeral / VIP)', '10-59', null),
        ('Pick up Subject / Prisoner Transport', '10-91', null),
        ('Request Assistance (Non-Emergency)', '10-78', null)
      ) as v(name, code, placeholder)
     where c.tenant_id = t.id and c.module = 'IncidentCategory' and c.detail1 is not null
       and lower(c.name) = lower(v.name)
       and (nullif(btrim(coalesce(c.code, '')), '') is null or c.code = v.placeholder);

    -- Questions 0076 added, now tied to the details; a list an administrator changed is left.
    update public.command_records c
       set detail2 = nullif(v.prompts, '')
      from (values
        ('Malicious damage to property', 'Is the person still there?', 'What was damaged?
Is the person still there?'),
        ('Abandoned vehicle', 'Where exactly, and is it blocking traffic?', 'Is it blocking traffic?'),
        ('Dog bite / animal attack', 'Is the animal still there?', 'Is the animal still there?
What animal?')
      ) as v(name, old, prompts)
     where c.tenant_id = t.id and c.module = 'IncidentCategory' and c.detail1 is not null
       and lower(c.name) = lower(v.name) and coalesce(c.detail2, '') = v.old;

    -- Replaced by V4's own types; calls already on record keep their type.
    update public.command_records c
       set status = 'Inactive'
     where c.tenant_id = t.id and c.module = 'IncidentCategory' and c.detail1 is not null and c.status = 'Active'
       and lower(c.name) in ('suspicious person or vehicle');
  end loop;
end $$;

-- Calls already on record get their type's code.
update public.incidents i
   set incident_code = (
     select nullif(btrim(c.code), '') from public.command_records c
      where c.tenant_id = i.tenant_id and c.module = 'IncidentCategory' and c.detail1 is not null
        and lower(c.name) = lower(i.incident_type)
      order by (lower(c.detail1) = lower(coalesce(i.incident_category, ''))) desc, c.created_at
      limit 1)
 where i.incident_code is null;

-- ── 4. Logging a call: details, code, the new number ────────────────────────

drop function if exists public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text, silo[], text[]
);

create or replace function public.log_incoming_call(
  p_silo silo, p_caller_name text, p_caller_number text, p_call_description text,
  p_incident_type text, p_incident_severity incident_severity, p_location_address text,
  p_location_lat double precision, p_location_lng double precision,
  p_suburb text default null, p_city text default null, p_postal_code text default null,
  p_fire_incident_type text default null, p_medical_type text default null,
  p_disaster_type text default null, p_is_caller_patient boolean default null,
  p_patient_name text default null, p_number_of_victims integer default null,
  p_notes text default null, p_source text default 'Master',
  p_client_ref uuid default null,
  p_incident_category text default null,
  p_region text default null,
  p_tagged_silos silo[] default null,
  p_injuries text[] default null,
  p_details jsonb default null
)
returns public.incidents
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_incident public.incidents;
  v_existing public.incidents;
  v_taker    text;
  v_tags     silo[];
  v_number   text := regexp_replace(coalesce(p_caller_number, ''), '[[:space:]().-]', '', 'g');
  v_status   incident_status := case p_silo
                                  when 'EthekwiniDisaster' then 'Pending Analysis'::incident_status
                                  else 'Pending Dispatch'::incident_status
                                end;
begin
  perform public.require_role(
    'SystemAdmin','SuperAdmin','Admin','ControlRoom','IncidentLogger','System'
  );

  if p_client_ref is not null then
    select * into v_existing from public.incidents
     where client_ref = p_client_ref and tenant_id = public.current_tenant();
    if found then return v_existing; end if;
  end if;

  -- The desks this call goes to: the four departments, each once.
  select coalesce(array_agg(distinct s order by s), '{}') into v_tags
    from unnest(coalesce(p_tagged_silos, '{}')) s
   where s <> 'Ethekwini';
  if cardinality(v_tags) = 0 then
    raise exception 'Choose the department this call is for: Police, Fire & Rescue, EMS or Disaster Management'
      using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_caller_name, '')), '') is null then
    raise exception 'Enter the caller name' using errcode = '22023';
  end if;
  if v_number !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter the caller number with its country code, e.g. +27 82 123 4567'
      using errcode = '22023';
  end if;
  -- 0076: asked on a medical call only (EMS among the departments).
  if p_is_caller_patient is null and 'Medical' = any (v_tags) then
    raise exception 'Say whether the caller is the patient' using errcode = '22023';
  end if;
  if p_location_lat is null or p_location_lng is null
     or (p_location_lat = 0 and p_location_lng = 0) then
    raise exception 'Place the incident on the map before logging the call';
  end if;

  -- Who took the call is a fact the server knows; never take it from a form.
  select full_name into v_taker from public.profiles where id = auth.uid();

  insert into public.incidents (
    silo, source, incident_number, client_ref,
    caller_name, caller_number, call_description, notes,
    incident_type, incident_category, incident_severity,
    fire_incident_type, medical_type, disaster_type,
    location_address, suburb, city, postal_code, region, location_lat, location_lng,
    is_caller_patient, patient_name, number_of_victims, injuries,
    status, call_timestamp, incident_created_at,
    call_taken_by, created_by, tagged_silos, intake_complete, details, incident_code
  ) values (
    p_silo, p_source, public.next_incident_number(p_silo, v_tags), p_client_ref,
    trim(p_caller_name), v_number, p_call_description, p_notes,
    p_incident_type, nullif(trim(coalesce(p_incident_category, '')), ''), p_incident_severity,
    p_fire_incident_type, p_medical_type, p_disaster_type,
    p_location_address, p_suburb, p_city, p_postal_code,
    nullif(trim(coalesce(p_region, '')), ''), p_location_lat, p_location_lng,
    p_is_caller_patient, p_patient_name, p_number_of_victims, public.clean_injuries(p_injuries),
    v_status, now(), now(),
    v_taker, auth.uid(), v_tags, true,
    public.clean_details(p_details), public.incident_code_for(p_incident_type, p_incident_category)
  )
  returning * into v_incident;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (p_silo, v_incident.id,
    format('Call logged by %s and sent to the %s dispatch desk%s.', coalesce(v_taker, 'the call taker'),
      (select string_agg(public.department_label(s), ', ' order by s) from unnest(v_tags) s),
      case when cardinality(v_tags) > 1 then 's' else '' end),
    auth.uid(), v_taker);

  insert into public.audit_logs (
    silo, user_id, user_name, department, action_type, entity_type, entity_id, details
  ) values (
    p_silo, auth.uid(), v_taker,
    p_silo::text, 'CREATE_INCIDENT', 'incidents', v_incident.id::text,
    format('Logged %s call from %s at %s, for %s', p_incident_type, trim(p_caller_name), p_location_address,
      (select string_agg(public.department_label(s), ', ' order by s) from unnest(v_tags) s))
  );

  return v_incident;
end $$;

revoke execute on function public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text, silo[], text[], jsonb
) from public, anon;
grant execute on function public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text, silo[], text[], jsonb
) to authenticated, service_role;

-- ── 5. An urgent call, sent early: the same ─────────────────────────────────

drop function if exists public.send_call_early(
  uuid, silo, text, incident_severity, text, double precision, double precision, silo[],
  text, text, text, text, text, text, text, text, boolean, text, integer, text, text[], text
);

create or replace function public.send_call_early(
  p_client_ref uuid,
  p_silo silo,
  p_incident_type text,
  p_incident_severity incident_severity,
  p_location_address text,
  p_location_lat double precision,
  p_location_lng double precision,
  p_tagged_silos silo[],
  p_incident_category text default null,
  p_suburb text default null,
  p_city text default null,
  p_postal_code text default null,
  p_region text default null,
  p_caller_name text default null,
  p_caller_number text default null,
  p_call_description text default null,
  p_is_caller_patient boolean default null,
  p_patient_name text default null,
  p_number_of_victims integer default null,
  p_medical_type text default null,
  p_injuries text[] default null,
  p_notes text default null,
  p_details jsonb default null
)
returns public.incidents
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_incident public.incidents;
  v_taker    text;
  v_tags     silo[];
  v_number   text := regexp_replace(coalesce(p_caller_number, ''), '[[:space:]().-]', '', 'g');
  v_name     text := nullif(btrim(coalesce(p_caller_name, '')), '');
  v_desc     text := nullif(btrim(coalesce(p_call_description, '')), '');
  v_complete boolean;
  v_status   incident_status := case p_silo
                                  when 'EthekwiniDisaster' then 'Pending Analysis'::incident_status
                                  else 'Pending Dispatch'::incident_status
                                end;
begin
  perform public.require_role(
    'SystemAdmin','SuperAdmin','Admin','ControlRoom','IncidentLogger','System'
  );

  if p_client_ref is null then
    raise exception 'The call has no reference; reload the form and send it again' using errcode = '22023';
  end if;
  select * into v_incident from public.incidents
   where client_ref = p_client_ref and tenant_id = public.current_tenant();
  if found then return v_incident; end if;

  select coalesce(array_agg(distinct s order by s), '{}') into v_tags
    from unnest(coalesce(p_tagged_silos, '{}')) s
   where s <> 'Ethekwini';
  if cardinality(v_tags) = 0 then
    raise exception 'Choose the department this call is for: Police, Fire & Rescue, EMS or Disaster Management'
      using errcode = '22023';
  end if;
  if p_incident_severity is null or p_incident_severity not in ('High', 'Critical') then
    raise exception 'Only a High or Critical call is sent before the form is complete' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_incident_type, '')), '') is null then
    raise exception 'Choose the incident type' using errcode = '22023';
  end if;
  if p_location_lat is null or p_location_lng is null
     or (p_location_lat = 0 and p_location_lng = 0)
     or nullif(btrim(coalesce(p_location_address, '')), '') is null then
    raise exception 'Place the incident on the map before sending the call' using errcode = '22023';
  end if;
  if v_number <> '' and v_number !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter the caller number with its country code, e.g. +27 82 123 4567'
      using errcode = '22023';
  end if;

  select full_name into v_taker from public.profiles where id = auth.uid();
  v_complete := v_name is not null and v_number <> '' and v_desc is not null
                and (not ('Medical' = any (v_tags)) or p_is_caller_patient is not null);

  insert into public.incidents (
    silo, source, incident_number, client_ref,
    caller_name, caller_number, call_description, notes,
    incident_type, incident_category, incident_severity, medical_type,
    location_address, suburb, city, postal_code, region, location_lat, location_lng,
    is_caller_patient, patient_name, number_of_victims, injuries,
    status, call_timestamp, incident_created_at,
    call_taken_by, created_by, tagged_silos, intake_complete, details, incident_code
  ) values (
    p_silo, 'Master', public.next_incident_number(p_silo, v_tags), p_client_ref,
    coalesce(v_name, 'Not given yet'), v_number, coalesce(v_desc, 'Details to follow.'), nullif(btrim(coalesce(p_notes, '')), ''),
    btrim(p_incident_type), nullif(btrim(coalesce(p_incident_category, '')), ''), p_incident_severity, p_medical_type,
    btrim(p_location_address), p_suburb, p_city, p_postal_code,
    nullif(btrim(coalesce(p_region, '')), ''), p_location_lat, p_location_lng,
    p_is_caller_patient, p_patient_name, p_number_of_victims, public.clean_injuries(p_injuries),
    v_status, now(), now(),
    v_taker, auth.uid(), v_tags, v_complete,
    public.clean_details(p_details), public.incident_code_for(p_incident_type, p_incident_category)
  )
  returning * into v_incident;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (p_silo, v_incident.id,
    format('Urgent call sent early by %s to the %s dispatch desk%s.%s', coalesce(v_taker, 'the call taker'),
      (select string_agg(public.department_label(s), ', ' order by s) from unnest(v_tags) s),
      case when cardinality(v_tags) > 1 then 's' else '' end,
      case when v_complete then '' else ' Details to follow.' end),
    auth.uid(), v_taker);

  insert into public.audit_logs (
    silo, user_id, user_name, department, action_type, entity_type, entity_id, details
  ) values (
    p_silo, auth.uid(), v_taker,
    p_silo::text, 'CREATE_INCIDENT', 'incidents', v_incident.id::text,
    format('Sent early: %s call at %s, %s, for %s', btrim(p_incident_type), btrim(p_location_address), p_incident_severity,
      (select string_agg(public.department_label(s), ', ' order by s) from unnest(v_tags) s))
  );

  return v_incident;
end $$;

revoke all on function public.send_call_early(
  uuid, silo, text, incident_severity, text, double precision, double precision, silo[],
  text, text, text, text, text, text, text, text, boolean, text, integer, text, text[], text, jsonb
) from public, anon;
grant execute on function public.send_call_early(
  uuid, silo, text, incident_severity, text, double precision, double precision, silo[],
  text, text, text, text, text, text, text, text, boolean, text, integer, text, text[], text, jsonb
) to authenticated, service_role;

-- ── 6. Adding to a call already sent: the details too ───────────────────────

create or replace function public.complete_call_intake(p_incident uuid, p_fields jsonb)
returns public.incidents
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  f        jsonb := coalesce(p_fields, '{}'::jsonb);
  v        public.incidents;
  n        public.incidents;
  k        text;
  v_who    text;
  v_txt    text;
  v_changed text[] := '{}';
  v_moved  boolean := false;
  v_allowed constant text[] := array[
    'caller_name', 'caller_number', 'call_description', 'is_caller_patient', 'patient_name',
    'number_of_victims', 'medical_type', 'injuries', 'details', 'notes', 'incident_severity',
    'incident_type', 'incident_category',
    'location_address', 'location_lat', 'location_lng', 'suburb', 'city', 'postal_code', 'region'
  ];
begin
  perform public.require_role(
    'SystemAdmin','SuperAdmin','Admin','ControlRoom','IncidentLogger','System'
  );
  if jsonb_typeof(f) <> 'object' then
    raise exception 'Send the details as a list of fields' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(f) loop
    if not k = any (v_allowed) then
      raise exception 'That detail cannot be changed here: %', k using errcode = '22023';
    end if;
  end loop;

  select * into v from public.incidents
   where id = p_incident and tenant_id = public.current_tenant()
   for update;
  if not found then raise exception 'Incident not found' using errcode = 'P0002'; end if;
  -- The person who took the call finishes it; the control room and the
  -- organisation's administrators may too.
  if v.created_by is distinct from auth.uid()
     and not (public.role_in('SystemAdmin', 'SuperAdmin', 'System')
              or (public.role_in('ControlRoom', 'Admin') and public.current_silo() = 'Ethekwini')) then
    raise exception 'Only the person who logged % adds its details', v.incident_number using errcode = '42501';
  end if;
  if v.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v.incident_number, lower(v.status::text) using errcode = '22023';
  end if;

  n := v;

  if f ? 'caller_name' then
    v_txt := nullif(btrim(coalesce(f ->> 'caller_name', '')), '');
    if v_txt is null then raise exception 'Enter the caller name' using errcode = '22023'; end if;
    n.caller_name := left(v_txt, 100);
  end if;
  if f ? 'caller_number' then
    v_txt := regexp_replace(coalesce(f ->> 'caller_number', ''), '[[:space:]().-]', '', 'g');
    if v_txt !~ '^\+[1-9][0-9]{7,14}$' then
      raise exception 'Enter the caller number with its country code, e.g. +27 82 123 4567' using errcode = '22023';
    end if;
    n.caller_number := v_txt;
  end if;
  if f ? 'call_description' then
    v_txt := nullif(btrim(coalesce(f ->> 'call_description', '')), '');
    if v_txt is null then raise exception 'Enter the description' using errcode = '22023'; end if;
    n.call_description := left(v_txt, 2000);
  end if;
  if f ? 'is_caller_patient' then
    if jsonb_typeof(f -> 'is_caller_patient') <> 'boolean' then
      raise exception 'Say whether the caller is the patient' using errcode = '22023';
    end if;
    n.is_caller_patient := (f ->> 'is_caller_patient')::boolean;
  end if;
  if f ? 'patient_name' then n.patient_name := nullif(left(btrim(coalesce(f ->> 'patient_name', '')), 200), ''); end if;
  if f ? 'number_of_victims' then
    if jsonb_typeof(f -> 'number_of_victims') <> 'number' or (f ->> 'number_of_victims')::numeric < 0 then
      raise exception 'The number of people hurt is a whole number' using errcode = '22023';
    end if;
    n.number_of_victims := (f ->> 'number_of_victims')::numeric::int;
  end if;
  if f ? 'medical_type' then n.medical_type := nullif(left(btrim(coalesce(f ->> 'medical_type', '')), 100), ''); end if;
  if f ? 'injuries' then
    if jsonb_typeof(f -> 'injuries') <> 'array' then
      raise exception 'Injuries are a list' using errcode = '22023';
    end if;
    n.injuries := public.clean_injuries(array(select jsonb_array_elements_text(f -> 'injuries')));
  end if;
  if f ? 'details' then
    if jsonb_typeof(f -> 'details') <> 'object' then
      raise exception 'The details are a list of answers' using errcode = '22023';
    end if;
    n.details := public.clean_details(f -> 'details');
  end if;
  if f ? 'notes' then n.notes := nullif(left(btrim(coalesce(f ->> 'notes', '')), 2000), ''); end if;
  if f ? 'incident_severity' then
    if coalesce(f ->> 'incident_severity', '') not in ('Low', 'Medium', 'High', 'Critical') then
      raise exception 'Choose Low, Medium, High or Critical' using errcode = '22023';
    end if;
    n.incident_severity := (f ->> 'incident_severity')::incident_severity;
  end if;

  if f ? 'incident_type' or f ? 'incident_category' then
    v_txt := nullif(btrim(coalesce(f ->> 'incident_type', v.incident_type)), '');
    if v_txt is null then raise exception 'Choose the incident type' using errcode = '22023'; end if;
    if (v_txt is distinct from v.incident_type
        or nullif(btrim(coalesce(f ->> 'incident_category', v.incident_category)), '') is distinct from v.incident_category)
       and exists (select 1 from public.incident_departments d where d.incident_id = v.id and d.lead_id is not null) then
      raise exception 'A crew has accepted %: ask the dispatcher to change its type', v.incident_number using errcode = '22023';
    end if;
    n.incident_type := left(v_txt, 100);
    n.incident_category := nullif(left(btrim(coalesce(f ->> 'incident_category', v.incident_category)), 100), '');
    if n.incident_type is distinct from v.incident_type or n.incident_category is distinct from v.incident_category then
      n.incident_code := public.incident_code_for(n.incident_type, n.incident_category);
    end if;
  end if;

  if f ? 'location_lat' or f ? 'location_lng' or f ? 'location_address' then
    if not (f ? 'location_lat' and f ? 'location_lng' and f ? 'location_address') then
      raise exception 'Send the place with its address and its point on the map' using errcode = '22023';
    end if;
    if jsonb_typeof(f -> 'location_lat') <> 'number' or jsonb_typeof(f -> 'location_lng') <> 'number'
       or ((f ->> 'location_lat')::double precision = 0 and (f ->> 'location_lng')::double precision = 0)
       or nullif(btrim(coalesce(f ->> 'location_address', '')), '') is null then
      raise exception 'Place the incident on the map' using errcode = '22023';
    end if;
    n.location_lat := (f ->> 'location_lat')::double precision;
    n.location_lng := (f ->> 'location_lng')::double precision;
    n.location_address := left(btrim(f ->> 'location_address'), 200);
    v_moved := n.location_lat is distinct from v.location_lat or n.location_lng is distinct from v.location_lng
               or n.location_address is distinct from v.location_address;
    if v_moved and exists (select 1 from public.incident_departments d where d.incident_id = v.id and d.arrived_at is not null) then
      raise exception 'A crew is on scene at %: tell the dispatcher about the new place', v.location_address using errcode = '22023';
    end if;
  end if;
  if f ? 'suburb' then n.suburb := nullif(left(btrim(coalesce(f ->> 'suburb', '')), 100), ''); end if;
  if f ? 'city' then n.city := nullif(left(btrim(coalesce(f ->> 'city', '')), 100), ''); end if;
  if f ? 'postal_code' then n.postal_code := nullif(left(btrim(coalesce(f ->> 'postal_code', '')), 20), ''); end if;
  if f ? 'region' then n.region := nullif(left(btrim(coalesce(f ->> 'region', '')), 40), ''); end if;

  -- What changed, in words, for the timeline.
  if n.caller_name is distinct from v.caller_name then v_changed := array_append(v_changed, 'caller name'); end if;
  if n.caller_number is distinct from v.caller_number then v_changed := array_append(v_changed, 'caller number'); end if;
  if n.call_description is distinct from v.call_description then v_changed := array_append(v_changed, 'description'); end if;
  if n.is_caller_patient is distinct from v.is_caller_patient then v_changed := array_append(v_changed, 'whether the caller is the patient'); end if;
  if n.patient_name is distinct from v.patient_name then v_changed := array_append(v_changed, 'patient name'); end if;
  if n.number_of_victims is distinct from v.number_of_victims then v_changed := array_append(v_changed, 'people hurt'); end if;
  if n.medical_type is distinct from v.medical_type then v_changed := array_append(v_changed, 'medical code'); end if;
  if n.injuries is distinct from v.injuries then v_changed := array_append(v_changed, 'injuries'); end if;
  if n.details is distinct from v.details then v_changed := array_append(v_changed, 'details'); end if;
  if n.notes is distinct from v.notes then v_changed := array_append(v_changed, 'dispatch notes'); end if;
  if n.incident_severity is distinct from v.incident_severity then
    v_changed := array_append(v_changed, format('severity (%s, was %s)', n.incident_severity, v.incident_severity));
  end if;
  if n.incident_type is distinct from v.incident_type then
    v_changed := array_append(v_changed, format('type (%s, was %s)', n.incident_type, v.incident_type));
  end if;
  if n.suburb is distinct from v.suburb or n.city is distinct from v.city or n.postal_code is distinct from v.postal_code
     or n.region is distinct from v.region then
    if not v_moved then v_changed := array_append(v_changed, 'area details'); end if;
  end if;

  if cardinality(v_changed) = 0 and not v_moved then
    return v;
  end if;

  n.intake_complete := v.intake_complete
    or (n.caller_name <> 'Not given yet' and n.caller_number ~ '^\+[1-9][0-9]{7,14}$'
        and n.call_description <> 'Details to follow.'
        and (not ('Medical' = any (coalesce(n.tagged_silos, '{}'))) or n.is_caller_patient is not null));

  update public.incidents
     set caller_name = n.caller_name, caller_number = n.caller_number, call_description = n.call_description,
         is_caller_patient = n.is_caller_patient, patient_name = n.patient_name,
         number_of_victims = n.number_of_victims, medical_type = n.medical_type, injuries = n.injuries,
         details = n.details, incident_code = n.incident_code,
         notes = n.notes, incident_severity = n.incident_severity,
         incident_type = n.incident_type, incident_category = n.incident_category,
         location_address = n.location_address, location_lat = n.location_lat, location_lng = n.location_lng,
         suburb = n.suburb, city = n.city, postal_code = n.postal_code, region = n.region,
         intake_complete = n.intake_complete, updated_at = now()
   where id = v.id
  returning * into n;

  select full_name into v_who from public.profiles where id = auth.uid();
  if v_moved then
    insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
    values (n.silo, n.id, format('[INTAKE] Place changed by %s to %s.', coalesce(v_who, 'the call taker'), n.location_address),
            auth.uid(), v_who);
  end if;
  if cardinality(v_changed) > 0 or (n.intake_complete and not v.intake_complete) then
    insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
    values (n.silo, n.id,
      '[INTAKE] ' || concat_ws(' ',
        case when cardinality(v_changed) > 0
             then format('Details added by %s: %s.', coalesce(v_who, 'the call taker'), array_to_string(v_changed, ', ')) end,
        case when n.intake_complete and not v.intake_complete then 'The call details are complete.' end),
      auth.uid(), v_who);
  end if;
  if v_moved or n.incident_type is distinct from v.incident_type or n.incident_severity is distinct from v.incident_severity
     or (n.intake_complete and not v.intake_complete) then
    insert into public.audit_logs (silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
    values (n.silo, auth.uid(), v_who, n.silo::text, 'INTAKE_UPDATE', 'incidents', n.id::text,
      format('%s: %s', n.incident_number, array_to_string(v_changed || case when v_moved then array['place'] else '{}'::text[] end, ', ')));
  end if;

  return n;
end $$;

revoke all on function public.complete_call_intake(uuid, jsonb) from public, anon;
grant execute on function public.complete_call_intake(uuid, jsonb) to authenticated, service_role;

-- ── 7. An officer's SOS: the new number, coded 10-33 ────────────────────────

create or replace function public.raise_panic(
  p_lat         double precision default null,
  p_lng         double precision default null,
  p_accuracy    double precision default null,
  p_note        text default null,
  p_client_ref  uuid default null,
  p_occurred_at timestamptz default null
)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_existing public.incidents;
  v_silo     silo;
  v_name     text;
  v_phone    text;
  v_unit     text;
  v_at       timestamptz;
  v_lat      double precision := p_lat;
  v_lng      double precision := p_lng;
  v_where    text;
  v_note     text;
  v_last_lat double precision;
  v_last_lng double precision;
  v_last_at  timestamptz;
  v_sent     int := 0;
  v_fallback boolean := false;
  r          record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Deliberately no require_role(): every account may call for help.

  -- An offline retry of an SOS already delivered returns the same incident.
  if p_client_ref is not null then
    select * into v_existing from public.incidents
     where client_ref = p_client_ref and tenant_id = public.current_tenant();
    if found then return v_existing; end if;
  end if;

  select coalesce(pr.silo, 'Ethekwini'::silo), coalesce(pr.full_name, 'Unknown officer'), pr.contact_number
    into v_silo, v_name, v_phone
    from public.profiles pr
   where pr.id = auth.uid();
  if v_silo is null then v_silo := 'Ethekwini'; end if;
  if v_name is null then v_name := 'Unknown officer'; end if;

  select a.unit_number, p.latitude, p.longitude, coalesce(p.last_login, p.updated_at)
    into v_unit, v_last_lat, v_last_lng, v_last_at
    from public.personnel p
    left join public.apparatus a on a.id = p.assigned_apparatus_id
   where p.user_id = auth.uid() and p.tenant_id = public.current_tenant()
   limit 1;

  -- The moment of the press, not of delivery (bounded, as for status changes).
  v_at := case
    when p_occurred_at is null then now()
    when p_occurred_at > now() then now()
    when p_occurred_at < now() - interval '12 hours' then now()
    else p_occurred_at
  end;

  if v_lat is not null and v_lng is not null and not (v_lat = 0 and v_lng = 0) then
    v_where := format('Officer position %s, %s%s', round(v_lat::numeric, 5), round(v_lng::numeric, 5),
      case when p_accuracy is not null then format(' (±%sm)', round(p_accuracy::numeric)) else '' end);
  elsif v_last_lat is not null and v_last_lng is not null and not (v_last_lat = 0 and v_last_lng = 0) then
    -- No fix from the phone: the app's last heartbeat is the best we have.
    v_lat := v_last_lat;
    v_lng := v_last_lng;
    v_where := format('LAST KNOWN position %s, %s (app heartbeat %s)',
      round(v_lat::numeric, 5), round(v_lng::numeric, 5),
      to_char(v_last_at at time zone 'Africa/Johannesburg', 'HH24:MI'));
    v_note := 'No GPS fix at the time of the SOS — pin is the officer''s last known position.';
  else
    -- No made-up pin: 0,0 is "unknown" to every map in the system.
    v_lat := 0;
    v_lng := 0;
    v_where := 'POSITION UNKNOWN — raise the officer on the radio for their location';
    v_note := 'No GPS fix and no last known position for this officer.';
  end if;

  insert into public.incidents (
    silo, source, incident_number, client_ref,
    caller_name, caller_number, call_description,
    incident_type, incident_severity,
    location_address, location_lat, location_lng,
    status, call_timestamp, incident_created_at,
    responding_officer, created_by, notes, incident_code
  ) values (
    v_silo, 'Responder-Panic', public.next_incident_number(v_silo, array[v_silo], v_at), p_client_ref,
    v_name, coalesce(v_phone, 'Unknown'),
    format('SOS — OFFICER REQUIRES IMMEDIATE ASSISTANCE. %s%s',
      case when v_unit is not null then 'Unit ' || v_unit || '. ' else '' end,
      coalesce(nullif(p_note, ''), 'No further detail — assume the worst until contact is made.')),
    'Officer Emergency', 'Critical',
    v_where, v_lat, v_lng,
    -- Waits in the dispatch queue until someone sends it out.
    'Pending', v_at, v_at, v_name, auth.uid(),
    v_note, '10-33'
  )
  returning * into v_incident;

  -- The desks that can act on it: this department's dispatch desk and the
  -- central control room, and this department's command. Each personally.
  for r in
    select pr.id, pr.silo from public.profiles pr
    where pr.tenant_id = v_incident.tenant_id
      and pr.id <> auth.uid()
      and (
        (pr.role in ('Dispatcher', 'ControlRoom', 'Supervisor') and pr.silo in (v_silo, 'Ethekwini'))
        or (pr.role in ('Captain', 'FireChief') and pr.silo = v_silo)
      )
  loop
    insert into public.alerts (
      tenant_id, silo, target_user_id, kind, severity, title, body, incident_id,
      link, presentation, requires_ack, created_by, created_by_name
    ) values (
      v_incident.tenant_id, r.silo, r.id, 'sos', 'Critical',
      format('SOS — %s needs assistance', v_name),
      format('%s · %s', v_where, coalesce('Unit ' || v_unit, 'No unit assigned')),
      v_incident.id, '/incidents/' || v_incident.id::text,
      'modal', true, auth.uid(), v_name
    );
    v_sent := v_sent + 1;
  end loop;

  -- Never silent: with no desk or command account to reach, the tenant's
  -- oversight seats hear it instead.
  if v_sent = 0 then
    v_fallback := true;
    for r in
      select pr.id, pr.silo from public.profiles pr
      where pr.tenant_id = v_incident.tenant_id
        and pr.id <> auth.uid()
        and pr.role in ('SystemController', 'SystemAdmin')
    loop
      insert into public.alerts (
        tenant_id, silo, target_user_id, kind, severity, title, body, incident_id,
        link, presentation, requires_ack, created_by, created_by_name
      ) values (
        v_incident.tenant_id, r.silo, r.id, 'sos', 'Critical',
        format('SOS — %s needs assistance', v_name),
        format('%s · %s · no dispatch desk reachable for this department',
          v_where, coalesce('Unit ' || v_unit, 'No unit assigned')),
        v_incident.id, '/incidents/' || v_incident.id::text,
        'modal', true, auth.uid(), v_name
      );
      v_sent := v_sent + 1;
    end loop;
  end if;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name, timestamp)
  values (v_silo, v_incident.id,
    format('[SOS] Raised from the responder app%s. %s %s alerted; awaiting dispatch.',
      case when v_at < now() - interval '30 seconds'
        then format(' (sent offline, delivered %s later)', to_char(now() - v_at, 'HH24:MI:SS')) else '' end,
      v_sent,
      case when v_fallback then 'oversight staff (no dispatch desk for this department)'
           else 'dispatch and command staff' end),
    auth.uid(), v_name, v_at);

  insert into public.audit_logs (
    silo, user_id, user_name, department, action_type, entity_type, entity_id, details
  ) values (
    v_silo, auth.uid(), v_name, v_silo::text, 'PANIC_RAISED', 'incidents', v_incident.id::text,
    format('SOS raised by %s at %s', v_name, v_where)
  );

  return v_incident;
end $$;

revoke execute on function public.raise_panic(double precision, double precision, double precision, text, uuid, timestamptz) from public, anon;
grant  execute on function public.raise_panic(double precision, double precision, double precision, text, uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';
