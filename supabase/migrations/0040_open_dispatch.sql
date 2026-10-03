-- ============================================================================
-- 0040 — Open dispatch: the call goes out, the first officer to accept takes it
-- ============================================================================
--
-- Run after 0039.
--
-- The dispatcher no longer picks a unit. Dispatching sends the call to every
-- officer ON DUTY in the chosen departments; it sits in their app as an
-- available call until one of them accepts it (Mark En Route). From that
-- moment it is theirs alone and leaves everyone else's list.
--
--   route_incident()           dispatch to the departments' on-duty officers
--     → refused when nobody in those departments is on duty
--     → a personal alert (and push) to each on-duty officer not already on a call
--   update_responder_status()  the first on-duty officer to accept takes it
--     → anyone after them is told who took it
--     → still one call at a time; still no off-duty/sign-out mid-call (0039)
--
-- The silo-wide "dispatched to your department" alert is gone: it reached
-- every phone in the department, off duty or not.
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. Dispatch to whoever is on duty ───────────────────────────────────────

create or replace function public.route_incident(p_incident_id uuid, p_silos silo[], p_notes text default null)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_name     text;
  v_on_duty  int;
  v_alerted  int := 0;
  v_to       text;
  r          record;
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
    raise exception '% has already been taken by %', v_incident.incident_number,
      coalesce(v_incident.responding_officer, 'an officer');
  end if;

  -- Somebody has to be there to receive it.
  select count(*) into v_on_duty
  from public.personnel p
  where p.tenant_id = v_incident.tenant_id
    and p.is_on_duty and p.user_id is not null
    and p.silo = any(p_silos);
  if v_on_duty = 0 then
    raise exception 'No one is on duty to receive the dispatch'
      using hint = 'The call stays in the pending queue. Dispatch it once an officer goes on duty.';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  v_to := array_to_string(p_silos, ', ');

  update public.incidents
     set status           = 'Dispatched',
         dispatch_time    = coalesce(dispatch_time, now()),
         dispatched_silos = p_silos,
         dispatched_by    = coalesce(v_name, dispatched_by),
         dispatched_by_id = auth.uid(),
         -- Nobody holds it yet: the officer who accepts brings their vehicle.
         unit_id          = null,
         unit_status      = 'Dispatched',
         notes            = coalesce(nullif(p_notes, ''), notes),
         updated_at       = now()
   where id = p_incident_id
  returning * into v_incident;

  -- A personal alert for each on-duty officer free to take it.
  for r in
    select p.user_id, p.silo from public.personnel p
    where p.tenant_id = v_incident.tenant_id
      and p.is_on_duty and p.user_id is not null
      and p.silo = any(p_silos)
      and not exists (
        select 1 from public.incidents o
        where o.accepted_by = p.user_id and o.status not in ('Resolved', 'Closed')
      )
  loop
    insert into public.alerts (
      silo, target_user_id, kind, severity, title, body, incident_id, link,
      presentation, requires_ack, created_by, created_by_name
    ) values (
      r.silo, r.user_id, 'dispatch', v_incident.incident_severity::text,
      format('New call %s', v_incident.incident_number),
      format('%s · %s', v_incident.incident_type, v_incident.location_address),
      v_incident.id, format('/incidents/%s', v_incident.id),
      'modal', false, auth.uid(), v_name
    );
    v_alerted := v_alerted + 1;
  end loop;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[DISPATCH] Sent to %s — %s on duty, %s alerted. First to accept takes the call.',
           v_to, v_on_duty, v_alerted),
    auth.uid(), v_name);

  insert into public.audit_logs (silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_incident.silo, auth.uid(), v_name, 'IncidentRouted', 'incident', v_incident.id::text,
    format('Dispatched %s to %s (%s on duty, %s alerted)', v_incident.incident_number, v_to, v_on_duty, v_alerted));

  return v_incident;
end $$;

revoke execute on function public.route_incident(uuid, silo[], text) from public, anon;
grant  execute on function public.route_incident(uuid, silo[], text) to authenticated;

-- ── 2. First on-duty officer to accept takes it ─────────────────────────────

create or replace function public.update_responder_status(
  p_incident_id uuid,
  p_status      incident_status,
  p_occurred_at timestamptz default null
)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_name     text := coalesce((select full_name from public.profiles where id = auth.uid()), 'Responder');
  v_at       timestamptz;
  v_queued   boolean;
  v_field    boolean;
  v_person   public.personnel;
  v_other    text;
  v_accepts  boolean := false;
  v_unit     text;
