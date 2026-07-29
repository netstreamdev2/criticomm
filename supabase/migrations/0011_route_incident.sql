-- =====================================================================
-- CRITICOM V5 — 0011
-- route_incident: send an incident to one or more departments without
-- committing to a specific unit yet. dispatch_unit() stays the function for
-- "this exact appliance is rolling"; this one is the control room saying
-- "Fire and EMS, this is yours" straight off the call-taking screen.
-- =====================================================================

create or replace function public.route_incident(
  p_incident_id uuid,
  p_silos       silo[],
  p_notes       text default null
) returns public.incidents
language plpgsql security definer set search_path = public as $$
declare
  v_incident public.incidents;
  v_name     text;
begin
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
$$;

grant execute on function public.route_incident(uuid, silo[], text) to authenticated;

-- raise_dispatch_alerts runs as the caller (security invoker) so RLS applies;
-- when called from route_incident (security definer) it still inserts as the
-- signed-in user because auth.uid() is preserved. Nothing further to grant.
