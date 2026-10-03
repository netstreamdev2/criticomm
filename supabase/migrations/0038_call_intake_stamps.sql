-- ============================================================================
-- 0038 — Call intake: one transaction, server-stamped, with a real position
-- ============================================================================
--
-- Operations Manual 22.1 says log_incoming_call() "writes the row, allocates
-- INC-YYYYMMDD-NNNN, audits. Call-taker, category and region are stamped."
-- Until now only the first half was true: the log-call screen created the
-- incident and then patched call_taken_by, incident_category and region in a
-- second request. If that second request failed the incident existed with no
-- call-taker on it, and the name was whatever the browser said it was.
--
-- This migration:
--   1. stamps call_taken_by from the caller's own profile, inside the insert;
--   2. takes incident_category and region as arguments, so they land in the
--      same transaction as the incident;
--   3. refuses a scene with no position. The screen used to send 0,0 when no
--      pin was placed, which puts the incident in the Gulf of Guinea on every
--      map and makes nearest-unit dispatch meaningless.
--
-- PostgREST resolves an RPC by its argument names, so the previous arity is
-- dropped in the same migration (Operations Manual 41.2).
--
-- Safe to re-run.
-- ============================================================================

drop function if exists public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid
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
  v_status   incident_status := case p_silo
                                  when 'EthekwiniDisaster' then 'Pending Analysis'::incident_status
                                  else 'Pending Dispatch'::incident_status
                                end;
begin
  perform public.require_role(
    'SystemAdmin','SuperAdmin','Admin','Operator','ControlRoom','IncidentLogger','System'
  );

  if p_client_ref is not null then
    select * into v_existing from public.incidents where client_ref = p_client_ref;
    if found then return v_existing; end if;
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
    p_caller_name, p_caller_number, p_call_description, p_notes,
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
    format('Logged %s call from %s at %s', p_incident_type, p_caller_name, p_location_address)
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

notify pgrst, 'reload schema';
