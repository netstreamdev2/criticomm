-- ============================================================================
-- 0080 — How the call came in, and each patient's own severity
-- ============================================================================
--
-- Run after 0079.
--
--   incidents.call_channel        Phone call, WhatsApp, In person or Other.
--   incidents.call_channel_other  What "Other" was, in a few words.
--   incidents.patients            Each patient: name, severity (Critical, High,
--                                 Medium, Low or Unknown), and whether it is
--                                 the caller. A patient's severity is their
--                                 own: a burning building is Critical while
--                                 the person in it has minor burns.
--
-- Logging a call and sending it early take them (log_incoming_call,
-- send_call_early); the call taker and the dispatcher correct them like any
-- other field (apply_call_edit, 0079), and each change is kept.
--
-- Safe to re-run.
-- ============================================================================

alter table public.incidents
  add column if not exists call_channel text,
  add column if not exists call_channel_other text,
  add column if not exists patients jsonb not null default '[]'::jsonb;
comment on column public.incidents.call_channel is 'How the call came in (0080): Phone call, WhatsApp, In person or Other.';
comment on column public.incidents.call_channel_other is 'What "Other" was, when the call came in another way (0080).';
comment on column public.incidents.patients is 'Each patient (0080): [{name, severity, caller}], severity Critical, High, Medium, Low or Unknown.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'incidents_call_channel_check') then
    alter table public.incidents add constraint incidents_call_channel_check
      check (call_channel is null or call_channel in ('Phone call', 'WhatsApp', 'In person', 'Other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'incidents_call_channel_other_check') then
    alter table public.incidents add constraint incidents_call_channel_other_check
      check (call_channel_other is null or length(call_channel_other) <= 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'incidents_patients_check') then
    alter table public.incidents add constraint incidents_patients_check
      check (jsonb_typeof(patients) = 'array' and jsonb_array_length(patients) <= 20);
  end if;
end $$;

/** Each patient as the form sends it, made safe: a name, a known severity (else Unknown), the caller or not; at most 20. */
create or replace function public.clean_patients(p jsonb)
returns jsonb language sql immutable set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', nullif(left(btrim(coalesce(x.e ->> 'name', '')), 200), ''),
           'severity', case when x.e ->> 'severity' in ('Critical', 'High', 'Medium', 'Low', 'Unknown')
                            then x.e ->> 'severity' else 'Unknown' end,
           'caller', coalesce(x.e -> 'caller' = 'true'::jsonb, false)) order by x.ord), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality as x(e, ord)
   where jsonb_typeof(x.e) = 'object' and x.ord <= 20
$$;
revoke all on function public.clean_patients(jsonb) from public, anon, authenticated;

-- ── 1. Logging a call ────────────────────────────────────────────────────────

drop function if exists public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text, silo[], text[], jsonb
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
  p_details jsonb default null,
  p_call_channel text default null,
  p_call_channel_other text default null,
  p_patients jsonb default null
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

  -- How the call came in, and each patient's own severity (0080).
  if p_call_channel is not null and p_call_channel not in ('Phone call', 'WhatsApp', 'In person', 'Other') then
    raise exception 'Choose how the call came in: phone call, WhatsApp, in person or other' using errcode = '22023';
  end if;
  if p_call_channel = 'Other' and nullif(btrim(coalesce(p_call_channel_other, '')), '') is null then
    raise exception 'Say how the call came in' using errcode = '22023';
  end if;
  if p_patients is not null and jsonb_typeof(p_patients) <> 'array' then
    raise exception 'The patients are a list' using errcode = '22023';
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
    call_taken_by, created_by, tagged_silos, intake_complete, details, incident_code, call_channel, call_channel_other, patients
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
    public.clean_details(p_details), public.incident_code_for(p_incident_type, p_incident_category),
    p_call_channel, case when p_call_channel = 'Other' then left(btrim(p_call_channel_other), 60) end,
    public.clean_patients(p_patients)
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
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text, silo[], text[], jsonb, text, text, jsonb
) from public, anon;
grant execute on function public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text, silo[], text[], jsonb, text, text, jsonb
) to authenticated, service_role;

