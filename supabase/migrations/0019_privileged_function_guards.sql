-- ============================================================================
-- 0019 — Authorization guards on privileged functions + write-policy tightening
-- ============================================================================
--
-- Two defects, both allowing writes to live emergency data by callers who
-- should have none.
--
-- (1) Every mutating RPC is SECURITY DEFINER — it runs as the owner and so
--     bypasses RLS completely — yet none of them checked the caller's role.
--     `auth.uid()` appeared in each body for ATTRIBUTION only (stamping the
--     audit log), never for ENFORCEMENT. EXECUTE was additionally granted to
--     `anon`, so a caller holding nothing but the public anon key could
--     route, dispatch or close any incident in any silo. The audit trail
--     would then record the action as legitimate, with a null actor.
--
--     Fix: a `require_role()` guard as the first statement of each function,
--     and EXECUTE revoked from `anon` on everything except the one function
--     that is genuinely public (`citizen_update_location`, which authenticates
--     by single-use bearer token).
--
-- (2) `is_global()` conflates cross-silo VISIBILITY with authority to WRITE.
--     It returns true for `Viewer` (read-only) and `IncidentLogger`. Where it
--     is ANDed behind a role check — `role_in(...) AND (silo = current_silo()
--     OR is_global())` — that is correct and is left alone. Where it stands
--     alone as an OR-branch it grants writes outright. Five policies did that.
--
--     Fix: `can_write_global()` — the same cross-silo scope, minus the roles
--     that have no write authority.
--
-- Role sets mirror packages/db/src/roles.ts. Keep the two in step: that file
-- is the route matrix, this is the data boundary behind it.
-- ============================================================================

-- ── Guards ──────────────────────────────────────────────────────────────────

create or replace function public.require_role(variadic p_roles public.user_role[])
returns void language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = any(p_roles)
  ) then
    raise exception 'Not authorised: this action requires one of %',
      array_to_string(p_roles::text[], ', ') using errcode = '42501';
  end if;
end $$;

comment on function public.require_role(variadic public.user_role[]) is
  'Raises 42501 unless the caller holds one of the listed roles. First statement of every SECURITY DEFINER mutator.';

-- Cross-silo WRITE authority. Deliberately excludes Viewer (read-only) and
-- IncidentLogger (intake desk only — see the two-desk split below).
create or replace function public.can_write_global()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select role in ('SystemAdmin','SuperAdmin','Dispatcher','Operator','ControlRoom','System')
     from public.profiles where id = auth.uid()),
    false
  );
$$;

comment on function public.can_write_global() is
  'Cross-silo write authority. Use for write policies; is_global() remains correct for SELECT.';

-- ── (1) Guard the privileged RPCs ───────────────────────────────────────────
-- Bodies are unchanged apart from the guard line; behaviour is otherwise
-- identical so existing call sites keep working.

-- Intake. The call-taker desk logs incidents; a Dispatcher does not (two-desk
-- split), and a Viewer never does.
create or replace function public.log_incoming_call(p_silo silo, p_caller_name text, p_caller_number text, p_call_description text, p_incident_type text, p_incident_severity incident_severity, p_location_address text, p_location_lat double precision, p_location_lng double precision, p_suburb text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_postal_code text DEFAULT NULL::text, p_fire_incident_type text DEFAULT NULL::text, p_medical_type text DEFAULT NULL::text, p_disaster_type text DEFAULT NULL::text, p_is_caller_patient boolean DEFAULT NULL::boolean, p_patient_name text DEFAULT NULL::text, p_number_of_victims integer DEFAULT NULL::integer, p_notes text DEFAULT NULL::text, p_source text DEFAULT 'Master'::text)
 RETURNS incidents LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_incident public.incidents;
  v_status   incident_status := case p_silo when 'EthekwiniDisaster' then 'Pending Analysis'::incident_status else 'Pending Dispatch'::incident_status end;
  v_inc_num  text := 'INC-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYYYMMDD') || '-' || lpad((floor(random() * 900) + 100)::text, 3, '0');
