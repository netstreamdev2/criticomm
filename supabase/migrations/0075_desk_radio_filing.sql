-- ============================================================================
-- 0075 — Filing by radio: the desk files and closes for a crew without a phone
-- ============================================================================
--
-- Run after 0074.
--
-- A crew short of phones works the call on the radio: they tell the desk
-- what happened and the desk keeps the record. Until now the desk could mark
-- their progress (set_department_status) but not file their report — only
-- the officer leading the call could, from the app — so the call could only
-- end as "closed without a report". Now a department's dispatch desk, its
-- command, the control room and the organisation's administrators file a
-- crew's report from the console, and close it on scene, as V4's desk did.
--
-- What stays true:
--   • The report is the crew member's: filed in the name of the member who
--     radioed it in (their rank, force number, station and vehicle), and that
--     member leads the department's part. The desk can only file for a member
--     of that department, and only for the member already leading it, if any.
--   • Who actually typed it is on record too: the part carries who filed it
--     from the desk and as radioed in by whom, the timeline says
--     "[RADIO] … filed from the desk by …, as radioed in by …", and the audit
--     log has REPORT_FILED_BY_RADIO under the desk user's own name.
--   • The crew must be marked on scene first (set_department_status), as on
--     the phone. Nobody signs over the radio: a patient report filed by radio
--     waives the signatures, and the record says it was radioed in.
--   • Only someone who directs the department (can_direct_department, 0073)
--     may, and only on a call they can work. A field officer cannot file in
--     someone else's name.
--   • The phone's path is unchanged: the four report functions below are
--     0073's, with the changes marked "0075".
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. On the department's part: filed from the desk, as radioed in by ─────

alter table public.incident_departments
  add column if not exists radio_filed_by      uuid,
  add column if not exists radio_filed_by_name text,
  add column if not exists radioed_by          uuid,
  add column if not exists radioed_by_name     text;

comment on column public.incident_departments.radio_filed_by is
  'The desk user who filed this department''s report from the console, as radioed in by radioed_by (0075). Null when the crew filed from the app.';

-- ── 2. Who the desk files for ───────────────────────────────────────────────

-- Called by the report functions with the report's fields. Without
-- `radioed_by` it returns null and the crew's own path applies. With it, the
-- caller must direct the department, the member must belong to it, the crew
-- must be on scene, and the member leads the department's part (they had no
-- phone to press Responding). Returns the member the report is filed for.
create or replace function public.radio_filer(p_incident_id uuid, p_silo public.silo, p_fields jsonb, p_lead uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_officer uuid;
  v_person  public.personnel;
  v_dept    public.incident_departments;
  v_name    text;
  v_label   text := public.department_label(p_silo);
begin
  if nullif(btrim(coalesce(p_fields ->> 'radioed_by', '')), '') is null then
    return null;
  end if;
  begin
    v_officer := (p_fields ->> 'radioed_by')::uuid;
  exception when invalid_text_representation then
    raise exception 'Choose who radioed it in' using errcode = '22023';
  end;

  if not public.role_in('Dispatcher', 'ControlRoom', 'Operator', 'SystemController', 'System', 'Supervisor',
                        'Captain', 'Chief', 'FireChief', 'Admin', 'SystemAdmin', 'SuperAdmin')
     or not public.can_direct_department(p_silo)
     or not public.can_work_incident(p_incident_id) then
    raise exception 'Only % dispatch or command, or the control room, files a report by radio', v_label
      using errcode = '42501';
  end if;
  -- The lead filing their own call files as themselves.
  if v_officer = auth.uid() then
    return null;
  end if;

  select * into v_person from public.personnel
   where user_id = v_officer and tenant_id = public.current_tenant()
   limit 1;
  if not found or v_person.silo is distinct from p_silo then
    raise exception 'Choose a member of % who was on the call', v_label using errcode = '22023';
  end if;

  select * into v_dept from public.incident_departments
   where incident_id = p_incident_id and silo = p_silo
   for update;
  if not found then
    raise exception 'The call was not sent to %', v_label using errcode = 'P0002';
  end if;
  if p_lead is not null and p_lead <> v_officer then
    raise exception '% leads % for %: file it as radioed in by them', coalesce(v_dept.lead_name, 'Another member'),
      (select incident_number from public.incidents where id = p_incident_id), v_label using errcode = '22023';
  end if;
  if v_dept.status not in ('Arrived', 'On Scene', 'Transporting') then
    raise exception 'Mark % on scene first, as the crew radioed it', v_label using errcode = 'P0001';
  end if;

  if p_lead is null then
    v_name := btrim(concat_ws(' ', nullif(btrim(coalesce(v_person.rank, '')), ''), v_person.first_name, v_person.last_name));
    update public.incident_departments
       set lead_id = v_officer, lead_name = v_name, accepted_at = coalesce(accepted_at, dispatched_at, now()), updated_at = now()
     where id = v_dept.id;
    insert into public.incident_responders (tenant_id, incident_id, user_id, silo, name, unit_id, role, status, joined_at)
    values (v_dept.tenant_id, p_incident_id, v_officer, p_silo, v_name, v_person.assigned_apparatus_id, 'lead',
            v_dept.status::public.incident_status, coalesce(v_dept.dispatched_at, now()))
    on conflict (incident_id, user_id) do update
       set role = 'lead', status = excluded.status, updated_at = now();
    -- The call's own lead is the first department's lead (as update_responder_status).
    update public.incidents
       set accepted_by        = coalesce(accepted_by, v_officer),
           accepted_at        = coalesce(accepted_at, v_dept.dispatched_at, now()),
           responding_officer = coalesce(responding_officer, v_name),
           updated_at         = now()
     where id = p_incident_id;
  end if;
  return v_officer;
end $$;
revoke all on function public.radio_filer(uuid, public.silo, jsonb, uuid) from public, anon, authenticated;

-- After the report: the part, the timeline and the audit log say who filed it
-- from the desk, and as radioed in by whom.
create or replace function public.note_radio_filing(p_incident_id uuid, p_silo public.silo, p_officer uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_desk    text;
  v_officer text;
  v_inc     public.incidents;
begin
  select full_name into v_desk from public.profiles where id = auth.uid();
  select btrim(concat_ws(' ', nullif(btrim(coalesce(pe.rank, '')), ''), pe.first_name, pe.last_name)) into v_officer
    from public.personnel pe where pe.user_id = p_officer and pe.tenant_id = public.current_tenant() limit 1;
  update public.incident_departments
     set radio_filed_by = auth.uid(), radio_filed_by_name = v_desk,
         radioed_by = p_officer, radioed_by_name = v_officer, updated_at = now()
   where incident_id = p_incident_id and silo = p_silo;
  select * into v_inc from public.incidents where id = p_incident_id;
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id,
    format('[RADIO] %s report filed from the desk by %s, as radioed in by %s.',
      public.department_label(p_silo), coalesce(v_desk, 'the desk'), coalesce(v_officer, 'the crew')),
    auth.uid(), v_desk);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, v_inc.silo, auth.uid(), v_desk, p_silo::text, 'REPORT_FILED_BY_RADIO', 'incidents', v_inc.id::text,
    format('%s report for %s filed from the desk as radioed in by %s', public.department_label(p_silo), v_inc.incident_number,
      coalesce(v_officer, 'the crew')));
