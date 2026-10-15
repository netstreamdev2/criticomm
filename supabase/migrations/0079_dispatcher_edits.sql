-- ============================================================================
-- 0079 — The dispatcher edits a call before dispatching it, and every change
-- is kept: who, when, why, and what it was and became
-- ============================================================================
--
-- Run after 0078.
--
-- On the assign page a dispatcher may correct the call (type, severity,
-- description, caller, place, patient, notes, details) before sending crews:
--
--   dispatcher_edit_call(incident, fields, reason)
--     A department's desk, until its own department's part is dispatched; the
--     control room and administrators, until any department is dispatched.
--     After that the call taker and the control room add details as before.
--
--   incident_edits
--     One row per change, by the call taker (kind 'intake') or a dispatcher
--     ('dispatch'): who, their role, when, why, and each field before and
--     after. Read by the call page and the case PDF; written only by the
--     functions below.
--
-- The checks on each field are 0077's, unchanged, now in apply_call_edit(),
-- which only these two functions call. complete_call_intake keeps its rules
-- and words. Every dispatcher edit also goes to the audit trail
-- (DISPATCH_EDIT) and the call's timeline ([DISPATCH]).
--
-- Safe to re-run.
-- ============================================================================

create table if not exists public.incident_edits (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  silo           public.silo not null,
  incident_id    uuid not null references public.incidents (id) on delete cascade,
  kind           text not null check (kind in ('intake', 'dispatch')),
  edited_by      uuid,
  edited_by_name text,
  edited_by_role text,
  reason         text check (reason is null or length(reason) <= 500),
  changes        jsonb not null default '{}'::jsonb,
  edited_at      timestamptz not null default clock_timestamp()
);
comment on table public.incident_edits is
  'Each change to a call after it was sent (0079): by the call taker (intake) or a dispatcher before dispatch (dispatch), with each field before and after. Written only by apply_call_edit().';
create index if not exists incident_edits_incident_idx on public.incident_edits (incident_id, edited_at);
alter table public.incident_edits enable row level security;

-- Whoever may open the call reads its changes (the incidents rules decide).
drop policy if exists incident_edits_read on public.incident_edits;
create policy incident_edits_read on public.incident_edits for select to authenticated
  using (tenant_id = public.current_tenant()
         and exists (select 1 from public.incidents i where i.id = incident_edits.incident_id));
revoke all on public.incident_edits from public, anon;
grant select on public.incident_edits to authenticated;

-- ── 1. The shared core: 0077's checks, and the record of each change ─────────

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
    'location_address', 'location_lat', 'location_lng', 'suburb', 'city', 'postal_code', 'region'
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

-- ── 2. The call taker adds details (0076, 0077): the same rules ──────────────

create or replace function public.complete_call_intake(p_incident uuid, p_fields jsonb)
returns public.incidents
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v public.incidents;
begin
  perform public.require_role(
    'SystemAdmin','SuperAdmin','Admin','ControlRoom','IncidentLogger','System'
  );
  select * into v from public.incidents
   where id = p_incident and tenant_id = public.current_tenant();
  if not found then raise exception 'Incident not found' using errcode = 'P0002'; end if;
  -- The person who took the call finishes it; the control room and the
  -- organisation's administrators may too.
  if v.created_by is distinct from auth.uid()
     and not (public.role_in('SystemAdmin', 'SuperAdmin', 'System')
              or (public.role_in('ControlRoom', 'Admin') and public.current_silo() = 'Ethekwini')) then
    raise exception 'Only the person who logged % adds its details', v.incident_number using errcode = '42501';
  end if;
  return public.apply_call_edit(p_incident, p_fields, 'intake', null);
end $$;

revoke all on function public.complete_call_intake(uuid, jsonb) from public, anon;
grant execute on function public.complete_call_intake(uuid, jsonb) to authenticated, service_role;

-- ── 3. The dispatcher edits before dispatching ───────────────────────────────

create or replace function public.dispatcher_edit_call(p_incident uuid, p_fields jsonb, p_reason text default null)
returns public.incidents
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v      public.incidents;
  v_desk public.silo := public.desk_silo();
  v_sent text;
begin
  perform public.require_role('SystemAdmin','SuperAdmin','Admin','Dispatcher','Operator','ControlRoom','Supervisor');
  if p_reason is not null and length(btrim(p_reason)) > 500 then
    raise exception 'Keep the reason under 500 characters' using errcode = '22023';
  end if;

  select * into v from public.incidents
   where id = p_incident and tenant_id = public.current_tenant()
   for update;
  if not found then raise exception 'Incident not found' using errcode = 'P0002'; end if;
  if v.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v.incident_number, lower(v.status::text) using errcode = '22023';
  end if;

  -- A department's desk works the calls sent to it (0068).
  if v_desk is not null and not (v.silo = v_desk or v_desk = any (coalesce(v.dispatched_silos, '{}'))
          or v_desk = any (coalesce(v.tagged_silos, '{}'))) then
    raise exception '% was not sent to your dispatch desk', v.incident_number using errcode = '42501';
  end if;

  -- Before dispatch only: a desk until its own department's crews are sent,
  -- the control room until any are. A call from before 0073 has no parts: its status says.
  if exists (select 1 from public.incident_departments d where d.incident_id = v.id) then
    select string_agg(public.department_label(d.silo), ', ' order by d.silo) into v_sent
      from public.incident_departments d
     where d.incident_id = v.id and d.dispatched_at is not null
       and (v_desk is null or d.silo = v_desk);
  elsif v.status not in ('New', 'Pending', 'Pending Dispatch', 'Pending Analysis') then
    v_sent := 'a crew';
  end if;
  if v_sent is not null then
    raise exception '% has been dispatched (%): it can no longer be edited here. The call taker or the control room adds details.',
      v.incident_number, v_sent using errcode = '22023';
  end if;

  return public.apply_call_edit(p_incident, p_fields, 'dispatch', p_reason);
end $$;

revoke all on function public.dispatcher_edit_call(uuid, jsonb, text) from public, anon;
grant execute on function public.dispatcher_edit_call(uuid, jsonb, text) to authenticated, service_role;

notify pgrst, 'reload schema';
