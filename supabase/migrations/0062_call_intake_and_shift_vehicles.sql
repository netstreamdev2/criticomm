-- ============================================================================
-- 0062 — Call intake checks, no-vehicle shifts, licence and ID on record
-- ============================================================================
--
--   1. log_incoming_call() refuses a caller number that is not a full
--      international number (E.164: "+", country code, 8 to 15 digits) and
--      refuses a call that does not say whether the caller is the patient.
--      The console checks both first; this makes the database the last word,
--      whatever sends the call.
--   2. check_duplicate_incident() matches a caller on the last nine digits of
--      the number, so +27 82 123 4567 and 082 123 4567 are the same caller.
--   3. An officer who finds no vehicle free at start of shift says so on the
--      record (declare_shift_no_vehicle) and carries on with the shift. The
--      server checks there really is none free. The police / standard gate
--      accepts that declaration in place of today's 187(c) inspection.
--   4. An officer may add a photo of their driver's licence and of their ID
--      to today's shift record (record_shift_documents). Optional; the files
--      live in the shift-inspections bucket under the officer's own folder.
--
-- Safe to re-run.
-- ============================================================================

begin;

-- ── 1. Call intake ──────────────────────────────────────────────────────────

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
  p_region text default null
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

  if nullif(trim(coalesce(p_caller_name, '')), '') is null then
    raise exception 'Enter the caller name' using errcode = '22023';
  end if;
  if v_number !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter the caller number with its country code, e.g. +27 82 123 4567'
      using errcode = '22023';
  end if;
  if p_is_caller_patient is null then
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
    is_caller_patient, patient_name, number_of_victims,
    status, call_timestamp, incident_created_at,
    call_taken_by, created_by
  ) values (
    p_silo, p_source, public.next_incident_number(p_silo), p_client_ref,
    trim(p_caller_name), v_number, p_call_description, p_notes,
    p_incident_type, nullif(trim(coalesce(p_incident_category, '')), ''), p_incident_severity,
    p_fire_incident_type, p_medical_type, p_disaster_type,
    p_location_address, p_suburb, p_city, p_postal_code,
    nullif(trim(coalesce(p_region, '')), ''), p_location_lat, p_location_lng,
    p_is_caller_patient, p_patient_name, p_number_of_victims,
    v_status, now(), now(),
    v_taker, auth.uid()
  )
  returning * into v_incident;

  insert into public.audit_logs (
    silo, user_id, user_name, department, action_type, entity_type, entity_id, details
  ) values (
    p_silo, auth.uid(), v_taker,
    p_silo::text, 'CREATE_INCIDENT', 'incidents', v_incident.id::text,
    format('Logged %s call from %s at %s', p_incident_type, trim(p_caller_name), p_location_address)
  );

  return v_incident;
end $$;

revoke execute on function public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text
) from public, anon;
grant execute on function public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text
) to authenticated, service_role;

-- The same caller, however the number was typed: the last nine digits are the
-- subscriber number in South Africa and long enough to be unique elsewhere.
create or replace function public.check_duplicate_incident(
  p_phone     text,
  p_location  text,
  p_type      text
) returns table (reason text, incident_id uuid, incident_number text, matched_at timestamptz)
language sql security invoker set search_path = public as $$
  with recent as (
    select * from public.incidents
    where call_timestamp >= now() - interval '12 hours'
      and status not in ('Closed', 'Resolved')
  ), phone as (
    select right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9) as tail
  )
  (select 'Caller'::text, r.id, r.incident_number, r.call_timestamp
   from recent r, phone
   where length(phone.tail) = 9
     and right(regexp_replace(coalesce(r.caller_number, ''), '[^0-9]', '', 'g'), 9) = phone.tail
   order by r.call_timestamp desc
   limit 1)
  union all
  (select 'Location'::text, id, incident_number, call_timestamp
   from recent
   where p_location is not null and p_type is not null
     and location_address = p_location and incident_type = p_type
   order by call_timestamp desc
   limit 1);
$$;

revoke execute on function public.check_duplicate_incident(text, text, text) from public, anon;
grant execute on function public.check_duplicate_incident(text, text, text) to authenticated;

-- ── 2. No vehicle free at start of shift ────────────────────────────────────

create table if not exists public.shift_no_vehicle_declarations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant(),
  silo        silo not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  user_name   text,
  reason      text,
  created_at  timestamptz not null default now()
);
create index if not exists shift_no_vehicle_user_idx
  on public.shift_no_vehicle_declarations (user_id, created_at desc);
alter table public.shift_no_vehicle_declarations enable row level security;

