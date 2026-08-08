-- ============================================================================
-- 0031 — Tenant guards on the privileged functions
-- ============================================================================
--
-- 0030's restrictive policies bind every query that runs AS the user. They do
-- not bind SECURITY DEFINER functions, which is the whole point of DEFINER —
-- so each one must carry the boundary itself. Three treatments:
--
--   FLIP TO INVOKER  where the function only reads and RLS gives the right
--   answer anyway: the dispatcher KPI rollup and the duplicate check. Losing
--   DEFINER costs nothing — every permitted caller can already read the rows
--   involved — and the tenant boundary comes for free, from the same policy
--   that binds every other query. The least code is the code that cannot be
--   wrong.
--
--   GUARD THE WHERE  for the uuid-targeted mutators (route, dispatch, status,
--   close). A uuid is unguessable, but "unguessable" is not an authorization
--   model: a copied link in the wrong tenant's console must hit zero rows.
--
--   STAMP EXPLICITLY  where the writer is not the tenant. The automation
--   engine runs as the platform with no JWT; if its alerts took the column
--   default they would all land in the founding tenant. Every rule now
--   carries the tenant of the row that triggered it.
-- ============================================================================

-- ── Flip to INVOKER ─────────────────────────────────────────────────────────

alter function public.get_dispatcher_kpis(silo) security invoker;
alter function public.check_duplicate_incident(text, text, text) security invoker;

-- ── Per-tenant incident numbering ───────────────────────────────────────────

create or replace function public.next_incident_number(p_silo silo)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.current_tenant();
  v_day date := (now() at time zone 'Africa/Johannesburg')::date;
  v_seq int;
begin
  insert into public.incident_number_counters (tenant_id, silo, day, last_seq)
  values (v_tenant, p_silo, v_day, 1)
  on conflict (tenant_id, silo, day)
    do update set last_seq = public.incident_number_counters.last_seq + 1
  returning last_seq into v_seq;

  return 'INC-' || to_char(v_day, 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');
end $$;

-- ── Guard the uuid-targeted mutators ────────────────────────────────────────

create or replace function public.route_incident(p_incident_id uuid, p_silos silo[], p_notes text default null)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
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
     and tenant_id = public.current_tenant()
  returning * into v_incident;

  if not found then raise exception 'Incident % not found', p_incident_id; end if;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[DISPATCH] Routed to %s', array_to_string(p_silos, ', ')),
    auth.uid(), v_name);

  insert into public.audit_logs (silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_incident.silo, auth.uid(), v_name, 'IncidentRouted', 'incident', v_incident.id,
    format('Routed to %s', array_to_string(p_silos, ', ')));

  perform public.raise_dispatch_alerts(v_incident.id, p_silos, v_name);

  return v_incident;
end $$;

create or replace function public.dispatch_unit(p_incident_id uuid, p_unit_id uuid, p_unit_type text, p_target_silos silo[])
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
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
     and tenant_id = public.current_tenant()
  returning * into v_incident;

  if not found then raise exception 'Incident % not found', p_incident_id; end if;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[DISPATCH] Unit assigned, target silos: %s', array_to_string(p_target_silos, ', ')),
    auth.uid(), (select full_name from public.profiles where id = auth.uid()));

  insert into public.audit_logs (silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.silo, auth.uid(),
    (select full_name from public.profiles where id = auth.uid()),
    v_incident.silo::text, 'DISPATCH', 'incidents', v_incident.id::text,
    format('Dispatched %s to %s', p_unit_type, array_to_string(p_target_silos, ', ')));

  return v_incident;
