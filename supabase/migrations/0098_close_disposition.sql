-- ============================================================================
-- 0098 — How a call ended: the disposition code when a part is closed on scene
-- ============================================================================
--
-- Run after 0097.
--
-- Standard dispatch practice: the unit clearing a call says how it ended,
-- from a short list (arrest made, report taken, gone on arrival…), so the
-- figures say what actually happened. Closing on scene (0074) and closing
-- for a crew from the desk (0075) took only a free-text note. Now each takes
-- an outcome too, kept on the department's part, written on the call's
-- timeline, in the audit trail and in the closing notice to dispatch and
-- command.
--
--   incident_departments.disposition   the outcome code, one of the list
--   disposition_codes()                the list (as packages/db/src/dispositions.ts)
--   disposition_label()                a code in words
--   close_department_part()            + p_disposition
--   close_department_part_from_desk()  + p_disposition
--
-- The new screens require an outcome. A phone not yet updated still closes
-- without one: the outcome is optional to the database, never wrong.
--
-- Safe to re-run.
-- ============================================================================

alter table public.incident_departments add column if not exists disposition text;

create or replace function public.disposition_codes()
returns text[] language sql immutable set search_path to 'public' as $$
  select array['GOA', 'REFERRED', 'UNFOUNDED', 'ARREST', 'REPORT', 'ADVICE', 'DUPLICATE', 'EXTINGUISHED', 'RESCUE', 'SAFE', 'FALSE_ALARM', 'TRANSPORTED', 'TREATED', 'REFUSED', 'DOA', 'ASSISTED', 'ASSESSED']::text[]
$$;
grant execute on function public.disposition_codes() to authenticated, service_role;

/** An outcome code in words; null for none. */
create or replace function public.disposition_label(p_code text)
returns text language sql immutable set search_path to 'public' as $$
  select case p_code
    when 'GOA' then 'Gone on arrival'
    when 'REFERRED' then 'Referred to another agency'
    when 'UNFOUNDED' then 'Unfounded or false call'
    when 'ARREST' then 'Arrest made'
    when 'REPORT' then 'Report taken, case opened'
    when 'ADVICE' then 'Advice given, no further action'
    when 'DUPLICATE' then 'Duplicate of another call'
    when 'EXTINGUISHED' then 'Fire put out'
    when 'RESCUE' then 'Rescue done'
    when 'SAFE' then 'Scene made safe'
    when 'FALSE_ALARM' then 'False alarm'
    when 'TRANSPORTED' then 'Patient taken to hospital'
    when 'TREATED' then 'Treated on scene, not taken'
    when 'REFUSED' then 'Patient refused help'
    when 'DOA' then 'Dead on arrival'
    when 'ASSISTED' then 'Residents assisted'
    when 'ASSESSED' then 'Damage assessed'
    else p_code
  end
$$;
grant execute on function public.disposition_label(text) to authenticated, service_role;

do $$
begin
  alter table public.incident_departments drop constraint if exists incident_departments_disposition_check;
  alter table public.incident_departments add constraint incident_departments_disposition_check
    check (disposition is null or disposition = any (array['GOA', 'REFERRED', 'UNFOUNDED', 'ARREST', 'REPORT', 'ADVICE', 'DUPLICATE', 'EXTINGUISHED', 'RESCUE', 'SAFE', 'FALSE_ALARM', 'TRANSPORTED', 'TREATED', 'REFUSED', 'DOA', 'ASSISTED', 'ASSESSED']::text[]));
end $$;

comment on column public.incident_departments.disposition is
  'How the call ended for this department, picked when its part was closed on scene (0098). One of disposition_codes().';

-- ── Closing on scene, with the outcome ─────────────────────────────────────

drop function if exists public.close_department_part(uuid, text, timestamptz);
create or replace function public.close_department_part(
  p_incident_id uuid,
  p_note        text default null,
  p_occurred_at timestamptz default null,
  p_disposition text default null
)
returns public.incident_departments language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_dept     public.incident_departments;
  v_silo     public.silo;
  v_label    text;
  v_name     text;
  v_note     text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
  v_disp     text := nullif(upper(btrim(coalesce(p_disposition, ''))), '');
  v_said     text;
  v_at       timestamptz;
  v_waiting  text;
  v_title    text;
  v_body     text;
