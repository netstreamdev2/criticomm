-- ============================================================================
-- 0065 — Disaster Management: start of shift and the post-mortem
-- ============================================================================
--
-- Run after 0064.
--
-- The Disaster Management officer's side, as V4 had it and as tight as the
-- other departments:
--
--   1. Start of shift is the readiness assessment alone (V4's StartDuty for
--      Disaster: "STEP 1 OF 2", then on duty). No vehicle inspection; the gate
--      no longer asks a Disaster officer for a 187(c) sheet.
--   2. file_post_mortem(): V4's Official After-Action Report (Incident
--      Overview, Impact Metrics, Operational Analysis) closes the incident.
--      The officer leading it files from the scene; command may close out a
--      deployed incident from the console. It is linked to the incident,
--      takes V4's timeline snapshot (the incident history and the deployment
--      updates), resolves the incident, writes the timeline and audit trail
--      and tells dispatch and command. A replay returns the report filed.
--   3. A Disaster incident is resolved by its post-mortem, never by a bare
--      status from a Disaster officer.
--   4. Who reads a post-mortem: Disaster and the tenant-wide tier as before,
--      plus everyone who worked the incident and case managers. It is never
--      deleted, keeps its link, and locks when the case is closed. 0002's
--      write rules checked the role only on changes; new records too now.
--
-- Safe to re-run.
-- ============================================================================

begin;

alter table public.post_mortem_reports
  add column if not exists report_number text,
  add column if not exists filed_by      uuid references auth.users(id);
create unique index if not exists post_mortem_incident_once
  on public.post_mortem_reports (incident_id) where incident_id is not null and report_number is not null;

-- ── 1. Start of shift: readiness only for Disaster ──────────────────────────
-- 0062's gate, with the Disaster branch added; every other branch unchanged.

