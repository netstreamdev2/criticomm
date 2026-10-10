-- ============================================================================
-- 0061 — Case review and close: the end of a call's life
-- ============================================================================
--
-- The life of a police call, as the database now enforces it:
--
--   Call-taker logs it                     log_incoming_call()     Pending Dispatch
--   Dispatcher assigns / sends to all      assign_incident() /
--                                          route_incident()        Dispatched
--   Officer accepts, arrives               update_responder_status() En Route → On Scene
--   Officer files the case report          file_incident_report()  Resolved
--   Case manager reviews and closes        close_case()            Closed  (Reviewed)
--
--   …or, for a call that will never have a report (hoax, duplicate, caller
--   cancelled, nobody to send), the desk closes it with a reason:
--                                          close_case()            Closed  (Cancelled)
--
-- What was broken, and what this changes:
--
--   1. A reported call could never be Closed. The console treated Resolved as
--      closed and hid the button, and close_case() refused the CaseManager
--      role outright. close_case() now accepts case managers for resolved
--      calls, records who closed it, how and why, and tells the officers and
--      the chain of command. A live call can only be closed by the desk or
--      command, and only with a reason.
--   2. A case manager in the control silo (Ethekwini) could not see a call
--      owned by Metro Police, nor its report, timeline, evidence or audit
--      trail. A control-silo case manager now reads every case in their own
--      tenant; a department case manager keeps their department.
--   3. The desk could mark a police or fire call Resolved with no report, and
--      anyone could set "Closed" without a record of why. Resolved now needs
--      the report on police and fire calls whoever asks, and Closed is set by
--      close_case() only.
--   4. A Captain responding from the phone was treated as a desk user: never
--      recorded as the accepting officer, so their own report was refused.
--      Captains are field commanders here and respond like officers.
--   5. Case managers are told when a report lands, so the review queue does
--      not depend on someone refreshing a page. Resolving from the phone now
--      stamps resolved_at for every department, not only through a report.
--
-- Additive and safe to re-run. Run after 0060.
-- ============================================================================

-- ── 1. How a case was closed ────────────────────────────────────────────────

alter table public.incidents
  add column if not exists closed_by      uuid,
  add column if not exists closed_by_name text,
  add column if not exists close_kind     text,
  add column if not exists close_reason   text;

do $$ begin
  alter table public.incidents
    add constraint incidents_close_kind_check
    check (close_kind is null or close_kind in ('Reviewed', 'Cancelled'));
exception when duplicate_object then null; end $$;

comment on column public.incidents.close_kind is
  'Reviewed: a resolved case closed after review. Cancelled: a live call closed without a report, with a reason. Null on cases closed before 0061.';

-- The case manager's queues: awaiting review (Resolved, oldest first) and
-- recently closed.
create index if not exists incidents_case_review_idx
  on public.incidents (tenant_id, status, resolved_at);
create index if not exists incidents_closed_at_idx
  on public.incidents (tenant_id, closed_at desc) where closed_at is not null;

-- ── 2. Who reviews cases across the whole tenant ────────────────────────────

-- A case manager seated in the control silo reviews every department's cases
-- in their own tenant. A case manager seated in a department keeps that
-- department, which the existing silo rules already give them.
create or replace function public.is_tenant_case_reviewer() returns boolean
language sql stable security definer set search_path = public as $$
  select public.role_in('CaseManager') and public.current_silo() = 'Ethekwini';
$$;

revoke execute on function public.is_tenant_case_reviewer() from public, anon;
grant  execute on function public.is_tenant_case_reviewer() to authenticated;

-- May the caller work this incident? Unchanged from 0042, plus the tenant-wide
-- case reviewer. This one helper scopes the timeline, evidence (rows and
-- files), responders and the police and fire reports, so the case manager
-- sees the whole case file through it.
create or replace function public.can_work_incident(p_incident_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.incidents i
    where i.id = p_incident_id
      and i.tenant_id = public.current_tenant()
      and (
        public.is_global()
        or i.silo = public.current_silo()
        or public.current_silo() = any(coalesce(i.dispatched_silos, '{}'))
        or i.accepted_by = auth.uid()
        or i.assigned_to = auth.uid()
        or (i.unit_id is not null and i.unit_id = public.my_apparatus_id())
        or exists (select 1 from public.incident_responders r
                   where r.incident_id = i.id and r.user_id = auth.uid())
        or public.is_tenant_case_reviewer()
      )
  );
