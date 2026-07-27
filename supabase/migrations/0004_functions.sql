-- =====================================================================
-- Criticom V5 — RPC functions (SECURITY DEFINER)
-- All multi-step workflows live here so web + mobile call the same code path.
-- =====================================================================

set search_path = public;

-- ─────────────────────────────────────────────────────────────────────
-- LOG INCOMING CALL — what ControlRoomController.LogNew + IncidentWorkflowService.LogIncomingCallAsync did
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.log_incoming_call(
  p_silo                 silo,
  p_caller_name          text,
  p_caller_number        text,
  p_call_description     text,
  p_incident_type        text,
  p_incident_severity    incident_severity,
  p_location_address     text,
  p_location_lat         double precision,
  p_location_lng         double precision,
  p_suburb               text default null,
  p_city                 text default null,
  p_postal_code          text default null,
  p_fire_incident_type   text default null,
  p_medical_type         text default null,
  p_disaster_type        text default null,
  p_is_caller_patient    boolean default null,
  p_patient_name         text default null,
  p_number_of_victims    int default null,
  p_notes                text default null,
  p_source               text default 'Master'
) returns public.incidents
language plpgsql security definer set search_path = public as $$
declare
  v_incident public.incidents;
  v_status   incident_status := case p_silo when 'EthekwiniDisaster' then 'Pending Analysis'::incident_status else 'Pending Dispatch'::incident_status end;
  v_inc_num  text := 'INC-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYYYMMDD') || '-' || lpad((floor(random() * 900) + 100)::text, 3, '0');
begin
  insert into public.incidents (
    silo, source, incident_number,
    caller_name, caller_number, call_description, notes,
    incident_type, incident_severity, fire_incident_type, medical_type, disaster_type,
    location_address, suburb, city, postal_code, location_lat, location_lng,
    is_caller_patient, patient_name, number_of_victims,
    status, call_timestamp, incident_created_at,
    created_by
  ) values (
    p_silo, p_source, v_inc_num,
    p_caller_name, p_caller_number, p_call_description, p_notes,
    p_incident_type, p_incident_severity, p_fire_incident_type, p_medical_type, p_disaster_type,
    p_location_address, p_suburb, p_city, p_postal_code, p_location_lat, p_location_lng,
    p_is_caller_patient, p_patient_name, p_number_of_victims,
    v_status, now(), now(),
    auth.uid()
  )
  returning * into v_incident;

  insert into public.audit_logs (silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (p_silo, auth.uid(), (select full_name from public.profiles where id = auth.uid()), p_silo::text, 'CREATE_INCIDENT', 'incidents', v_incident.id::text,
    format('Logged %s call from %s at %s', p_incident_type, p_caller_name, p_location_address));

  return v_incident;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- CHECK DUPLICATE — what ControlRoomController.CheckDuplicate did (12h window)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.check_duplicate_incident(
  p_phone     text,
  p_location  text,
  p_type      text
) returns table (reason text, incident_id uuid, incident_number text, matched_at timestamptz)
language sql security definer set search_path = public as $$
  with recent as (
    select * from public.incidents
    where call_timestamp >= now() - interval '12 hours'
      and status not in ('Closed', 'Resolved')
  )
  -- By caller phone
  (select 'Caller'::text, id, incident_number, call_timestamp
   from recent where p_phone is not null and caller_number = p_phone
   limit 1)
  union all
  -- By location + type
  (select 'Location'::text, id, incident_number, call_timestamp
   from recent
   where p_location is not null and p_type is not null
     and location_address = p_location and incident_type = p_type
   limit 1);
$$;

-- ─────────────────────────────────────────────────────────────────────
-- DISPATCH UNIT — what IncidentWorkflowService.DispatchUnitAsync did, simplified
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.dispatch_unit(
  p_incident_id   uuid,
  p_unit_id       uuid,
  p_unit_type     text,   -- "Fire" | "Police" | "Medical" | "Disaster" | "Fire,Police" | "BroadcastAll"
  p_target_silos  silo[]  -- which silos the dispatch fans out to
) returns public.incidents
language plpgsql security definer set search_path = public as $$
declare
  v_incident public.incidents;
begin
  update public.incidents
     set status           = 'Dispatched',
         dispatch_time    = now(),
         unit_id          = p_unit_id,
         unit_type        = p_unit_type,
         unit_status      = 'En Route',
         dispatched_silos = p_target_silos
   where id = p_incident_id
  returning * into v_incident;

  if not found then raise exception 'Incident % not found', p_incident_id; end if;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (
    v_incident.silo, v_incident.id,
    format('[DISPATCH] Unit assigned, target silos: %s', array_to_string(p_target_silos, ', ')),
    auth.uid(),
    (select full_name from public.profiles where id = auth.uid())
  );

  insert into public.audit_logs (silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.silo, auth.uid(),
    (select full_name from public.profiles where id = auth.uid()),
    v_incident.silo::text,
    'DISPATCH', 'incidents', v_incident.id::text,
    format('Dispatched %s to %s', p_unit_type, array_to_string(p_target_silos, ', ')));

  return v_incident;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- UPDATE RESPONDER STATUS — what ResponderController.UpdateStatus + IncidentWorkflowService.UpdateResponderStatusAsync did
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.update_responder_status(
  p_incident_id  uuid,
  p_status       incident_status
) returns public.incidents
language plpgsql security definer set search_path = public as $$
declare
  v_incident public.incidents;
  v_name     text := coalesce((select full_name from public.profiles where id = auth.uid()), 'Responder');
begin
  update public.incidents
     set status              = p_status,
         acceptance          = case when p_status = 'En Route' then true else acceptance end,
         arrived_timestamp   = case when p_status in ('Arrived','On Scene') and arrived_timestamp is null then now() else arrived_timestamp end,
         responding_officer  = coalesce(responding_officer, v_name),
         unit_status         = p_status::text
   where id = p_incident_id
  returning * into v_incident;

  if not found then raise exception 'Incident % not found', p_incident_id; end if;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id, format('[STATUS] %s', p_status::text), auth.uid(), v_name);

  return v_incident;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- CLOSE CASE — what CaseManagerController.CloseCase did
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.close_case(
  p_incident_id  uuid,
  p_reason       text default null
) returns public.incidents
language plpgsql security definer set search_path = public as $$
declare
  v_incident public.incidents;
  v_name     text := coalesce((select full_name from public.profiles where id = auth.uid()), 'Supervisor');