end $$;
revoke all on function public.note_radio_filing(uuid, public.silo, uuid) from public, anon, authenticated;

-- ── 3. The four reports, as 0073 with the desk's path (marked 0075) ─────────

create or replace function public.file_incident_report(
  p_incident_id uuid,
  p_report_type text,
  p_fields      jsonb,
  p_details     jsonb default '{}'::jsonb
) returns public.metro_reports
language plpgsql security definer set search_path = public as $$
declare
  v_incident public.incidents;
  v_person   public.personnel;
  v_report   public.metro_reports;
  v_name     text;
  v_narr     text := nullif(trim(coalesce(p_fields ->> 'officer_narrative', '')), '');
  f          jsonb := coalesce(p_fields, '{}'::jsonb);
  v_radio    uuid;
begin
  perform public.require_role('Police','Officer','Metro','Security','Captain','Supervisor',
                              'Admin','SystemAdmin','SuperAdmin', 'Dispatcher', 'ControlRoom', 'Operator', 'SystemController', 'System', 'Chief', 'FireChief');

  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;
  -- 0073: the call as MetroPolice sees it — its own lead, status and report.
  v_incident := public.incident_for_department(v_incident, 'MetroPolice');

  -- Replay of a report already filed (offline retry): return it unchanged.
  if v_incident.report_filed_at is not null then
    select * into v_report from public.metro_reports
    where incident_id = p_incident_id and filed_at is not null
    order by filed_at limit 1;
    if found then return v_report; end if;
  end if;

  -- 0075: the desk files for a crew that radioed it in; radio_filer() says who may.
  v_radio := public.radio_filer(p_incident_id, 'MetroPolice', f, v_incident.accepted_by);
  if v_radio is null and v_incident.accepted_by is distinct from auth.uid() then
    raise exception 'Only the officer who accepted % can file its report', v_incident.incident_number;
  end if;
  if v_incident.status not in ('Arrived', 'On Scene', 'Transporting') then
    raise exception 'Mark yourself on scene before filing the report for %', v_incident.incident_number;
  end if;
  if v_narr is null or length(v_narr) < 20 then
    raise exception 'The officer narrative is required (at least 20 characters)';
  end if;

  -- 0075: the member who radioed it in, when the desk files.
  select * into v_person from public.personnel
  where user_id = coalesce(v_radio, auth.uid()) and tenant_id = public.current_tenant();
  select full_name into v_name from public.profiles where id = auth.uid();

  insert into public.metro_reports (
    silo, incident_id, case_number, date_of_offense, time_of_offense, location, station,
    incident_category, officer_name, badge_number, partner_name, bodycam_active,
    dispatch_time, arrival_time, clear_time, total_time,
    arrest_made, charges, use_of_force,
    suspect_name, suspect_description, offender_name, offender_id,
    victim_name, victim_contact, victim_id, victim_injuries,
    vehicle_make, license_plate, vin_number, reg_number, vehicle_impounded, impound_lot,
    weapon_type, weapon_size, ammunition_rounds,
    fine_amount, ticket_number,
    contraband_seized, contraband_details,
    evidence_weapons, evidence_drugs, evidence_property, evidence_log,
    officer_narrative,
    report_type, details, filed_by, filed_at
  ) values (
    'MetroPolice', v_incident.id, v_incident.incident_number,
    (v_incident.call_timestamp at time zone 'Africa/Johannesburg')::date,
    to_char(v_incident.call_timestamp at time zone 'Africa/Johannesburg', 'HH24:MI'),
    v_incident.location_address, v_person.station,
    v_incident.incident_type,
    -- 0075: filed by radio, the member's own name, never the desk user's.
    case when v_radio is not null
         then btrim(concat_ws(' ', nullif(btrim(coalesce(v_person.rank, '')), ''), v_person.first_name, v_person.last_name))
         else coalesce(trim(v_person.rank || ' ' || v_person.first_name || ' ' || v_person.last_name), v_name) end,
    v_person.badge_number,
    nullif(trim(f ->> 'partner_name'), ''),
    nullif(trim(f ->> 'bodycam_active'), ''),
    to_char(v_incident.dispatch_time at time zone 'Africa/Johannesburg', 'HH24:MI'),
    to_char(v_incident.arrived_timestamp at time zone 'Africa/Johannesburg', 'HH24:MI'),
    to_char(now() at time zone 'Africa/Johannesburg', 'HH24:MI'),
    case when v_incident.dispatch_time is not null
         then round(extract(epoch from (now() - v_incident.dispatch_time)) / 60)::text || ' min' end,
    nullif(trim(f ->> 'arrest_made'), ''),
    nullif(trim(f ->> 'charges'), ''),
    nullif(trim(f ->> 'use_of_force'), ''),
    nullif(trim(f ->> 'suspect_name'), ''),
    nullif(trim(f ->> 'suspect_description'), ''),
    nullif(trim(f ->> 'offender_name'), ''),
    nullif(trim(f ->> 'offender_id'), ''),
    nullif(trim(f ->> 'victim_name'), ''),
    nullif(trim(f ->> 'victim_contact'), ''),
    nullif(trim(f ->> 'victim_id'), ''),
    nullif(trim(f ->> 'victim_injuries'), ''),
    nullif(trim(f ->> 'vehicle_make'), ''),
    upper(nullif(trim(f ->> 'license_plate'), '')),
    upper(nullif(trim(f ->> 'vin_number'), '')),
    upper(nullif(trim(f ->> 'reg_number'), '')),
    coalesce(nullif(trim(f ->> 'vehicle_impounded'), ''), 'No'),
    nullif(trim(f ->> 'impound_lot'), ''),
    nullif(trim(f ->> 'weapon_type'), ''),
    nullif(trim(f ->> 'weapon_size'), ''),
    coalesce(nullif(regexp_replace(coalesce(f ->> 'ammunition_rounds', ''), '[^0-9]', '', 'g'), '')::int, 0),
    nullif(regexp_replace(coalesce(f ->> 'fine_amount', ''), '[^0-9.]', '', 'g'), '')::numeric,
    nullif(trim(f ->> 'ticket_number'), ''),
    nullif(trim(f ->> 'contraband_seized'), ''),
    nullif(trim(f ->> 'contraband_details'), ''),
    coalesce(f ->> 'evidence_weapons', '') in ('true', 'Yes'),
    coalesce(f ->> 'evidence_drugs', '') in ('true', 'Yes'),
    coalesce(f ->> 'evidence_property', '') in ('true', 'Yes'),
    nullif(trim(f ->> 'evidence_log'), ''),
    v_narr,
    nullif(trim(coalesce(p_report_type, '')), ''),
    coalesce(p_details, '{}'::jsonb),
    auth.uid(), now()
  ) returning * into v_report;

  -- 0073: the report finishes MetroPolice's part; the call is resolved once every department has finished.
  v_incident := public.finish_department_by_report(p_incident_id, 'MetroPolice', now());

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[REPORT] %s report filed by %s', coalesce(p_report_type, 'Case'), coalesce(v_name, 'officer')),
    auth.uid(), v_name);

  insert into public.audit_logs (silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.silo, auth.uid(), v_name, 'MetroPolice', 'REPORT_FILED', 'incidents', v_incident.id::text,
    format('%s report filed for %s', coalesce(p_report_type, 'Case'), v_incident.incident_number));

  perform public.notify_incident_chain(
    v_incident, case when v_incident.status = 'Resolved' then 'resolved' else 'report_filed' end,
    format('%s: police report filed by %s', v_incident.incident_number, coalesce(v_name, 'officer')),
    format('%s · %s', v_incident.incident_type, v_incident.location_address)
  );

  -- 0075: filed from the desk, as radioed in: on record as such.
  if v_radio is not null then perform public.note_radio_filing(p_incident_id, 'MetroPolice', v_radio); end if;

  return v_report;