begin
  perform public.require_role(
    'Responder','Police','Officer','Metro','Security','Firefighter','Paramedic','Disaster','Captain'
  );
  -- A deactivated account closes nothing.
  if not public.role_in('Responder','Police','Officer','Metro','Security','Firefighter','Paramedic','Disaster','Captain') then
    raise exception 'Your account cannot close incidents' using errcode = '42501';
  end if;

  select * into v_incident from public.incidents
   where id = p_incident_id and tenant_id = public.current_tenant()
   for update;
  -- SECURITY DEFINER skips row security: someone not on the call learns
  -- nothing about it, not even its number (as close_case, 0061).
  if not found or not public.can_work_incident(p_incident_id) then
    raise exception 'Incident not found' using errcode = 'P0002';
  end if;

  -- The officer's own department, as update_responder_status() reads it.
  select coalesce(
           (select pe.silo from public.personnel pe
             where pe.user_id = auth.uid() and pe.tenant_id = v_incident.tenant_id limit 1),
           public.current_silo())
    into v_silo;
  v_label := public.department_label(v_silo);

  select * into v_dept from public.incident_departments
   where incident_id = p_incident_id and silo = v_silo
   for update;
  -- Only the lead of this department's part: the one who filed its report.
  if not found or v_dept.lead_id is distinct from auth.uid() then
    raise exception 'Only the lead on % closes it for %', v_incident.incident_number, v_label
      using errcode = '42501';
  end if;

  if v_dept.closed_at is not null or v_incident.status = 'Closed' then
    return v_dept;
  end if;
  if v_dept.status <> 'Resolved' or v_dept.report_filed_at is null then
    raise exception 'File the report on % before you close it', v_incident.incident_number;
  end if;

  -- An outcome from the list (0098); older phones may still send none.
  if v_disp is not null and not (v_disp = any (public.disposition_codes())) then
    raise exception 'That outcome is not on the list' using errcode = '22023';
  end if;
  v_said := public.disposition_label(v_disp);

  v_at := greatest(
    v_dept.report_filed_at,
    case when p_occurred_at is null or p_occurred_at > now() or p_occurred_at < now() - interval '12 hours'
         then now() else p_occurred_at end
  );
  select full_name into v_name from public.profiles where id = auth.uid();

  update public.incident_departments
     set closed_at = v_at, closed_by = auth.uid(), closed_by_name = v_name, close_note = v_note, disposition = v_disp, updated_at = now()
   where id = v_dept.id
  returning * into v_dept;

  -- The departments still on the call: working it, or filed and not closed.
  select string_agg(public.department_label(d.silo), ', ' order by d.silo) into v_waiting
    from public.incident_departments d
   where d.incident_id = p_incident_id and d.id <> v_dept.id
     and (public.department_open(d.status) or (d.status = 'Resolved' and d.closed_at is null));

  -- Live screens (console, other crews) refresh on the call's row.
  update public.incidents set updated_at = now() where id = p_incident_id
  returning * into v_incident;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name, timestamp)
  values (v_incident.silo, v_incident.id,
    format('[CLOSED ON SCENE] %s closed by %s.%s%s %s',
      v_label, coalesce(v_name, 'the lead'),
      coalesce(' Outcome: ' || v_said || '.', ''),
      coalesce(' ' || v_note, ''),
      case when v_waiting is not null then format('Waiting on %s.', v_waiting)
           when v_incident.status = 'Resolved' then 'Every department has closed. Ready for case review.'
           else 'Every department has closed.' end),
    auth.uid(), v_name, v_at);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, v_incident.silo, auth.uid(), v_name, v_silo::text, 'DEPARTMENT_CLOSED', 'incidents',
    v_incident.id::text,
    format('%s closed %s for %s%s%s', coalesce(v_name, 'The lead'), v_incident.incident_number, v_label,
      coalesce(' (' || v_said || ')', ''), coalesce(': ' || v_note, '')));

  v_title := case when v_waiting is not null
                  then format('%s: %s closed by %s. Waiting on %s', v_incident.incident_number, v_label, coalesce(v_name, 'the lead'), v_waiting)
                  else format('%s: closed by every department', v_incident.incident_number) end;
  v_body := format('%s · %s%s%s', v_incident.incident_type, v_incident.location_address,
    coalesce(' · ' || v_said, ''), coalesce(' · ' || v_note, ''));

  -- Command, the control room, the department's administrators and the
  -- call's dispatcher (0061's chain)…
  perform public.notify_incident_chain(v_incident, 'officer_closed', v_title, v_body);

  -- …and each department's own dispatcher, who sent their crew to it.
  insert into public.alerts (
    tenant_id, silo, target_user_id, kind, severity, title, body, incident_id, link,
    presentation, requires_ack, created_by, created_by_name
  )
  select v_incident.tenant_id, p.silo, p.id, 'officer_closed', v_incident.incident_severity::text,
         v_title, v_body, v_incident.id, format('/incidents/%s', v_incident.id),
         'toast', false, auth.uid(), v_name
    from public.profiles p
   where p.tenant_id = v_incident.tenant_id
     and p.deactivated_at is null
     and p.id is distinct from auth.uid()
     and p.id is distinct from v_incident.dispatched_by_id
     and p.id in (select d.dispatched_by from public.incident_departments d
                   where d.incident_id = p_incident_id and d.dispatched_by is not null);

  return v_dept;
end $$;