-- ── 2. An urgent call, sent early ────────────────────────────────────────────

drop function if exists public.send_call_early(
  uuid, silo, text, incident_severity, text, double precision, double precision, silo[],
  text, text, text, text, text, text, text, text, boolean, text, integer, text, text[], text, jsonb
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
  p_details jsonb default null,
  p_call_channel text default null,
  p_call_channel_other text default null,
  p_patients jsonb default null
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

  -- How the call came in, and each patient's own severity (0080).
  if p_call_channel is not null and p_call_channel not in ('Phone call', 'WhatsApp', 'In person', 'Other') then
    raise exception 'Choose how the call came in: phone call, WhatsApp, in person or other' using errcode = '22023';
  end if;
  if p_call_channel = 'Other' and nullif(btrim(coalesce(p_call_channel_other, '')), '') is null then
    raise exception 'Say how the call came in' using errcode = '22023';
  end if;
  if p_patients is not null and jsonb_typeof(p_patients) <> 'array' then
    raise exception 'The patients are a list' using errcode = '22023';
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
    call_taken_by, created_by, tagged_silos, intake_complete, details, incident_code, call_channel, call_channel_other, patients
  ) values (
    p_silo, 'Master', public.next_incident_number(p_silo, v_tags), p_client_ref,
    coalesce(v_name, 'Not given yet'), v_number, coalesce(v_desc, 'Details to follow.'), nullif(btrim(coalesce(p_notes, '')), ''),
    btrim(p_incident_type), nullif(btrim(coalesce(p_incident_category, '')), ''), p_incident_severity, p_medical_type,
    btrim(p_location_address), p_suburb, p_city, p_postal_code,
    nullif(btrim(coalesce(p_region, '')), ''), p_location_lat, p_location_lng,
    p_is_caller_patient, p_patient_name, p_number_of_victims, public.clean_injuries(p_injuries),
    v_status, now(), now(),
    v_taker, auth.uid(), v_tags, v_complete,
    public.clean_details(p_details), public.incident_code_for(p_incident_type, p_incident_category),
    p_call_channel, case when p_call_channel = 'Other' then left(btrim(p_call_channel_other), 60) end,
    public.clean_patients(p_patients)
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

revoke execute on function public.send_call_early(
  uuid, silo, text, incident_severity, text, double precision, double precision, silo[],
  text, text, text, text, text, text, text, text, boolean, text, integer, text, text[], text, jsonb, text, text, jsonb
) from public, anon;
grant execute on function public.send_call_early(
  uuid, silo, text, incident_severity, text, double precision, double precision, silo[],
  text, text, text, text, text, text, text, text, boolean, text, integer, text, text[], text, jsonb, text, text, jsonb
) to authenticated, service_role;

-- ── 3. Corrections: the channel and the patients too, each change kept ───────

create or replace function public.apply_call_edit(p_incident uuid, p_fields jsonb, p_kind text, p_reason text default null)
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
  v_diff   jsonb := '{}'::jsonb;
  v_role   text;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_tag    text;
  v_allowed constant text[] := array[
    'caller_name', 'caller_number', 'call_description', 'is_caller_patient', 'patient_name',
    'number_of_victims', 'medical_type', 'injuries', 'details', 'notes', 'incident_severity',
    'incident_type', 'incident_category',
    'location_address', 'location_lat', 'location_lng', 'suburb', 'city', 'postal_code', 'region',
    'call_channel', 'call_channel_other', 'patients'
  ];
begin
  if p_kind is null or p_kind not in ('intake', 'dispatch') then
    raise exception 'Unknown kind of change: %', p_kind using errcode = '22023';
  end if;
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
  if f ? 'call_channel' or f ? 'call_channel_other' then
    n.call_channel := nullif(btrim(coalesce(f ->> 'call_channel', v.call_channel)), '');
    if n.call_channel is not null and n.call_channel not in ('Phone call', 'WhatsApp', 'In person', 'Other') then
      raise exception 'Choose how the call came in: phone call, WhatsApp, in person or other' using errcode = '22023';
    end if;
    n.call_channel_other := case when n.call_channel = 'Other'
      then nullif(left(btrim(coalesce(f ->> 'call_channel_other', v.call_channel_other)), 60), '') end;
    if n.call_channel = 'Other' and n.call_channel_other is null then
      raise exception 'Say how the call came in' using errcode = '22023';
    end if;
  end if;
  if f ? 'patients' then
    if jsonb_typeof(f -> 'patients') <> 'array' then
      raise exception 'The patients are a list' using errcode = '22023';
    end if;
    n.patients := public.clean_patients(f -> 'patients');
  end if;

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
  if n.call_channel is distinct from v.call_channel or n.call_channel_other is distinct from v.call_channel_other then
    v_changed := array_append(v_changed, 'how the call came in'); end if;
  if n.patients is distinct from v.patients then v_changed := array_append(v_changed, 'patients'); end if;
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

  -- Each change, before and after: the audit trail and the case PDF read it.
  if n.caller_name is distinct from v.caller_name then
    v_diff := v_diff || jsonb_build_object('caller_name', jsonb_build_object('before', v.caller_name, 'after', n.caller_name)); end if;
  if n.caller_number is distinct from v.caller_number then
    v_diff := v_diff || jsonb_build_object('caller_number', jsonb_build_object('before', v.caller_number, 'after', n.caller_number)); end if;
  if n.call_description is distinct from v.call_description then
    v_diff := v_diff || jsonb_build_object('call_description', jsonb_build_object('before', v.call_description, 'after', n.call_description)); end if;
  if n.is_caller_patient is distinct from v.is_caller_patient then
    v_diff := v_diff || jsonb_build_object('is_caller_patient', jsonb_build_object('before', v.is_caller_patient, 'after', n.is_caller_patient)); end if;
  if n.patient_name is distinct from v.patient_name then
    v_diff := v_diff || jsonb_build_object('patient_name', jsonb_build_object('before', v.patient_name, 'after', n.patient_name)); end if;
  if n.number_of_victims is distinct from v.number_of_victims then
    v_diff := v_diff || jsonb_build_object('number_of_victims', jsonb_build_object('before', v.number_of_victims, 'after', n.number_of_victims)); end if;
  if n.medical_type is distinct from v.medical_type then
    v_diff := v_diff || jsonb_build_object('medical_type', jsonb_build_object('before', v.medical_type, 'after', n.medical_type)); end if;
  if n.injuries is distinct from v.injuries then
    v_diff := v_diff || jsonb_build_object('injuries', jsonb_build_object('before', to_jsonb(v.injuries), 'after', to_jsonb(n.injuries))); end if;
  if n.details is distinct from v.details then
    v_diff := v_diff || jsonb_build_object('details', jsonb_build_object('before', v.details, 'after', n.details)); end if;
  if n.notes is distinct from v.notes then
    v_diff := v_diff || jsonb_build_object('notes', jsonb_build_object('before', v.notes, 'after', n.notes)); end if;
  if n.incident_severity is distinct from v.incident_severity then
    v_diff := v_diff || jsonb_build_object('incident_severity', jsonb_build_object('before', v.incident_severity, 'after', n.incident_severity)); end if;
  if n.incident_type is distinct from v.incident_type then
    v_diff := v_diff || jsonb_build_object('incident_type', jsonb_build_object('before', v.incident_type, 'after', n.incident_type)); end if;
  if n.incident_category is distinct from v.incident_category then
    v_diff := v_diff || jsonb_build_object('incident_category', jsonb_build_object('before', v.incident_category, 'after', n.incident_category)); end if;
  if v_moved then
    v_diff := v_diff || jsonb_build_object('location', jsonb_build_object(
      'before', jsonb_build_object('address', v.location_address, 'lat', v.location_lat, 'lng', v.location_lng),
      'after', jsonb_build_object('address', n.location_address, 'lat', n.location_lat, 'lng', n.location_lng))); end if;
  if n.suburb is distinct from v.suburb then
    v_diff := v_diff || jsonb_build_object('suburb', jsonb_build_object('before', v.suburb, 'after', n.suburb)); end if;
  if n.city is distinct from v.city then
    v_diff := v_diff || jsonb_build_object('city', jsonb_build_object('before', v.city, 'after', n.city)); end if;
  if n.postal_code is distinct from v.postal_code then
    v_diff := v_diff || jsonb_build_object('postal_code', jsonb_build_object('before', v.postal_code, 'after', n.postal_code)); end if;
  if n.region is distinct from v.region then
    v_diff := v_diff || jsonb_build_object('region', jsonb_build_object('before', v.region, 'after', n.region)); end if;
  if n.call_channel is distinct from v.call_channel or n.call_channel_other is distinct from v.call_channel_other then
    v_diff := v_diff || jsonb_build_object('call_channel', jsonb_build_object(
      'before', concat_ws(': ', v.call_channel, v.call_channel_other), 'after', concat_ws(': ', n.call_channel, n.call_channel_other))); end if;
  if n.patients is distinct from v.patients then
    v_diff := v_diff || jsonb_build_object('patients', jsonb_build_object('before', v.patients, 'after', n.patients)); end if;

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
         call_channel = n.call_channel, call_channel_other = n.call_channel_other, patients = n.patients,
         intake_complete = n.intake_complete, updated_at = now()
   where id = v.id
  returning * into n;

  select full_name, role::text into v_who, v_role from public.profiles where id = auth.uid();
  v_tag := case when p_kind = 'dispatch' then '[DISPATCH] ' else '[INTAKE] ' end;
  if v_moved then
    insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
    values (n.silo, n.id, v_tag || format('Place changed by %s to %s.',
              coalesce(v_who, case when p_kind = 'dispatch' then 'the dispatcher' else 'the call taker' end), n.location_address),
            auth.uid(), v_who);
  end if;
  if cardinality(v_changed) > 0 or (n.intake_complete and not v.intake_complete) then
    insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
    values (n.silo, n.id,
      v_tag || concat_ws(' ',
        case when cardinality(v_changed) > 0 and p_kind = 'dispatch'
             then format('Edited before dispatch by %s: %s.%s', coalesce(v_who, 'the dispatcher'), array_to_string(v_changed, ', '),
                         case when v_reason is not null then ' Why: ' || v_reason end)
             when cardinality(v_changed) > 0
             then format('Details added by %s: %s.', coalesce(v_who, 'the call taker'), array_to_string(v_changed, ', ')) end,
        case when n.intake_complete and not v.intake_complete then 'The call details are complete.' end),
      auth.uid(), v_who);
  end if;
  if p_kind = 'dispatch' then
    insert into public.audit_logs (silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
    values (n.silo, auth.uid(), v_who, coalesce(public.desk_silo(), public.current_silo())::text, 'DISPATCH_EDIT', 'incidents', n.id::text,
      left(format('%s edited before dispatch by %s (%s)%s. %s', n.incident_number, coalesce(v_who, 'a dispatcher'), coalesce(v_role, 'unknown role'),
        case when v_reason is not null then '. Why: ' || v_reason else '' end,
        (select string_agg(format('%s: was "%s", now "%s"', e.key,
                  coalesce(e.value -> 'before' #>> '{}', ''), coalesce(e.value -> 'after' #>> '{}', '')), '; ' order by e.key)
           from jsonb_each(v_diff) e)), 4000));
  elsif v_moved or n.incident_type is distinct from v.incident_type or n.incident_severity is distinct from v.incident_severity
     or (n.intake_complete and not v.intake_complete) then
    insert into public.audit_logs (silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
    values (n.silo, auth.uid(), v_who, n.silo::text, 'INTAKE_UPDATE', 'incidents', n.id::text,
      format('%s: %s', n.incident_number, array_to_string(v_changed || case when v_moved then array['place'] else '{}'::text[] end, ', ')));
  end if;

  insert into public.incident_edits (tenant_id, silo, incident_id, kind, edited_by, edited_by_name, edited_by_role, reason, changes)
  values (n.tenant_id, n.silo, n.id, p_kind, auth.uid(), v_who, v_role, v_reason, v_diff);

  return n;
end $$;

revoke all on function public.apply_call_edit(uuid, jsonb, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