begin
  update public.incidents
     set status   = 'Closed',
         closed_at = now()
   where id = p_incident_id
  returning * into v_incident;

  if not found then raise exception 'Incident % not found', p_incident_id; end if;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    coalesce('Incident closed. Reason: ' || p_reason, 'Incident closed by supervisor.'),
    auth.uid(), v_name);

  insert into public.audit_logs (silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.silo, auth.uid(), v_name, v_incident.silo::text, 'CLOSE_CASE', 'incidents', v_incident.id::text,
    coalesce(p_reason, 'No reason given'));

  return v_incident;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- DISPATCHER KPIS — what IncidentWorkflowService.GetDispatcherKPIsAsync produced
-- Returns one row with summary numbers + arrays for hourly distribution + lifecycle averages.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.get_dispatcher_kpis(
  p_silo silo default null  -- null = global view across all silos
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_active_deployments int;
  v_critical_today int;
  v_total_today int;
  v_personnel_on_duty int;
  v_avg_dispatch_min numeric;
  v_avg_travel_min numeric;
  v_avg_on_scene_min numeric;
  v_avg_resolution_min numeric;
  v_type_data jsonb;
  v_priority_data jsonb;
  v_dept_data jsonb;
  v_hourly jsonb;
begin
  with i as (
    select * from public.incidents
    where p_silo is null or silo = p_silo or p_silo = any(dispatched_silos)
  )
  select
    count(*) filter (where status in ('Dispatched','En Route','On Scene','Arrived','Transporting','Active')),
    count(*) filter (where incident_severity = 'Critical' and incident_created_at::date = v_today),
    count(*) filter (where incident_created_at::date = v_today),
    avg(extract(epoch from (dispatch_time - call_timestamp))) filter (where dispatch_time is not null) / 60.0,
    avg(extract(epoch from (arrived_timestamp - dispatch_time))) filter (where arrived_timestamp is not null and dispatch_time is not null) / 60.0,
    avg(extract(epoch from (closed_at - arrived_timestamp))) filter (where closed_at is not null and arrived_timestamp is not null) / 60.0,
    avg(extract(epoch from (closed_at - call_timestamp))) filter (where closed_at is not null) / 60.0
  into v_active_deployments, v_critical_today, v_total_today, v_avg_dispatch_min, v_avg_travel_min, v_avg_on_scene_min, v_avg_resolution_min
  from i;

  select count(*) into v_personnel_on_duty
  from public.personnel
  where is_on_duty and (p_silo is null or silo = p_silo);

  -- Type distribution: [Medical, Fire, Police, Traffic, Disaster]
  select jsonb_build_array(
    (select count(*) from public.incidents where incident_type ilike '%med%' and (p_silo is null or silo = p_silo)),
    (select count(*) from public.incidents where incident_type ilike '%fire%' and (p_silo is null or silo = p_silo)),
    (select count(*) from public.incidents where (incident_type ilike '%pol%' or incident_type ilike '%robbery%') and (p_silo is null or silo = p_silo)),
    (select count(*) from public.incidents where incident_type ilike '%traffic%' and (p_silo is null or silo = p_silo)),
    (select count(*) from public.incidents where incident_type ilike '%disaster%' and (p_silo is null or silo = p_silo))
  ) into v_type_data;

  -- Severity distribution: [Low, Medium, High, Critical]
  select jsonb_build_array(
    (select count(*) from public.incidents where incident_severity = 'Low' and (p_silo is null or silo = p_silo)),
    (select count(*) from public.incidents where incident_severity = 'Medium' and (p_silo is null or silo = p_silo)),
    (select count(*) from public.incidents where incident_severity = 'High' and (p_silo is null or silo = p_silo)),
    (select count(*) from public.incidents where incident_severity = 'Critical' and (p_silo is null or silo = p_silo))
  ) into v_priority_data;

  -- Department distribution
  select jsonb_build_array(
    (select count(*) from public.incidents where silo = 'MetroFire'),
    (select count(*) from public.incidents where silo = 'MetroPolice'),
    (select count(*) from public.incidents where silo = 'Medical'),
    (select count(*) from public.incidents where silo = 'EthekwiniDisaster')
  ) into v_dept_data;

  -- Hourly distribution for today
  select jsonb_agg(coalesce(c, 0) order by hr)
  into v_hourly
  from generate_series(0, 23) hr
  left join lateral (
    select count(*) c
    from public.incidents
    where extract(hour from (incident_created_at at time zone 'Africa/Johannesburg')) = hr
      and (incident_created_at at time zone 'Africa/Johannesburg')::date = v_today
      and (p_silo is null or silo = p_silo)
  ) ic on true;

  return jsonb_build_object(
    'activeDeployments', coalesce(v_active_deployments, 0),
    'criticalAlertsToday', coalesce(v_critical_today, 0),
    'totalIncidentsToday', coalesce(v_total_today, 0),
    'personnelOnDuty', coalesce(v_personnel_on_duty, 0),
    'avgResponseTime', round(coalesce(v_avg_dispatch_min, 0)::numeric, 1),
    'responseData', jsonb_build_array(
      round(coalesce(v_avg_dispatch_min, 0)::numeric, 1),
      round(coalesce(v_avg_travel_min, 0)::numeric, 1),
      round(coalesce(v_avg_on_scene_min, 0)::numeric, 1),
      round(coalesce(v_avg_resolution_min, 0)::numeric, 1)
    ),
    'typeData', v_type_data,
    'priorityData', v_priority_data,
    'deptData', v_dept_data,
    'hourlyDistribution', v_hourly
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- TOGGLE DUTY — what NotificationsController.ToggleDutyStatus did
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.toggle_duty(
  p_on_duty   boolean,
  p_latitude  double precision default null,
  p_longitude double precision default null
) returns public.personnel
language plpgsql security definer set search_path = public as $$
declare
  v_person public.personnel;
begin
  update public.personnel
     set is_on_duty = p_on_duty,
         latitude   = case when p_on_duty then p_latitude  else null end,
         longitude  = case when p_on_duty then p_longitude else null end,
         last_login = case when p_on_duty then now() else last_login end
   where user_id = auth.uid()
  returning * into v_person;

  return v_person;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- LOGOUT CLEANUP — what AuthController.Logout did (free vehicle, clear duty)
-- Called from a server action just before sign-out.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.cleanup_on_logout() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_apparatus_id uuid;
begin
  select assigned_apparatus_id into v_apparatus_id
  from public.personnel where user_id = auth.uid();

  if v_apparatus_id is not null then
    update public.apparatus set status = 'Available' where id = v_apparatus_id;
  end if;

  update public.personnel
     set is_on_duty            = false,
         latitude              = null,
         longitude             = null,
         assigned_apparatus_id = null
   where user_id = auth.uid();
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- HAS COMPLETED SHIFT START TODAY — what ShiftController.HasCompletedShiftStartTodayAsync did
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.has_completed_shift_start_today() returns boolean
language sql security definer set search_path = public as $$
  with passed_mental as (
    select 1 from public.mental_checks
    where user_id = auth.uid()
      and mental_checks.timestamp >= (now() at time zone 'Africa/Johannesburg')::date
      and memory_recall and judgment and situational_awareness
      and not_under_influence and anger_check and reflexes
    limit 1
  ),
  did_vehicle as (
    select 1 from public.vehicle_checklists
    where user_id = auth.uid()
      and checked_at >= (now() at time zone 'Africa/Johannesburg')::date
    limit 1
  )
  select exists(select 1 from passed_mental) and exists(select 1 from did_vehicle);
$$;

-- ─────────────────────────────────────────────────────────────────────
-- ASSIGN VEHICLE — what ShiftController.AssignVehicle did
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.assign_vehicle(p_apparatus_id uuid) returns public.apparatus
language plpgsql security definer set search_path = public as $$
declare
  v_vehicle public.apparatus;
begin
  update public.apparatus set status = 'In Use' where id = p_apparatus_id returning * into v_vehicle;
  if not found then raise exception 'Apparatus % not found', p_apparatus_id; end if;

  update public.personnel
     set assigned_apparatus_id = p_apparatus_id, is_on_duty = true
   where user_id = auth.uid();

  insert into public.vehicle_checklists (silo, user_id, apparatus_id, checked_at, fuel_level, lights_functional, tires_condition_ok, equipment_stocked, comms_working, brakes_responsive)
  values (v_vehicle.silo, auth.uid(), p_apparatus_id, now(), 'Full', true, true, true, true, true);

  return v_vehicle;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- CITIZEN GPS SHARE — token-based public location update
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.citizen_update_location(
  p_token      text,
  p_latitude   double precision,
  p_longitude  double precision
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_token public.citizen_share_tokens;
begin
  select * into v_token from public.citizen_share_tokens
  where token = p_token and used_at is null and expires_at > now();

  if not found then raise exception 'Invalid or expired token'; end if;

  update public.incidents
     set location_lat = p_latitude, location_lng = p_longitude
   where id = v_token.incident_id;

  update public.citizen_share_tokens set used_at = now() where token = p_token;

  insert into public.audit_logs (silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_token.silo, null, 'Citizen (Mobile)', v_token.silo::text, 'CITIZEN_GPS_UPDATE',
    'incidents', v_token.incident_id::text,
    format('Live GPS update received for incident %s', v_token.incident_id));
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- GRANTS — RPCs callable via PostgREST
-- ─────────────────────────────────────────────────────────────────────
grant execute on function public.log_incoming_call            to authenticated;
grant execute on function public.check_duplicate_incident     to authenticated;
grant execute on function public.dispatch_unit                to authenticated;
grant execute on function public.update_responder_status      to authenticated;
grant execute on function public.close_case                   to authenticated;
grant execute on function public.get_dispatcher_kpis          to authenticated;
grant execute on function public.toggle_duty                  to authenticated;
grant execute on function public.cleanup_on_logout            to authenticated;
grant execute on function public.has_completed_shift_start_today to authenticated;
grant execute on function public.assign_vehicle               to authenticated;
grant execute on function public.citizen_update_location      to anon, authenticated;