end $$;

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
begin
  perform public.require_role(
    'Responder','Firefighter','Paramedic','Officer','Constable','Sergeant','Captain',
    'Chief','FireChief','Supervisor','Dispatcher','ControlRoom','Operator',
    'Admin','SystemAdmin','SuperAdmin','System'
  );

  v_at := case
    when p_occurred_at is null then now()
    when p_occurred_at > now() then now()
    when p_occurred_at < now() - interval '12 hours' then now()
    else p_occurred_at
  end;

  v_queued := p_occurred_at is not null and v_at < now() - interval '30 seconds';

  update public.incidents
     set status              = p_status,
         acceptance          = case when p_status = 'En Route' then true else acceptance end,
         arrived_timestamp   = case
                                 when p_status in ('Arrived','On Scene') and arrived_timestamp is null
                                   then v_at
                                 else arrived_timestamp
                               end,
         responding_officer  = coalesce(responding_officer, v_name),
         unit_status         = p_status::text,
         updated_at          = now()
   where id = p_incident_id
     and tenant_id = public.current_tenant()
  returning * into v_incident;

  if not found then raise exception 'Incident % not found', p_incident_id; end if;

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

  return v_incident;
end $$;

create or replace function public.close_case(p_incident_id uuid, p_reason text default null)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_name     text := coalesce((select full_name from public.profiles where id = auth.uid()), 'Supervisor');
begin
  perform public.require_role('SystemAdmin','SuperAdmin','Admin','Supervisor','Captain','Chief','FireChief','Dispatcher','Operator','ControlRoom','System');

  update public.incidents
     set status   = 'Closed',
         closed_at = now()
   where id = p_incident_id
     and tenant_id = public.current_tenant()
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

-- ── Panic: alerts inherit the incident's tenant ─────────────────────────────

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
  v_silos    silo[];
  v_target   silo;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Deliberately no require_role(): every account may call for help.

  if p_client_ref is not null then
    select * into v_existing from public.incidents
     where client_ref = p_client_ref and tenant_id = public.current_tenant();
    if found then return v_existing; end if;
  end if;

  select coalesce(pr.silo, 'Ethekwini'::silo),
         coalesce(pr.full_name, 'Unknown officer'),
         pr.contact_number
    into v_silo, v_name, v_phone
    from public.profiles pr
   where pr.id = auth.uid();

  if v_silo is null then v_silo := 'Ethekwini'; end if;
  if v_name is null then v_name := 'Unknown officer'; end if;

  select a.unit_number into v_unit
    from public.personnel p
    join public.apparatus a on a.id = p.assigned_apparatus_id
   where p.user_id = auth.uid()
   limit 1;

  v_at := case
    when p_occurred_at is null then now()
    when p_occurred_at > now() then now()
    when p_occurred_at < now() - interval '12 hours' then now()
    else p_occurred_at
  end;

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
    format('OFFICER REQUIRES IMMEDIATE ASSISTANCE. %s%s',
      case when v_unit is not null then 'Unit ' || v_unit || '. ' else '' end,
      coalesce(nullif(p_note, ''), 'No further detail — assume the worst until contact is made.')),
    'Officer Emergency', 'Critical',
    case
      when p_lat is not null and p_lng is not null
        then format('Officer position %s, %s%s',
                    round(p_lat::numeric, 5), round(p_lng::numeric, 5),
                    case when p_accuracy is not null
                      then format(' (±%sm)', round(p_accuracy::numeric)) else '' end)
      else 'POSITION UNKNOWN — last known location required from dispatch'
    end,
    coalesce(p_lat, -29.8587), coalesce(p_lng, 31.0218),
    'Dispatched', v_at, v_at, v_name, auth.uid(),
    case when p_lat is null then 'GPS unavailable on the reporting device.' else null end
  )
  returning * into v_incident;

  v_silos := array(select distinct unnest(array[v_silo, 'Ethekwini'::silo]));

  foreach v_target in array v_silos loop
    insert into public.alerts (
      tenant_id, silo, kind, severity, title, body, incident_id,
      link, presentation, requires_ack, created_by, created_by_name
    ) values (
      v_incident.tenant_id, v_target, 'assignment', 'Critical',
      format('OFFICER EMERGENCY — %s', v_name),
      format('%s · %s', v_incident.location_address,
             case when v_unit is not null then 'Unit ' || v_unit else 'No unit assigned' end),
      v_incident.id, '/incidents/' || v_incident.id::text,
      'modal', true, auth.uid(), v_name
    );
  end loop;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name, timestamp)
  values (v_silo, v_incident.id, '[PANIC] Emergency raised from the responder app.',
          auth.uid(), v_name, v_at);

  insert into public.audit_logs (
    silo, user_id, user_name, department, action_type, entity_type, entity_id, details
  ) values (
    v_silo, auth.uid(), v_name, v_silo::text, 'PANIC_RAISED', 'incidents', v_incident.id::text,
    format('Panic raised by %s at %s', v_name, v_incident.location_address)
  );

  return v_incident;