begin
  perform public.require_role('SystemAdmin','SuperAdmin','Admin','Operator','ControlRoom','IncidentLogger','System');

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
end $function$;

-- Routing to departments. Dispatch desk only — an IncidentLogger logs, it does
-- not dispatch.
create or replace function public.route_incident(p_incident_id uuid, p_silos silo[], p_notes text DEFAULT NULL::text)
 RETURNS incidents LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_incident public.incidents;
  v_name     text;
begin
  perform public.require_role('SystemAdmin','SuperAdmin','Admin','Dispatcher','Operator','ControlRoom','Supervisor','System');

  if p_silos is null or array_length(p_silos, 1) is null then
    raise exception 'At least one department must be selected';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();

  update public.incidents
     set status           = 'Dispatched',
         dispatch_time    = coalesce(dispatch_time, now()),
         dispatched_silos = p_silos,
         dispatched_by    = coalesce(v_name, dispatched_by),
         notes            = coalesce(nullif(p_notes, ''), notes),
         updated_at       = now()
   where id = p_incident_id
  returning * into v_incident;

  if not found then
    raise exception 'Incident % not found', p_incident_id;
  end if;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (
    v_incident.silo, v_incident.id,
    format('[DISPATCH] Routed to %s', array_to_string(p_silos, ', ')),
    auth.uid(), v_name
  );

  insert into public.audit_logs (
    silo, user_id, user_name, action_type, entity_type, entity_id, details
  ) values (
    v_incident.silo, auth.uid(), v_name, 'IncidentRouted', 'incident', v_incident.id,
    format('Routed to %s', array_to_string(p_silos, ', '))
  );

  -- Pop every screen in the receiving departments.
  perform public.raise_dispatch_alerts(v_incident.id, p_silos, v_name);

  return v_incident;
end;
$function$;

-- Committing a specific unit. Dispatch desk only.
create or replace function public.dispatch_unit(p_incident_id uuid, p_unit_id uuid, p_unit_type text, p_target_silos silo[])
 RETURNS incidents LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_incident public.incidents;
begin
  perform public.require_role('SystemAdmin','SuperAdmin','Admin','Dispatcher','Operator','ControlRoom','Supervisor','System');

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
end $function$;