create or replace function public.shift_vehicle_passed_today() returns boolean
language sql stable security definer set search_path = public as $$
  -- Disaster Management: readiness only, as V4 (STEP 1 OF 2); no vehicle form.
  select case when public.current_silo() = 'EthekwiniDisaster' then true
  when public.current_silo() = 'MetroFire' then exists (
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

-- ── 2. File the post-mortem — the Disaster officer's close-out ──────────────

create or replace function public.file_post_mortem(p_incident_id uuid, p_fields jsonb)
returns public.post_mortem_reports
language plpgsql security definer set search_path to 'public' as $$
declare
  f          jsonb := coalesce(p_fields, '{}'::jsonb);
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
  perform public.require_role('Disaster', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin');
  if public.current_silo() is distinct from 'EthekwiniDisaster' then
    raise exception 'Only Disaster Management files a post-mortem' using errcode = '42501';
  end if;

  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;
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
  if v_command then
    if v_incident.status not in ('Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting', 'Active') then
      raise exception 'Deploy resources to % before filing its post-mortem', v_incident.incident_number using errcode = 'P0001';
    end if;
  else
    if v_incident.accepted_by is distinct from auth.uid() then
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

  select * into v_person from public.personnel
  where user_id = auth.uid() and tenant_id = public.current_tenant();
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
    format('[REPORT] Post-mortem %s filed by %s — incident resolved (%s injured, %s fatalities, %s displaced)',
      v_report.report_number, v_officer, v_report.injuries, v_report.fatalities, v_report.displaced_people),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'REPORT_FILED', 'incidents',
    v_incident.id::text, format('Post-mortem %s filed for %s; incident resolved', v_report.report_number, v_incident.incident_number));

  perform public.notify_incident_chain(
    v_incident, 'resolved',
    format('%s resolved — post-mortem filed by %s', v_incident.incident_number, v_officer),
    format('%s · %s displaced', v_report.incident_type, v_report.displaced_people)
  );

  return v_report;
end $$;

revoke execute on function public.file_post_mortem(uuid, jsonb) from public, anon;
grant  execute on function public.file_post_mortem(uuid, jsonb) to authenticated;

-- ── 3. A Disaster incident is resolved by its post-mortem ───────────────────

create or replace function public.guard_disaster_resolution() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.status in ('Resolved', 'Closed')
     and old.status not in ('Resolved', 'Closed')
     and new.report_filed_at is null
     and (new.silo = 'EthekwiniDisaster' or 'EthekwiniDisaster' = any(coalesce(new.dispatched_silos, '{}')))
     and public.role_in('Disaster') then
    raise exception 'File the post-mortem to close %', new.incident_number using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists guard_disaster_resolution on public.incidents;
create trigger guard_disaster_resolution before update of status on public.incidents
  for each row execute function public.guard_disaster_resolution();

-- ── 4. Who reads and writes Disaster records ────────────────────────────────

drop policy if exists post_mortem_worked_read on public.post_mortem_reports;
create policy post_mortem_worked_read on public.post_mortem_reports for select to authenticated
  using (incident_id is not null and public.can_work_incident(incident_id));
drop policy if exists post_mortem_case_read on public.post_mortem_reports;
create policy post_mortem_case_read on public.post_mortem_reports for select to authenticated
  using (public.role_in('CaseManager', 'SystemController'));

-- Post-mortems are filed through file_post_mortem() only; Disaster
-- Management may correct one until its case is closed.
drop policy if exists post_mortem_write on public.post_mortem_reports;
drop policy if exists post_mortem_update on public.post_mortem_reports;
create policy post_mortem_update on public.post_mortem_reports for update to authenticated
  using (silo = public.current_silo() and public.role_in('Disaster', 'Supervisor', 'SystemAdmin', 'SuperAdmin', 'Admin'))
  with check (silo = public.current_silo() and public.role_in('Disaster', 'Supervisor', 'SystemAdmin', 'SuperAdmin', 'Admin'));

-- 0002 checked the role only on changes; new deployment logs are checked too.
drop policy if exists disaster_logs_write on public.disaster_logs;
create policy disaster_logs_write on public.disaster_logs for all
  using (silo = public.current_silo() and public.role_in('Disaster', 'Supervisor', 'SystemAdmin', 'SuperAdmin', 'Admin', 'IncidentLogger'))
  with check (silo = public.current_silo() and public.role_in('Disaster', 'Supervisor', 'SystemAdmin', 'SuperAdmin', 'Admin', 'IncidentLogger'));

create or replace function public.guard_post_mortem_record() returns trigger
language plpgsql set search_path to 'public' as $$
declare
  v_status incident_status;
begin
  if old.incident_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A post-mortem filed against an incident cannot be deleted.' using errcode = 'P0001';
  end if;
  if new.incident_id is distinct from old.incident_id or new.report_number is distinct from old.report_number
     or new.filed_by is distinct from old.filed_by or new.report_filed_at is distinct from old.report_filed_at
     or new.incident_number is distinct from old.incident_number then
    raise exception 'A filed post-mortem keeps its incident and filing record.' using errcode = 'P0001';
  end if;
  select status into v_status from public.incidents where id = old.incident_id;
  if v_status = 'Closed' then
    raise exception 'The case is closed; its post-mortem can no longer be changed.' using errcode = 'P0001';
  end if;
  -- The duration follows the times.
  if new.start_time is not null and new.end_time is not null then
    if new.end_time < new.start_time then
      raise exception 'Resolved Time cannot be before Start Time.' using errcode = 'P0001';
    end if;
    new.total_duration_hours := round((extract(epoch from (new.end_time - new.start_time)) / 3600)::numeric, 2);
  end if;
  return new;
end $$;

drop trigger if exists guard_post_mortem_record on public.post_mortem_reports;
create trigger guard_post_mortem_record before update or delete on public.post_mortem_reports
  for each row execute function public.guard_post_mortem_record();

commit;

notify pgrst, 'reload schema';
