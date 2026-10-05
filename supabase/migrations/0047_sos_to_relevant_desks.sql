-- ============================================================================
-- 0047 — An SOS goes to the desks that can act on it, not to every screen
-- ============================================================================
--
-- Run after 0046.
--
-- 0043 sent the SOS siren to every Dispatcher, ControlRoom, SystemController,
-- SystemAdmin, SuperAdmin and Admin in the tenant, whatever their department,
-- so a police officer's SOS wailed on the fire dispatcher's console and on the
-- platform owner's. Now it goes to:
--
--   the dispatch desk     Dispatcher, ControlRoom and desk Supervisors in the
--                         officer's own department, plus the central control
--                         room (silo Ethekwini), which serves every department;
--   department command    the officer's Captain (police) or FireChief (fire).
--
-- Not to: SuperAdmin, SystemAdmin, Admins, the SystemController, or another
-- department's desk. They still see the SOS at the top of the incident queue.
--
-- Safety net: if nobody in that list exists (a department with no dispatcher
-- accounts yet), the tenant's SystemController and SystemAdmin get it
-- instead, so an SOS is never silent.
--
-- Only raise_panic() changes; dispatching the SOS afterwards is unchanged.
-- Safe to re-run.
-- ============================================================================

create or replace function public.raise_panic(
  p_lat         double precision default null,
  p_lng         double precision default null,
  p_accuracy    double precision default null,
  p_note        text default null,
  p_client_ref  uuid default null,
  p_occurred_at timestamptz default null
)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_existing public.incidents;
  v_silo     silo;
  v_name     text;
  v_phone    text;
  v_unit     text;
  v_at       timestamptz;
  v_lat      double precision := p_lat;
  v_lng      double precision := p_lng;
  v_where    text;
  v_note     text;
  v_last_lat double precision;
  v_last_lng double precision;
  v_last_at  timestamptz;
  v_sent     int := 0;
  v_fallback boolean := false;
  r          record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Deliberately no require_role(): every account may call for help.

  -- An offline retry of an SOS already delivered returns the same incident.
  if p_client_ref is not null then
    select * into v_existing from public.incidents
     where client_ref = p_client_ref and tenant_id = public.current_tenant();
    if found then return v_existing; end if;
  end if;

  select coalesce(pr.silo, 'Ethekwini'::silo), coalesce(pr.full_name, 'Unknown officer'), pr.contact_number
    into v_silo, v_name, v_phone
    from public.profiles pr
   where pr.id = auth.uid();
  if v_silo is null then v_silo := 'Ethekwini'; end if;
  if v_name is null then v_name := 'Unknown officer'; end if;

  select a.unit_number, p.latitude, p.longitude, coalesce(p.last_login, p.updated_at)
    into v_unit, v_last_lat, v_last_lng, v_last_at
    from public.personnel p
    left join public.apparatus a on a.id = p.assigned_apparatus_id
   where p.user_id = auth.uid() and p.tenant_id = public.current_tenant()
   limit 1;

  -- The moment of the press, not of delivery (bounded, as for status changes).
  v_at := case
    when p_occurred_at is null then now()
    when p_occurred_at > now() then now()
    when p_occurred_at < now() - interval '12 hours' then now()
    else p_occurred_at
  end;

  if v_lat is not null and v_lng is not null and not (v_lat = 0 and v_lng = 0) then
    v_where := format('Officer position %s, %s%s', round(v_lat::numeric, 5), round(v_lng::numeric, 5),
      case when p_accuracy is not null then format(' (±%sm)', round(p_accuracy::numeric)) else '' end);
  elsif v_last_lat is not null and v_last_lng is not null and not (v_last_lat = 0 and v_last_lng = 0) then
    -- No fix from the phone: the app's last heartbeat is the best we have.
    v_lat := v_last_lat;
    v_lng := v_last_lng;
    v_where := format('LAST KNOWN position %s, %s (app heartbeat %s)',
      round(v_lat::numeric, 5), round(v_lng::numeric, 5),
      to_char(v_last_at at time zone 'Africa/Johannesburg', 'HH24:MI'));
    v_note := 'No GPS fix at the time of the SOS — pin is the officer''s last known position.';
  else
    -- No made-up pin: 0,0 is "unknown" to every map in the system.
    v_lat := 0;
    v_lng := 0;
    v_where := 'POSITION UNKNOWN — raise the officer on the radio for their location';
    v_note := 'No GPS fix and no last known position for this officer.';
  end if;

  insert into public.incidents (
    silo, source, incident_number, client_ref,
    caller_name, caller_number, call_description,
    incident_type, incident_severity,
    location_address, location_lat, location_lng,
    status, call_timestamp, incident_created_at,
    responding_officer, created_by, notes
  ) values (
    v_silo, 'Responder-Panic', public.next_incident_number(v_silo), p_client_ref,
    v_name, coalesce(v_phone, 'Unknown'),
    format('SOS — OFFICER REQUIRES IMMEDIATE ASSISTANCE. %s%s',
      case when v_unit is not null then 'Unit ' || v_unit || '. ' else '' end,
      coalesce(nullif(p_note, ''), 'No further detail — assume the worst until contact is made.')),
    'Officer Emergency', 'Critical',
    v_where, v_lat, v_lng,
    -- Waits in the dispatch queue until someone sends it out.
    'Pending', v_at, v_at, v_name, auth.uid(),
    v_note
  )
  returning * into v_incident;

  -- The desks that can act on it: this department's dispatch desk and the
  -- central control room, and this department's command. Each personally.
  for r in
    select pr.id, pr.silo from public.profiles pr
    where pr.tenant_id = v_incident.tenant_id
      and pr.id <> auth.uid()
      and (
        (pr.role in ('Dispatcher', 'ControlRoom', 'Supervisor') and pr.silo in (v_silo, 'Ethekwini'))
        or (pr.role in ('Captain', 'FireChief') and pr.silo = v_silo)
      )
  loop
    insert into public.alerts (
      tenant_id, silo, target_user_id, kind, severity, title, body, incident_id,
      link, presentation, requires_ack, created_by, created_by_name
    ) values (
      v_incident.tenant_id, r.silo, r.id, 'sos', 'Critical',
      format('SOS — %s needs assistance', v_name),
      format('%s · %s', v_where, coalesce('Unit ' || v_unit, 'No unit assigned')),
      v_incident.id, '/incidents/' || v_incident.id::text,
      'modal', true, auth.uid(), v_name
    );
    v_sent := v_sent + 1;
  end loop;

  -- Never silent: with no desk or command account to reach, the tenant's
  -- oversight seats hear it instead.
  if v_sent = 0 then
    v_fallback := true;
    for r in
      select pr.id, pr.silo from public.profiles pr
      where pr.tenant_id = v_incident.tenant_id
        and pr.id <> auth.uid()
        and pr.role in ('SystemController', 'SystemAdmin')
    loop
      insert into public.alerts (
        tenant_id, silo, target_user_id, kind, severity, title, body, incident_id,
        link, presentation, requires_ack, created_by, created_by_name
      ) values (
        v_incident.tenant_id, r.silo, r.id, 'sos', 'Critical',
        format('SOS — %s needs assistance', v_name),
        format('%s · %s · no dispatch desk reachable for this department',
          v_where, coalesce('Unit ' || v_unit, 'No unit assigned')),
        v_incident.id, '/incidents/' || v_incident.id::text,
        'modal', true, auth.uid(), v_name
      );
      v_sent := v_sent + 1;
    end loop;
  end if;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name, timestamp)
  values (v_silo, v_incident.id,
    format('[SOS] Raised from the responder app%s. %s %s alerted; awaiting dispatch.',
      case when v_at < now() - interval '30 seconds'
        then format(' (sent offline, delivered %s later)', to_char(now() - v_at, 'HH24:MI:SS')) else '' end,
      v_sent,
      case when v_fallback then 'oversight staff (no dispatch desk for this department)'
           else 'dispatch and command staff' end),
    auth.uid(), v_name, v_at);

  insert into public.audit_logs (
    silo, user_id, user_name, department, action_type, entity_type, entity_id, details
  ) values (
    v_silo, auth.uid(), v_name, v_silo::text, 'PANIC_RAISED', 'incidents', v_incident.id::text,
    format('SOS raised by %s at %s', v_name, v_where)
  );

  return v_incident;
end $$;

revoke execute on function public.raise_panic(double precision, double precision, double precision, text, uuid, timestamptz) from public, anon;
grant  execute on function public.raise_panic(double precision, double precision, double precision, text, uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';