-- Closing a case is a supervisory/dispatch act with medico-legal weight.
create or replace function public.close_case(p_incident_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS incidents LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_incident public.incidents;
  v_name     text := coalesce((select full_name from public.profiles where id = auth.uid()), 'Supervisor');
begin
  perform public.require_role('SystemAdmin','SuperAdmin','Admin','Supervisor','Captain','Chief','FireChief','Dispatcher','Operator','ControlRoom','System');

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
end $function$;

-- Field status updates: responders on the incident, plus the desk that owns it.
create or replace function public.update_responder_status(p_incident_id uuid, p_status incident_status)
 RETURNS incidents LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_incident public.incidents;
  v_name     text := coalesce((select full_name from public.profiles where id = auth.uid()), 'Responder');
begin
  perform public.require_role(
    'SystemAdmin','SuperAdmin','Admin','Dispatcher','Operator','ControlRoom','Supervisor','System',
    'Responder','Police','Officer','Metro','Security','Captain','Firefighter','FireChief','Chief',
    'Paramedic','Doctor','Disaster');

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
end $function$;

-- Vehicle assignment marks shared fleet state, so it needs a real caller.
create or replace function public.assign_vehicle(p_apparatus_id uuid)
 RETURNS apparatus LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_vehicle public.apparatus;
begin
  perform public.require_role(
    'SystemAdmin','SuperAdmin','Admin','Supervisor','System',
    'Responder','Police','Officer','Metro','Security','Captain','Firefighter','FireChief','Chief',
    'Paramedic','Doctor','Disaster');

  update public.apparatus set status = 'In Use' where id = p_apparatus_id returning * into v_vehicle;
  if not found then raise exception 'Apparatus % not found', p_apparatus_id; end if;

  update public.personnel
     set assigned_apparatus_id = p_apparatus_id, is_on_duty = true
   where user_id = auth.uid();

  insert into public.vehicle_checklists (silo, user_id, apparatus_id, checked_at, fuel_level, lights_functional, tires_condition_ok, equipment_stocked, comms_working, brakes_responsive)
  values (v_vehicle.silo, auth.uid(), p_apparatus_id, now(), 'Full', true, true, true, true, true);

  return v_vehicle;
end $function$;

-- toggle_duty and cleanup_on_logout are self-scoped (`where user_id =
-- auth.uid()`), so an anonymous call is already a no-op. They still need a
-- signed-in caller; revoking anon below is sufficient.

-- ── EXECUTE grants ──────────────────────────────────────────────────────────
-- Nothing operational should be reachable without a session.
revoke execute on function public.log_incoming_call(silo, text, text, text, text, incident_severity, text, double precision, double precision, text, text, text, text, text, text, boolean, text, integer, text, text) from anon;
revoke execute on function public.route_incident(uuid, silo[], text) from anon;
revoke execute on function public.dispatch_unit(uuid, uuid, text, silo[]) from anon;
revoke execute on function public.close_case(uuid, text) from anon;
revoke execute on function public.update_responder_status(uuid, incident_status) from anon;
revoke execute on function public.assign_vehicle(uuid) from anon;
revoke execute on function public.toggle_duty(boolean, double precision, double precision) from anon;
revoke execute on function public.cleanup_on_logout() from anon;
revoke execute on function public.check_duplicate_incident(text, text, text) from anon;
revoke execute on function public.get_dispatcher_kpis(silo) from anon;
revoke execute on function public.has_completed_shift_start_today() from anon;
revoke execute on function public.purge_expired_share_tokens() from anon, authenticated;

-- `citizen_update_location` stays anon-executable on purpose: the citizen has
-- no account. It is authenticated by a single-use, expiring bearer token, and
-- since 0018 those tokens are no longer enumerable.

-- ── (2) Write policies that granted through a bare is_global() ──────────────

-- A Viewer could close a live emergency; an IncidentLogger could dispatch one.
drop policy if exists incidents_dispatcher_update on public.incidents;
create policy incidents_dispatcher_update on public.incidents for update
  using (public.can_write_global() or public.role_in('Supervisor','SystemAdmin','SuperAdmin'))
  with check (public.can_write_global() or public.role_in('Supervisor','SystemAdmin','SuperAdmin'));

-- Citizen GPS bearer tokens: minting and revoking them is a desk function.
drop policy if exists citizen_share_admin on public.citizen_share_tokens;
create policy citizen_share_admin on public.citizen_share_tokens for all
  using (public.role_in('Dispatcher','Operator','ControlRoom','IncidentLogger','SystemAdmin','SuperAdmin','Admin','System'))
  with check (public.role_in('Dispatcher','Operator','ControlRoom','IncidentLogger','SystemAdmin','SuperAdmin','Admin','System'));

-- The incident log is the evidentiary record of the response. Everyone who
-- works an incident may add to it; a read-only account may not.
drop policy if exists incident_updates_insert on public.incident_updates;
create policy incident_updates_insert on public.incident_updates for insert
  with check (
    ((silo = public.current_silo()) or public.can_write_global() or public.role_in('IncidentLogger'))
    and not public.role_in('Viewer')
  );

drop policy if exists incident_attachments_insert on public.incident_attachments;
create policy incident_attachments_insert on public.incident_attachments for insert
  with check (
    ((silo = public.current_silo()) or public.can_write_global() or public.role_in('IncidentLogger'))
    and not public.role_in('Viewer')
  );

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert
  with check (
    ((silo = public.current_silo()) or public.can_write_global() or public.role_in('IncidentLogger'))
    and not public.role_in('Viewer')
  );