-- Written only through declare_shift_no_vehicle(); read by the officer and command.
drop policy if exists shift_no_vehicle_read on public.shift_no_vehicle_declarations;
create policy shift_no_vehicle_read on public.shift_no_vehicle_declarations for select to authenticated
  using (
    user_id = auth.uid()
    or public.role_in('SystemAdmin','SuperAdmin','SystemController')
    or (silo = public.current_silo()
        and public.role_in('Admin','System','Supervisor','Captain','Chief'))
  );
drop policy if exists tenant_isolation on public.shift_no_vehicle_declarations;
create policy tenant_isolation on public.shift_no_vehicle_declarations as restrictive for all to authenticated
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

create or replace function public.declare_shift_no_vehicle(p_reason text default null)
returns public.shift_no_vehicle_declarations
language plpgsql security definer set search_path = public as $$
declare
  v_person public.personnel;
  v_row    public.shift_no_vehicle_declarations;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into v_person from public.personnel
  where user_id = auth.uid() and tenant_id = public.current_tenant();
  if not found then raise exception 'No personnel record is linked to this account'; end if;
  if v_person.silo in ('MetroFire', 'Medical') then
    raise exception 'Fire and EMS crews start the shift on an apparatus';
  end if;
  if not public.shift_readiness_passed_today() then
    raise exception 'Complete the readiness assessment first';
  end if;
  if v_person.assigned_apparatus_id is not null then
    raise exception 'A vehicle is already assigned to you: inspect it to continue';
  end if;
  -- The same vehicles assign_vehicle() would let this officer take.
  if exists (
    select 1 from public.apparatus a
    where a.tenant_id = public.current_tenant() and a.status = 'Available'
      and (a.silo = v_person.silo or (v_person.silo = 'Ethekwini' and a.silo = 'MetroPolice'))
  ) then
    raise exception 'A vehicle is available: select it to continue';
  end if;

  insert into public.shift_no_vehicle_declarations (tenant_id, silo, user_id, user_name, reason)
  values (
    public.current_tenant(), v_person.silo, auth.uid(),
    trim(v_person.rank || ' ' || v_person.first_name || ' ' || v_person.last_name),
    nullif(trim(coalesce(p_reason, '')), '')
  ) returning * into v_row;
  return v_row;
end $$;

revoke execute on function public.declare_shift_no_vehicle(text) from public, anon;
grant  execute on function public.declare_shift_no_vehicle(text) to authenticated;

-- 0060's gate, with one change in the police / standard branch: a no-vehicle
-- declaration today stands in for the inspection while the officer holds no
-- vehicle. Fire and EMS are unchanged.
create or replace function public.shift_vehicle_passed_today() returns boolean
language sql stable security definer set search_path = public as $$
  select case when public.current_silo() = 'MetroFire' then exists (
    select 1 from (
      select v.* from public.vehicle_checklists v
      join public.personnel p on p.user_id = v.user_id and p.tenant_id = v.tenant_id
        and p.assigned_apparatus_id = v.apparatus_id and p.silo = 'MetroFire'
      join public.apparatus a on a.id = v.apparatus_id and a.tenant_id = v.tenant_id
        and a.silo = 'MetroFire' and a.status = 'In Use'
      where v.user_id = auth.uid() and v.tenant_id = public.current_tenant() and v.silo = 'MetroFire'
        and v.checked_at >= public.sa_today_start() and v.officer_submitted
      order by v.checked_at desc, v.id desc limit 1
    ) v
    where v.form_version = 'fire-v1' and v.declaration_accepted
      and v.lights_functional and v.tires_condition_ok and v.equipment_stocked and v.comms_working and v.brakes_responsive
      and v.scba_checked and v.water_tank_full and v.pump_operational
      and v.hoses_and_nozzles_stocked and v.ladders_secured and v.turnout_gear_complete
  ) when public.current_silo() = 'Medical' then exists (
    select 1 from (
      select v.* from public.vehicle_checklists v
      join public.personnel p on p.user_id = v.user_id and p.tenant_id = v.tenant_id
        and p.assigned_apparatus_id = v.apparatus_id and p.silo = 'Medical'
      join public.apparatus a on a.id = v.apparatus_id and a.tenant_id = v.tenant_id
        and a.silo = 'Medical' and a.status = 'In Use'
      where v.user_id = auth.uid() and v.tenant_id = public.current_tenant() and v.silo = 'Medical'
        and v.checked_at >= public.sa_today_start() and v.officer_submitted
      order by v.checked_at desc, v.id desc limit 1
    ) v
    where v.form_version = 'ems-v1' and v.declaration_accepted and v.requires_cleaning is false
      and v.lights_functional and v.tires_condition_ok and v.equipment_stocked and v.comms_working and v.brakes_responsive
      and v.oxygen_full and v.aed_battery_ok and v.suction_functional and v.bvm_masks_ok
      and v.jump_bag_stocked and v.iv_fluids_stocked and v.drug_box_sealed and v.gloves_ppe_stocked
  ) else exists (
    select 1 from (
      select v.* from public.vehicle_checklists v
      join public.personnel p on p.user_id = v.user_id and p.tenant_id = v.tenant_id
        and p.assigned_apparatus_id = v.apparatus_id
      where v.user_id = auth.uid() and v.tenant_id = public.current_tenant()
        and v.checked_at >= public.sa_today_start() and v.officer_submitted and v.form_version = '187c'
      order by v.checked_at desc, v.id desc limit 1
    ) v
    where v.lights_functional and v.tires_condition_ok and v.equipment_stocked
      and v.comms_working and v.brakes_responsive and v.declaration_accepted
  ) or (
    exists (
      select 1 from public.shift_no_vehicle_declarations d
      where d.user_id = auth.uid() and d.tenant_id = public.current_tenant()
        and d.created_at >= public.sa_today_start()
    )
    and exists (
      select 1 from public.personnel p
      where p.user_id = auth.uid() and p.tenant_id = public.current_tenant()
        and p.assigned_apparatus_id is null
    )
  ) end;