$$;

-- The incident row itself. The restrictive tenant wall still applies.
drop policy if exists incidents_case_review_read on public.incidents;
create policy incidents_case_review_read on public.incidents for select to authenticated
  using (public.is_tenant_case_reviewer());

-- The case's audit trail. Audit rows are filed under the department that
-- wrote them, which is often not the department reading the case, so the
-- silo rule alone hid half of a case's history from its reviewer. Case
-- managers and command read the trail of any case they can work.
drop policy if exists audit_logs_case_read on public.audit_logs;
create policy audit_logs_case_read on public.audit_logs for select to authenticated
  using (
    entity_type in ('incident', 'incidents')
    and public.role_in('CaseManager', 'Supervisor', 'Captain', 'FireChief', 'Admin')
    and public.can_work_incident(public.try_uuid(entity_id))
  );

-- ── 3. Who hears what ───────────────────────────────────────────────────────

-- As 0039, plus: case managers hear when a case lands for review (resolved)
-- and when one closes; deactivated accounts hear nothing.
create or replace function public.notify_incident_chain(
  p_incident public.incidents,
  p_kind     text,
  p_title    text,
  p_body     text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count int := 0;
  r       record;
begin
  for r in
    select distinct p.id, p.silo
    from public.profiles p
    where p.tenant_id = p_incident.tenant_id
      and p.deactivated_at is null
      and p.id is distinct from auth.uid()
      and (
        p.id = p_incident.dispatched_by_id
        or p.role = 'SystemController'
        or (p.role in ('Supervisor', 'Captain', 'Admin')
            and (p.silo = p_incident.silo or p.silo = any(coalesce(p_incident.dispatched_silos, '{}'))))
        or (p_kind in ('resolved', 'closed') and p.role = 'CaseManager'
            and (p.silo = 'Ethekwini' or p.silo = p_incident.silo
                 or p.silo = any(coalesce(p_incident.dispatched_silos, '{}'))))
      )
  loop
    insert into public.alerts (
      tenant_id, silo, target_user_id, kind, severity, title, body, incident_id, link,
      presentation, requires_ack, created_by, created_by_name
    ) values (
      p_incident.tenant_id, r.silo, r.id, p_kind, p_incident.incident_severity::text,
      p_title, p_body, p_incident.id, format('/incidents/%s', p_incident.id),
      'toast', false, auth.uid(),
      (select full_name from public.profiles where id = auth.uid())
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke execute on function public.notify_incident_chain(public.incidents, text, text, text) from public, anon, authenticated;

-- ── 4. Responding: Captains respond, and Resolved needs the report ──────────

-- As 0042, with these changes, each marked "0061" below:
--   • nobody closes a call through this function: close_case() does;
--   • a Resolved or Closed call cannot be moved back to a live status;
--   • Captain is a field role here (they respond from the phone and file the
--     report as the accepting officer);
--   • nobody, desk included, resolves a police or fire call without its
--     report;
--   • resolving stamps resolved_at / resolved_by.
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
  v_me       public.incident_responders;
  v_joining  boolean := false;
  v_lead     boolean := true;
  v_unit     text;
  -- The field ladder, so a late offline replay never moves anyone backwards.
  v_rank     constant jsonb := '{"En Route":1,"Arrived":2,"On Scene":3,"Transporting":4}';
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

  -- The row lock makes leading first-come: a second officer waits here, then
  -- joins as backup.
  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;

  -- 0061: a case is closed by close_case(), which records who, how and why.
  if p_status = 'Closed' then
    raise exception 'Close % from its case file: closing is recorded with who closed it and why', v_incident.incident_number;
  end if;
  -- 0061: a finished call stays finished. Field crews were already refused
  -- here; the desk could move a Resolved or Closed call back to a live
  -- status and silently reopen it.
  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text);
  end if;

  -- Field crews move only their own place on the call; the desks and command
  -- may still correct the call's status on anyone's behalf.
  -- 0061: Captain added. A Captain responds from the phone like an officer;
  -- as a desk user they were never the accepting officer, so their report
  -- was refused.
  v_field := public.role_in('Responder','Police','Officer','Metro','Security','Firefighter',
                            'Paramedic','Doctor','Disaster','Captain');
  if v_field then
    if v_incident.status in ('Resolved', 'Closed') then
      raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text);
    end if;

    select * into v_me from public.incident_responders
    where incident_id = p_incident_id and user_id = auth.uid();

    if not found then
      if p_status <> 'En Route' then
        raise exception 'Press Responding on % first', v_incident.incident_number;
      end if;
      if not (
        v_incident.assigned_to = auth.uid()
        or (v_incident.dispatch_time is not null
            and v_incident.status not in ('New', 'Pending', 'Pending Dispatch', 'Pending Analysis')
            and public.current_silo() = any(coalesce(v_incident.dispatched_silos, '{}')))
      ) then
        raise exception '% was not sent to you', v_incident.incident_number;
      end if;

      select * into v_person from public.personnel
      where user_id = auth.uid() and tenant_id = public.current_tenant();
      if not coalesce(v_person.is_on_duty, false) then
        raise exception 'Go on duty to respond to incidents';
      end if;

      -- The assigned officer leads an assigned call; an open call is led by
      -- whoever responds first. Everyone else is backup.
      v_lead := v_incident.accepted_by is null
                and (v_incident.assigned_to is null or v_incident.assigned_to = auth.uid());

      insert into public.incident_responders (
        tenant_id, incident_id, user_id, silo, name, unit_id, role, status, joined_at
      ) values (
        v_incident.tenant_id, v_incident.id, auth.uid(), v_person.silo, v_name,
        v_person.assigned_apparatus_id, case when v_lead then 'lead' else 'backup' end, 'En Route', v_at
      ) returning * into v_me;
      v_joining := true;
    else
      v_lead := v_me.role = 'lead';
      -- Replays and steps backwards along the ladder are no-ops.
      if v_rank ? p_status::text
         and (v_rank ->> p_status::text)::int <= coalesce((v_rank ->> v_me.status::text)::int, 0) then
        return v_incident;
      end if;
      if not v_lead and p_status not in ('Arrived', 'On Scene') then
        raise exception 'Backup marks en route and on scene; the lead officer closes %', v_incident.incident_number;
      end if;
      update public.incident_responders
         set status = p_status, updated_at = now()
       where id = v_me.id;
    end if;
  end if;

  -- A police or fire call is resolved by its report, never by a bare status.
  -- 0061: whoever asks. The desk used to be able to resolve one with no
  -- report; a call that will never have one is closed with a reason instead.
  if p_status = 'Resolved' and v_incident.report_filed_at is null
     and ('MetroPolice' = any(coalesce(v_incident.dispatched_silos, '{}')) or v_incident.silo = 'MetroPolice'
          or 'MetroFire' = any(coalesce(v_incident.dispatched_silos, '{}')) or v_incident.silo = 'MetroFire') then
    raise exception 'File the incident report to resolve %', v_incident.incident_number
      using hint = case when v_field then 'Use File incident report on the call.'
                        else 'The officer files the report from the app. A call that will have no report is closed from its case file, with a reason.' end;
  end if;

  if v_lead then
    update public.incidents
       set status              = p_status,
           acceptance          = case when p_status = 'En Route' then true else acceptance end,
           accepted_by         = case when v_joining then auth.uid() else accepted_by end,
           accepted_at         = case when v_joining then v_at else accepted_at end,
           -- The lead's vehicle becomes the unit on the call.
           unit_id             = case when v_joining then coalesce(v_person.assigned_apparatus_id, unit_id) else unit_id end,
           arrived_timestamp   = case
                                   when p_status in ('Arrived','On Scene') and arrived_timestamp is null
                                     then v_at
                                   else arrived_timestamp
                                 end,
           responding_officer  = case when v_joining then v_name else coalesce(responding_officer, v_name) end,
           -- 0061: resolving through the ladder (EMS, Disaster) stamps it too.
           resolved_at         = case when p_status = 'Resolved' then coalesce(resolved_at, v_at) else resolved_at end,
           resolved_by         = case when p_status = 'Resolved' then coalesce(resolved_by, auth.uid()) else resolved_by end,
           unit_status         = p_status::text,
           updated_at          = now()
     where id = p_incident_id
    returning * into v_incident;
  else
    -- Backup leaves the call's status alone; the touch refreshes live screens.
    update public.incidents set updated_at = now() where id = p_incident_id
    returning * into v_incident;
  end if;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name, timestamp)
  values (
    v_incident.silo, v_incident.id,
    case when v_lead then '[STATUS] ' else format('[BACKUP] %s — ', v_name) end
      || p_status::text
      || case when v_queued then format(' (recorded offline, delivered %s later)', to_char(now() - v_at, 'HH24:MI:SS'))
              else '' end,
    auth.uid(), v_name, v_at
  );

  if v_joining then
    select unit_number into v_unit from public.apparatus where id = v_me.unit_id;
    insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name, timestamp)
    values (v_incident.silo, v_incident.id,
      format('[RESPONDING] %s%s responding%s', v_name, coalesce(' (' || v_unit || ')', ''),
             case when v_lead then ' — lead' else ' as backup' end),
      auth.uid(), v_name, v_at);

    perform public.notify_incident_chain(
      v_incident, 'responding',
      case when v_lead then format('%s responding to %s', v_name, v_incident.incident_number)
           else format('%s joined %s as backup', v_name, v_incident.incident_number) end,
      format('%s%s · %s', coalesce(v_unit || ' · ', ''), v_incident.incident_type, v_incident.location_address)
    );

    -- The lead hears about backup on the way.
    if not v_lead and v_incident.accepted_by is not null and v_incident.accepted_by <> auth.uid() then
      insert into public.alerts (
        tenant_id, silo, target_user_id, kind, severity, title, body, incident_id, link,
        presentation, requires_ack, created_by, created_by_name
      )
      select v_incident.tenant_id, p.silo, v_incident.accepted_by, 'backup', v_incident.incident_severity::text,
             format('%s is joining you on %s', v_name, v_incident.incident_number),
             format('Backup%s en route', coalesce(' · ' || v_unit, '')),
             v_incident.id, format('/incidents/%s', v_incident.id),
             'toast', false, auth.uid(), v_name
      from public.personnel p
      where p.user_id = v_incident.accepted_by and p.tenant_id = v_incident.tenant_id
      limit 1;
    end if;
  end if;

  return v_incident;
