-- ============================================================================
-- 0074 — The officer closes their part of the call
-- ============================================================================
--
-- Run after 0073.
--
-- V4 closed the call on scene when the officer filed: "Incident CLOSED on
-- scene by <officer>. Unit back in service." and told dispatch. Since 0073 the
-- report finishes the department's part, the call waits for every department,
-- and case review closes the case (0061). The officer had no step of their
-- own that says "I am done here", and dispatch had to read the timeline to
-- know.
--
-- Now, once a department's report is filed, the lead of that department's
-- part closes it from the phone:
--
--   close_department_part()   the lead, their own department, report filed
--                             → the part is closed on scene, with who and when
--                             → the timeline says so, and which departments
--                               are still on the call ("waiting on Fire & Rescue")
--                             → dispatch (each department's dispatcher),
--                               command, the control room and the department's
--                               administrators are told
--
-- What this does not change: the call is still Resolved when every department
-- has filed or been stood down, and the case is still closed by case review
-- (close_case, 0061). The officer's close neither closes the case nor holds
-- it up. Nothing new is readable: the columns below sit on
-- incident_departments, read under its 0073 rule (whoever may see the call),
-- and are written only by the function.
--
-- Additive and safe to re-run.
-- ============================================================================

-- ── 1. Who closed a department's part, and when ─────────────────────────────

alter table public.incident_departments
  add column if not exists closed_at      timestamptz,
  add column if not exists closed_by      uuid,
  add column if not exists closed_by_name text,
  add column if not exists close_note     text;

do $$ begin
  alter table public.incident_departments
    add constraint incident_departments_close_after_report
    check (closed_at is null or report_filed_at is not null);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.incident_departments
    add constraint incident_departments_close_note_length
    check (close_note is null or length(close_note) <= 500);
exception when duplicate_object then null; end $$;

comment on column public.incident_departments.closed_at is
  'When the lead closed this department''s part on scene, after its report (0074). Case review still closes the case.';

-- ── 2. Closing a part ───────────────────────────────────────────────────────

-- The lead of their own department's part, once its report is filed. Safe to
-- run twice (an offline retry, a double tap): a part already closed, or a
-- case already closed by review, is returned as it is. `p_occurred_at` is when
-- the officer pressed Close, for a close queued offline; it is held between
-- the report and now.
create or replace function public.close_department_part(
  p_incident_id uuid,
  p_note        text default null,
  p_occurred_at timestamptz default null
)
returns public.incident_departments language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_dept     public.incident_departments;
  v_silo     public.silo;
  v_label    text;
  v_name     text;
  v_note     text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
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

  v_at := greatest(
    v_dept.report_filed_at,
    case when p_occurred_at is null or p_occurred_at > now() or p_occurred_at < now() - interval '12 hours'
         then now() else p_occurred_at end
  );
  select full_name into v_name from public.profiles where id = auth.uid();

  update public.incident_departments
     set closed_at = v_at, closed_by = auth.uid(), closed_by_name = v_name, close_note = v_note, updated_at = now()
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
    format('[CLOSED ON SCENE] %s closed by %s.%s %s',
      v_label, coalesce(v_name, 'the lead'),
      coalesce(' ' || v_note, ''),
      case when v_waiting is not null then format('Waiting on %s.', v_waiting)
           when v_incident.status = 'Resolved' then 'Every department has closed. Ready for case review.'
           else 'Every department has closed.' end),
    auth.uid(), v_name, v_at);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, v_incident.silo, auth.uid(), v_name, v_silo::text, 'DEPARTMENT_CLOSED', 'incidents',
    v_incident.id::text,
    format('%s closed %s for %s%s', coalesce(v_name, 'The lead'), v_incident.incident_number, v_label, coalesce(': ' || v_note, '')));

  v_title := case when v_waiting is not null
                  then format('%s: %s closed by %s. Waiting on %s', v_incident.incident_number, v_label, coalesce(v_name, 'the lead'), v_waiting)
                  else format('%s: closed by every department', v_incident.incident_number) end;
  v_body := format('%s · %s%s', v_incident.incident_type, v_incident.location_address, coalesce(' · ' || v_note, ''));

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

revoke all on function public.close_department_part(uuid, text, timestamptz) from public, anon;
grant execute on function public.close_department_part(uuid, text, timestamptz) to authenticated;

-- ── 3. Prove it ─────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'incident_departments' and column_name = 'closed_at') then
    raise exception '0074: incident_departments.closed_at is missing';
  end if;
  if has_function_privilege('anon', 'public.close_department_part(uuid, text, timestamptz)', 'EXECUTE') then
    raise exception '0074: anon can close incidents';
  end if;
  if has_table_privilege('authenticated', 'public.incident_departments', 'UPDATE') then
    raise exception '0074: incident_departments is writable outside the functions';
  end if;
  -- One signature: an extra overload would make PostgREST resolve calls to neither.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'close_department_part') <> 1 then
    raise exception '0074: close_department_part has more than one signature';
  end if;
end $$;

notify pgrst, 'reload schema';