begin
  perform public.require_role(
    'Responder','Police','Officer','Metro','Security','Firefighter','Paramedic','Doctor','Disaster',
    'Captain','Chief','FireChief','Supervisor','Dispatcher','ControlRoom','Operator',
    'Admin','SystemAdmin','SuperAdmin','System'
  );

  v_at := case
    when p_occurred_at is null then now()
    when p_occurred_at > now() then now()
    when p_occurred_at < now() - interval '12 hours' then now()
    else p_occurred_at
  end;
  v_queued := p_occurred_at is not null and v_at < now() - interval '30 seconds';

  -- The row lock makes acceptance first-come: a second officer waits here,
  -- then sees the first one's name below.
  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;

  -- Field crews work only the call they took; the desks and command may still
  -- correct a status on anyone's behalf.
  v_field := public.role_in('Responder','Police','Officer','Metro','Security','Firefighter',
                            'Paramedic','Doctor','Disaster');
  if v_field then
    if v_incident.accepted_by is not null and v_incident.accepted_by <> auth.uid() then
      raise exception '% was already taken by %', v_incident.incident_number,
        coalesce(v_incident.responding_officer, 'another officer');
    end if;

    if v_incident.accepted_by is null then
      if p_status = 'Dispatched' then
        raise exception 'Accept % by marking yourself En Route', v_incident.incident_number;
      end if;
      if v_incident.status <> 'Dispatched' then
        raise exception '% has not been dispatched yet', v_incident.incident_number;
      end if;
      if not (public.current_silo() = any(coalesce(v_incident.dispatched_silos, '{}'))
              or v_incident.silo = public.current_silo()) then
        raise exception '% was not dispatched to your department', v_incident.incident_number;
      end if;

      select * into v_person from public.personnel
      where user_id = auth.uid() and tenant_id = public.current_tenant();
      if not coalesce(v_person.is_on_duty, false) then
        raise exception 'Go on duty to accept calls';
      end if;

      -- One call at a time: finish (file the report on) the current one first.
      select incident_number into v_other from public.incidents
      where accepted_by = auth.uid() and id <> p_incident_id
        and status not in ('Resolved', 'Closed')
        and tenant_id = public.current_tenant()
      limit 1;
      if v_other is not null then
        raise exception 'Finish % (file its report) before accepting another call', v_other;
      end if;
      v_accepts := true;
    end if;
  end if;

  -- A police call is resolved by its case report, never by a bare status.
  if p_status in ('Resolved', 'Closed') and v_incident.report_filed_at is null
     and ('MetroPolice' = any(coalesce(v_incident.dispatched_silos, '{}')) or v_incident.silo = 'MetroPolice')
     and v_field then
    raise exception 'File the incident report to close %', v_incident.incident_number;
  end if;

  update public.incidents
     set status              = p_status,
         acceptance          = case when p_status = 'En Route' then true else acceptance end,
         accepted_by         = case when v_accepts then auth.uid() else accepted_by end,
         accepted_at         = case when v_accepts then v_at else accepted_at end,
         -- The accepting officer's vehicle becomes the unit on the call.
         unit_id             = case when v_accepts then coalesce(v_person.assigned_apparatus_id, unit_id) else unit_id end,
         arrived_timestamp   = case
                                 when p_status in ('Arrived','On Scene') and arrived_timestamp is null
                                   then v_at
                                 else arrived_timestamp
                               end,
         responding_officer  = case when v_accepts then v_name else coalesce(responding_officer, v_name) end,
         unit_status         = p_status::text,
         updated_at          = now()
   where id = p_incident_id
  returning * into v_incident;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name, timestamp)
  values (
    v_incident.silo, v_incident.id,
    case
      when v_queued then format('[STATUS] %s (recorded offline, delivered %s later)',
                                p_status::text, to_char(now() - v_at, 'HH24:MI:SS'))
      else format('[STATUS] %s', p_status::text)
    end,
    auth.uid(), v_name, v_at
  );

  if v_accepts then
    select unit_number into v_unit from public.apparatus where id = v_incident.unit_id;
    insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name, timestamp)
    values (v_incident.silo, v_incident.id,
      format('[ACCEPTED] %s%s accepted the call', v_name, coalesce(' (' || v_unit || ')', '')),
      auth.uid(), v_name, v_at);
    perform public.notify_incident_chain(
      v_incident, 'accepted',
      format('%s accepted by %s', v_incident.incident_number, v_name),
      format('%s%s · %s', coalesce(v_unit || ' · ', ''), v_incident.incident_type, v_incident.location_address)
    );
  end if;

  return v_incident;
end $$;

notify pgrst, 'reload schema';