end $$;

notify pgrst, 'reload schema';

-- ── 5. Closing a case ───────────────────────────────────────────────────────

-- Two ways a call ends, never confused:
--   Reviewed   the call is Resolved (its report is filed); a case manager,
--              command or the desk has read it and closes the case. A review
--              note is optional.
--   Cancelled  the call is still live or was never sent: hoax, duplicate,
--              caller cancelled. The desk or command closes it without a
--              report, and must say why. Case managers do not cancel live
--              calls; that is the dispatch desk's decision.
-- Everyone working the call and the chain of command are told.
create or replace function public.close_case(p_incident_id uuid, p_reason text default null)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_name     text;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_kind     text;
  r          record;
begin
  perform public.require_role(
    'SystemAdmin', 'SuperAdmin', 'Admin', 'SystemController', 'Supervisor', 'Captain', 'FireChief',
    'Dispatcher', 'ControlRoom', 'CaseManager', 'System'
  );

  select * into v_incident from public.incidents
   where id = p_incident_id and tenant_id = public.current_tenant()
   for update;
  -- SECURITY DEFINER skips row security, so check the caller may see the case
  -- at all: a department Admin closes their own department's cases, not
  -- another's by guessing an id.
  if not found or not public.can_work_incident(p_incident_id) then
    raise exception 'Incident % not found', p_incident_id;
  end if;
  if v_incident.status = 'Closed' then
    raise exception '% is already closed', v_incident.incident_number;
  end if;

  if v_incident.status = 'Resolved' then
    v_kind := 'Reviewed';
  else
    if public.role_in('CaseManager') then
      raise exception '% is still live (%): case managers close resolved cases; the dispatch desk cancels live calls',
        v_incident.incident_number, v_incident.status;
    end if;
    if v_reason is null or length(v_reason) < 10 then
      raise exception 'Say why % is being closed without a report (at least 10 characters)', v_incident.incident_number;
    end if;
    v_kind := 'Cancelled';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();

  update public.incidents
     set status         = 'Closed',
         closed_at      = now(),
         closed_by      = auth.uid(),
         closed_by_name = v_name,
         close_kind     = v_kind,
         close_reason   = v_reason,
         unit_status    = 'Closed',
         updated_at     = now()
   where id = p_incident_id
  returning * into v_incident;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    case v_kind
      when 'Reviewed' then format('[CLOSED] Case reviewed and closed by %s%s',
                                  coalesce(v_name, 'case review'), coalesce(' — ' || v_reason, ''))
      else format('[CANCELLED] Closed without a report by %s — %s', coalesce(v_name, 'the desk'), v_reason)
    end,
    auth.uid(), v_name);

  insert into public.audit_logs (silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.silo, auth.uid(), v_name, v_incident.silo::text,
    case v_kind when 'Reviewed' then 'CASE_CLOSED' else 'CALL_CANCELLED' end,
    'incidents', v_incident.id::text,
    format('%s %s%s', v_incident.incident_number,
           case v_kind when 'Reviewed' then 'reviewed and closed' else 'closed without a report' end,
           coalesce(': ' || v_reason, '')));

  -- The officers on the call: the lead, the assigned officer, every backup.
  for r in
    select distinct u.uid
    from (
      select v_incident.accepted_by as uid
      union all select v_incident.assigned_to
      union all select ir.user_id from public.incident_responders ir where ir.incident_id = v_incident.id
    ) u
    where u.uid is not null and u.uid is distinct from auth.uid()
  loop
    insert into public.alerts (
      tenant_id, silo, target_user_id, kind, severity, title, body, incident_id, link,
      presentation, requires_ack, created_by, created_by_name
    )
    select v_incident.tenant_id, p.silo, r.uid, 'closed', v_incident.incident_severity::text,
           case v_kind when 'Reviewed' then format('%s closed', v_incident.incident_number)
                       else format('%s cancelled: stand down', v_incident.incident_number) end,
           case v_kind when 'Reviewed' then format('Your report was reviewed by %s. The case is closed.', coalesce(v_name, 'case review'))
                       else v_reason end,
           v_incident.id, format('/incidents/%s', v_incident.id),
           'toast', false, auth.uid(), v_name
      from public.profiles p
     where p.id = r.uid and p.tenant_id = v_incident.tenant_id and p.deactivated_at is null;
  end loop;

  -- The dispatcher, command and case managers.
  perform public.notify_incident_chain(
    v_incident, 'closed',
    case v_kind when 'Reviewed' then format('%s closed after review', v_incident.incident_number)
                else format('%s closed without a report', v_incident.incident_number) end,
    format('%s · %s%s', v_incident.incident_type, coalesce(v_name, 'case review'), coalesce(' · ' || v_reason, ''))
  );

  return v_incident;
end $$;

revoke execute on function public.close_case(uuid, text) from public, anon;
grant  execute on function public.close_case(uuid, text) to authenticated;

-- ── 6. Prove it ─────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'incidents'
                  and policyname = 'incidents_case_review_read') then
    raise exception '0061: incidents_case_review_read is missing';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_logs'
                  and policyname = 'audit_logs_case_read') then
    raise exception '0061: audit_logs_case_read is missing';
  end if;
  if has_function_privilege('anon', 'public.close_case(uuid, text)', 'EXECUTE') then
    raise exception '0061: anon can still close cases';
  end if;
  -- One close_case and one update_responder_status: an extra overload would
  -- make PostgREST resolve calls to neither.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'close_case') <> 1 then
    raise exception '0061: close_case has more than one signature';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'update_responder_status') <> 1 then
    raise exception '0061: update_responder_status has more than one signature';
  end if;
end $$;

notify pgrst, 'reload schema';
