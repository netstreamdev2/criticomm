-- ============================================================================
-- 0076 — Call intake: urgent calls sent early, and more incident types
-- ============================================================================
--
-- Run after 0075.
--
-- On a critical call the seconds count, so the call taker no longer has to
-- finish the form before dispatch hears of it:
--
--   send_call_early()       An urgent call (High or Critical) goes to the
--                           dispatch desks as soon as it has its incident
--                           type, its place on the map and a department.
--                           Anything else already known goes with it; the
--                           call is marked "details to follow"
--                           (incidents.intake_complete = false).
--   complete_call_intake()  The person who logged the call (or the control
--                           room) adds the rest to the same call while it is
--                           live: caller, number, description, patient,
--                           injuries, severity; the type until a crew has
--                           accepted, the place until a crew is on scene.
--                           Every change goes on the call's timeline.
--
-- Also:
--   - "Is the caller the patient?" is asked only on a medical call (EMS among
--     the departments); log_incoming_call() refused every call without it.
--   - The injuries the call taker ticks are kept (incidents.injuries).
--   - Every organisation gets the full list of incident types (shootings,
--     stabbings, heart attacks, shack fires and the rest) with the questions
--     to ask, under Admin → Configuration, where they can still be edited.
--     Incident codes are now unique within an organisation, not across all
--     of them.
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. The call ─────────────────────────────────────────────────────────────

alter table public.incidents
  add column if not exists intake_complete boolean not null default true,
  add column if not exists injuries text[] not null default '{}';
comment on column public.incidents.intake_complete is
  'False while an urgent call sent early still has details to follow (0076).';
comment on column public.incidents.injuries is
  'The injuries the call taker ticked (0076).';

/** The injuries as kept: trimmed, each once, in the order ticked, at most 12. */
create or replace function public.clean_injuries(p text[]) returns text[]
language sql immutable set search_path to 'public' as $$
  select coalesce(array_agg(v order by o), '{}')
    from (
      select left(btrim(x), 60) as v, min(o) as o
        from unnest(coalesce(p, '{}')) with ordinality as u(x, o)
       where btrim(coalesce(x, '')) <> ''
       group by left(btrim(x), 60)
       order by min(o)
       limit 12
    ) s
$$;
-- Used only inside the call functions below (they run with their own rights):
-- no one calls it directly.
revoke all on function public.clean_injuries(text[]) from public, anon, authenticated;
grant execute on function public.clean_injuries(text[]) to service_role;

-- ── 2. Incident types, per organisation ─────────────────────────────────────

-- 0007 made a code's name unique across every organisation, so a second
-- organisation could not have its own "Burglary".
drop index if exists public.command_records_module_name_key;
create unique index if not exists command_records_tenant_module_name_key
  on public.command_records (tenant_id, module, coalesce(detail1, ''), name);

-- ── 3. Every organisation's incident types ──────────────────────────────────

-- The types the call-taking screen knows (packages/db/src/intake.ts), with the
-- questions to ask the caller (detail2, one per line). A type an organisation
-- already has is left as it is; its questions are filled in only when it has
-- none. Administrators edit them under Admin → Configuration.
do $$
declare
  t record;