end $$;

create or replace function public.file_fire_report(p_incident_id uuid, p_fields jsonb)
returns public.firefighter_reports
language plpgsql security definer set search_path to 'public' as $$
declare
  f          jsonb := coalesce(p_fields, '{}'::jsonb);
  v_radio    uuid;
  v_incident public.incidents;
  v_person   public.personnel;
  v_report   public.firefighter_reports;
  v_name     text;
  v_officer  text;
  v_summary  text := nullif(trim(coalesce(f ->> 'narrative_summary', '')), '');
  v_type     text := nullif(trim(coalesce(f ->> 'type_of_incident', '')), '');
  v_cause    text := nullif(trim(coalesce(f ->> 'fire_cause', '')), '');
  v_vent     text := nullif(trim(coalesce(f ->> 'ventilation_type', '')), '');
  v_hazmat   text := nullif(trim(coalesce(f ->> 'hazmat_description', '')), '');
  v_photos   int;
  v_now      timestamptz := now();
begin
  perform public.require_role('Firefighter', 'FireChief', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin',
    'Dispatcher', 'ControlRoom', 'Operator', 'SystemController', 'System', 'Chief', 'Captain');

  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;
  -- 0073: the call as MetroFire sees it — its own lead, status and report.
  v_incident := public.incident_for_department(v_incident, 'MetroFire');

  -- Replay of a report already filed (offline retry): return it unchanged.
  if v_incident.report_filed_at is not null then
    select * into v_report from public.firefighter_reports
    where incident_id = p_incident_id order by report_submission_date limit 1;
    if found then return v_report; end if;
    raise exception '% is already closed', v_incident.incident_number using errcode = 'P0001';
  end if;

  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text) using errcode = 'P0001';
  end if;
  -- 0075: the desk files for a crew that radioed it in; radio_filer() says who may.
  v_radio := public.radio_filer(p_incident_id, 'MetroFire', f, v_incident.accepted_by);
  if v_radio is null and v_incident.accepted_by is distinct from auth.uid() then
    raise exception 'Only the firefighter leading % files its report', v_incident.incident_number using errcode = 'P0001';
  end if;
  if v_incident.status not in ('Arrived', 'On Scene', 'Transporting') then
    raise exception 'Mark yourself on scene before filing the report for %', v_incident.incident_number using errcode = 'P0001';
  end if;

  -- What the report must say.
  if v_type is null then
    raise exception 'Choose the type of incident.' using errcode = 'P0001';
  end if;
  if v_summary is null or length(v_summary) < 20 then
    raise exception 'The summary is required (at least 20 characters).' using errcode = 'P0001';
  end if;
  if v_cause is null then
    raise exception 'Give the cause, or Under investigation.' using errcode = 'P0001';
  end if;
  if coalesce(nullif(regexp_replace(coalesce(f ->> 'civilian_fatalities', ''), '[^0-9]', '', 'g'), '')::int, 0)
     + coalesce(nullif(regexp_replace(coalesce(f ->> 'firefighter_fatalities', ''), '[^0-9]', '', 'g'), '')::int, 0) > 0
     and nullif(trim(coalesce(f ->> 'civilian_fatality_details', '') || coalesce(f ->> 'firefighter_fatality_details', '')), '') is null then
    raise exception 'Describe the fatalities.' using errcode = 'P0001';
  end if;
  if coalesce(nullif(regexp_replace(coalesce(f ->> 'civilian_injuries', ''), '[^0-9]', '', 'g'), '')::int, 0)
     + coalesce(nullif(regexp_replace(coalesce(f ->> 'firefighter_injuries', ''), '[^0-9]', '', 'g'), '')::int, 0) > 0
     and nullif(trim(coalesce(f ->> 'civilian_injury_details', '') || coalesce(f ->> 'firefighter_injury_details', '')), '') is null then
    raise exception 'Describe the injuries.' using errcode = 'P0001';
  end if;

  -- 0075: the member who radioed it in, when the desk files.
  select * into v_person from public.personnel
  where user_id = coalesce(v_radio, auth.uid()) and tenant_id = public.current_tenant();
  select full_name into v_name from public.profiles where id = auth.uid();
  v_officer := coalesce(nullif(trim(concat_ws(' ', v_person.first_name, v_person.last_name)), ''), v_name, 'Firefighter');
  select count(*) into v_photos from public.incident_attachments where incident_id = p_incident_id and kind = 'image';

  insert into public.firefighter_reports (
    tenant_id, silo, incident_id, apparatus_id, report_number, date_of_incident, time_of_incident, location,
    type_of_incident,
    dispatch_time_seconds, arrival_time_seconds, clear_time_seconds, total_time_on_scene_seconds,
    fire_department_name, station_number, narrative_summary, initial_observations,
    smoke_conditions, flame_spread, heat_signature, hazards_identified,
    fire_suppression_details, search_and_rescue_performed, persons_rescued, rescue_location, rescue_condition,
    ventilation_conducted, ventilation_type, salvage_overhaul, hazmat_operations, hazmat_description,
    medical_aid_provided, medical_aid_description, utilities_secured, utility_details,
    point_of_origin_room, point_of_origin_object, ignition_source, fire_cause,
    fire_investigation_conducted, fire_investigation_reason,
    property_type, property_owner, property_contact, property_value, damage_estimate,
    photos_attached, no_photo_reason,
    civilian_injuries, civilian_injury_details, civilian_fatalities, civilian_fatality_details,
    firefighter_injuries, firefighter_injury_details, firefighter_fatalities, firefighter_fatality_details,
    treatment_provided, treatment_details,
    other_agencies_on_scene, mutual_aid_used, equipment_used, challenges_faced, successes, recommendations,
    reporting_officer_name, reporting_officer_rank, reporting_officer_id, report_submission_date
  ) values (
    v_incident.tenant_id, 'MetroFire', v_incident.id, coalesce(v_incident.unit_id, v_person.assigned_apparatus_id),
    'FR-' || v_incident.incident_number,
    (coalesce(v_incident.call_timestamp, v_incident.incident_created_at) at time zone 'Africa/Johannesburg')::date,
    coalesce(nullif(f ->> 'time_of_incident', '')::time,
             (coalesce(v_incident.call_timestamp, v_incident.incident_created_at) at time zone 'Africa/Johannesburg')::time),
    coalesce(nullif(trim(f ->> 'location'), ''), v_incident.location_address),
    v_type,
    -- Durations, from the incident's own timestamps: never typed.
    greatest(0, coalesce(extract(epoch from (v_incident.dispatch_time - coalesce(v_incident.call_timestamp, v_incident.incident_created_at))), 0))::bigint,
    greatest(0, coalesce(extract(epoch from (v_incident.arrived_timestamp - v_incident.dispatch_time)), 0))::bigint,
    greatest(0, coalesce(extract(epoch from (v_now - coalesce(v_incident.dispatch_time, v_incident.incident_created_at))), 0))::bigint,
    greatest(0, coalesce(extract(epoch from (v_now - v_incident.arrived_timestamp)), 0))::bigint,
    nullif(trim(f ->> 'fire_department_name'), ''), nullif(trim(f ->> 'station_number'), ''),
    v_summary, nullif(trim(f ->> 'initial_observations'), ''),
    nullif(trim(f ->> 'smoke_conditions'), ''), nullif(trim(f ->> 'flame_spread'), ''),
    nullif(trim(f ->> 'heat_signature'), ''), nullif(trim(f ->> 'hazards_identified'), ''),
    nullif(trim(f ->> 'fire_suppression_details'), ''),
    coalesce(f ->> 'search_and_rescue_performed', '') in ('true', 'Yes'),
    least(1000, coalesce(nullif(regexp_replace(coalesce(f ->> 'persons_rescued', ''), '[^0-9]', '', 'g'), '')::int, 0)),
    nullif(trim(f ->> 'rescue_location'), ''), nullif(trim(f ->> 'rescue_condition'), ''),
    v_vent is not null and v_vent <> 'None', case when v_vent = 'None' then null else v_vent end,
    coalesce(f ->> 'salvage_overhaul', '') in ('true', 'Yes'),
    v_hazmat is not null, v_hazmat,
    coalesce(f ->> 'medical_aid_provided', '') in ('true', 'Yes'), nullif(trim(f ->> 'medical_aid_description'), ''),
    coalesce(f ->> 'utilities_secured', '') in ('true', 'Yes'), nullif(trim(f ->> 'utility_details'), ''),
    nullif(trim(f ->> 'point_of_origin_room'), ''), nullif(trim(f ->> 'point_of_origin_object'), ''),
    nullif(trim(f ->> 'ignition_source'), ''), v_cause,
    coalesce(f ->> 'fire_investigation_conducted', '') in ('true', 'Yes'), nullif(trim(f ->> 'fire_investigation_reason'), ''),
    nullif(trim(f ->> 'property_type'), ''), nullif(trim(f ->> 'property_owner'), ''), nullif(trim(f ->> 'property_contact'), ''),
    least(1e12, greatest(0, coalesce(nullif(regexp_replace(coalesce(f ->> 'property_value', ''), '[^0-9.]', '', 'g'), '')::numeric, 0))),
    least(1e12, greatest(0, coalesce(nullif(regexp_replace(coalesce(f ->> 'damage_estimate', ''), '[^0-9.]', '', 'g'), '')::numeric, 0))),
    v_photos > 0, case when v_photos = 0 then nullif(trim(f ->> 'no_photo_reason'), '') end,
    least(1000, coalesce(nullif(regexp_replace(coalesce(f ->> 'civilian_injuries', ''), '[^0-9]', '', 'g'), '')::int, 0)),
    nullif(trim(f ->> 'civilian_injury_details'), ''),
    least(1000, coalesce(nullif(regexp_replace(coalesce(f ->> 'civilian_fatalities', ''), '[^0-9]', '', 'g'), '')::int, 0)),
    nullif(trim(f ->> 'civilian_fatality_details'), ''),
    least(1000, coalesce(nullif(regexp_replace(coalesce(f ->> 'firefighter_injuries', ''), '[^0-9]', '', 'g'), '')::int, 0)),
    nullif(trim(f ->> 'firefighter_injury_details'), ''),
    least(1000, coalesce(nullif(regexp_replace(coalesce(f ->> 'firefighter_fatalities', ''), '[^0-9]', '', 'g'), '')::int, 0)),
    nullif(trim(f ->> 'firefighter_fatality_details'), ''),
    coalesce(f ->> 'treatment_provided', '') in ('true', 'Yes'), nullif(trim(f ->> 'treatment_details'), ''),
    nullif(trim(f ->> 'other_agencies_on_scene'), ''),
    coalesce(f ->> 'mutual_aid_used', '') in ('true', 'Yes'),
    nullif(trim(f ->> 'equipment_used'), ''), nullif(trim(f ->> 'challenges_faced'), ''),
    nullif(trim(f ->> 'successes'), ''), nullif(trim(f ->> 'recommendations'), ''),
    v_officer, nullif(trim(v_person.rank), ''), nullif(trim(v_person.badge_number), ''), v_now
  ) returning * into v_report;

  -- 0073: the report finishes MetroFire's part; the call is resolved once every department has finished.
  v_incident := public.finish_department_by_report(p_incident_id, 'MetroFire', v_now);

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[REPORT] Fire report %s filed by %s', v_report.report_number, v_officer),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, 'MetroFire', auth.uid(), v_name, 'MetroFire', 'REPORT_FILED', 'incidents', v_incident.id::text,
    format('Fire report %s filed for %s (%s)', v_report.report_number, v_incident.incident_number, v_type));

  perform public.notify_incident_chain(
    v_incident, case when v_incident.status = 'Resolved' then 'resolved' else 'report_filed' end,
    format('%s: fire report filed by %s', v_incident.incident_number, v_officer),
    format('%s · %s', v_type, v_incident.location_address)
  );

  -- 0075: filed from the desk, as radioed in: on record as such.
  if v_radio is not null then perform public.note_radio_filing(p_incident_id, 'MetroFire', v_radio); end if;

  return v_report;