$$;

revoke all on function public.shift_vehicle_passed_today() from public, anon;
grant execute on function public.shift_vehicle_passed_today() to authenticated;

-- ── 3. Driver's licence and ID on the shift record ──────────────────────────

create table if not exists public.shift_identity_documents (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default public.current_tenant(),
  silo              silo not null,
  user_id           uuid not null references auth.users(id) on delete cascade,
  user_name         text,
  licence_path      text,
  id_document_path  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists shift_identity_documents_user_idx
  on public.shift_identity_documents (user_id, created_at desc);
alter table public.shift_identity_documents enable row level security;

drop policy if exists shift_identity_documents_read on public.shift_identity_documents;
create policy shift_identity_documents_read on public.shift_identity_documents for select to authenticated
  using (
    user_id = auth.uid()
    or public.role_in('SystemAdmin','SuperAdmin','SystemController')
    or (silo = public.current_silo()
        and public.role_in('Admin','System','Supervisor','Captain','Chief','FireChief'))
  );
drop policy if exists tenant_isolation on public.shift_identity_documents;
create policy tenant_isolation on public.shift_identity_documents as restrictive for all to authenticated
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

-- One row per officer per day: a second call replaces what it is given and
-- keeps the other photo. Paths must sit in the officer's own folder.
create or replace function public.record_shift_documents(
  p_licence_path text default null, p_id_document_path text default null
)
returns public.shift_identity_documents
language plpgsql security definer set search_path = public as $$
declare
  v_person public.personnel;
  v_row    public.shift_identity_documents;
  v_prefix text := public.current_tenant()::text || '/' || auth.uid()::text || '/';
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into v_person from public.personnel
  where user_id = auth.uid() and tenant_id = public.current_tenant();
  if not found then raise exception 'No personnel record is linked to this account'; end if;
  if p_licence_path is null and p_id_document_path is null then
    raise exception 'Add a licence or an ID photo';
  end if;
  if (p_licence_path is not null and (left(p_licence_path, length(v_prefix)) <> v_prefix or p_licence_path like '%..%'))
     or (p_id_document_path is not null and (left(p_id_document_path, length(v_prefix)) <> v_prefix or p_id_document_path like '%..%')) then
    raise exception 'That photo is not in your folder' using errcode = '42501';
  end if;

  select * into v_row from public.shift_identity_documents
  where user_id = auth.uid() and tenant_id = public.current_tenant()
    and created_at >= public.sa_today_start()
  order by created_at desc limit 1
  for update;

  if found then
    update public.shift_identity_documents
    set licence_path = coalesce(p_licence_path, licence_path),
        id_document_path = coalesce(p_id_document_path, id_document_path),
        updated_at = now()
    where id = v_row.id
    returning * into v_row;
  else
    insert into public.shift_identity_documents (tenant_id, silo, user_id, user_name, licence_path, id_document_path)
    values (
      public.current_tenant(), v_person.silo, auth.uid(),
      trim(v_person.rank || ' ' || v_person.first_name || ' ' || v_person.last_name),
      p_licence_path, p_id_document_path
    ) returning * into v_row;
  end if;
  return v_row;
end $$;

revoke execute on function public.record_shift_documents(text, text) from public, anon;
grant  execute on function public.record_shift_documents(text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