begin
  for t in select id from public.tenants loop
    insert into public.command_records (tenant_id, module, name, detail1, code, status)
    select t.id, 'IncidentCategory', g.name, null, g.code, 'Active'
      from (values ('Crime', '10'), ('Traffic', '20'), ('Fire', '30'), ('Medical', '40'), ('Public Order', '50'), ('Disaster', '60')) as g(name, code)
     where not exists (select 1 from public.command_records c
                        where c.tenant_id = t.id and c.module = 'IncidentCategory' and c.detail1 is null
                          and lower(c.name) = lower(g.name));

    insert into public.command_records (tenant_id, module, name, detail1, detail2, status)
    select t.id, 'IncidentCategory', v.name, v.grp, nullif(v.prompts, ''), 'Active'
      from (values
      ('Crime', 'Assault', 'Is anyone hurt?
Is the attacker still there?'),
      ('Crime', 'Robbery', 'Were weapons used?
Which way did they go?'),
      ('Crime', 'Burglary', 'Are the suspects still inside?
Is anyone home?'),
      ('Crime', 'Shooting / gunshot wound', 'Is the shooter still there?
Where was the person shot?
Is the person breathing?'),
      ('Crime', 'Stabbing', 'Is the attacker still there?
Where is the wound?
Is the bleeding heavy?'),
      ('Crime', 'Armed robbery', 'How many suspects, and what weapons?
Which way did they go, and in what vehicle?'),
      ('Crime', 'Hijacking', 'What vehicle: make, colour, registration?
Which way did they go?
Is anyone hurt?'),
      ('Crime', 'Cash-in-transit heist', 'How many suspects and vehicles?
Are shots being fired?'),
      ('Crime', 'Kidnapping / abduction', 'Who was taken, and what do they look like?
What vehicle, and which way?'),
      ('Crime', 'Domestic violence', 'Is the attacker still there?
Is anyone hurt?
Are there children in the house?'),
      ('Crime', 'Rape / sexual assault', 'Is the person safe now?
Does the person need medical help?'),
      ('Crime', 'Child abuse', 'Is the child safe now?
Is the child hurt?'),
      ('Crime', 'Murder / body found', 'Is anyone else in danger?
Has anyone touched the body?'),
      ('Crime', 'Gang violence', 'Are weapons being used?
How many people?'),
      ('Crime', 'Housebreaking in progress', 'Are you safe where you are?
How many suspects?'),
      ('Crime', 'Theft of motor vehicle', 'Make, colour and registration?
When was it last seen?'),
      ('Crime', 'Theft', 'What was taken?
Is the suspect still there?'),
      ('Crime', 'Shoplifting', 'Is the suspect being held?'),
      ('Crime', 'Missing person', 'Name, age and what they were wearing?
Where and when were they last seen?'),
      ('Crime', 'Suspicious person or vehicle', 'What do they look like, and where are they now?'),
      ('Crime', 'Drug dealing', 'Where exactly, and how many people?'),
      ('Crime', 'Malicious damage to property', 'Is the person still there?'),
      ('Crime', 'Trespassing', 'Is the person still on the property?'),
      ('Traffic', 'Motor Vehicle Accident', 'Is anyone hurt or trapped?
How many vehicles?
Is the road blocked?'),
      ('Traffic', 'Traffic Violation', 'Registration and direction of travel?'),
      ('Traffic', 'Crash with injuries', 'How many people are hurt?
Is anyone trapped?
Is there fuel leaking or fire?'),
      ('Traffic', 'Crash with people trapped', 'How many are trapped?
Is there fire or leaking fuel?
Are they conscious?'),
      ('Traffic', 'Pedestrian knocked down', 'Is the person conscious and breathing?
Did the driver stay?'),
      ('Traffic', 'Bus or taxi crash', 'How many passengers are hurt?
Is anyone trapped?'),
      ('Traffic', 'Hit and run', 'Vehicle make, colour and registration?
Is anyone hurt?'),
      ('Traffic', 'Truck overturned', 'What is it carrying?
Is anything leaking?'),
      ('Traffic', 'Drunk driver', 'Vehicle, registration and direction?'),
      ('Traffic', 'Road blocked', 'What is blocking the road?'),
      ('Traffic', 'Traffic lights out', 'Which intersection?'),
      ('Traffic', 'Abandoned vehicle', 'Where exactly, and is it blocking traffic?'),
      ('Fire', 'Structure Fire', 'Is anyone inside?
Which floor, and how big is the fire?'),
      ('Fire', 'Veld/Wildland Fire', 'Is it near homes?
Which way is the wind blowing it?'),
      ('Fire', 'House fire', 'Is anyone still inside?
Is the fire spreading to neighbours?'),
      ('Fire', 'Informal settlement fire', 'How many homes are burning?
Is anyone missing or trapped?'),
      ('Fire', 'Fire with people trapped', 'How many are trapped, and where?
Can they get to a window?'),
      ('Fire', 'Vehicle fire', 'Is anyone in the vehicle?
Is it near fuel pumps or buildings?'),
      ('Fire', 'Gas leak', 'Can people leave the building?
Is anyone feeling ill?'),
      ('Fire', 'Hazardous chemical spill', 'What is the substance, if known?
Is anyone feeling ill?'),
      ('Fire', 'Explosion', 'Is anyone hurt or trapped?
Is there still fire?'),
      ('Fire', 'Building collapse', 'Is anyone trapped?
How many people were inside?'),
      ('Fire', 'Person trapped (rescue)', 'Where is the person trapped?
Are they hurt?'),
      ('Fire', 'Electrical fire or sparking cables', 'Is anyone near the cables?'),
      ('Fire', 'Power lines down', 'Is anyone touching or near the lines?'),
      ('Fire', 'Smoke seen', 'Where is the smoke coming from?'),
      ('Fire', 'Rubbish fire', 'Is it near buildings or cars?'),
      ('Fire', 'Animal rescue', 'What animal, and where is it stuck?'),
      ('Medical', 'Cardiac', 'Is the person breathing?
Is the person awake?'),
      ('Medical', 'Trauma', 'Where is the person hurt?
Is there heavy bleeding?'),
      ('Medical', 'Heart attack / chest pain', 'Is the person awake and breathing?
Their age?'),
      ('Medical', 'Not breathing / choking', 'Is the person awake?
What did they choke on?'),
      ('Medical', 'Unconscious person', 'Is the person breathing?'),
      ('Medical', 'Stroke', 'When did it start?
Is the face drooping or speech slurred?'),
      ('Medical', 'Severe bleeding', 'Where is the bleeding from?
Can someone press on the wound?'),
      ('Medical', 'Drowning', 'Is the person out of the water?
Are they breathing?'),
      ('Medical', 'Electrocution', 'Is the person still touching the power?'),
      ('Medical', 'Seizure / fits', 'Is the person still fitting?
Are they breathing?'),
      ('Medical', 'Breathing difficulty / asthma', 'Can the person speak?
Do they have a pump?'),
      ('Medical', 'Diabetic emergency', 'Is the person awake?'),
      ('Medical', 'Pregnancy / labour', 'How far along is she?
Is the baby coming now?'),
      ('Medical', 'Overdose / poisoning', 'What was taken, and how much?
Is the person awake?'),
      ('Medical', 'Allergic reaction', 'Is the throat swelling or breathing hard?'),
      ('Medical', 'Burns', 'How big are the burns, and where?'),
      ('Medical', 'Fall / injury', 'From how high?
Can the person move?'),
      ('Medical', 'Mental health crisis / suicide attempt', 'Is the person alone?
Do they have a weapon or pills?'),
      ('Medical', 'Sick person', 'What are the symptoms?
Their age?'),
      ('Medical', 'Dog bite / animal attack', 'Is the animal still there?'),
      ('Public Order', 'Protest', 'How many people?
Is it peaceful?'),
      ('Public Order', 'Violent protest / riot', 'Is anyone hurt?
Is property being burnt?'),
      ('Public Order', 'Road barricaded / burning tyres', 'Which road, and where exactly?'),
      ('Public Order', 'Public violence', 'How many people, and any weapons?'),
      ('Public Order', 'Illegal gathering', 'How many people?'),
      ('Public Order', 'Noise complaint', 'Where exactly?'),
      ('Disaster', 'Flooding', 'Are people trapped by the water?
How many homes are flooded?'),
      ('Disaster', 'People trapped by flood water', 'How many people, and where?'),
      ('Disaster', 'Storm damage', 'Is anyone hurt?
How many homes are damaged?'),
      ('Disaster', 'Landslide / mudslide', 'Are homes or people buried?'),
      ('Disaster', 'Tree fallen on a home or road', 'Is anyone trapped or hurt?'),
      ('Disaster', 'Sinkhole', 'Is it near homes or the road?'),
      ('Disaster', 'Coastal surge / high seas', 'Are people or homes in danger?'),
      ('Disaster', 'People displaced', 'How many people need shelter?')
      ) as v(grp, name, prompts)
     where not exists (select 1 from public.command_records c
                        where c.tenant_id = t.id and c.module = 'IncidentCategory' and c.detail1 is not null
                          and lower(c.name) = lower(v.name));

    update public.command_records c
       set detail2 = v.prompts
      from (values
      ('Crime', 'Assault', 'Is anyone hurt?
Is the attacker still there?'),
      ('Crime', 'Robbery', 'Were weapons used?
Which way did they go?'),
      ('Crime', 'Burglary', 'Are the suspects still inside?
Is anyone home?'),
      ('Crime', 'Shooting / gunshot wound', 'Is the shooter still there?
Where was the person shot?
Is the person breathing?'),
      ('Crime', 'Stabbing', 'Is the attacker still there?
Where is the wound?
Is the bleeding heavy?'),
      ('Crime', 'Armed robbery', 'How many suspects, and what weapons?
Which way did they go, and in what vehicle?'),
      ('Crime', 'Hijacking', 'What vehicle: make, colour, registration?
Which way did they go?
Is anyone hurt?'),
      ('Crime', 'Cash-in-transit heist', 'How many suspects and vehicles?
Are shots being fired?'),
      ('Crime', 'Kidnapping / abduction', 'Who was taken, and what do they look like?
What vehicle, and which way?'),
      ('Crime', 'Domestic violence', 'Is the attacker still there?
Is anyone hurt?
Are there children in the house?'),
      ('Crime', 'Rape / sexual assault', 'Is the person safe now?
Does the person need medical help?'),
      ('Crime', 'Child abuse', 'Is the child safe now?
Is the child hurt?'),
      ('Crime', 'Murder / body found', 'Is anyone else in danger?
Has anyone touched the body?'),
      ('Crime', 'Gang violence', 'Are weapons being used?
How many people?'),
      ('Crime', 'Housebreaking in progress', 'Are you safe where you are?
How many suspects?'),
      ('Crime', 'Theft of motor vehicle', 'Make, colour and registration?
When was it last seen?'),
      ('Crime', 'Theft', 'What was taken?
Is the suspect still there?'),
      ('Crime', 'Shoplifting', 'Is the suspect being held?'),
      ('Crime', 'Missing person', 'Name, age and what they were wearing?
Where and when were they last seen?'),
      ('Crime', 'Suspicious person or vehicle', 'What do they look like, and where are they now?'),
      ('Crime', 'Drug dealing', 'Where exactly, and how many people?'),
      ('Crime', 'Malicious damage to property', 'Is the person still there?'),
      ('Crime', 'Trespassing', 'Is the person still on the property?'),
      ('Traffic', 'Motor Vehicle Accident', 'Is anyone hurt or trapped?
How many vehicles?
Is the road blocked?'),
      ('Traffic', 'Traffic Violation', 'Registration and direction of travel?'),
      ('Traffic', 'Crash with injuries', 'How many people are hurt?
Is anyone trapped?
Is there fuel leaking or fire?'),
      ('Traffic', 'Crash with people trapped', 'How many are trapped?
Is there fire or leaking fuel?
Are they conscious?'),
      ('Traffic', 'Pedestrian knocked down', 'Is the person conscious and breathing?
Did the driver stay?'),
      ('Traffic', 'Bus or taxi crash', 'How many passengers are hurt?
Is anyone trapped?'),
      ('Traffic', 'Hit and run', 'Vehicle make, colour and registration?
Is anyone hurt?'),
      ('Traffic', 'Truck overturned', 'What is it carrying?
Is anything leaking?'),
      ('Traffic', 'Drunk driver', 'Vehicle, registration and direction?'),
      ('Traffic', 'Road blocked', 'What is blocking the road?'),
      ('Traffic', 'Traffic lights out', 'Which intersection?'),
      ('Traffic', 'Abandoned vehicle', 'Where exactly, and is it blocking traffic?'),
      ('Fire', 'Structure Fire', 'Is anyone inside?
Which floor, and how big is the fire?'),
      ('Fire', 'Veld/Wildland Fire', 'Is it near homes?
Which way is the wind blowing it?'),
      ('Fire', 'House fire', 'Is anyone still inside?
Is the fire spreading to neighbours?'),
      ('Fire', 'Informal settlement fire', 'How many homes are burning?
Is anyone missing or trapped?'),
      ('Fire', 'Fire with people trapped', 'How many are trapped, and where?
Can they get to a window?'),
      ('Fire', 'Vehicle fire', 'Is anyone in the vehicle?
Is it near fuel pumps or buildings?'),
      ('Fire', 'Gas leak', 'Can people leave the building?
Is anyone feeling ill?'),
      ('Fire', 'Hazardous chemical spill', 'What is the substance, if known?
Is anyone feeling ill?'),
      ('Fire', 'Explosion', 'Is anyone hurt or trapped?
Is there still fire?'),
      ('Fire', 'Building collapse', 'Is anyone trapped?
How many people were inside?'),
      ('Fire', 'Person trapped (rescue)', 'Where is the person trapped?
Are they hurt?'),
      ('Fire', 'Electrical fire or sparking cables', 'Is anyone near the cables?'),
      ('Fire', 'Power lines down', 'Is anyone touching or near the lines?'),
      ('Fire', 'Smoke seen', 'Where is the smoke coming from?'),
      ('Fire', 'Rubbish fire', 'Is it near buildings or cars?'),
      ('Fire', 'Animal rescue', 'What animal, and where is it stuck?'),
      ('Medical', 'Cardiac', 'Is the person breathing?
Is the person awake?'),
      ('Medical', 'Trauma', 'Where is the person hurt?
Is there heavy bleeding?'),
      ('Medical', 'Heart attack / chest pain', 'Is the person awake and breathing?
Their age?'),
      ('Medical', 'Not breathing / choking', 'Is the person awake?
What did they choke on?'),
      ('Medical', 'Unconscious person', 'Is the person breathing?'),
      ('Medical', 'Stroke', 'When did it start?
Is the face drooping or speech slurred?'),
      ('Medical', 'Severe bleeding', 'Where is the bleeding from?
Can someone press on the wound?'),
      ('Medical', 'Drowning', 'Is the person out of the water?
Are they breathing?'),
      ('Medical', 'Electrocution', 'Is the person still touching the power?'),
      ('Medical', 'Seizure / fits', 'Is the person still fitting?
Are they breathing?'),
      ('Medical', 'Breathing difficulty / asthma', 'Can the person speak?
Do they have a pump?'),
      ('Medical', 'Diabetic emergency', 'Is the person awake?'),
      ('Medical', 'Pregnancy / labour', 'How far along is she?
Is the baby coming now?'),
      ('Medical', 'Overdose / poisoning', 'What was taken, and how much?
Is the person awake?'),
      ('Medical', 'Allergic reaction', 'Is the throat swelling or breathing hard?'),
      ('Medical', 'Burns', 'How big are the burns, and where?'),
      ('Medical', 'Fall / injury', 'From how high?
Can the person move?'),
      ('Medical', 'Mental health crisis / suicide attempt', 'Is the person alone?
Do they have a weapon or pills?'),
      ('Medical', 'Sick person', 'What are the symptoms?
Their age?'),
      ('Medical', 'Dog bite / animal attack', 'Is the animal still there?'),
      ('Public Order', 'Protest', 'How many people?
Is it peaceful?'),
      ('Public Order', 'Violent protest / riot', 'Is anyone hurt?
Is property being burnt?'),
      ('Public Order', 'Road barricaded / burning tyres', 'Which road, and where exactly?'),
      ('Public Order', 'Public violence', 'How many people, and any weapons?'),
      ('Public Order', 'Illegal gathering', 'How many people?'),
      ('Public Order', 'Noise complaint', 'Where exactly?'),
      ('Disaster', 'Flooding', 'Are people trapped by the water?
How many homes are flooded?'),
      ('Disaster', 'People trapped by flood water', 'How many people, and where?'),
      ('Disaster', 'Storm damage', 'Is anyone hurt?
How many homes are damaged?'),
      ('Disaster', 'Landslide / mudslide', 'Are homes or people buried?'),
      ('Disaster', 'Tree fallen on a home or road', 'Is anyone trapped or hurt?'),
      ('Disaster', 'Sinkhole', 'Is it near homes or the road?'),
      ('Disaster', 'Coastal surge / high seas', 'Are people or homes in danger?'),
      ('Disaster', 'People displaced', 'How many people need shelter?')
      ) as v(grp, name, prompts)
     where c.tenant_id = t.id and c.module = 'IncidentCategory' and c.detail1 is not null
       and lower(c.name) = lower(v.name) and coalesce(c.detail2, '') = '' and v.prompts <> '';
  end loop;
end $$;

-- ── 4. Logging a call: the patient question on a medical call only ─────────

-- As 0068, with two changes marked 0076: "Is the caller the patient?" is
-- required only when EMS is among the departments, and the injuries ticked are
-- kept. The new parameter changes the signature, so the old one goes first.
drop function if exists public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text, silo[]
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
  p_injuries text[] default null
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
    call_taken_by, created_by, tagged_silos, intake_complete
  ) values (
    p_silo, p_source, public.next_incident_number(p_silo), p_client_ref,
    trim(p_caller_name), v_number, p_call_description, p_notes,
    p_incident_type, nullif(trim(coalesce(p_incident_category, '')), ''), p_incident_severity,
    p_fire_incident_type, p_medical_type, p_disaster_type,
    p_location_address, p_suburb, p_city, p_postal_code,
    nullif(trim(coalesce(p_region, '')), ''), p_location_lat, p_location_lng,
    p_is_caller_patient, p_patient_name, p_number_of_victims, public.clean_injuries(p_injuries),
    v_status, now(), now(),
    v_taker, auth.uid(), v_tags, true
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
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text, silo[], text[]
) from public, anon;
grant execute on function public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text, silo[], text[]
) to authenticated, service_role;

-- ── 5. An urgent call, sent early ───────────────────────────────────────────

-- The minimum dispatch needs to move: what it is, where, and who must go. The
-- same people may send it as may log a call, and the dispatch desks see it the
-- moment it is sent, as with any new call. A press repeated (a double click,
-- a dropped connection retried) returns the same call: the form makes the
-- reference once.
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
  p_notes text default null
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
    call_taken_by, created_by, tagged_silos, intake_complete
  ) values (
    p_silo, 'Master', public.next_incident_number(p_silo), p_client_ref,
    coalesce(v_name, 'Not given yet'), v_number, coalesce(v_desc, 'Details to follow.'), nullif(btrim(coalesce(p_notes, '')), ''),
    btrim(p_incident_type), nullif(btrim(coalesce(p_incident_category, '')), ''), p_incident_severity, p_medical_type,
    btrim(p_location_address), p_suburb, p_city, p_postal_code,
    nullif(btrim(coalesce(p_region, '')), ''), p_location_lat, p_location_lng,
    p_is_caller_patient, p_patient_name, p_number_of_victims, public.clean_injuries(p_injuries),
    v_status, now(), now(),
    v_taker, auth.uid(), v_tags, v_complete
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
  text, text, text, text, text, text, text, text, boolean, text, integer, text, text[], text
) from public, anon;
grant execute on function public.send_call_early(
  uuid, silo, text, incident_severity, text, double precision, double precision, silo[],
  text, text, text, text, text, text, text, text, boolean, text, integer, text, text[], text
) to authenticated, service_role;

-- ── 6. The rest of the call, added while it is live ─────────────────────────

-- Only what is sent is changed. The type can still change until a crew has
-- accepted, and the place until a crew is on scene; after that it is the
-- dispatcher's to correct with the crew. Each save goes on the timeline,
-- naming what was added.
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
    'number_of_victims', 'medical_type', 'injuries', 'notes', 'incident_severity',
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

notify pgrst, 'reload schema';