end $$;

create or replace function public.file_pcr(p_incident_id uuid, p_fields jsonb)
returns public.paramedic_reports
language plpgsql security definer set search_path to 'public' as $$
declare
  f            jsonb := coalesce(p_fields, '{}'::jsonb);
  v_radio      uuid;
  v_incident   public.incidents;
  v_person     public.personnel;
  v_report     public.paramedic_reports;
  v_vehicle    public.apparatus;
  v_history    uuid;
  v_vitals     uuid;
  v_int        uuid;
  v_name       text;
  v_medic      text;
  v_now        timestamptz := now();
  v_today      date := (now() at time zone 'Africa/Johannesburg')::date;
  v_mode       text := nullif(trim(coalesce(f ->> 'transport_mode', '')), '');
  v_dest       text := nullif(trim(coalesce(f ->> 'destination_hospital', '')), '');
  v_care       text := nullif(trim(coalesce(f ->> 'level_of_care', '')), '');
  v_response   text := nullif(trim(coalesce(f ->> 'patient_response', '')), '');
  v_complaint  text := nullif(trim(coalesce(f ->> 'chief_complaint', '')), '');
  v_signature  text := nullif(trim(coalesce(f ->> 'responder_signature_image_base64', '')), '');
  v_cleaning   text := f ->> 'requires_cleaning';
  v_pain       int;
  v_gcs        int;
  v_short      text;
  v_ambulance  uuid;
  v_secondary  jsonb;
  v_doctor     text := nullif(trim(coalesce(f ->> 'handover_doctor_name', '')), '');
  v_condition  text := nullif(trim(coalesce(f ->> 'handover_patient_status', '')), '');
  v_handover   boolean;
