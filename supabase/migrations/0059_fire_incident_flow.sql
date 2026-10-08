-- ============================================================================
-- 0059 — Fire & Rescue: an incident is closed by its fire report
-- ============================================================================
--
-- Run after 0058.
--
-- The firefighter's side of an incident, made as tight as the police one
-- (0039, 0042):
--
--   1. file_fire_report(): the lead firefighter files the fire incident report
--      from the phone (Incident details, Response timeline, Narrative,
--      Conditions, Actions & rescue, Support operations, Origin & cause,
--      Property & damage, Casualties, Debrief). It lands on the existing
--      firefighter_reports register, linked to the incident, and in the same
--      transaction resolves the incident, writes the timeline and audit trail,
--      and tells dispatch and command. A replay from the phone's outbox after
--      a dead zone returns the report already filed.
--   2. A Fire incident is resolved by its report, never by a bare status from
--      the field, as police calls already are.
--   3. Who reads a fire report: the department and the tenant-wide tier as
--      before, plus everyone who worked the incident and case managers.
--   4. A report filed against an incident is a permanent record: it is never
--      edited or deleted.
--
-- Safe to re-run.
-- ============================================================================

begin;

-- ── 1. File the fire report — the firefighter's close-out ───────────────────

create or replace function public.file_fire_report(p_incident_id uuid, p_fields jsonb)
returns public.firefighter_reports
language plpgsql security definer set search_path to 'public' as $$
declare
  f          jsonb := coalesce(p_fields, '{}'::jsonb);
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
  perform public.require_role('Firefighter', 'FireChief', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin');

  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;

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
  if v_incident.accepted_by is distinct from auth.uid() then
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

  select * into v_person from public.personnel
  where user_id = auth.uid() and tenant_id = public.current_tenant();
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

  update public.incidents
     set status          = 'Resolved',
         unit_status     = 'Resolved',
         resolved_at     = v_now,
         resolved_by     = auth.uid(),
         report_filed_at = v_now,
         updated_at      = v_now
   where id = p_incident_id
  returning * into v_incident;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[REPORT] Fire report %s filed by %s — incident resolved', v_report.report_number, v_officer),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, 'MetroFire', auth.uid(), v_name, 'MetroFire', 'REPORT_FILED', 'incidents', v_incident.id::text,
    format('Fire report %s filed for %s (%s); incident resolved', v_report.report_number, v_incident.incident_number, v_type));

  perform public.notify_incident_chain(
    v_incident, 'resolved',
    format('%s resolved — fire report filed by %s', v_incident.incident_number, v_officer),
    format('%s · %s', v_type, v_incident.location_address)
  );

  return v_report;
end $$;

revoke execute on function public.file_fire_report(uuid, jsonb) from public, anon;
grant  execute on function public.file_fire_report(uuid, jsonb) to authenticated;

-- ── 2. A Fire incident is resolved by its report ────────────────────────────

-- update_responder_status() already refuses this for police calls; the same
-- rule for Fire, held at the table so no path around it exists from the field.
create or replace function public.guard_fire_resolution() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.status in ('Resolved', 'Closed')
     and old.status not in ('Resolved', 'Closed')
     and new.report_filed_at is null
     and (new.silo = 'MetroFire' or 'MetroFire' = any(coalesce(new.dispatched_silos, '{}')))
     and public.role_in('Firefighter') then
    raise exception 'File the fire report to close %', new.incident_number using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists guard_fire_resolution on public.incidents;
create trigger guard_fire_resolution before update of status on public.incidents
  for each row execute function public.guard_fire_resolution();

-- ── 3. Who reads a fire report ──────────────────────────────────────────────

drop policy if exists fire_reports_worked_read on public.firefighter_reports;
create policy fire_reports_worked_read on public.firefighter_reports for select to authenticated
  using (incident_id is not null and public.can_work_incident(incident_id));

drop policy if exists fire_reports_case_read on public.firefighter_reports;
create policy fire_reports_case_read on public.firefighter_reports for select to authenticated
  using (public.role_in('CaseManager', 'SystemController'));

-- ── 4. A filed report is permanent ──────────────────────────────────────────

create or replace function public.guard_fire_report_record() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if old.incident_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A fire report filed against an incident is a permanent record and cannot be deleted.'
      using errcode = 'P0001';
  end if;
  -- Only a supervisor's review stamp may be added afterwards.
  if (to_jsonb(new) - array['supervisor_name', 'supervisor_rank', 'supervisor_review_date'])
     is distinct from (to_jsonb(old) - array['supervisor_name', 'supervisor_rank', 'supervisor_review_date']) then
    raise exception 'A filed fire report cannot be edited.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists guard_fire_report_record on public.firefighter_reports;
create trigger guard_fire_report_record before update or delete on public.firefighter_reports
  for each row execute function public.guard_fire_report_record();

commit;