revoke all on function public.close_department_part(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.close_department_part(uuid, text, timestamptz, text) to authenticated;

-- ── Closing for a crew from the desk, with the outcome ─────────────────────

drop function if exists public.close_department_part_from_desk(uuid, public.silo, text);
create or replace function public.close_department_part_from_desk(
  p_incident_id uuid,
  p_silo        public.silo,
  p_note        text default null,
  p_disposition text default null
)
returns public.incident_departments language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_dept     public.incident_departments;
  v_label    text := public.department_label(p_silo);
  v_name     text;
  v_note     text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
  v_disp     text := nullif(upper(btrim(coalesce(p_disposition, ''))), '');
  v_said     text;
  v_waiting  text;
  v_title    text;
  v_body     text;
begin
  perform public.require_role('Dispatcher', 'ControlRoom', 'Operator', 'SystemController', 'System', 'Supervisor',
                              'Captain', 'Chief', 'FireChief', 'Admin', 'SystemAdmin', 'SuperAdmin');

  select * into v_incident from public.incidents
   where id = p_incident_id and tenant_id = public.current_tenant()
   for update;
  if not found or not public.can_work_incident(p_incident_id) then
    raise exception 'Incident not found' using errcode = 'P0002';
  end if;
  if not public.can_direct_department(p_silo) then
    raise exception 'Only % dispatch or command, or the control room, closes it for the crew', v_label using errcode = '42501';
  end if;

  select * into v_dept from public.incident_departments
   where incident_id = p_incident_id and silo = p_silo
   for update;
  if not found then
    raise exception 'The call was not sent to %', v_label using errcode = 'P0002';
  end if;
  if v_dept.closed_at is not null or v_incident.status = 'Closed' then
    return v_dept;
  end if;
  if v_dept.status <> 'Resolved' or v_dept.report_filed_at is null then
    raise exception 'File the % report on % before you close it', v_label, v_incident.incident_number;
  end if;

  -- An outcome from the list (0098); older phones may still send none.
  if v_disp is not null and not (v_disp = any (public.disposition_codes())) then
    raise exception 'That outcome is not on the list' using errcode = '22023';
  end if;
  v_said := public.disposition_label(v_disp);

  select full_name into v_name from public.profiles where id = auth.uid();
  update public.incident_departments
     set closed_at = now(), closed_by = auth.uid(), closed_by_name = v_name, close_note = v_note, disposition = v_disp, updated_at = now()
   where id = v_dept.id
  returning * into v_dept;

  select string_agg(public.department_label(d.silo), ', ' order by d.silo) into v_waiting
    from public.incident_departments d
   where d.incident_id = p_incident_id and d.id <> v_dept.id
     and (public.department_open(d.status) or (d.status = 'Resolved' and d.closed_at is null));

  update public.incidents set updated_at = now() where id = p_incident_id
  returning * into v_incident;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[CLOSED ON SCENE] %s closed from the desk by %s.%s%s %s',
      v_label, coalesce(v_name, 'the desk'), coalesce(' Outcome: ' || v_said || '.', ''), coalesce(' ' || v_note, ''),
      case when v_waiting is not null then format('Waiting on %s.', v_waiting)
           when v_incident.status = 'Resolved' then 'Every department has closed. Ready for case review.'
           else 'Every department has closed.' end),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, v_incident.silo, auth.uid(), v_name, p_silo::text, 'DEPARTMENT_CLOSED', 'incidents',
    v_incident.id::text,
    format('%s closed %s for %s from the desk%s%s', coalesce(v_name, 'The desk'), v_incident.incident_number, v_label,
      coalesce(' (' || v_said || ')', ''), coalesce(': ' || v_note, '')));

  v_title := case when v_waiting is not null
                  then format('%s: %s closed from the desk by %s. Waiting on %s', v_incident.incident_number, v_label, coalesce(v_name, 'the desk'), v_waiting)
                  else format('%s: closed by every department', v_incident.incident_number) end;
  v_body := format('%s · %s%s%s', v_incident.incident_type, v_incident.location_address,
    coalesce(' · ' || v_said, ''), coalesce(' · ' || v_note, ''));

  perform public.notify_incident_chain(v_incident, 'officer_closed', v_title, v_body);
  insert into public.alerts (
    tenant_id, silo, target_user_id, kind, severity, title, body, incident_id, link,
    presentation, requires_ack, created_by, created_by_name
  )
  select v_incident.tenant_id, p.silo, p.id, 'officer_closed', v_incident.incident_severity::text,
         v_title, v_body, v_incident.id, format('/incidents/%s', v_incident.id),
         'toast', false, auth.uid(), v_name
    from public.profiles p
   where p.tenant_id = v_incident.tenant_id
     and p.deactivated_at is null
     and p.id is distinct from auth.uid()
     and p.id is distinct from v_incident.dispatched_by_id
     and p.id in (select d.dispatched_by from public.incident_departments d
                   where d.incident_id = p_incident_id and d.dispatched_by is not null);

  return v_dept;
end $$;

revoke all on function public.close_department_part_from_desk(uuid, public.silo, text, text) from public, anon;
grant execute on function public.close_department_part_from_desk(uuid, public.silo, text, text) to authenticated;

notify pgrst, 'reload schema';