begin
  -- The EMS crew files; the receiving doctor signs on the crew's phone (0064).
  perform public.require_role('Paramedic', 'Responder', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin',
    'Dispatcher', 'ControlRoom', 'Operator', 'SystemController', 'System', 'Chief', 'FireChief', 'Captain');
  -- 0075: or the desk, filing for an EMS crew that radioed it in (radio_filer() checks).
  if public.current_silo() is distinct from 'Medical' and nullif(f ->> 'radioed_by', '') is null then
    raise exception 'Only EMS files a patient care report' using errcode = '42501';
  end if;

  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;
  -- 0073: the call as Medical sees it — its own lead, status and report.
  v_incident := public.incident_for_department(v_incident, 'Medical');

  -- Replay of a report already filed (offline retry): return it unchanged.
  if v_incident.report_filed_at is not null then
    select * into v_report from public.paramedic_reports
    where incident_id = p_incident_id and report_number is not null order by filed_at limit 1;
    if found then return v_report; end if;
    raise exception '% is already closed', v_incident.incident_number using errcode = 'P0001';
  end if;

  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text) using errcode = 'P0001';
  end if;
  -- 0075: the desk files for a crew that radioed it in; radio_filer() says who may.
  v_radio := public.radio_filer(p_incident_id, 'Medical', f, v_incident.accepted_by);
  if v_radio is null and v_incident.accepted_by is distinct from auth.uid() then
    raise exception 'Only the crew member leading % files its patient report', v_incident.incident_number using errcode = 'P0001';
  end if;
  if v_incident.status not in ('Arrived', 'On Scene', 'Transporting') then
    raise exception 'Mark yourself on scene before filing the patient report for %', v_incident.incident_number using errcode = 'P0001';
  end if;

  -- What the report must say.
  if v_complaint is null then raise exception 'Chief Complaint is required.' using errcode = 'P0001'; end if;
  if v_care is null or v_care not in ('BLS', 'ILS', 'ALS') then
    raise exception 'Care Level is required.' using errcode = 'P0001';
  end if;
  if v_response is null or v_response not in ('Improved', 'Unchanged', 'Deteriorated', 'Succumbed on Scene') then
    raise exception 'Overall Patient Response to Treatment is required.' using errcode = 'P0001';
  end if;
  if v_mode is not null and v_mode not in ('Ambulance (Ground)', 'HEMS (Airlift)', 'Private Transport') then
    raise exception 'Choose the transport mode from the list.' using errcode = 'P0001';
  end if;
  if v_mode in ('Ambulance (Ground)', 'HEMS (Airlift)') and v_dest is null then
    raise exception 'Choose the destination facility.' using errcode = 'P0001';
  end if;
  -- Taken to hospital: the hand-over of care is part of the report.
  v_handover := coalesce(v_mode in ('Ambulance (Ground)', 'HEMS (Airlift)'), false);
  if v_handover then
    if v_doctor is null then raise exception 'Receiving Doctor is required.' using errcode = 'P0001'; end if;
    if nullif(f ->> 'arrival_time', '') is null then
      raise exception 'Hospital Arrival / Handover Time is required.' using errcode = 'P0001';
    end if;
    if v_condition is null then raise exception 'Patient Status at Handover is required.' using errcode = 'P0001'; end if;
    -- 0075: nobody can sign over the radio; the record says it was radioed in.
    if v_radio is null and nullif(f ->> 'doctor_signature_image_base64', '') is null then
      raise exception 'The receiving doctor must sign.' using errcode = 'P0001';
    end if;
  end if;
  if length(coalesce(v_condition, '')) > 500 then
    raise exception 'Patient Status at Handover is too long (500 characters).' using errcode = 'P0001';
  end if;
  if (v_radio is null or v_signature is not null)
     and (v_signature is null or v_signature not like 'data:image/%' or length(v_signature) > 600000) then
    raise exception 'The lead paramedic must sign.' using errcode = 'P0001';
  end if;
  if v_cleaning is null or v_cleaning not in ('true', 'false') then
    raise exception 'Say whether the vehicle requires cleaning.' using errcode = 'P0001';
  end if;
  if coalesce(f ->> 'departure_time', '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9])?$'
     or coalesce(f ->> 'arrival_time', '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9])?$'
     or coalesce(f ->> 'medication_time', '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9])?$' then
    raise exception 'Times must be HH:MM.' using errcode = 'P0001';
  end if;
  if coalesce(f ->> 'date_of_birth', '') !~ '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$' then
    raise exception 'Date of Birth must be a date.' using errcode = 'P0001';
  end if;
  v_pain := nullif(regexp_replace(coalesce(f ->> 'pain_scale', ''), '[^0-9]', '', 'g'), '')::int;
  if v_pain is not null and (v_pain < 0 or v_pain > 10) then
    raise exception 'Pain Scale must be 0 to 10.' using errcode = 'P0001';
  end if;
  for v_short in select unnest(array['hospital_representative_signature_base64', 'doctor_signature_image_base64']) loop
    if nullif(f ->> v_short, '') is not null and ((f ->> v_short) not like 'data:image/%' or length(f ->> v_short) > 600000) then
      raise exception 'A signature could not be read. Sign again.' using errcode = 'P0001';
    end if;
  end loop;
  begin
    v_secondary := coalesce(nullif(f ->> 'secondary_patients_json', ''), '[]')::jsonb;
  exception when others then
    raise exception 'The casualties list could not be read. Check it and file again.' using errcode = 'P0001';
  end;
  if jsonb_typeof(v_secondary) <> 'array' or jsonb_array_length(v_secondary) > 50 then
    raise exception 'The casualties list could not be read. Check it and file again.' using errcode = 'P0001';
  end if;

  -- 0075: the member who radioed it in, when the desk files.
  select * into v_person from public.personnel
  where user_id = coalesce(v_radio, auth.uid()) and tenant_id = public.current_tenant();
  select full_name into v_name from public.profiles where id = auth.uid();
  v_medic := coalesce(nullif(trim(concat_ws(' ', v_person.first_name, v_person.last_name)), ''), v_name, 'Paramedic');
  v_ambulance := coalesce(v_person.assigned_apparatus_id, v_incident.unit_id);
  v_gcs := nullif(regexp_replace(coalesce(f ->> 'gcs_eye', ''), '\D.*$', ''), '')::int
         + nullif(regexp_replace(coalesce(f ->> 'gcs_verbal', ''), '\D.*$', ''), '')::int
         + nullif(regexp_replace(coalesce(f ->> 'gcs_motor', ''), '\D.*$', ''), '')::int;

  insert into public.medical_histories (tenant_id, silo, patient_id, allergies, chronic_conditions, medications)
  values (v_incident.tenant_id, 'Medical', nullif(trim(f ->> 'identification_number'), ''),
    nullif(trim(f ->> 'allergies'), ''), nullif(trim(f ->> 'medical_history'), ''), nullif(trim(f ->> 'current_medications'), ''))
  returning id into v_history;

  insert into public.vital_signs (tenant_id, silo, blood_pressure, pulse_rate, respiratory_rate, oxygen_saturation,
    glasgow_coma_scale, blood_glucose_level, temperature)
  values (v_incident.tenant_id, 'Medical', nullif(trim(f ->> 'blood_pressure'), ''), nullif(trim(f ->> 'pulse_rate'), ''),
    nullif(trim(f ->> 'respiratory_rate'), ''), nullif(trim(f ->> 'oxygen_saturation'), ''),
    v_gcs::text, nullif(trim(f ->> 'blood_glucose_level'), ''), nullif(trim(f ->> 'body_temperature'), ''))
  returning id into v_vitals;

  insert into public.interventions (tenant_id, silo, airway_management, circulation_management, medication_admin)
  values (v_incident.tenant_id, 'Medical', nullif(trim(f ->> 'airway_management'), ''),
    nullif(trim(f ->> 'circulation_management'), ''), nullif(trim(f ->> 'medication_admin'), ''))
  returning id into v_int;

  insert into public.paramedic_reports (
    tenant_id, silo, incident_id, report_number, filed_by, filed_at, ambulance_id, total_response_seconds,
    patient_name, identification_number, date_of_birth, age, gender, weight, language, address, contact_number,
    next_of_kin, income, has_insurance, insurance_information, allergies,
    medical_history_id, vitals_id, interventions_id,
    incident_location, time_of_arrival, departure_time, scene_assessment, mechanism_of_injury,
    transport_mode, destination_hospital, level_of_care,
    paramedic_names, paramedic_ids, arrival_time,
    chief_complaint, nature_of_illness, presenting_problem, treatment_narrative,
    current_medications, risk_of_harm, patient_response, protocol_adherence,
    psych_danger_to_self_or_others, psych_health_risk, psych_believes_health_risk, psych_believes_danger,
    pulse_waveform, body_temperature, end_tidal_co2, level_of_consciousness, alert_and_oriented,
    gcs_eye, gcs_verbal, gcs_motor, stroke_assessment, pain_scale, pupils,
    skin_unremarkable, skin_cool, skin_pale, skin_diaphoretic, skin_cyanotic, skin_moist, skin_flush, skin_dry,
    medication_time, medication_dosage, medication_route, medication_comments,
    inv_oxygen, inv_bvm, inv_suction, inv_iv, inv_bandages, inv_aed, inv_drugs, inv_sharps, inv_ppe,
    responder_signature_image_base64, hospital_representative_signature_base64, doctor_signature_image_base64,
    requires_cleaning, secondary_patients_json, handover_doctor_name, handover_patient_status
  ) values (
    v_incident.tenant_id, 'Medical', v_incident.id, 'PCR-' || v_incident.incident_number, auth.uid(), v_now, v_ambulance,
    -- V4's total response time: from dispatch (or logging) to the report.
    greatest(0, extract(epoch from (v_now - coalesce(v_incident.dispatch_time, v_incident.incident_created_at))))::bigint,
    nullif(trim(f ->> 'patient_name'), ''), nullif(trim(f ->> 'identification_number'), ''),
    nullif(f ->> 'date_of_birth', '')::date,
    least(150, nullif(regexp_replace(coalesce(f ->> 'age', ''), '[^0-9]', '', 'g'), '')::int),
    nullif(trim(f ->> 'gender'), ''), nullif(trim(f ->> 'weight'), ''), nullif(trim(f ->> 'language'), ''),
    nullif(trim(f ->> 'address'), ''), nullif(trim(f ->> 'contact_number'), ''), nullif(trim(f ->> 'next_of_kin'), ''),
    nullif(trim(f ->> 'income'), ''), case when f ->> 'has_insurance' = 'Yes' then 'yes' else 'no' end,
    case when f ->> 'has_insurance' = 'Yes' then nullif(trim(f ->> 'insurance_information'), '') end,
    nullif(trim(f ->> 'allergies'), ''),
    v_history, v_vitals, v_int,
    coalesce(nullif(trim(f ->> 'incident_location'), ''), v_incident.location_address),
    v_incident.arrived_timestamp,
    case when nullif(f ->> 'departure_time', '') is not null
         then ((v_today + (f ->> 'departure_time')::time) at time zone 'Africa/Johannesburg') end,
    nullif(trim(f ->> 'scene_assessment'), ''), nullif(trim(f ->> 'mechanism_of_injury'), ''),
    v_mode, v_dest, v_care,
    coalesce(nullif(trim(f ->> 'paramedic_names'), ''), v_medic), nullif(trim(f ->> 'paramedic_ids'), ''),
    case when nullif(f ->> 'arrival_time', '') is not null
         then ((v_today + (f ->> 'arrival_time')::time) at time zone 'Africa/Johannesburg') end,
    v_complaint, nullif(trim(f ->> 'nature_of_illness'), ''), nullif(trim(f ->> 'presenting_problem'), ''),
    nullif(trim(f ->> 'treatment_narrative'), ''),
    nullif(trim(f ->> 'current_medications'), ''), nullif(trim(f ->> 'risk_of_harm'), ''), v_response,
    coalesce(f ->> 'protocol_adherence', '') = 'true',
    coalesce(f ->> 'psych_danger_to_self_or_others', '') = 'true', coalesce(f ->> 'psych_health_risk', '') = 'true',
    coalesce(f ->> 'psych_believes_health_risk', '') = 'true', coalesce(f ->> 'psych_believes_danger', '') = 'true',
    nullif(trim(f ->> 'pulse_waveform'), ''), nullif(trim(f ->> 'body_temperature'), ''), nullif(trim(f ->> 'end_tidal_co2'), ''),
    nullif(trim(f ->> 'level_of_consciousness'), ''), nullif(trim(f ->> 'alert_and_oriented'), ''),
    nullif(trim(f ->> 'gcs_eye'), ''), nullif(trim(f ->> 'gcs_verbal'), ''), nullif(trim(f ->> 'gcs_motor'), ''),
    nullif(trim(f ->> 'stroke_assessment'), ''), v_pain, nullif(trim(f ->> 'pupils'), ''),
    coalesce(f ->> 'skin_unremarkable', '') = 'true', coalesce(f ->> 'skin_cool', '') = 'true',
    coalesce(f ->> 'skin_pale', '') = 'true', coalesce(f ->> 'skin_diaphoretic', '') = 'true',
    coalesce(f ->> 'skin_cyanotic', '') = 'true', coalesce(f ->> 'skin_moist', '') = 'true',
    coalesce(f ->> 'skin_flush', '') = 'true', coalesce(f ->> 'skin_dry', '') = 'true',
    nullif(f ->> 'medication_time', '')::time, nullif(trim(f ->> 'medication_dosage'), ''),
    nullif(trim(f ->> 'medication_route'), ''), nullif(trim(f ->> 'medication_comments'), ''),
    coalesce(f ->> 'inv_oxygen', '') = 'true', coalesce(f ->> 'inv_bvm', '') = 'true', coalesce(f ->> 'inv_suction', '') = 'true',
    coalesce(f ->> 'inv_iv', '') = 'true', coalesce(f ->> 'inv_bandages', '') = 'true', coalesce(f ->> 'inv_aed', '') = 'true',
    coalesce(f ->> 'inv_drugs', '') = 'true', coalesce(f ->> 'inv_sharps', '') = 'true', coalesce(f ->> 'inv_ppe', '') = 'true',
    v_signature, nullif(f ->> 'hospital_representative_signature_base64', ''), nullif(f ->> 'doctor_signature_image_base64', ''),
    v_cleaning = 'true', v_secondary,
    case when v_handover then v_doctor end, case when v_handover then v_condition end
  ) returning * into v_report;

  update public.incidents
     set responding_officer = coalesce(responding_officer, v_report.paramedic_names)
   where id = p_incident_id;
  -- 0073: the report finishes Medical's part; the call is resolved once every department has finished.
  v_incident := public.finish_department_by_report(p_incident_id, 'Medical', v_now);

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[REPORT] Patient care report %s filed by %s%s', v_report.report_number, v_medic,
      case when v_handover then format(' · patient handed over to %s at %s, %s', v_doctor, v_dest,
             to_char(v_report.arrival_time at time zone 'Africa/Johannesburg', 'HH24:MI'))
           when v_dest is not null then ' · patient to ' || v_dest else '' end),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, 'Medical', auth.uid(), v_name, 'Medical', 'REPORT_FILED', 'incidents', v_incident.id::text,
    format('Patient care report %s filed for %s (%s, %s)', v_report.report_number,
      v_incident.incident_number, v_care, v_response));

  perform public.notify_incident_chain(
    v_incident, case when v_incident.status = 'Resolved' then 'resolved' else 'report_filed' end,
    format('%s: patient report filed by %s', v_incident.incident_number, v_medic),
    format('%s · %s', v_complaint, coalesce(v_dest, v_incident.location_address))
  );

  -- After the call: the ambulance.
  if v_ambulance is not null then
    select * into v_vehicle from public.apparatus where id = v_ambulance and tenant_id = v_incident.tenant_id;
  end if;
  if v_vehicle.id is not null and v_cleaning = 'true' then
    update public.apparatus set status = 'Out of Service',
      status_note = format('Off road for cleaning (%s)', v_report.report_number),
      status_changed_at = v_now, status_changed_by_name = v_medic
     where id = v_vehicle.id;
    update public.personnel set assigned_apparatus_id = null, is_on_duty = false
     where assigned_apparatus_id = v_vehicle.id and tenant_id = v_incident.tenant_id;
    perform public.notify_command(v_incident.tenant_id, 'Medical',
      'Ambulance off road for cleaning: ' || v_vehicle.unit_number,
      format('After %s. Reported by %s.', v_incident.incident_number, v_medic), 'High', '/shift/today');
  end if;
  if v_vehicle.id is not null then
    v_short := concat_ws(', ',
      case when not v_report.inv_oxygen then 'oxygen' end,
      case when not v_report.inv_bvm then 'BVM / masks' end,
      case when not v_report.inv_suction then 'suction unit' end,
      case when not v_report.inv_iv then 'IV fluids & sets' end,
      case when not v_report.inv_bandages then 'bandages' end,
      case when not v_report.inv_aed then 'AED pads' end,
      case when not v_report.inv_drugs then 'drug box' end,
      case when not v_report.inv_sharps then 'sharps container' end,
      case when not v_report.inv_ppe then 'gloves & PPE' end);
    if nullif(v_short, '') is not null then
      perform public.notify_command(v_incident.tenant_id, 'Medical',
        'Ambulance stock short: ' || v_vehicle.unit_number,
        format('After %s: %s. Reported by %s.', v_incident.incident_number, v_short, v_medic), 'Medium', '/medical');
    end if;
  end if;

  -- 0075: filed from the desk, as radioed in: on record as such.
  if v_radio is not null then perform public.note_radio_filing(p_incident_id, 'Medical', v_radio); end if;

  return v_report;
end $$;

create or replace function public.file_post_mortem(p_incident_id uuid, p_fields jsonb)
returns public.post_mortem_reports
language plpgsql security definer set search_path to 'public' as $$
declare
  f          jsonb := coalesce(p_fields, '{}'::jsonb);
  v_radio    uuid;
  v_incident public.incidents;
  v_person   public.personnel;
  v_report   public.post_mortem_reports;
  v_name     text;
  v_officer  text := nullif(trim(coalesce(f ->> 'reporting_officer', '')), '');
  v_cause    text := nullif(trim(coalesce(f ->> 'root_cause', '')), '');
  v_lessons  text := nullif(trim(coalesce(f ->> 'lessons_learned', '')), '');
  v_start    timestamptz;
  v_end      timestamptz;
  v_command  boolean := public.role_in('Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin');
  v_count    text;
  v_timeline jsonb;
  v_now      timestamptz := now();
begin
  perform public.require_role('Disaster', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin',
    'Dispatcher', 'ControlRoom', 'Operator', 'SystemController', 'System', 'Chief', 'FireChief', 'Captain');
  -- 0075: or the desk, filing for a Disaster officer who radioed it in (radio_filer() checks).
  if public.current_silo() is distinct from 'EthekwiniDisaster' and nullif(f ->> 'radioed_by', '') is null then
    raise exception 'Only Disaster Management files a post-mortem' using errcode = '42501';
  end if;

  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;
  -- 0073: the call as EthekwiniDisaster sees it — its own lead, status and report.
  v_incident := public.incident_for_department(v_incident, 'EthekwiniDisaster');
  if not (v_incident.silo = 'EthekwiniDisaster' or 'EthekwiniDisaster' = any(coalesce(v_incident.dispatched_silos, '{}'))) then
    raise exception '% is not a Disaster Management incident', v_incident.incident_number using errcode = 'P0001';
  end if;

  -- Replay of a report already filed (offline retry): return it unchanged.
  if v_incident.report_filed_at is not null then
    select * into v_report from public.post_mortem_reports
    where incident_id = p_incident_id and report_number is not null order by report_filed_at limit 1;
    if found then return v_report; end if;
    raise exception '% is already closed', v_incident.incident_number using errcode = 'P0001';
  end if;
  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text) using errcode = 'P0001';
  end if;

  -- The officer leading the incident files from the scene; command may close
  -- out a deployed incident from the console, as V4's desk did.
  -- 0075: the desk files for a crew that radioed it in; radio_filer() says who may.
  v_radio := public.radio_filer(p_incident_id, 'EthekwiniDisaster', f, v_incident.accepted_by);
  if v_command and v_radio is null then
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

  -- What the report must say (V4's After-Action Report).
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
  foreach v_count in array array['injuries', 'fatalities', 'displaced_people'] loop
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

  -- 0075: the member who radioed it in, when the desk files.
  select * into v_person from public.personnel
  where user_id = coalesce(v_radio, auth.uid()) and tenant_id = public.current_tenant();
  select full_name into v_name from public.profiles where id = auth.uid();

  -- V4's timeline snapshot: the incident's own history and the deployment's
  -- periodic updates, oldest first.
  select coalesce(jsonb_agg(e order by e ->> 'timestamp'), '[]'::jsonb) into v_timeline from (
    select jsonb_build_object('timestamp', to_char(u.timestamp at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI'),
                              'text', u.message) as e
      from public.incident_updates u where u.incident_id = p_incident_id
    union all
    -- Console updates carry an ISO instant; V4's carried SA wall-clock text.
    select jsonb_build_object('timestamp',
             case when coalesce(x ->> 'timestamp', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                  then to_char((x ->> 'timestamp')::timestamptz at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI')
                  else coalesce(x ->> 'timestamp', '') end,
             'text', coalesce(x ->> 'text', ''))
      from public.disaster_logs d, jsonb_array_elements(coalesce(d.updates, '[]'::jsonb)) x
     where d.incident_id = p_incident_id
  ) s;

  insert into public.post_mortem_reports (
    tenant_id, silo, incident_id, incident_number, report_number, filed_by,
    incident_type, location, start_time, end_time, total_duration_hours,
    injuries, fatalities, displaced_people, root_cause, lessons_learned,
    timeline_snapshot, reporting_officer, report_filed_at
  ) values (
    v_incident.tenant_id, 'EthekwiniDisaster', v_incident.id, v_incident.incident_number,
    'PM-' || v_incident.incident_number, auth.uid(),
    coalesce(nullif(trim(coalesce(v_incident.disaster_type, '')), ''), v_incident.incident_type),
    v_incident.location_address, v_start, v_end,
    round((extract(epoch from (v_end - v_start)) / 3600)::numeric, 2),
    (f ->> 'injuries')::int, (f ->> 'fatalities')::int, (f ->> 'displaced_people')::int,
    v_cause, v_lessons, v_timeline, v_officer, v_now
  ) returning * into v_report;

  -- 0073: the report finishes EthekwiniDisaster's part; the call is resolved once every department has finished.
  v_incident := public.finish_department_by_report(p_incident_id, 'EthekwiniDisaster', v_now);

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[REPORT] Post-mortem %s filed by %s (%s injured, %s fatalities, %s displaced)',
      v_report.report_number, v_officer, v_report.injuries, v_report.fatalities, v_report.displaced_people),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'REPORT_FILED', 'incidents',
    v_incident.id::text, format('Post-mortem %s filed for %s', v_report.report_number, v_incident.incident_number));

  perform public.notify_incident_chain(
    v_incident, case when v_incident.status = 'Resolved' then 'resolved' else 'report_filed' end,
    format('%s: post-mortem filed by %s', v_incident.incident_number, v_officer),
    format('%s · %s displaced', v_report.incident_type, v_report.displaced_people)
  );

  -- 0075: filed from the desk, as radioed in: on record as such.
  if v_radio is not null then perform public.note_radio_filing(p_incident_id, 'EthekwiniDisaster', v_radio); end if;

  return v_report;
end $$;


-- ── 4. Closing on scene from the desk ───────────────────────────────────────

-- As close_department_part() (0074), for whoever directs the department:
-- a crew on the radio cannot press Close, and a crew that forgot to can be
-- closed for. The record says it was closed from the desk.
create or replace function public.close_department_part_from_desk(
  p_incident_id uuid,
  p_silo        public.silo,
  p_note        text default null
)
returns public.incident_departments language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_dept     public.incident_departments;
  v_label    text := public.department_label(p_silo);
  v_name     text;
  v_note     text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
  v_waiting  text;
  v_title    text;
  v_body     text;
begin
  perform public.require_role('Dispatcher', 'ControlRoom', 'Operator', 'SystemController', 'System', 'Supervisor',
                              'Captain', 'Chief', 'FireChief', 'Admin', 'SystemAdmin', 'SuperAdmin');

  select * into v_incident from public.incidents
   where id = p_incident_id and tenant_id = public.current_tenant()
   for update;
  if not found or not public.can_work_incident(p_incident_id) then
    raise exception 'Incident not found' using errcode = 'P0002';
  end if;
  if not public.can_direct_department(p_silo) then
    raise exception 'Only % dispatch or command, or the control room, closes it for the crew', v_label using errcode = '42501';
  end if;

  select * into v_dept from public.incident_departments
   where incident_id = p_incident_id and silo = p_silo
   for update;
  if not found then
    raise exception 'The call was not sent to %', v_label using errcode = 'P0002';
  end if;
  if v_dept.closed_at is not null or v_incident.status = 'Closed' then
    return v_dept;
  end if;
  if v_dept.status <> 'Resolved' or v_dept.report_filed_at is null then
    raise exception 'File the % report on % before you close it', v_label, v_incident.incident_number;
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  update public.incident_departments
     set closed_at = now(), closed_by = auth.uid(), closed_by_name = v_name, close_note = v_note, updated_at = now()
   where id = v_dept.id
  returning * into v_dept;

  select string_agg(public.department_label(d.silo), ', ' order by d.silo) into v_waiting
    from public.incident_departments d
   where d.incident_id = p_incident_id and d.id <> v_dept.id
     and (public.department_open(d.status) or (d.status = 'Resolved' and d.closed_at is null));

  update public.incidents set updated_at = now() where id = p_incident_id
  returning * into v_incident;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[CLOSED ON SCENE] %s closed from the desk by %s.%s %s',
      v_label, coalesce(v_name, 'the desk'), coalesce(' ' || v_note, ''),
      case when v_waiting is not null then format('Waiting on %s.', v_waiting)
           when v_incident.status = 'Resolved' then 'Every department has closed. Ready for case review.'
           else 'Every department has closed.' end),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, v_incident.silo, auth.uid(), v_name, p_silo::text, 'DEPARTMENT_CLOSED', 'incidents',
    v_incident.id::text,
    format('%s closed %s for %s from the desk%s', coalesce(v_name, 'The desk'), v_incident.incident_number, v_label,
      coalesce(': ' || v_note, '')));

  v_title := case when v_waiting is not null
                  then format('%s: %s closed from the desk by %s. Waiting on %s', v_incident.incident_number, v_label, coalesce(v_name, 'the desk'), v_waiting)
                  else format('%s: closed by every department', v_incident.incident_number) end;
  v_body := format('%s · %s%s', v_incident.incident_type, v_incident.location_address, coalesce(' · ' || v_note, ''));

  perform public.notify_incident_chain(v_incident, 'officer_closed', v_title, v_body);
  insert into public.alerts (
    tenant_id, silo, target_user_id, kind, severity, title, body, incident_id, link,
    presentation, requires_ack, created_by, created_by_name
  )
  select v_incident.tenant_id, p.silo, p.id, 'officer_closed', v_incident.incident_severity::text,
         v_title, v_body, v_incident.id, format('/incidents/%s', v_incident.id),
         'toast', false, auth.uid(), v_name
    from public.profiles p
   where p.tenant_id = v_incident.tenant_id
     and p.deactivated_at is null
     and p.id is distinct from auth.uid()
     and p.id is distinct from v_incident.dispatched_by_id
     and p.id in (select d.dispatched_by from public.incident_departments d
                   where d.incident_id = p_incident_id and d.dispatched_by is not null);

  return v_dept;
end $$;

revoke all on function public.close_department_part_from_desk(uuid, public.silo, text) from public, anon;
grant execute on function public.close_department_part_from_desk(uuid, public.silo, text) to authenticated;

-- ── 5. Prove it ─────────────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'incident_departments' and column_name = 'radioed_by') then
    raise exception '0075: incident_departments.radioed_by is missing';
  end if;
  -- The helpers are the report functions' own: nobody calls them directly.
  if has_function_privilege('authenticated', 'public.radio_filer(uuid, public.silo, jsonb, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.note_radio_filing(uuid, public.silo, uuid)', 'EXECUTE') then
    raise exception '0075: the radio helpers are callable directly';
  end if;
  if has_function_privilege('anon', 'public.close_department_part_from_desk(uuid, public.silo, text)', 'EXECUTE') then
    raise exception '0075: anon can close incidents';
  end if;
  -- One signature each: an extra overload would make PostgREST resolve calls to neither.
  foreach f in array array['file_incident_report', 'file_fire_report', 'file_pcr', 'file_post_mortem', 'close_department_part_from_desk'] loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = f) <> 1 then
      raise exception '0075: % has more than one signature', f;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
