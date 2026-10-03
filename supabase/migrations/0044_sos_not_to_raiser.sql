-- ============================================================================
-- 0044 — An SOS is never dispatched to the officer who raised it
-- ============================================================================
--
-- Run after 0043.
--
-- The officer who pressed SOS is the one in trouble, but "send to all on duty"
-- alerted every on-duty officer in the department — including them — so they
-- were told about their own emergency, and could even be assigned it. Now the
-- raiser (incidents.created_by on a 'Responder-Panic' incident) is left out of
-- everything that sends the SOS out:
--
--   route_incident()      not alerted, and not counted as "on duty to receive it"
--   assign_incident()     refused if pointed at the raiser          (trigger)
--   Responding            refused for the raiser                    (trigger)
--   any dispatch alert    addressed to the raiser is dropped         (trigger)
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. Who raised it ────────────────────────────────────────────────────────

-- The officer an SOS is about, or null for any other incident.
create or replace function public.sos_raiser(p_incident public.incidents) returns uuid
language sql immutable as $$
  select case when p_incident.source = 'Responder-Panic' then p_incident.created_by end;
$$;

-- ── 2. Send to all on duty — without the raiser ─────────────────────────────

create or replace function public.route_incident(p_incident_id uuid, p_silos silo[], p_notes text default null)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_name     text;
  v_on_duty  int;
  v_to       text;
  v_raiser   uuid;
begin
  perform public.require_role('SystemAdmin','SuperAdmin','Admin','Dispatcher','Operator','ControlRoom','Supervisor','System');

  if p_silos is null or array_length(p_silos, 1) is null then
    raise exception 'At least one department must be selected';
  end if;

  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;
  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text);
  end if;
  if v_incident.accepted_by is not null then
    raise exception '% is already led by %', v_incident.incident_number,
      coalesce(v_incident.responding_officer, 'an officer')
      using hint = 'Other officers can still join it as backup from the app.';
  end if;

  v_raiser := public.sos_raiser(v_incident);

  -- Somebody other than the officer in distress has to be there to receive it.
  select count(*) into v_on_duty
  from public.personnel p
  where p.tenant_id = v_incident.tenant_id
    and p.is_on_duty and p.user_id is not null
    and p.user_id is distinct from v_raiser
    and p.silo = any(p_silos);
  if v_on_duty = 0 then
    raise exception 'No one is on duty to receive the dispatch'
      using hint = case when v_raiser is not null
        then 'The officer who raised this SOS does not count. It stays in the pending queue until another officer is on duty.'
        else 'The call stays in the pending queue. Dispatch it once an officer goes on duty.' end;
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  v_to := array_to_string(p_silos, ', ');

  update public.incidents
     set status           = 'Dispatched',
         dispatch_time    = coalesce(dispatch_time, now()),
         dispatched_silos = p_silos,
         dispatched_by    = coalesce(v_name, dispatched_by),
         dispatched_by_id = auth.uid(),
         assigned_to      = null,
         assigned_to_name = null,
         assigned_at      = null,
         assigned_by      = null,
         unit_id          = null,
         unit_status      = 'Dispatched',
         notes            = coalesce(nullif(p_notes, ''), notes),
         updated_at       = now()
   where id = p_incident_id
  returning * into v_incident;

  insert into public.alerts (
    silo, target_user_id, kind, severity, title, body, incident_id, link,
    presentation, requires_ack, created_by, created_by_name
  )
  select p.silo, p.user_id, 'dispatch', v_incident.incident_severity::text,
         format('New incident %s', v_incident.incident_number),
         format('%s · %s', v_incident.incident_type, v_incident.location_address),
         v_incident.id, format('/incidents/%s', v_incident.id),
         'modal', false, auth.uid(), v_name
  from public.personnel p
  where p.tenant_id = v_incident.tenant_id
    and p.is_on_duty and p.user_id is not null
    and p.user_id is distinct from v_raiser
    and p.silo = any(p_silos);

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[DISPATCH] Sent to all on duty in %s (%s officers%s). First to respond leads; others may join as backup.',
           v_to, v_on_duty, case when v_raiser is not null then ', not the officer who raised the SOS' else '' end),
    auth.uid(), v_name);

  insert into public.audit_logs (silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_incident.silo, auth.uid(), v_name, 'IncidentRouted', 'incident', v_incident.id::text,
    format('Dispatched %s to all on duty in %s (%s officers)', v_incident.incident_number, v_to, v_on_duty));

  return v_incident;
end $$;

revoke execute on function public.route_incident(uuid, silo[], text) from public, anon;
grant  execute on function public.route_incident(uuid, silo[], text) to authenticated;

-- ── 3. Never assigned to, or responded to by, the raiser ────────────────────

create or replace function public.guard_sos_assignment() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.assigned_to is not null
     and new.assigned_to is distinct from old.assigned_to
     and new.assigned_to = public.sos_raiser(new) then
    raise exception '% is the officer who raised this SOS — assign another officer', coalesce(new.assigned_to_name, 'That officer');
  end if;
  return new;
end $$;

drop trigger if exists guard_sos_assignment on public.incidents;
create trigger guard_sos_assignment before update of assigned_to on public.incidents
  for each row execute function public.guard_sos_assignment();

create or replace function public.guard_sos_responder() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.incidents i
             where i.id = new.incident_id and public.sos_raiser(i) = new.user_id) then
    raise exception 'This is your own SOS — help is being sent to you';
  end if;
  return new;
end $$;

drop trigger if exists guard_sos_responder on public.incident_responders;
create trigger guard_sos_responder before insert on public.incident_responders
  for each row execute function public.guard_sos_responder();

-- ── 4. Safety net: no dispatch alert for an SOS reaches its raiser ──────────

-- Extends 0043's title trigger: an alert addressed to the raiser is dropped;
-- every other dispatch alert for an SOS is led with "SOS".
create or replace function public.sos_alert_title() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_raiser uuid;
begin
  if new.incident_id is null or new.kind not in ('dispatch', 'assignment') then
    return new;
  end if;
  select public.sos_raiser(i) into v_raiser from public.incidents i where i.id = new.incident_id;
  if v_raiser is null then
    return new;
  end if;
  if new.target_user_id = v_raiser then
    return null;
  end if;
  if new.title not like 'SOS%' then
    new.title := 'SOS · ' || new.title;
  end if;
  return new;
end $$;

drop trigger if exists sos_alert_title on public.alerts;
create trigger sos_alert_title before insert on public.alerts
  for each row execute function public.sos_alert_title();

notify pgrst, 'reload schema';