end $$;

-- ── Automations stamp the source row's tenant ───────────────────────────────

drop function if exists public.automation_alert(silo, text, text, text, uuid, uuid, text, text, int);

create or replace function public.automation_alert(
  p_tenant      uuid,
  p_silo        silo,
  p_title       text,
  p_body        text,
  p_severity    text default 'Medium',
  p_incident_id uuid default null,
  p_target_user uuid default null,
  p_link        text default null,
  p_presentation text default 'toast',
  p_expires_hours int default 24
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  insert into public.alerts (
    tenant_id, silo, target_user_id, kind, severity, title, body, incident_id, link,
    presentation, requires_ack, created_by, created_by_name, expires_at
  ) values (
    p_tenant, p_silo, p_target_user, 'system', p_severity, p_title, p_body, p_incident_id, p_link,
    p_presentation, p_presentation = 'modal', null, 'Criticomm automation',
    now() + make_interval(hours => p_expires_hours)
  )
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.automation_alert(uuid, silo, text, text, text, uuid, uuid, text, text, int)
  from public, anon, authenticated;

create or replace function public.automation_sla_unassigned(p_config jsonb)
returns table (affected int, detail text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_warn int := public.automation_cfg_int(p_config, 'warn_minutes', 10);
  v_crit int := public.automation_cfg_int(p_config, 'critical_minutes', 20);
  v_count int := 0;
  v_worst int := 0;
  r record;
  v_bucket text;
  v_age int;
begin
  for r in
    select i.id, i.tenant_id, i.silo, i.incident_number, i.incident_type, i.incident_severity,
           i.location_address, i.call_timestamp
      from public.incidents i
     where i.status in ('New','Pending','Pending Dispatch','Pending Analysis')
       and i.call_timestamp < now() - make_interval(mins => v_warn)
     order by i.call_timestamp
     limit 200
  loop
    v_age := floor(extract(epoch from (now() - r.call_timestamp)) / 60);
    v_bucket := case when v_age >= v_crit then 'critical' else 'warn' end;

    if public.automation_claim('sla_unassigned', r.id::text, v_bucket) then
      perform public.automation_alert(
        r.tenant_id, r.silo,
        format('Unassigned %s min — %s', v_age, r.incident_number),
        format('%s · %s · %s', r.incident_type, r.incident_severity, r.location_address),
        case when v_bucket = 'critical' then 'Critical' else 'High' end,
        r.id, null, '/dispatch/assign/' || r.id::text,
        case when v_bucket = 'critical' then 'modal' else 'toast' end, 6
      );
      if r.silo <> 'Ethekwini' then
        perform public.automation_alert(
          r.tenant_id, 'Ethekwini',
          format('Unassigned %s min — %s (%s)', v_age, r.incident_number, r.silo),
          format('%s · %s', r.incident_type, r.location_address),
          case when v_bucket = 'critical' then 'Critical' else 'High' end,
          r.id, null, '/dispatch/assign/' || r.id::text, 'toast', 6
        );
      end if;
      v_count := v_count + 1;
      v_worst := greatest(v_worst, v_age);
    end if;
  end loop;

  return query select v_count,
    case when v_count = 0 then 'No newly-breached calls'
    else format('%s call(s) escalated, oldest %s min', v_count, v_worst) end;
end $$;

create or replace function public.automation_sla_no_arrival(p_config jsonb)
returns table (affected int, detail text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_after int := public.automation_cfg_int(p_config, 'minutes', 30);
  v_count int := 0;
  r record;
begin
  for r in
    select i.id, i.tenant_id, i.silo, i.incident_number, i.incident_type, i.location_address,
           coalesce(i.dispatch_time, i.call_timestamp) as from_time
      from public.incidents i
     where i.status in ('Dispatched','En Route')
       and i.arrived_timestamp is null
       and coalesce(i.dispatch_time, i.call_timestamp) < now() - make_interval(mins => v_after)
     order by from_time
     limit 200
  loop
    if public.automation_claim('sla_no_arrival', r.id::text, 'overdue') then
      perform public.automation_alert(
        r.tenant_id, r.silo,
        format('No arrival after %s min — %s', v_after, r.incident_number),
        format('%s · %s. Confirm the crew is en route.', r.incident_type, r.location_address),
        'High', r.id, null, '/incidents/' || r.id::text, 'toast', 6
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return query select v_count,
    case when v_count = 0 then 'All dispatched calls progressing'
    else format('%s call(s) with no arrival past %s min', v_count, v_after) end;
end $$;

create or replace function public.automation_stale_incidents(p_config jsonb)
returns table (affected int, detail text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_hours int := public.automation_cfg_int(p_config, 'hours', 4);
  v_count int := 0;
  r record;
begin
  for r in
    select i.id, i.tenant_id, i.silo, i.incident_number, i.incident_type, i.status,
           greatest(
             coalesce(i.updated_at, i.incident_created_at),
             coalesce((select max(u.timestamp) from public.incident_updates u
                        where u.incident_id = i.id), i.incident_created_at)
           ) as last_touch
      from public.incidents i
     where i.status in ('En Route','Arrived','On Scene','Transporting','Active')
     order by i.incident_created_at
     limit 300
  loop
    continue when r.last_touch >= now() - make_interval(hours => v_hours);

    if public.automation_claim('stale_incidents', r.id::text,
                               to_char(now() at time zone 'Africa/Johannesburg', 'YYYY-MM-DD')) then
      perform public.automation_alert(
        r.tenant_id, r.silo,
        format('No update in %s h — %s', v_hours, r.incident_number),
        format('%s, still %s. Ask the crew for a situation report or close it.',
               r.incident_type, r.status),
        'Medium', r.id, null, '/incidents/' || r.id::text, 'toast', 12
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return query select v_count,
    case when v_count = 0 then 'No stale incidents'
    else format('%s incident(s) with no update in %s h', v_count, v_hours) end;
end $$;

create or replace function public.automation_cert_expiry(p_config jsonb)
returns table (affected int, detail text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_windows int[] := coalesce(
    (select array_agg(trim(w)::int) from unnest(string_to_array(
       coalesce(nullif(p_config ->> 'windows', ''), '30,7,1'), ',')) w),
    array[30, 7, 1]
  );
  v_count int := 0;
  v_window int;
  r record;
begin
  foreach v_window in array v_windows loop
    for r in
      select c.id, c.tenant_id, c.silo, c.name, c.expiry_date,
             p.first_name, p.last_name, p.user_id
        from public.certifications c
        join public.personnel p on p.id = c.personnel_id
       where c.expiry_date between current_date and current_date + v_window
       limit 500
    loop
      if public.automation_claim('cert_expiry', r.id::text, v_window::text) then
        if r.user_id is not null then
          perform public.automation_alert(
            r.tenant_id, r.silo,
            format('%s expires %s', r.name, to_char(r.expiry_date, 'DD Mon')),
            format('Your %s lapses in %s day(s). Renewal has to be recorded before it does.',
                   r.name, (r.expiry_date - current_date)),
            case when v_window <= 7 then 'High' else 'Medium' end,
            null, r.user_id, '/profile/my-hr', 'toast', 72
          );
        end if;
        perform public.automation_alert(
          r.tenant_id, r.silo,
          format('Certification lapsing — %s %s', r.first_name, r.last_name),
          format('%s expires %s (%s day(s)).', r.name,
                 to_char(r.expiry_date, 'DD Mon YYYY'), (r.expiry_date - current_date)),
          case when v_window <= 7 then 'High' else 'Low' end,
          null, null, '/hr', 'toast', 72
        );
        v_count := v_count + 1;
      end if;
    end loop;
  end loop;

  return query select v_count,
    case when v_count = 0 then 'No certifications entering a warning window'
    else format('%s certification warning(s) raised', v_count) end;
end $$;

create or replace function public.automation_duty_unacknowledged(p_config jsonb)
returns table (affected int, detail text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_lead int := public.automation_cfg_int(p_config, 'lead_hours', 12);
  v_count int := 0;
  r record;
begin
  for r in
    select ro.id, ro.tenant_id, ro.silo, ro.user_id, ro.user_name, ro.post, ro.station,
           ro.start_at
      from public.rosters ro
     where ro.published
       and ro.acknowledged_at is null
       and ro.user_id is not null
       and ro.start_at is not null
       and ro.start_at between now() and now() + make_interval(hours => v_lead)
     limit 300
  loop
    if public.automation_claim('duty_unacknowledged', r.id::text, 'reminder') then
      perform public.automation_alert(
        r.tenant_id, r.silo,
        'Confirm your next duty',
        format('%s at %s, %s. Open My Schedule and acknowledge it.',
               coalesce(r.post, 'Duty'),
               to_char(r.start_at at time zone 'Africa/Johannesburg', 'HH24:MI on DD Mon'),
               coalesce(r.station, 'station TBC')),
        'Medium', null, r.user_id, '/roster/mine', 'toast', 24
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return query select v_count,
    case when v_count = 0 then 'All imminent duties acknowledged'
    else format('%s unacknowledged duty reminder(s)', v_count) end;
end $$;

create or replace function public.automation_daily_digest(p_config jsonb)
returns table (affected int, detail text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_hour int := public.automation_cfg_int(p_config, 'hour', 6);
  v_local timestamptz := now() at time zone 'Africa/Johannesburg';
  v_today date := v_local::date;
  v_from timestamptz := (v_today - 1)::timestamp at time zone 'Africa/Johannesburg';
  v_to   timestamptz := v_today::timestamp at time zone 'Africa/Johannesburg';
  v_count int := 0;
  r record;
begin
  if extract(hour from v_local) <> v_hour then
    return query select 0, format('Outside the digest hour (%s:00)', v_hour);
    return;
  end if;

  for r in
    select i.tenant_id, i.silo,
           count(*)::int                                                 as total,
           count(*) filter (where i.incident_severity = 'Critical')::int as critical,
           count(*) filter (where i.status in ('Closed','Resolved'))::int as closed,
           avg(extract(epoch from (i.arrived_timestamp - i.call_timestamp)) / 60.0)
             filter (where i.arrived_timestamp is not null)               as avg_response
      from public.incidents i
     where i.call_timestamp >= v_from and i.call_timestamp < v_to
     group by i.tenant_id, i.silo
  loop
    if public.automation_claim('daily_digest', r.tenant_id::text || ':' || r.silo::text, v_today::text) then
      perform public.automation_alert(
        r.tenant_id, r.silo,
        format('Yesterday: %s calls, %s closed', r.total, r.closed),
        format('%s Critical. Average response %s. Closure rate %s%%.',
               r.critical,
               case when r.avg_response is null then 'not recorded'
                    else round(r.avg_response)::text || ' min' end,
               case when r.total = 0 then '0'
                    else round((r.closed::numeric / r.total) * 100)::text end),
        'Low', null, null, '/analytics', 'toast', 12
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return query select v_count,
    case when v_count = 0 then 'Digest already sent, or no calls yesterday'
    else format('Digest sent to %s department(s)', v_count) end;
end $$;
