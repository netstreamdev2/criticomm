-- ============================================================================
-- 0073 — One call, several departments: each works its own part
-- ============================================================================
--
-- Run after 0072.
--
-- A call sent to Police and Fire had one status, one lead and one report for
-- both. When Police dispatched it, it left Fire's queue too; once a police
-- officer accepted, Fire could not send its crews; the police report resolved
-- the call while Fire was still on scene, and the case could be closed under
-- them. Now every department the call is sent to has its own part of it
-- (public.incident_departments):
--
--   Waiting      sent to the department's desk, not dispatched yet. The call
--                stays in that desk's queue until the desk dispatches it,
--                whatever the other departments have done.
--   Dispatched   sent to its crews (route_incident, assign_incident).
--   En Route … Transporting
--                its lead's progress. The first of its crew to respond leads
--                the department's part; another department's lead never
--                blocks it.
--   Resolved     its report is filed: the police report, the fire report,
--                the patient report or the post-mortem finishes only that
--                department's part.
--   Not needed   stood down by its desk or command, with a reason
--                (stand_down_department). A crew already on scene is stood
--                down by its command only.
--   Cancelled    the call was closed without a report.
--
-- The call itself (incidents.status) follows its parts: the furthest live
-- part, and Resolved only when every department has finished or been stood
-- down — so only then can the case be reviewed and closed. A department's
-- desk cancels a live call only while no other department has it.
--
-- One link (/incidents/<id>) serves every department; each reads the parts
-- and acts on its own.
--
-- Also: a department's dispatch desk reads its own department's crews only
-- (it counted every department's crews as on duty). The control room and
-- organisation administrators still see every department.
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. A department's part of a call ────────────────────────────────────────

create table if not exists public.incident_departments (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  incident_id        uuid not null references public.incidents (id) on delete cascade,
  silo               public.silo not null check (silo <> 'Ethekwini'),
  status             text not null default 'Waiting' check (status in (
                       'Waiting', 'Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting',
                       'Resolved', 'Not needed', 'Cancelled')),
  sent_at            timestamptz not null default now(),
  dispatched_at      timestamptz,
  dispatched_by      uuid,
  dispatched_by_name text,
  assigned_to        uuid,
  assigned_to_name   text,
  assigned_at        timestamptz,
  lead_id            uuid,
  lead_name          text,
  accepted_at        timestamptz,
  arrived_at         timestamptz,
  report_filed_at    timestamptz,
  finished_at        timestamptz,
  finished_by        uuid,
  finished_by_name   text,
  finish_reason      text,
  updated_at         timestamptz not null default now(),
  unique (incident_id, silo)
);
comment on table public.incident_departments is
  'One department''s part of a call (0073): its dispatch, lead, progress and report. The call is resolved when every part has finished.';

create index if not exists incident_departments_waiting_idx
  on public.incident_departments (tenant_id, silo) where status = 'Waiting';
create index if not exists incident_departments_lead_idx
  on public.incident_departments (lead_id) where lead_id is not null;
create index if not exists incident_departments_assigned_idx
  on public.incident_departments (assigned_to) where assigned_to is not null;

alter table public.incident_departments enable row level security;
drop policy if exists tenant_isolation on public.incident_departments;
create policy tenant_isolation on public.incident_departments as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
-- Whoever may see the call sees its parts (the subquery reads the call under
-- the reader's own rules, the dispatch desks' wall included).
drop policy if exists incident_departments_read on public.incident_departments;
create policy incident_departments_read on public.incident_departments for select to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_departments.incident_id));
revoke all on public.incident_departments from anon;
revoke insert, update, delete on public.incident_departments from authenticated;
grant select on public.incident_departments to authenticated;

-- ── 2. Helpers ──────────────────────────────────────────────────────────────

/** Where a part stands on the way to the scene; null once finished. */
create or replace function public.department_step_rank(p_status text) returns integer
language sql immutable as $$
  select case p_status
    when 'Waiting' then 0 when 'Dispatched' then 1 when 'En Route' then 2
    when 'Arrived' then 3 when 'On Scene' then 4 when 'Transporting' then 5
  end
$$;

/** Still being worked (or waiting to be). */
create or replace function public.department_open(p_status text) returns boolean
language sql immutable as $$
  select p_status in ('Waiting', 'Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting')
$$;

/**
 * May the caller direct this department's part of a call: dispatch it,
 * correct its crew's status, stand it down? Its own desk and command, the
 * control room, and organisation administrators.
 */
create or replace function public.can_direct_department(p_silo public.silo) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.deactivated_at is null
       and (p.role in ('SystemAdmin', 'SuperAdmin', 'SystemController', 'System')
            or (p.role in ('Dispatcher', 'ControlRoom', 'Operator', 'Supervisor', 'Captain', 'FireChief', 'Chief', 'Admin')
                and p.silo in ('Ethekwini', p_silo)))
  )
$$;

/** Command of the department (or of the organisation): may stand down a crew already on scene. */
create or replace function public.commands_department(p_silo public.silo) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.deactivated_at is null
       and (p.role in ('SystemAdmin', 'SuperAdmin', 'SystemController', 'System')
            or (p.role in ('Supervisor', 'Captain', 'FireChief', 'Chief', 'Admin') and p.silo in ('Ethekwini', p_silo)))
  )
$$;

revoke all on function public.can_direct_department(public.silo) from public, anon;
grant execute on function public.can_direct_department(public.silo) to authenticated;
revoke all on function public.commands_department(public.silo) from public, anon;
grant execute on function public.commands_department(public.silo) to authenticated;

/**
 * Every department a call is for has its part: those it was sent to, those
 * dispatched, and the department it was logged under (not the control room).
 * A part made for a call already under way takes what the call already
 * holds; a part added later waits for its desk.
 */
create or replace function public.ensure_incident_departments(p_incident public.incidents) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  s        public.silo;
  v_lead   record;
  v_sent   boolean := p_incident.status not in ('New', 'Pending', 'Pending Dispatch', 'Pending Analysis');
  v_filer  public.silo;
  v_status text;
  v_assigned public.silo;
begin
  if p_incident.status in ('Resolved', 'Closed') and p_incident.report_filed_at is not null then
    select pr.silo into v_filer from public.profiles pr
     where pr.id = coalesce(p_incident.resolved_by, p_incident.accepted_by);
  end if;
  if p_incident.assigned_to is not null then
    select pe.silo into v_assigned from public.personnel pe
     where pe.user_id = p_incident.assigned_to and pe.tenant_id = p_incident.tenant_id limit 1;
  end if;

  for s in
    select distinct x
      from unnest(coalesce(p_incident.tagged_silos, '{}') || coalesce(p_incident.dispatched_silos, '{}') || array[p_incident.silo]) x
     where x <> 'Ethekwini'
  loop
    continue when exists (select 1 from public.incident_departments d where d.incident_id = p_incident.id and d.silo = s);

    -- Who leads it already: the department's lead, else its first responder.
    select r.user_id, r.name, r.joined_at, r.status::text as status into v_lead
      from public.incident_responders r
     where r.incident_id = p_incident.id and r.silo = s
     order by (r.role = 'lead') desc, r.joined_at
     limit 1;

    v_status := case
      when p_incident.status = 'Closed' and p_incident.report_filed_at is null then 'Cancelled'
      when p_incident.status in ('Resolved', 'Closed') then case when s = v_filer then 'Resolved' else 'Not needed' end
      when not v_sent or not (s = any (coalesce(p_incident.dispatched_silos, '{}'))) then 'Waiting'
      when v_lead.user_id is not null then
        case when v_lead.user_id = p_incident.accepted_by
                  and p_incident.status in ('En Route', 'Arrived', 'On Scene', 'Transporting') then p_incident.status::text
             when v_lead.status in ('En Route', 'Arrived', 'On Scene', 'Transporting') then v_lead.status
             else 'En Route' end
      else 'Dispatched'
    end;

    insert into public.incident_departments (
      tenant_id, incident_id, silo, status, sent_at,
      dispatched_at, dispatched_by, dispatched_by_name,
      assigned_to, assigned_to_name, assigned_at,
      lead_id, lead_name, accepted_at, arrived_at,
      report_filed_at, finished_at, finished_by, finish_reason
    ) values (
      p_incident.tenant_id, p_incident.id, s, v_status, coalesce(p_incident.incident_created_at, now()),
      case when v_status <> 'Waiting' and s = any (coalesce(p_incident.dispatched_silos, '{}')) then p_incident.dispatch_time end,
      case when v_status <> 'Waiting' and s = any (coalesce(p_incident.dispatched_silos, '{}')) then p_incident.dispatched_by_id end,
      case when v_status <> 'Waiting' and s = any (coalesce(p_incident.dispatched_silos, '{}')) then p_incident.dispatched_by end,
      case when v_assigned = s then p_incident.assigned_to end,
      case when v_assigned = s then p_incident.assigned_to_name end,
      case when v_assigned = s then p_incident.assigned_at end,
      v_lead.user_id, v_lead.name,
      case when v_lead.user_id = p_incident.accepted_by then p_incident.accepted_at else v_lead.joined_at end,
      case when v_lead.user_id is not null and v_status in ('Arrived', 'On Scene', 'Transporting', 'Resolved')
           then p_incident.arrived_timestamp end,
      case when v_status = 'Resolved' then p_incident.report_filed_at end,
      case when not public.department_open(v_status) then coalesce(p_incident.closed_at, p_incident.resolved_at, now()) end,
      case when not public.department_open(v_status) then coalesce(p_incident.resolved_by, p_incident.closed_by) end,
      case v_status
        when 'Not needed' then 'Finished before each department was tracked separately.'
        when 'Cancelled' then p_incident.close_reason
      end
    )
    on conflict (incident_id, silo) do nothing;
  end loop;
end $$;
revoke all on function public.ensure_incident_departments(public.incidents) from public, anon, authenticated;

/**
 * The call follows its parts: the furthest live part, Dispatched while the
 * rest wait, Resolved once every department has finished or been stood down
 * and at least one report is filed. A call nobody filed on stays live: the
 * desk cancels it with a reason.
 */
create or replace function public.sync_incident_from_departments(p_incident_id uuid)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v        public.incidents;
  v_any    boolean;
  v_open   integer;
  v_top    integer;
  v_filed  timestamptz;
  v_sent   boolean;
  v_status public.incident_status;
begin
  select * into v from public.incidents where id = p_incident_id for update;
  if not found or v.status = 'Closed' then return v; end if;

  select count(*) > 0,
         count(*) filter (where public.department_open(d.status)),
         max(public.department_step_rank(d.status)) filter (where public.department_open(d.status)),
         max(d.report_filed_at),
         coalesce(bool_or(d.dispatched_at is not null), false)
    into v_any, v_open, v_top, v_filed, v_sent
    from public.incident_departments d
   where d.incident_id = p_incident_id;
  if not v_any then return v; end if;

  if v_open = 0 then
    if v_filed is null then return v; end if;
    v_status := 'Resolved';
  elsif v_top = 0 then
    v_status := case when v.status in ('New', 'Pending', 'Pending Dispatch', 'Pending Analysis') and not v_sent
                     then v.status else 'Dispatched' end;
  else
    v_status := (array['Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting']::public.incident_status[])[v_top];
  end if;

  update public.incidents
     set status          = v_status,
         unit_status     = v_status::text,
         resolved_at     = case when v_status = 'Resolved' then coalesce(resolved_at, now()) else resolved_at end,
         resolved_by     = case when v_status = 'Resolved' then coalesce(resolved_by, auth.uid()) else resolved_by end,
         report_filed_at = case when v_status = 'Resolved' then coalesce(report_filed_at, v_filed) else report_filed_at end,
         updated_at      = now()
   where id = p_incident_id
  returning * into v;
  return v;
end $$;
revoke all on function public.sync_incident_from_departments(uuid) from public, anon, authenticated;

/**
 * The call as one department sees it: its own status, lead, assignment,
 * vehicle, dispatch, arrival and report. The report functions read the call through
 * this, so their checks (who leads, on scene, already filed) are the
 * department's own.
 */
create or replace function public.incident_for_department(p_incident public.incidents, p_silo public.silo)
returns public.incidents language plpgsql stable security definer set search_path to 'public' as $$
declare
  d public.incident_departments;
  v public.incidents := p_incident;
begin
  select * into d from public.incident_departments where incident_id = p_incident.id and silo = p_silo;
  if not found then
    v.accepted_by := null;
    v.accepted_at := null;
    v.assigned_to := null;
    v.report_filed_at := null;
    v.unit_id := null;
    v.status := case when p_incident.status = 'Closed' then 'Closed' else 'Pending Dispatch' end;
    return v;
  end if;
  v.status := case
    when p_incident.status = 'Closed' then 'Closed'
    when d.status = 'Waiting' then 'Pending Dispatch'
    when d.status in ('Not needed', 'Cancelled') then 'Closed'
    else d.status::public.incident_status
  end;
  v.accepted_by        := d.lead_id;
  v.accepted_at        := d.accepted_at;
  v.responding_officer := coalesce(d.lead_name, p_incident.responding_officer);
  v.assigned_to        := d.assigned_to;
  v.assigned_to_name   := d.assigned_to_name;
  v.report_filed_at    := d.report_filed_at;
  -- The department's own vehicle: its lead's, never another department's.
  v.unit_id            := (select r.unit_id from public.incident_responders r
                            where r.incident_id = p_incident.id and r.user_id = d.lead_id);
  v.dispatch_time      := coalesce(d.dispatched_at, p_incident.dispatch_time);
  v.arrived_timestamp  := coalesce(d.arrived_at, p_incident.arrived_timestamp);
  return v;
end $$;
revoke all on function public.incident_for_department(public.incidents, public.silo) from public, anon, authenticated;

/** A report finishes its department's part, and the call follows. */
create or replace function public.finish_department_by_report(p_incident_id uuid, p_silo public.silo, p_at timestamptz)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v      public.incidents;
  v_name text;
  v_left text;
begin
  select full_name into v_name from public.profiles where id = auth.uid();
  update public.incidents set updated_at = now() where id = p_incident_id returning * into v;
  perform public.ensure_incident_departments(v);
  update public.incident_departments
     set status = 'Resolved', report_filed_at = coalesce(report_filed_at, p_at),
         finished_at = coalesce(finished_at, p_at), finished_by = coalesce(finished_by, auth.uid()),
         finished_by_name = coalesce(finished_by_name, v_name), updated_at = now()
   where incident_id = p_incident_id and silo = p_silo;

  v := public.sync_incident_from_departments(p_incident_id);
  select string_agg(public.department_label(d.silo), ', ' order by d.silo) into v_left
    from public.incident_departments d
   where d.incident_id = p_incident_id and public.department_open(d.status);
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v.silo, v.id,
    case when v_left is null
         then format('[RESOLVED] %s has finished. Every department is done: %s is resolved.', public.department_label(p_silo), v.incident_number)
         else format('[DEPARTMENT] %s has finished. Still working: %s.', public.department_label(p_silo), v_left) end,
    auth.uid(), v_name);
  return v;
end $$;
revoke all on function public.finish_department_by_report(uuid, public.silo, timestamptz) from public, anon, authenticated;

-- ── 3. The parts follow the call ────────────────────────────────────────────

create or replace function public.incident_departments_follow() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.ensure_incident_departments(new);
  -- A call closed without a report closes every part still open.
  if tg_op = 'UPDATE' and new.status = 'Closed' and old.status is distinct from 'Closed' then
    update public.incident_departments
       set status = 'Cancelled', finished_at = now(), finished_by = auth.uid(),
           finished_by_name = (select full_name from public.profiles where id = auth.uid()),
           finish_reason = new.close_reason, updated_at = now()
     where incident_id = new.id and public.department_open(status);
  end if;
  return null;
end $$;
revoke all on function public.incident_departments_follow() from public, anon, authenticated;

drop trigger if exists incident_departments_follow on public.incidents;
create trigger incident_departments_follow
  after insert or update of silo, tagged_silos, dispatched_silos, status on public.incidents
  for each row execute function public.incident_departments_follow();

/**
 * Cancelling a live call (closing it without a report) ends it for every
 * department, so only someone who directs every department still on it may:
 * a department's desk stands its own department down instead.
 */
create or replace function public.guard_department_cancel() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_others text;
begin
  if auth.uid() is null or not (new.status = 'Closed' and old.status not in ('Closed', 'Resolved')) then
    return new;
  end if;
  select string_agg(public.department_label(d.silo), ', ' order by d.silo) into v_others
    from public.incident_departments d
   where d.incident_id = new.id and public.department_open(d.status) and not public.can_direct_department(d.silo);
  if v_others is not null then
    raise exception '% still has %. Mark your department Not needed instead.', v_others, new.incident_number
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_department_cancel on public.incidents;
create trigger guard_department_cancel before update of status on public.incidents
  for each row execute function public.guard_department_cancel();

-- ── 4. Dispatching a department ─────────────────────────────────────────────

-- As 0044, per department: a department already led, or finished, is not sent
-- again; another department's lead no longer blocks it. The departments a
-- call was dispatched to are only ever added to (0044 replaced them).
create or replace function public.route_incident(p_incident_id uuid, p_silos silo[], p_notes text default null)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_name     text;
  v_on_duty  int;
  v_to       text;
  v_raiser   uuid;
  v_desk     public.silo := public.desk_silo();
  v_silos    public.silo[];
  v_busy     text;
  v_clear    boolean := false;
  s          public.silo;
begin
  perform public.require_role('SystemAdmin','SuperAdmin','Admin','Dispatcher','Operator','ControlRoom','Supervisor','System');

  select coalesce(array_agg(distinct x order by x), '{}') into v_silos
    from unnest(coalesce(p_silos, '{}')) x where x <> 'Ethekwini';
  if cardinality(v_silos) = 0 then
    raise exception 'At least one department must be selected';
  end if;

  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;
  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text);
  end if;

  -- A department's desk works the calls sent to it and sends its own crews (0068).
  if v_desk is not null then
    if not (v_incident.silo = v_desk or v_desk = any (coalesce(v_incident.dispatched_silos, '{}'))
            or v_desk = any (coalesce(v_incident.tagged_silos, '{}')) or v_incident.created_by = auth.uid()) then
      raise exception '% was not sent to your dispatch desk', v_incident.incident_number using errcode = '42501';
    end if;
    select x into s from unnest(v_silos) x where x <> v_desk limit 1;
    if s is not null then
      raise exception 'Your desk dispatches % crews only. Send the call to the % dispatch desk to bring them in.',
        public.department_label(v_desk), public.department_label(s) using errcode = '42501';
    end if;
  end if;

  perform public.ensure_incident_departments(v_incident);
  select string_agg(
           public.department_label(d.silo) || case when public.department_open(d.status)
             then ' is led by ' || coalesce(d.lead_name, 'a crew member') else ' has finished' end,
           '; ' order by d.silo)
    into v_busy
    from public.incident_departments d
   where d.incident_id = p_incident_id and d.silo = any (v_silos)
     and (d.lead_id is not null or not public.department_open(d.status));
  if v_busy is not null then
    raise exception 'On %, %', v_incident.incident_number, v_busy
      using hint = 'Other crews can still join as backup from the app.';
  end if;

  v_raiser := public.sos_raiser(v_incident);

  -- Somebody other than the officer in distress has to be there to receive it.
  select count(*) into v_on_duty
  from public.personnel p
  where p.tenant_id = v_incident.tenant_id
    and p.is_on_duty and p.user_id is not null
    and p.user_id is distinct from v_raiser
    and p.silo = any(v_silos);
  if v_on_duty = 0 then
    raise exception 'No one is on duty to receive the dispatch'
      using hint = case when v_raiser is not null
        then 'The officer who raised this SOS does not count. It stays in the pending queue until another officer is on duty.'
        else 'The call stays in the pending queue. Dispatch it once an officer goes on duty.' end;
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  select string_agg(public.department_label(x), ', ' order by x) into v_to from unnest(v_silos) x;

  insert into public.incident_departments (tenant_id, incident_id, silo, status, dispatched_at, dispatched_by, dispatched_by_name)
  select v_incident.tenant_id, v_incident.id, x, 'Dispatched', now(), auth.uid(), v_name from unnest(v_silos) x
  on conflict (incident_id, silo) do update
     set status             = 'Dispatched',
         dispatched_at      = coalesce(incident_departments.dispatched_at, now()),
         dispatched_by      = auth.uid(),
         dispatched_by_name = v_name,
         assigned_to        = null,
         assigned_to_name   = null,
         assigned_at        = null,
         updated_at         = now();

  -- Before anyone leads, sending to all replaces an assignment in those departments.
  if v_incident.accepted_by is null and v_incident.assigned_to is not null then
    select pe.silo = any (v_silos) into v_clear from public.personnel pe
     where pe.user_id = v_incident.assigned_to and pe.tenant_id = v_incident.tenant_id limit 1;
  end if;

  update public.incidents
     set status           = case when status in ('New', 'Pending', 'Pending Dispatch', 'Pending Analysis') then 'Dispatched' else status end,
         dispatch_time    = coalesce(dispatch_time, now()),
         dispatched_silos = array(select distinct x from unnest(coalesce(dispatched_silos, '{}') || v_silos) x),
         dispatched_by    = coalesce(v_name, dispatched_by),
         dispatched_by_id = auth.uid(),
         assigned_to      = case when coalesce(v_clear, false) then null else assigned_to end,
         assigned_to_name = case when coalesce(v_clear, false) then null else assigned_to_name end,
         assigned_at      = case when coalesce(v_clear, false) then null else assigned_at end,
         assigned_by      = case when coalesce(v_clear, false) then null else assigned_by end,
         unit_id          = case when accepted_by is null then null else unit_id end,
         unit_status      = case when status in ('New', 'Pending', 'Pending Dispatch', 'Pending Analysis') then 'Dispatched' else unit_status end,
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
    and p.silo = any(v_silos);

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[DISPATCH] Sent to all on duty in %s (%s officers%s). The first of each department to respond leads it; others may join as backup.',
           v_to, v_on_duty, case when v_raiser is not null then ', not the officer who raised the SOS' else '' end),
    auth.uid(), v_name);

  insert into public.audit_logs (silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_incident.silo, auth.uid(), v_name, 'IncidentRouted', 'incident', v_incident.id::text,
    format('Dispatched %s to all on duty in %s (%s officers)', v_incident.incident_number, v_to, v_on_duty));

  return public.sync_incident_from_departments(p_incident_id);
end $$;

revoke execute on function public.route_incident(uuid, silo[], text) from public, anon;
grant  execute on function public.route_incident(uuid, silo[], text) to authenticated;

-- As 0042, per department: the officer's department leads its own part;
-- re-assigning is allowed until someone of that department leads.
create or replace function public.assign_incident(p_incident_id uuid, p_user_id uuid, p_notes text default null)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_person   public.personnel;
  v_dept     public.incident_departments;
  v_desk     public.silo := public.desk_silo();
  v_name     text;
  v_officer  text;
  v_previous uuid;
begin
  perform public.require_role('SystemAdmin','SuperAdmin','Admin','Dispatcher','Operator','ControlRoom','Supervisor','System');

  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;
  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text);
  end if;
  if v_desk is not null and not (v_incident.silo = v_desk or v_desk = any (coalesce(v_incident.dispatched_silos, '{}'))
          or v_desk = any (coalesce(v_incident.tagged_silos, '{}')) or v_incident.created_by = auth.uid()) then
    raise exception '% was not sent to your dispatch desk', v_incident.incident_number using errcode = '42501';
  end if;

  select * into v_person from public.personnel
  where user_id = p_user_id and tenant_id = v_incident.tenant_id;
  if not found then raise exception 'That officer has no personnel record'; end if;
  v_officer := trim(coalesce(v_person.rank, '') || ' ' || v_person.first_name || ' ' || v_person.last_name);
  if v_person.silo = 'Ethekwini' then
    raise exception '% is not in a field department', v_officer;
  end if;
  if v_desk is not null and v_person.silo <> v_desk then
    raise exception 'Your desk dispatches % crews only. Send the call to the % dispatch desk to bring them in.',
      public.department_label(v_desk), public.department_label(v_person.silo) using errcode = '42501';
  end if;
  if not v_person.is_on_duty then
    raise exception '% is not on duty', v_officer;
  end if;
  if p_user_id = public.sos_raiser(v_incident) then
    raise exception '% is the officer who raised this SOS — assign another officer', v_officer;
  end if;

  perform public.ensure_incident_departments(v_incident);
  select * into v_dept from public.incident_departments
   where incident_id = p_incident_id and silo = v_person.silo
   for update;
  if found and v_dept.lead_id is not null then
    raise exception '% is already led by % for %', v_incident.incident_number,
      coalesce(v_dept.lead_name, 'a crew member'), public.department_label(v_person.silo)
      using hint = 'Other officers can still join it as backup from the app.';
  end if;
  if found and not public.department_open(v_dept.status) then
    raise exception '% has already finished its part on %', public.department_label(v_person.silo), v_incident.incident_number;
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  v_previous := v_dept.assigned_to;

  insert into public.incident_departments (
    tenant_id, incident_id, silo, status, dispatched_at, dispatched_by, dispatched_by_name,
    assigned_to, assigned_to_name, assigned_at
  ) values (
    v_incident.tenant_id, v_incident.id, v_person.silo, 'Dispatched', now(), auth.uid(), v_name,
    p_user_id, v_officer, now()
  )
  on conflict (incident_id, silo) do update
     set status             = 'Dispatched',
         dispatched_at      = coalesce(incident_departments.dispatched_at, now()),
         dispatched_by      = auth.uid(),
         dispatched_by_name = v_name,
         assigned_to        = p_user_id,
         assigned_to_name   = v_officer,
         assigned_at        = now(),
         updated_at         = now();

  update public.incidents
     set status           = case when status in ('New', 'Pending', 'Pending Dispatch', 'Pending Analysis') then 'Dispatched' else status end,
         dispatch_time    = coalesce(dispatch_time, now()),
         dispatched_silos = array(
           select distinct s from unnest(coalesce(dispatched_silos, '{}') || array[v_person.silo]) s
         ),
         dispatched_by    = coalesce(v_name, dispatched_by),
         dispatched_by_id = auth.uid(),
         -- The call's own assignment is the first department's, until someone leads.
         assigned_to      = case when accepted_by is null then p_user_id else assigned_to end,
         assigned_to_name = case when accepted_by is null then v_officer else assigned_to_name end,
         assigned_at      = case when accepted_by is null then now() else assigned_at end,
         assigned_by      = case when accepted_by is null then auth.uid() else assigned_by end,
         unit_id          = case when accepted_by is null then null else unit_id end,
         unit_status      = case when status in ('New', 'Pending', 'Pending Dispatch', 'Pending Analysis') then 'Dispatched' else unit_status end,
         notes            = coalesce(nullif(p_notes, ''), notes),
         updated_at       = now()
   where id = p_incident_id
  returning * into v_incident;

  insert into public.alerts (
    tenant_id, silo, target_user_id, kind, severity, title, body, incident_id, link,
    presentation, requires_ack, created_by, created_by_name
  ) values (
    v_incident.tenant_id, v_person.silo, p_user_id, 'assignment', v_incident.incident_severity::text,
    format('%s assigned to you', v_incident.incident_number),
    format('%s · %s', v_incident.incident_type, v_incident.location_address),
    v_incident.id, format('/incidents/%s', v_incident.id),
    'modal', true, auth.uid(), v_name
  );

  if v_previous is not null and v_previous <> p_user_id then
    insert into public.alerts (
      tenant_id, silo, target_user_id, kind, severity, title, body, incident_id, link,
      presentation, requires_ack, created_by, created_by_name
    )
    select v_incident.tenant_id, p.silo, v_previous, 'reassigned', v_incident.incident_severity::text,
           format('%s reassigned to %s', v_incident.incident_number, v_officer),
           'You no longer need to respond. You can still join as backup.',
           v_incident.id, format('/incidents/%s', v_incident.id),
           'toast', false, auth.uid(), v_name
    from public.personnel p
    where p.user_id = v_previous and p.tenant_id = v_incident.tenant_id
    limit 1;
  end if;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[ASSIGNED] Assigned to %s (%s) by %s', v_officer, public.department_label(v_person.silo), coalesce(v_name, 'dispatch')),
    auth.uid(), v_name);

  insert into public.audit_logs (silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_incident.silo, auth.uid(), v_name, 'IncidentAssigned', 'incident', v_incident.id::text,
    format('Assigned %s to %s', v_incident.incident_number, v_officer));

  return public.sync_incident_from_departments(p_incident_id);
end $$;

revoke execute on function public.assign_incident(uuid, uuid, text) from public, anon;
grant  execute on function public.assign_incident(uuid, uuid, text) to authenticated;

-- 0039's unit dispatch is not used by any screen and knows nothing of the
-- departments' parts: route_incident and assign_incident replace it.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'dispatch_unit') then
    execute (select string_agg(format('revoke execute on function %s from public, anon, authenticated', p.oid::regprocedure), '; ')
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'dispatch_unit');
  end if;
end $$;

-- ── 5. The desk marking a department's crew ─────────────────────────────────

-- When a crew radios a step in instead of pressing it in the app. Only the
-- steps on the way to the scene, never backwards, and only for a department
-- that has been dispatched.
create or replace function public.set_department_status(p_incident_id uuid, p_silo public.silo, p_status incident_status)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_dept     public.incident_departments;
  v_name     text;
begin
  perform public.require_role(
    'Captain','Chief','FireChief','Supervisor','Dispatcher','ControlRoom','Operator',
    'Admin','SystemAdmin','SuperAdmin','SystemController','System'
  );
  select * into v_incident from public.incidents
   where id = p_incident_id and tenant_id = public.current_tenant()
   for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;
  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text);
  end if;
  if p_status::text not in ('En Route', 'Arrived', 'On Scene', 'Transporting') then
    raise exception 'Choose En Route, Arrived, On Scene or Transporting' using errcode = '22023';
  end if;
  if not public.can_direct_department(p_silo) then
    raise exception 'Only % dispatch or command, or the control room, marks its crew', public.department_label(p_silo)
      using errcode = '42501';
  end if;

  select * into v_dept from public.incident_departments
   where incident_id = p_incident_id and silo = p_silo
   for update;
  if not found or v_dept.status = 'Waiting' then
    raise exception '% has not dispatched % yet', public.department_label(p_silo), v_incident.incident_number
      using errcode = '22023';
  end if;
  if not public.department_open(v_dept.status) then
    raise exception '% has already finished its part on %', public.department_label(p_silo), v_incident.incident_number
      using errcode = '22023';
  end if;
  if public.department_step_rank(p_status::text) <= public.department_step_rank(v_dept.status) then
    return v_incident;
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  update public.incident_departments
     set status     = p_status::text,
         arrived_at = case when p_status in ('Arrived', 'On Scene', 'Transporting') and arrived_at is null then now() else arrived_at end,
         updated_at = now()
   where id = v_dept.id;
  update public.incidents
     set arrived_timestamp = case when p_status in ('Arrived', 'On Scene', 'Transporting') and arrived_timestamp is null
                                  then now() else arrived_timestamp end,
         updated_at = now()
   where id = p_incident_id;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[STATUS] %s · %s (marked from the console by %s)', p_status, public.department_label(p_silo), coalesce(v_name, 'the desk')),
    auth.uid(), v_name);

  return public.sync_incident_from_departments(p_incident_id);
end $$;

revoke all on function public.set_department_status(uuid, public.silo, incident_status) from public, anon;
grant execute on function public.set_department_status(uuid, public.silo, incident_status) to authenticated;

-- ── 6. Responding: each department leads its own part ───────────────────────

-- As 0061, per department:
--   • a crew member responds to their own department's part, once it has
--     been dispatched (or they are assigned); the first of the department to
--     respond leads it, whoever leads the other departments;
--   • the lead moves their department's part; the call follows its parts;
--   • nobody resolves through this function any more: each department
--     finishes with its report, or is stood down;
--   • the desk and command mark a department's crew through
--     set_department_status() (their own department, or the only one under
--     way).
create or replace function public.update_responder_status(
  p_incident_id uuid,
  p_status      incident_status,
  p_occurred_at timestamptz default null
)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_dept     public.incident_departments;
  v_silo     public.silo;
  v_name     text := coalesce((select full_name from public.profiles where id = auth.uid()), 'Responder');
  v_at       timestamptz;
  v_queued   boolean;
  v_field    boolean;
  v_person   public.personnel;
  v_me       public.incident_responders;
  v_joining  boolean := false;
  v_lead     boolean := true;
  v_unit     text;
  v_count    int;
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

  -- The row lock makes leading first-come: a second crew member waits here,
  -- then joins as backup.
  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;

  if p_status = 'Closed' then
    raise exception 'Close % from its case file: closing is recorded with who closed it and why', v_incident.incident_number;
  end if;
  if p_status = 'Resolved' then
    raise exception 'Each department finishes % with its report, or is marked Not needed', v_incident.incident_number
      using hint = 'The lead files the report from the app.';
  end if;
  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text);
  end if;
  if p_status::text not in ('En Route', 'Arrived', 'On Scene', 'Transporting') then
    raise exception 'Choose En Route, Arrived, On Scene or Transporting' using errcode = '22023';
  end if;

  v_field := public.role_in('Responder','Police','Officer','Metro','Security','Firefighter',
                            'Paramedic','Doctor','Disaster','Captain');

  if not v_field then
    -- The desk or command: their own department, else the one under way.
    v_silo := coalesce(public.desk_silo(), nullif(public.current_silo(), 'Ethekwini'));
    if v_silo is null then
      select count(*), min(d.silo::text)::public.silo into v_count, v_silo
        from public.incident_departments d
       where d.incident_id = p_incident_id and public.department_open(d.status) and d.status <> 'Waiting';
      if v_count <> 1 then
        raise exception 'Choose the department on % to mark', v_incident.incident_number using errcode = '22023';
      end if;
    end if;
    return public.set_department_status(p_incident_id, v_silo, p_status);
  end if;

  select * into v_person from public.personnel
  where user_id = auth.uid() and tenant_id = public.current_tenant();
  v_silo := coalesce(v_person.silo, public.current_silo());

  perform public.ensure_incident_departments(v_incident);
  select * into v_dept from public.incident_departments
   where incident_id = p_incident_id and silo = v_silo
   for update;
  if not found or (v_dept.status = 'Waiting' and v_dept.assigned_to is distinct from auth.uid()) then
    raise exception '% was not sent to you', v_incident.incident_number;
  end if;
  if not public.department_open(v_dept.status) then
    raise exception '% — % has finished its part', v_incident.incident_number, public.department_label(v_silo);
  end if;

  select * into v_me from public.incident_responders
  where incident_id = p_incident_id and user_id = auth.uid();

  if not found then
    if p_status <> 'En Route' then
      raise exception 'Press Responding on % first', v_incident.incident_number;
    end if;
    if not coalesce(v_person.is_on_duty, false) then
      raise exception 'Go on duty to respond to incidents';
    end if;

    -- The assigned crew member leads their department's part; an open
    -- dispatch is led by whoever of the department responds first.
    v_lead := v_dept.lead_id is null
              and (v_dept.assigned_to is null or v_dept.assigned_to = auth.uid());

    insert into public.incident_responders (
      tenant_id, incident_id, user_id, silo, name, unit_id, role, status, joined_at
    ) values (
      v_incident.tenant_id, v_incident.id, auth.uid(), v_silo, v_name,
      v_person.assigned_apparatus_id, case when v_lead then 'lead' else 'backup' end, 'En Route', v_at
    ) returning * into v_me;
    v_joining := true;
  else
    v_lead := v_me.role = 'lead' and v_dept.lead_id is not distinct from auth.uid();
    -- Replays and steps backwards along the ladder are no-ops.
    if v_rank ? p_status::text
       and (v_rank ->> p_status::text)::int <= coalesce((v_rank ->> v_me.status::text)::int, 0) then
      return v_incident;
    end if;
    if not v_lead and p_status not in ('Arrived', 'On Scene') then
      raise exception 'Backup marks en route and on scene; the lead closes % for %',
        v_incident.incident_number, public.department_label(v_silo);
    end if;
    update public.incident_responders
       set status = p_status, updated_at = now()
     where id = v_me.id;
  end if;

  if v_lead then
    update public.incident_departments
       set status      = case when public.department_step_rank(p_status::text) > public.department_step_rank(status)
                              then p_status::text else status end,
           lead_id     = case when v_joining then auth.uid() else lead_id end,
           lead_name   = case when v_joining then v_name else lead_name end,
           accepted_at = case when v_joining then v_at else accepted_at end,
           arrived_at  = case when p_status in ('Arrived', 'On Scene', 'Transporting') and arrived_at is null then v_at else arrived_at end,
           updated_at  = now()
     where id = v_dept.id;

    -- The call's own lead is the first department's lead.
    update public.incidents
       set acceptance          = case when p_status = 'En Route' then true else acceptance end,
           accepted_by         = case when v_joining and accepted_by is null then auth.uid() else accepted_by end,
           accepted_at         = case when v_joining and accepted_at is null then v_at else accepted_at end,
           unit_id             = case when v_joining and unit_id is null then v_person.assigned_apparatus_id else unit_id end,
           arrived_timestamp   = case
                                   when p_status in ('Arrived','On Scene','Transporting') and arrived_timestamp is null then v_at
                                   else arrived_timestamp
                                 end,
           responding_officer  = case when v_joining and accepted_by is null then v_name else coalesce(responding_officer, v_name) end,
           updated_at          = now()
     where id = p_incident_id;
    v_incident := public.sync_incident_from_departments(p_incident_id);
  else
    -- Backup leaves the status alone; the touch refreshes live screens.
    update public.incidents set updated_at = now() where id = p_incident_id
    returning * into v_incident;
  end if;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name, timestamp)
  values (
    v_incident.silo, v_incident.id,
    case when v_lead then '[STATUS] ' else format('[BACKUP] %s — ', v_name) end
      || p_status::text || ' · ' || public.department_label(v_silo)
      || case when v_queued then format(' (recorded offline, delivered %s later)', to_char(now() - v_at, 'HH24:MI:SS'))
              else '' end,
    auth.uid(), v_name, v_at
  );

  if v_joining then
    select unit_number into v_unit from public.apparatus where id = v_me.unit_id;
    insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name, timestamp)
    values (v_incident.silo, v_incident.id,
      format('[RESPONDING] %s%s responding%s', v_name, coalesce(' (' || v_unit || ')', ''),
             case when v_lead then format(' — leads %s', public.department_label(v_silo)) else ' as backup' end),
      auth.uid(), v_name, v_at);

    perform public.notify_incident_chain(
      v_incident, 'responding',
      case when v_lead then format('%s responding to %s (%s)', v_name, v_incident.incident_number, public.department_label(v_silo))
           else format('%s joined %s as backup', v_name, v_incident.incident_number) end,
      format('%s%s · %s', coalesce(v_unit || ' · ', ''), v_incident.incident_type, v_incident.location_address)
    );

    -- The department's lead hears about backup on the way.
    if not v_lead and v_dept.lead_id is not null and v_dept.lead_id <> auth.uid() then
      insert into public.alerts (
        tenant_id, silo, target_user_id, kind, severity, title, body, incident_id, link,
        presentation, requires_ack, created_by, created_by_name
      )
      select v_incident.tenant_id, p.silo, v_dept.lead_id, 'backup', v_incident.incident_severity::text,
             format('%s is joining you on %s', v_name, v_incident.incident_number),
             format('Backup%s en route', coalesce(' · ' || v_unit, '')),
             v_incident.id, format('/incidents/%s', v_incident.id),
             'toast', false, auth.uid(), v_name
      from public.personnel p
      where p.user_id = v_dept.lead_id and p.tenant_id = v_incident.tenant_id
      limit 1;
    end if;
  end if;

  return v_incident;
end $$;

revoke execute on function public.update_responder_status(uuid, incident_status, timestamptz) from public, anon;
grant  execute on function public.update_responder_status(uuid, incident_status, timestamptz) to authenticated;

-- ── 7. Not needed ───────────────────────────────────────────────────────────

-- A department is stood down from a call with a reason: by its desk or
-- command, or the control room, while its crew is not yet on scene; by its
-- command once they are (the lead otherwise files the report). The last
-- department on a call nobody filed on is not stood down: the call is
-- cancelled instead, with the reason.
create or replace function public.stand_down_department(p_incident_id uuid, p_silo public.silo, p_reason text)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_dept     public.incident_departments;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_name     text;
  v_label    text := public.department_label(p_silo);
  r          record;
begin
  perform public.require_role(
    'Captain','Chief','FireChief','Supervisor','Dispatcher','ControlRoom','Operator',
    'Admin','SystemAdmin','SuperAdmin','SystemController','System'
  );
  select * into v_incident from public.incidents
   where id = p_incident_id and tenant_id = public.current_tenant()
   for update;
  if not found then raise exception 'Incident % not found', p_incident_id using errcode = 'P0002'; end if;
  if not public.can_direct_department(p_silo) then
    raise exception 'Only % dispatch or command, or the control room, stands % down', v_label, v_label
      using errcode = '42501';
  end if;
  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text) using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 10 then
    raise exception 'Say why % is not needed (at least 10 characters)', v_label using errcode = '22023';
  end if;

  perform public.ensure_incident_departments(v_incident);
  select * into v_dept from public.incident_departments
   where incident_id = p_incident_id and silo = p_silo
   for update;
  if not found then
    raise exception '% was not sent to %', v_incident.incident_number, v_label using errcode = 'P0002';
  end if;
  if v_dept.status = 'Not needed' then return v_incident; end if;
  if not public.department_open(v_dept.status) then
    raise exception '% has already finished its part on %', v_label, v_incident.incident_number using errcode = '22023';
  end if;
  if public.department_step_rank(v_dept.status) >= 3 and not public.commands_department(p_silo) then
    raise exception '% is on scene. Its lead files the report, or % command stands the crew down.', v_label, v_label
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.incident_departments d
                  where d.incident_id = p_incident_id and d.id <> v_dept.id
                    and (public.department_open(d.status) or d.report_filed_at is not null)) then
    raise exception 'No other department is on %. Cancel the call instead, with the reason.', v_incident.incident_number
      using errcode = '22023';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  update public.incident_departments
     set status = 'Not needed', finished_at = now(), finished_by = auth.uid(), finished_by_name = v_name,
         finish_reason = left(v_reason, 500), updated_at = now()
   where id = v_dept.id;

  -- Its crew stands down.
  for r in
    select distinct u.uid from (
      select v_dept.assigned_to as uid
      union all select v_dept.lead_id
      union all select ir.user_id from public.incident_responders ir where ir.incident_id = p_incident_id and ir.silo = p_silo
    ) u where u.uid is not null and u.uid is distinct from auth.uid()
  loop
    insert into public.alerts (
      tenant_id, silo, target_user_id, kind, severity, title, body, incident_id, link,
      presentation, requires_ack, created_by, created_by_name
    )
    select v_incident.tenant_id, p.silo, r.uid, 'stand_down', v_incident.incident_severity::text,
           format('%s: stand down', v_incident.incident_number), left(v_reason, 500),
           v_incident.id, format('/incidents/%s', v_incident.id), 'modal', false, auth.uid(), v_name
      from public.profiles p where p.id = r.uid and p.deactivated_at is null;
  end loop;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[DEPARTMENT] %s not needed (%s): %s', v_label, coalesce(v_name, 'the desk'), left(v_reason, 500)),
    auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, v_incident.silo, auth.uid(), v_name, p_silo::text, 'DEPARTMENT_STOOD_DOWN', 'incidents',
    v_incident.id::text, format('%s stood down from %s: %s', v_label, v_incident.incident_number, left(v_reason, 500)));

  v_incident := public.sync_incident_from_departments(p_incident_id);
  perform public.notify_incident_chain(
    v_incident,
    case when v_incident.status = 'Resolved' then 'resolved' else 'stood_down' end,
    case when v_incident.status = 'Resolved'
         then format('%s resolved: every department has finished', v_incident.incident_number)
         else format('%s: %s not needed', v_incident.incident_number, v_label) end,
    left(v_reason, 300)
  );
  return v_incident;
end $$;

revoke all on function public.stand_down_department(uuid, public.silo, text) from public, anon;
grant execute on function public.stand_down_department(uuid, public.silo, text) to authenticated;

-- ── 8. No signing off mid-call ──────────────────────────────────────────────

-- As 0039, per department: the lead of a department's part stays on duty
-- until that part is finished, whatever the other departments are doing.
create or replace function public.hold_duty_during_call()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_open text;
begin
  if new.user_id is null then return new; end if;
  if not (
    (old.is_on_duty and not coalesce(new.is_on_duty, false))
    or (old.assigned_apparatus_id is not null
        and new.assigned_apparatus_id is distinct from old.assigned_apparatus_id)
  ) then
    return new;
  end if;

  select i.incident_number into v_open
    from public.incident_departments d join public.incidents i on i.id = d.incident_id
   where d.lead_id = new.user_id and public.department_open(d.status) and i.status not in ('Resolved', 'Closed')
   limit 1;
  if v_open is null then return new; end if;

  if auth.uid() is not null then
    raise exception '% is still open — file its report before going off duty or signing out', v_open;
  end if;
  new.is_on_duty            := old.is_on_duty;
  new.assigned_apparatus_id := old.assigned_apparatus_id;
  return new;
end $$;

-- ── 9. A department's desk reads its own crews ──────────────────────────────

-- Dispatchers counted as "global" read every department's crews: the Metro
-- Police desk counted Fire and EMS as on duty. A department's dispatch desk
-- now reads its own department's; the control room and organisation roles
-- read every department's, as before.
drop policy if exists personnel_read on public.personnel;
create policy personnel_read on public.personnel for select using (
  silo = public.current_silo() or (public.is_global() and public.desk_silo() is null)
);

-- ── 10. Reports finish their department's part ──────────────────────────────

-- The four report functions as they were (0039, 0059, 0064, 0065), with two
-- changes each, marked 0073: the call is read as the filing department sees
-- it, and the report finishes that department's part instead of resolving
-- the call.

create or replace function public.file_incident_report(
  p_incident_id uuid,
  p_report_type text,
  p_fields      jsonb,
  p_details     jsonb default '{}'::jsonb
) returns public.metro_reports
language plpgsql security definer set search_path = public as $$
declare
  v_incident public.incidents;
  v_person   public.personnel;
  v_report   public.metro_reports;
  v_name     text;
  v_narr     text := nullif(trim(coalesce(p_fields ->> 'officer_narrative', '')), '');
  f          jsonb := coalesce(p_fields, '{}'::jsonb);
begin
  perform public.require_role('Police','Officer','Metro','Security','Captain','Supervisor',
                              'Admin','SystemAdmin','SuperAdmin');

  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;
  -- 0073: the call as MetroPolice sees it — its own lead, status and report.
  v_incident := public.incident_for_department(v_incident, 'MetroPolice');

  -- Replay of a report already filed (offline retry): return it unchanged.
  if v_incident.report_filed_at is not null then
    select * into v_report from public.metro_reports
    where incident_id = p_incident_id and filed_at is not null
    order by filed_at limit 1;
    if found then return v_report; end if;
  end if;

  if v_incident.accepted_by is distinct from auth.uid() then
    raise exception 'Only the officer who accepted % can file its report', v_incident.incident_number;
  end if;
  if v_incident.status not in ('Arrived', 'On Scene', 'Transporting') then
    raise exception 'Mark yourself on scene before filing the report for %', v_incident.incident_number;
  end if;
  if v_narr is null or length(v_narr) < 20 then
    raise exception 'The officer narrative is required (at least 20 characters)';
  end if;

  select * into v_person from public.personnel
  where user_id = auth.uid() and tenant_id = public.current_tenant();
  select full_name into v_name from public.profiles where id = auth.uid();

  insert into public.metro_reports (
    silo, incident_id, case_number, date_of_offense, time_of_offense, location, station,
    incident_category, officer_name, badge_number, partner_name, bodycam_active,
    dispatch_time, arrival_time, clear_time, total_time,
    arrest_made, charges, use_of_force,
    suspect_name, suspect_description, offender_name, offender_id,
    victim_name, victim_contact, victim_id, victim_injuries,
    vehicle_make, license_plate, vin_number, reg_number, vehicle_impounded, impound_lot,
    weapon_type, weapon_size, ammunition_rounds,
    fine_amount, ticket_number,
    contraband_seized, contraband_details,
    evidence_weapons, evidence_drugs, evidence_property, evidence_log,
    officer_narrative,
    report_type, details, filed_by, filed_at
  ) values (
    'MetroPolice', v_incident.id, v_incident.incident_number,
    (v_incident.call_timestamp at time zone 'Africa/Johannesburg')::date,
    to_char(v_incident.call_timestamp at time zone 'Africa/Johannesburg', 'HH24:MI'),
    v_incident.location_address, v_person.station,
    v_incident.incident_type,
    coalesce(trim(v_person.rank || ' ' || v_person.first_name || ' ' || v_person.last_name), v_name),
    v_person.badge_number,
    nullif(trim(f ->> 'partner_name'), ''),
    nullif(trim(f ->> 'bodycam_active'), ''),
    to_char(v_incident.dispatch_time at time zone 'Africa/Johannesburg', 'HH24:MI'),
    to_char(v_incident.arrived_timestamp at time zone 'Africa/Johannesburg', 'HH24:MI'),
    to_char(now() at time zone 'Africa/Johannesburg', 'HH24:MI'),
    case when v_incident.dispatch_time is not null
         then round(extract(epoch from (now() - v_incident.dispatch_time)) / 60)::text || ' min' end,
    nullif(trim(f ->> 'arrest_made'), ''),
    nullif(trim(f ->> 'charges'), ''),
    nullif(trim(f ->> 'use_of_force'), ''),
    nullif(trim(f ->> 'suspect_name'), ''),
    nullif(trim(f ->> 'suspect_description'), ''),
    nullif(trim(f ->> 'offender_name'), ''),
    nullif(trim(f ->> 'offender_id'), ''),
    nullif(trim(f ->> 'victim_name'), ''),
    nullif(trim(f ->> 'victim_contact'), ''),
    nullif(trim(f ->> 'victim_id'), ''),
    nullif(trim(f ->> 'victim_injuries'), ''),
    nullif(trim(f ->> 'vehicle_make'), ''),
    upper(nullif(trim(f ->> 'license_plate'), '')),
    upper(nullif(trim(f ->> 'vin_number'), '')),
    upper(nullif(trim(f ->> 'reg_number'), '')),
    coalesce(nullif(trim(f ->> 'vehicle_impounded'), ''), 'No'),
    nullif(trim(f ->> 'impound_lot'), ''),
    nullif(trim(f ->> 'weapon_type'), ''),
    nullif(trim(f ->> 'weapon_size'), ''),
    coalesce(nullif(regexp_replace(coalesce(f ->> 'ammunition_rounds', ''), '[^0-9]', '', 'g'), '')::int, 0),
    nullif(regexp_replace(coalesce(f ->> 'fine_amount', ''), '[^0-9.]', '', 'g'), '')::numeric,
    nullif(trim(f ->> 'ticket_number'), ''),
    nullif(trim(f ->> 'contraband_seized'), ''),
    nullif(trim(f ->> 'contraband_details'), ''),
    coalesce(f ->> 'evidence_weapons', '') in ('true', 'Yes'),
    coalesce(f ->> 'evidence_drugs', '') in ('true', 'Yes'),
    coalesce(f ->> 'evidence_property', '') in ('true', 'Yes'),
    nullif(trim(f ->> 'evidence_log'), ''),
    v_narr,
    nullif(trim(coalesce(p_report_type, '')), ''),
    coalesce(p_details, '{}'::jsonb),
    auth.uid(), now()
  ) returning * into v_report;

  -- 0073: the report finishes MetroPolice's part; the call is resolved once every department has finished.
  v_incident := public.finish_department_by_report(p_incident_id, 'MetroPolice', now());

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[REPORT] %s report filed by %s', coalesce(p_report_type, 'Case'), coalesce(v_name, 'officer')),
    auth.uid(), v_name);

  insert into public.audit_logs (silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.silo, auth.uid(), v_name, 'MetroPolice', 'REPORT_FILED', 'incidents', v_incident.id::text,
    format('%s report filed for %s', coalesce(p_report_type, 'Case'), v_incident.incident_number));

  perform public.notify_incident_chain(
    v_incident, case when v_incident.status = 'Resolved' then 'resolved' else 'report_filed' end,
    format('%s: police report filed by %s', v_incident.incident_number, coalesce(v_name, 'officer')),
    format('%s · %s', v_incident.incident_type, v_incident.location_address)
  );

  return v_report;
end $$;

create or replace function public.file_fire_report(p_incident_id uuid, p_fields jsonb)
returns public.firefighter_reports
language plpgsql security definer set search_path to 'public' as $$
declare
  f          jsonb := coalesce(p_fields, '{}'::jsonb);
  v_incident public.incidents;
  v_person   public.personnel;
  v_report   public.firefighter_reports;
  v_name     text;
  v_officer  text;
  v_summary  text := nullif(trim(coalesce(f ->> 'narrative_summary', '')), '');
  v_type     text := nullif(trim(coalesce(f ->> 'type_of_incident', '')), '');
  v_cause    text := nullif(trim(coalesce(f ->> 'fire_cause', '')), '');
  v_vent     text := nullif(trim(coalesce(f ->> 'ventilation_type', '')), '');
  v_hazmat   text := nullif(trim(coalesce(f ->> 'hazmat_description', '')), '');
  v_photos   int;
  v_now      timestamptz := now();
begin
  perform public.require_role('Firefighter', 'FireChief', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin');

  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;
  -- 0073: the call as MetroFire sees it — its own lead, status and report.
  v_incident := public.incident_for_department(v_incident, 'MetroFire');

  -- Replay of a report already filed (offline retry): return it unchanged.
  if v_incident.report_filed_at is not null then
    select * into v_report from public.firefighter_reports
    where incident_id = p_incident_id order by report_submission_date limit 1;
    if found then return v_report; end if;
    raise exception '% is already closed', v_incident.incident_number using errcode = 'P0001';
  end if;

  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text) using errcode = 'P0001';
  end if;
  if v_incident.accepted_by is distinct from auth.uid() then
    raise exception 'Only the firefighter leading % files its report', v_incident.incident_number using errcode = 'P0001';
  end if;
  if v_incident.status not in ('Arrived', 'On Scene', 'Transporting') then
    raise exception 'Mark yourself on scene before filing the report for %', v_incident.incident_number using errcode = 'P0001';
  end if;

  -- What the report must say.
  if v_type is null then
    raise exception 'Choose the type of incident.' using errcode = 'P0001';
  end if;
  if v_summary is null or length(v_summary) < 20 then
    raise exception 'The summary is required (at least 20 characters).' using errcode = 'P0001';
  end if;
  if v_cause is null then
    raise exception 'Give the cause, or Under investigation.' using errcode = 'P0001';
  end if;
  if coalesce(nullif(regexp_replace(coalesce(f ->> 'civilian_fatalities', ''), '[^0-9]', '', 'g'), '')::int, 0)
     + coalesce(nullif(regexp_replace(coalesce(f ->> 'firefighter_fatalities', ''), '[^0-9]', '', 'g'), '')::int, 0) > 0
     and nullif(trim(coalesce(f ->> 'civilian_fatality_details', '') || coalesce(f ->> 'firefighter_fatality_details', '')), '') is null then
    raise exception 'Describe the fatalities.' using errcode = 'P0001';
  end if;
  if coalesce(nullif(regexp_replace(coalesce(f ->> 'civilian_injuries', ''), '[^0-9]', '', 'g'), '')::int, 0)
     + coalesce(nullif(regexp_replace(coalesce(f ->> 'firefighter_injuries', ''), '[^0-9]', '', 'g'), '')::int, 0) > 0
     and nullif(trim(coalesce(f ->> 'civilian_injury_details', '') || coalesce(f ->> 'firefighter_injury_details', '')), '') is null then
    raise exception 'Describe the injuries.' using errcode = 'P0001';
  end if;

  select * into v_person from public.personnel
  where user_id = auth.uid() and tenant_id = public.current_tenant();
  select full_name into v_name from public.profiles where id = auth.uid();
  v_officer := coalesce(nullif(trim(concat_ws(' ', v_person.first_name, v_person.last_name)), ''), v_name, 'Firefighter');
  select count(*) into v_photos from public.incident_attachments where incident_id = p_incident_id and kind = 'image';

  insert into public.firefighter_reports (
    tenant_id, silo, incident_id, apparatus_id, report_number, date_of_incident, time_of_incident, location,
    type_of_incident,
    dispatch_time_seconds, arrival_time_seconds, clear_time_seconds, total_time_on_scene_seconds,
    fire_department_name, station_number, narrative_summary, initial_observations,
    smoke_conditions, flame_spread, heat_signature, hazards_identified,
    fire_suppression_details, search_and_rescue_performed, persons_rescued, rescue_location, rescue_condition,
    ventilation_conducted, ventilation_type, salvage_overhaul, hazmat_operations, hazmat_description,
    medical_aid_provided, medical_aid_description, utilities_secured, utility_details,
    point_of_origin_room, point_of_origin_object, ignition_source, fire_cause,
    fire_investigation_conducted, fire_investigation_reason,
    property_type, property_owner, property_contact, property_value, damage_estimate,
    photos_attached, no_photo_reason,
    civilian_injuries, civilian_injury_details, civilian_fatalities, civilian_fatality_details,
    firefighter_injuries, firefighter_injury_details, firefighter_fatalities, firefighter_fatality_details,
    treatment_provided, treatment_details,
    other_agencies_on_scene, mutual_aid_used, equipment_used, challenges_faced, successes, recommendations,
    reporting_officer_name, reporting_officer_rank, reporting_officer_id, report_submission_date
  ) values (
    v_incident.tenant_id, 'MetroFire', v_incident.id, coalesce(v_incident.unit_id, v_person.assigned_apparatus_id),
    'FR-' || v_incident.incident_number,
    (coalesce(v_incident.call_timestamp, v_incident.incident_created_at) at time zone 'Africa/Johannesburg')::date,
    coalesce(nullif(f ->> 'time_of_incident', '')::time,
             (coalesce(v_incident.call_timestamp, v_incident.incident_created_at) at time zone 'Africa/Johannesburg')::time),
    coalesce(nullif(trim(f ->> 'location'), ''), v_incident.location_address),
    v_type,
    -- Durations, from the incident's own timestamps: never typed.
    greatest(0, coalesce(extract(epoch from (v_incident.dispatch_time - coalesce(v_incident.call_timestamp, v_incident.incident_created_at))), 0))::bigint,
    greatest(0, coalesce(extract(epoch from (v_incident.arrived_timestamp - v_incident.dispatch_time)), 0))::bigint,
    greatest(0, coalesce(extract(epoch from (v_now - coalesce(v_incident.dispatch_time, v_incident.incident_created_at))), 0))::bigint,
    greatest(0, coalesce(extract(epoch from (v_now - v_incident.arrived_timestamp)), 0))::bigint,
    nullif(trim(f ->> 'fire_department_name'), ''), nullif(trim(f ->> 'station_number'), ''),
    v_summary, nullif(trim(f ->> 'initial_observations'), ''),
    nullif(trim(f ->> 'smoke_conditions'), ''), nullif(trim(f ->> 'flame_spread'), ''),
    nullif(trim(f ->> 'heat_signature'), ''), nullif(trim(f ->> 'hazards_identified'), ''),
    nullif(trim(f ->> 'fire_suppression_details'), ''),
    coalesce(f ->> 'search_and_rescue_performed', '') in ('true', 'Yes'),
    least(1000, coalesce(nullif(regexp_replace(coalesce(f ->> 'persons_rescued', ''), '[^0-9]', '', 'g'), '')::int, 0)),
    nullif(trim(f ->> 'rescue_location'), ''), nullif(trim(f ->> 'rescue_condition'), ''),
    v_vent is not null and v_vent <> 'None', case when v_vent = 'None' then null else v_vent end,
    coalesce(f ->> 'salvage_overhaul', '') in ('true', 'Yes'),
    v_hazmat is not null, v_hazmat,
    coalesce(f ->> 'medical_aid_provided', '') in ('true', 'Yes'), nullif(trim(f ->> 'medical_aid_description'), ''),
    coalesce(f ->> 'utilities_secured', '') in ('true', 'Yes'), nullif(trim(f ->> 'utility_details'), ''),
    nullif(trim(f ->> 'point_of_origin_room'), ''), nullif(trim(f ->> 'point_of_origin_object'), ''),
    nullif(trim(f ->> 'ignition_source'), ''), v_cause,
    coalesce(f ->> 'fire_investigation_conducted', '') in ('true', 'Yes'), nullif(trim(f ->> 'fire_investigation_reason'), ''),
    nullif(trim(f ->> 'property_type'), ''), nullif(trim(f ->> 'property_owner'), ''), nullif(trim(f ->> 'property_contact'), ''),
    least(1e12, greatest(0, coalesce(nullif(regexp_replace(coalesce(f ->> 'property_value', ''), '[^0-9.]', '', 'g'), '')::numeric, 0))),
    least(1e12, greatest(0, coalesce(nullif(regexp_replace(coalesce(f ->> 'damage_estimate', ''), '[^0-9.]', '', 'g'), '')::numeric, 0))),
    v_photos > 0, case when v_photos = 0 then nullif(trim(f ->> 'no_photo_reason'), '') end,
    least(1000, coalesce(nullif(regexp_replace(coalesce(f ->> 'civilian_injuries', ''), '[^0-9]', '', 'g'), '')::int, 0)),
    nullif(trim(f ->> 'civilian_injury_details'), ''),
    least(1000, coalesce(nullif(regexp_replace(coalesce(f ->> 'civilian_fatalities', ''), '[^0-9]', '', 'g'), '')::int, 0)),
    nullif(trim(f ->> 'civilian_fatality_details'), ''),
    least(1000, coalesce(nullif(regexp_replace(coalesce(f ->> 'firefighter_injuries', ''), '[^0-9]', '', 'g'), '')::int, 0)),
    nullif(trim(f ->> 'firefighter_injury_details'), ''),
    least(1000, coalesce(nullif(regexp_replace(coalesce(f ->> 'firefighter_fatalities', ''), '[^0-9]', '', 'g'), '')::int, 0)),
    nullif(trim(f ->> 'firefighter_fatality_details'), ''),
    coalesce(f ->> 'treatment_provided', '') in ('true', 'Yes'), nullif(trim(f ->> 'treatment_details'), ''),
    nullif(trim(f ->> 'other_agencies_on_scene'), ''),
    coalesce(f ->> 'mutual_aid_used', '') in ('true', 'Yes'),
    nullif(trim(f ->> 'equipment_used'), ''), nullif(trim(f ->> 'challenges_faced'), ''),
    nullif(trim(f ->> 'successes'), ''), nullif(trim(f ->> 'recommendations'), ''),
    v_officer, nullif(trim(v_person.rank), ''), nullif(trim(v_person.badge_number), ''), v_now
  ) returning * into v_report;

  -- 0073: the report finishes MetroFire's part; the call is resolved once every department has finished.
  v_incident := public.finish_department_by_report(p_incident_id, 'MetroFire', v_now);

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[REPORT] Fire report %s filed by %s', v_report.report_number, v_officer),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, 'MetroFire', auth.uid(), v_name, 'MetroFire', 'REPORT_FILED', 'incidents', v_incident.id::text,
    format('Fire report %s filed for %s (%s)', v_report.report_number, v_incident.incident_number, v_type));

  perform public.notify_incident_chain(
    v_incident, case when v_incident.status = 'Resolved' then 'resolved' else 'report_filed' end,
    format('%s: fire report filed by %s', v_incident.incident_number, v_officer),
    format('%s · %s', v_type, v_incident.location_address)
  );

  return v_report;
end $$;

create or replace function public.file_pcr(p_incident_id uuid, p_fields jsonb)
returns public.paramedic_reports
language plpgsql security definer set search_path to 'public' as $$
declare
  f            jsonb := coalesce(p_fields, '{}'::jsonb);
  v_incident   public.incidents;
  v_person     public.personnel;
  v_report     public.paramedic_reports;
  v_vehicle    public.apparatus;
  v_history    uuid;
  v_vitals     uuid;
  v_int        uuid;
  v_name       text;
  v_medic      text;
  v_now        timestamptz := now();
  v_today      date := (now() at time zone 'Africa/Johannesburg')::date;
  v_mode       text := nullif(trim(coalesce(f ->> 'transport_mode', '')), '');
  v_dest       text := nullif(trim(coalesce(f ->> 'destination_hospital', '')), '');
  v_care       text := nullif(trim(coalesce(f ->> 'level_of_care', '')), '');
  v_response   text := nullif(trim(coalesce(f ->> 'patient_response', '')), '');
  v_complaint  text := nullif(trim(coalesce(f ->> 'chief_complaint', '')), '');
  v_signature  text := nullif(trim(coalesce(f ->> 'responder_signature_image_base64', '')), '');
  v_cleaning   text := f ->> 'requires_cleaning';
  v_pain       int;
  v_gcs        int;
  v_short      text;
  v_ambulance  uuid;
  v_secondary  jsonb;
  v_doctor     text := nullif(trim(coalesce(f ->> 'handover_doctor_name', '')), '');
  v_condition  text := nullif(trim(coalesce(f ->> 'handover_patient_status', '')), '');
  v_handover   boolean;
begin
  -- The EMS crew files; the receiving doctor signs on the crew's phone (0064).
  perform public.require_role('Paramedic', 'Responder', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin');
  if public.current_silo() is distinct from 'Medical' then
    raise exception 'Only EMS files a patient care report' using errcode = '42501';
  end if;

  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;
  -- 0073: the call as Medical sees it — its own lead, status and report.
  v_incident := public.incident_for_department(v_incident, 'Medical');

  -- Replay of a report already filed (offline retry): return it unchanged.
  if v_incident.report_filed_at is not null then
    select * into v_report from public.paramedic_reports
    where incident_id = p_incident_id and report_number is not null order by filed_at limit 1;
    if found then return v_report; end if;
    raise exception '% is already closed', v_incident.incident_number using errcode = 'P0001';
  end if;

  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text) using errcode = 'P0001';
  end if;
  if v_incident.accepted_by is distinct from auth.uid() then
    raise exception 'Only the crew member leading % files its patient report', v_incident.incident_number using errcode = 'P0001';
  end if;
  if v_incident.status not in ('Arrived', 'On Scene', 'Transporting') then
    raise exception 'Mark yourself on scene before filing the patient report for %', v_incident.incident_number using errcode = 'P0001';
  end if;

  -- What the report must say.
  if v_complaint is null then raise exception 'Chief Complaint is required.' using errcode = 'P0001'; end if;
  if v_care is null or v_care not in ('BLS', 'ILS', 'ALS') then
    raise exception 'Care Level is required.' using errcode = 'P0001';
  end if;
  if v_response is null or v_response not in ('Improved', 'Unchanged', 'Deteriorated', 'Succumbed on Scene') then
    raise exception 'Overall Patient Response to Treatment is required.' using errcode = 'P0001';
  end if;
  if v_mode is not null and v_mode not in ('Ambulance (Ground)', 'HEMS (Airlift)', 'Private Transport') then
    raise exception 'Choose the transport mode from the list.' using errcode = 'P0001';
  end if;
  if v_mode in ('Ambulance (Ground)', 'HEMS (Airlift)') and v_dest is null then
    raise exception 'Choose the destination facility.' using errcode = 'P0001';
  end if;
  -- Taken to hospital: the hand-over of care is part of the report.
  v_handover := coalesce(v_mode in ('Ambulance (Ground)', 'HEMS (Airlift)'), false);
  if v_handover then
    if v_doctor is null then raise exception 'Receiving Doctor is required.' using errcode = 'P0001'; end if;
    if nullif(f ->> 'arrival_time', '') is null then
      raise exception 'Hospital Arrival / Handover Time is required.' using errcode = 'P0001';
    end if;
    if v_condition is null then raise exception 'Patient Status at Handover is required.' using errcode = 'P0001'; end if;
    if nullif(f ->> 'doctor_signature_image_base64', '') is null then
      raise exception 'The receiving doctor must sign.' using errcode = 'P0001';
    end if;
  end if;
  if length(coalesce(v_condition, '')) > 500 then
    raise exception 'Patient Status at Handover is too long (500 characters).' using errcode = 'P0001';
  end if;
  if v_signature is null or v_signature not like 'data:image/%' or length(v_signature) > 600000 then
    raise exception 'The lead paramedic must sign.' using errcode = 'P0001';
  end if;
  if v_cleaning is null or v_cleaning not in ('true', 'false') then
    raise exception 'Say whether the vehicle requires cleaning.' using errcode = 'P0001';
  end if;
  if coalesce(f ->> 'departure_time', '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9])?$'
     or coalesce(f ->> 'arrival_time', '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9])?$'
     or coalesce(f ->> 'medication_time', '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9])?$' then
    raise exception 'Times must be HH:MM.' using errcode = 'P0001';
  end if;
  if coalesce(f ->> 'date_of_birth', '') !~ '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$' then
    raise exception 'Date of Birth must be a date.' using errcode = 'P0001';
  end if;
  v_pain := nullif(regexp_replace(coalesce(f ->> 'pain_scale', ''), '[^0-9]', '', 'g'), '')::int;
  if v_pain is not null and (v_pain < 0 or v_pain > 10) then
    raise exception 'Pain Scale must be 0 to 10.' using errcode = 'P0001';
  end if;
  for v_short in select unnest(array['hospital_representative_signature_base64', 'doctor_signature_image_base64']) loop
    if nullif(f ->> v_short, '') is not null and ((f ->> v_short) not like 'data:image/%' or length(f ->> v_short) > 600000) then
      raise exception 'A signature could not be read. Sign again.' using errcode = 'P0001';
    end if;
  end loop;
  begin
    v_secondary := coalesce(nullif(f ->> 'secondary_patients_json', ''), '[]')::jsonb;
  exception when others then
    raise exception 'The casualties list could not be read. Check it and file again.' using errcode = 'P0001';
  end;
  if jsonb_typeof(v_secondary) <> 'array' or jsonb_array_length(v_secondary) > 50 then
    raise exception 'The casualties list could not be read. Check it and file again.' using errcode = 'P0001';
  end if;

  select * into v_person from public.personnel
  where user_id = auth.uid() and tenant_id = public.current_tenant();
  select full_name into v_name from public.profiles where id = auth.uid();
  v_medic := coalesce(nullif(trim(concat_ws(' ', v_person.first_name, v_person.last_name)), ''), v_name, 'Paramedic');
  v_ambulance := coalesce(v_person.assigned_apparatus_id, v_incident.unit_id);
  v_gcs := nullif(regexp_replace(coalesce(f ->> 'gcs_eye', ''), '\D.*$', ''), '')::int
         + nullif(regexp_replace(coalesce(f ->> 'gcs_verbal', ''), '\D.*$', ''), '')::int
         + nullif(regexp_replace(coalesce(f ->> 'gcs_motor', ''), '\D.*$', ''), '')::int;

  insert into public.medical_histories (tenant_id, silo, patient_id, allergies, chronic_conditions, medications)
  values (v_incident.tenant_id, 'Medical', nullif(trim(f ->> 'identification_number'), ''),
    nullif(trim(f ->> 'allergies'), ''), nullif(trim(f ->> 'medical_history'), ''), nullif(trim(f ->> 'current_medications'), ''))
  returning id into v_history;

  insert into public.vital_signs (tenant_id, silo, blood_pressure, pulse_rate, respiratory_rate, oxygen_saturation,
    glasgow_coma_scale, blood_glucose_level, temperature)
  values (v_incident.tenant_id, 'Medical', nullif(trim(f ->> 'blood_pressure'), ''), nullif(trim(f ->> 'pulse_rate'), ''),
    nullif(trim(f ->> 'respiratory_rate'), ''), nullif(trim(f ->> 'oxygen_saturation'), ''),
    v_gcs::text, nullif(trim(f ->> 'blood_glucose_level'), ''), nullif(trim(f ->> 'body_temperature'), ''))
  returning id into v_vitals;

  insert into public.interventions (tenant_id, silo, airway_management, circulation_management, medication_admin)
  values (v_incident.tenant_id, 'Medical', nullif(trim(f ->> 'airway_management'), ''),
    nullif(trim(f ->> 'circulation_management'), ''), nullif(trim(f ->> 'medication_admin'), ''))
  returning id into v_int;

  insert into public.paramedic_reports (
    tenant_id, silo, incident_id, report_number, filed_by, filed_at, ambulance_id, total_response_seconds,
    patient_name, identification_number, date_of_birth, age, gender, weight, language, address, contact_number,
    next_of_kin, income, has_insurance, insurance_information, allergies,
    medical_history_id, vitals_id, interventions_id,
    incident_location, time_of_arrival, departure_time, scene_assessment, mechanism_of_injury,
    transport_mode, destination_hospital, level_of_care,
    paramedic_names, paramedic_ids, arrival_time,
    chief_complaint, nature_of_illness, presenting_problem, treatment_narrative,
    current_medications, risk_of_harm, patient_response, protocol_adherence,
    psych_danger_to_self_or_others, psych_health_risk, psych_believes_health_risk, psych_believes_danger,
    pulse_waveform, body_temperature, end_tidal_co2, level_of_consciousness, alert_and_oriented,
    gcs_eye, gcs_verbal, gcs_motor, stroke_assessment, pain_scale, pupils,
    skin_unremarkable, skin_cool, skin_pale, skin_diaphoretic, skin_cyanotic, skin_moist, skin_flush, skin_dry,
    medication_time, medication_dosage, medication_route, medication_comments,
    inv_oxygen, inv_bvm, inv_suction, inv_iv, inv_bandages, inv_aed, inv_drugs, inv_sharps, inv_ppe,
    responder_signature_image_base64, hospital_representative_signature_base64, doctor_signature_image_base64,
    requires_cleaning, secondary_patients_json, handover_doctor_name, handover_patient_status
  ) values (
    v_incident.tenant_id, 'Medical', v_incident.id, 'PCR-' || v_incident.incident_number, auth.uid(), v_now, v_ambulance,
    -- V4's total response time: from dispatch (or logging) to the report.
    greatest(0, extract(epoch from (v_now - coalesce(v_incident.dispatch_time, v_incident.incident_created_at))))::bigint,
    nullif(trim(f ->> 'patient_name'), ''), nullif(trim(f ->> 'identification_number'), ''),
    nullif(f ->> 'date_of_birth', '')::date,
    least(150, nullif(regexp_replace(coalesce(f ->> 'age', ''), '[^0-9]', '', 'g'), '')::int),
    nullif(trim(f ->> 'gender'), ''), nullif(trim(f ->> 'weight'), ''), nullif(trim(f ->> 'language'), ''),
    nullif(trim(f ->> 'address'), ''), nullif(trim(f ->> 'contact_number'), ''), nullif(trim(f ->> 'next_of_kin'), ''),
    nullif(trim(f ->> 'income'), ''), case when f ->> 'has_insurance' = 'Yes' then 'yes' else 'no' end,
    case when f ->> 'has_insurance' = 'Yes' then nullif(trim(f ->> 'insurance_information'), '') end,
    nullif(trim(f ->> 'allergies'), ''),
    v_history, v_vitals, v_int,
    coalesce(nullif(trim(f ->> 'incident_location'), ''), v_incident.location_address),
    v_incident.arrived_timestamp,
    case when nullif(f ->> 'departure_time', '') is not null
         then ((v_today + (f ->> 'departure_time')::time) at time zone 'Africa/Johannesburg') end,
    nullif(trim(f ->> 'scene_assessment'), ''), nullif(trim(f ->> 'mechanism_of_injury'), ''),
    v_mode, v_dest, v_care,
    coalesce(nullif(trim(f ->> 'paramedic_names'), ''), v_medic), nullif(trim(f ->> 'paramedic_ids'), ''),
    case when nullif(f ->> 'arrival_time', '') is not null
         then ((v_today + (f ->> 'arrival_time')::time) at time zone 'Africa/Johannesburg') end,
    v_complaint, nullif(trim(f ->> 'nature_of_illness'), ''), nullif(trim(f ->> 'presenting_problem'), ''),
    nullif(trim(f ->> 'treatment_narrative'), ''),
    nullif(trim(f ->> 'current_medications'), ''), nullif(trim(f ->> 'risk_of_harm'), ''), v_response,
    coalesce(f ->> 'protocol_adherence', '') = 'true',
    coalesce(f ->> 'psych_danger_to_self_or_others', '') = 'true', coalesce(f ->> 'psych_health_risk', '') = 'true',
    coalesce(f ->> 'psych_believes_health_risk', '') = 'true', coalesce(f ->> 'psych_believes_danger', '') = 'true',
    nullif(trim(f ->> 'pulse_waveform'), ''), nullif(trim(f ->> 'body_temperature'), ''), nullif(trim(f ->> 'end_tidal_co2'), ''),
    nullif(trim(f ->> 'level_of_consciousness'), ''), nullif(trim(f ->> 'alert_and_oriented'), ''),
    nullif(trim(f ->> 'gcs_eye'), ''), nullif(trim(f ->> 'gcs_verbal'), ''), nullif(trim(f ->> 'gcs_motor'), ''),
    nullif(trim(f ->> 'stroke_assessment'), ''), v_pain, nullif(trim(f ->> 'pupils'), ''),
    coalesce(f ->> 'skin_unremarkable', '') = 'true', coalesce(f ->> 'skin_cool', '') = 'true',
    coalesce(f ->> 'skin_pale', '') = 'true', coalesce(f ->> 'skin_diaphoretic', '') = 'true',
    coalesce(f ->> 'skin_cyanotic', '') = 'true', coalesce(f ->> 'skin_moist', '') = 'true',
    coalesce(f ->> 'skin_flush', '') = 'true', coalesce(f ->> 'skin_dry', '') = 'true',
    nullif(f ->> 'medication_time', '')::time, nullif(trim(f ->> 'medication_dosage'), ''),
    nullif(trim(f ->> 'medication_route'), ''), nullif(trim(f ->> 'medication_comments'), ''),
    coalesce(f ->> 'inv_oxygen', '') = 'true', coalesce(f ->> 'inv_bvm', '') = 'true', coalesce(f ->> 'inv_suction', '') = 'true',
    coalesce(f ->> 'inv_iv', '') = 'true', coalesce(f ->> 'inv_bandages', '') = 'true', coalesce(f ->> 'inv_aed', '') = 'true',
    coalesce(f ->> 'inv_drugs', '') = 'true', coalesce(f ->> 'inv_sharps', '') = 'true', coalesce(f ->> 'inv_ppe', '') = 'true',
    v_signature, nullif(f ->> 'hospital_representative_signature_base64', ''), nullif(f ->> 'doctor_signature_image_base64', ''),
    v_cleaning = 'true', v_secondary,
    case when v_handover then v_doctor end, case when v_handover then v_condition end
  ) returning * into v_report;

  update public.incidents
     set responding_officer = coalesce(responding_officer, v_report.paramedic_names)
   where id = p_incident_id;
  -- 0073: the report finishes Medical's part; the call is resolved once every department has finished.
  v_incident := public.finish_department_by_report(p_incident_id, 'Medical', v_now);

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[REPORT] Patient care report %s filed by %s%s', v_report.report_number, v_medic,
      case when v_handover then format(' · patient handed over to %s at %s, %s', v_doctor, v_dest,
             to_char(v_report.arrival_time at time zone 'Africa/Johannesburg', 'HH24:MI'))
           when v_dest is not null then ' · patient to ' || v_dest else '' end),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, 'Medical', auth.uid(), v_name, 'Medical', 'REPORT_FILED', 'incidents', v_incident.id::text,
    format('Patient care report %s filed for %s (%s, %s)', v_report.report_number,
      v_incident.incident_number, v_care, v_response));

  perform public.notify_incident_chain(
    v_incident, case when v_incident.status = 'Resolved' then 'resolved' else 'report_filed' end,
    format('%s: patient report filed by %s', v_incident.incident_number, v_medic),
    format('%s · %s', v_complaint, coalesce(v_dest, v_incident.location_address))
  );

  -- After the call: the ambulance.
  if v_ambulance is not null then
    select * into v_vehicle from public.apparatus where id = v_ambulance and tenant_id = v_incident.tenant_id;
  end if;
  if v_vehicle.id is not null and v_cleaning = 'true' then
    update public.apparatus set status = 'Out of Service',
      status_note = format('Off road for cleaning (%s)', v_report.report_number),
      status_changed_at = v_now, status_changed_by_name = v_medic
     where id = v_vehicle.id;
    update public.personnel set assigned_apparatus_id = null, is_on_duty = false
     where assigned_apparatus_id = v_vehicle.id and tenant_id = v_incident.tenant_id;
    perform public.notify_command(v_incident.tenant_id, 'Medical',
      'Ambulance off road for cleaning: ' || v_vehicle.unit_number,
      format('After %s. Reported by %s.', v_incident.incident_number, v_medic), 'High', '/shift/today');
  end if;
  if v_vehicle.id is not null then
    v_short := concat_ws(', ',
      case when not v_report.inv_oxygen then 'oxygen' end,
      case when not v_report.inv_bvm then 'BVM / masks' end,
      case when not v_report.inv_suction then 'suction unit' end,
      case when not v_report.inv_iv then 'IV fluids & sets' end,
      case when not v_report.inv_bandages then 'bandages' end,
      case when not v_report.inv_aed then 'AED pads' end,
      case when not v_report.inv_drugs then 'drug box' end,
      case when not v_report.inv_sharps then 'sharps container' end,
      case when not v_report.inv_ppe then 'gloves & PPE' end);
    if nullif(v_short, '') is not null then
      perform public.notify_command(v_incident.tenant_id, 'Medical',
        'Ambulance stock short: ' || v_vehicle.unit_number,
        format('After %s: %s. Reported by %s.', v_incident.incident_number, v_short, v_medic), 'Medium', '/medical');
    end if;
  end if;

  return v_report;
end $$;

create or replace function public.file_post_mortem(p_incident_id uuid, p_fields jsonb)
returns public.post_mortem_reports
language plpgsql security definer set search_path to 'public' as $$
declare
  f          jsonb := coalesce(p_fields, '{}'::jsonb);
  v_incident public.incidents;
  v_person   public.personnel;
  v_report   public.post_mortem_reports;
  v_name     text;
  v_officer  text := nullif(trim(coalesce(f ->> 'reporting_officer', '')), '');
  v_cause    text := nullif(trim(coalesce(f ->> 'root_cause', '')), '');
  v_lessons  text := nullif(trim(coalesce(f ->> 'lessons_learned', '')), '');
  v_start    timestamptz;
  v_end      timestamptz;
  v_command  boolean := public.role_in('Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin');
  v_count    text;
  v_timeline jsonb;
  v_now      timestamptz := now();
begin
  perform public.require_role('Disaster', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin');
  if public.current_silo() is distinct from 'EthekwiniDisaster' then
    raise exception 'Only Disaster Management files a post-mortem' using errcode = '42501';
  end if;

  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;
  -- 0073: the call as EthekwiniDisaster sees it — its own lead, status and report.
  v_incident := public.incident_for_department(v_incident, 'EthekwiniDisaster');
  if not (v_incident.silo = 'EthekwiniDisaster' or 'EthekwiniDisaster' = any(coalesce(v_incident.dispatched_silos, '{}'))) then
    raise exception '% is not a Disaster Management incident', v_incident.incident_number using errcode = 'P0001';
  end if;

  -- Replay of a report already filed (offline retry): return it unchanged.
  if v_incident.report_filed_at is not null then
    select * into v_report from public.post_mortem_reports
    where incident_id = p_incident_id and report_number is not null order by report_filed_at limit 1;
    if found then return v_report; end if;
    raise exception '% is already closed', v_incident.incident_number using errcode = 'P0001';
  end if;
  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text) using errcode = 'P0001';
  end if;

  -- The officer leading the incident files from the scene; command may close
  -- out a deployed incident from the console, as V4's desk did.
  if v_command then
    if v_incident.status not in ('Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting', 'Active') then
      raise exception 'Deploy resources to % before filing its post-mortem', v_incident.incident_number using errcode = 'P0001';
    end if;
  else
    if v_incident.accepted_by is distinct from auth.uid() then
      raise exception 'Only the officer leading % files its post-mortem', v_incident.incident_number using errcode = 'P0001';
    end if;
    if v_incident.status not in ('Arrived', 'On Scene', 'Transporting') then
      raise exception 'Mark yourself on scene before filing the post-mortem for %', v_incident.incident_number using errcode = 'P0001';
    end if;
  end if;

  -- What the report must say (V4's After-Action Report).
  if coalesce(f ->> 'start_time', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T]([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Start Time must be a date and time (YYYY-MM-DD HH:MM).' using errcode = 'P0001';
  end if;
  if coalesce(f ->> 'end_time', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T]([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Resolved Time must be a date and time (YYYY-MM-DD HH:MM).' using errcode = 'P0001';
  end if;
  v_start := (replace(f ->> 'start_time', 'T', ' ') || ':00')::timestamp at time zone 'Africa/Johannesburg';
  v_end   := (replace(f ->> 'end_time', 'T', ' ') || ':00')::timestamp at time zone 'Africa/Johannesburg';
  if v_end < v_start then raise exception 'Resolved Time cannot be before Start Time.' using errcode = 'P0001'; end if;
  if v_end > v_now + interval '5 minutes' then raise exception 'Resolved Time cannot be in the future.' using errcode = 'P0001'; end if;
  foreach v_count in array array['injuries', 'fatalities', 'displaced_people'] loop
    if coalesce(f ->> v_count, '0') !~ '^[0-9]{1,6}$' then
      raise exception 'Counts must be whole numbers.' using errcode = 'P0001';
    end if;
  end loop;
  if v_cause is null then raise exception 'Root Cause Analysis is required.' using errcode = 'P0001'; end if;
  if v_lessons is null then raise exception 'Lessons Learned / Recommendations is required.' using errcode = 'P0001'; end if;
  if v_officer is null then raise exception 'Reporting Officer Name is required.' using errcode = 'P0001'; end if;
  if length(v_cause) > 4000 or length(v_lessons) > 4000 then
    raise exception 'Keep each answer under 4000 characters.' using errcode = 'P0001';
  end if;

  select * into v_person from public.personnel
  where user_id = auth.uid() and tenant_id = public.current_tenant();
  select full_name into v_name from public.profiles where id = auth.uid();

  -- V4's timeline snapshot: the incident's own history and the deployment's
  -- periodic updates, oldest first.
  select coalesce(jsonb_agg(e order by e ->> 'timestamp'), '[]'::jsonb) into v_timeline from (
    select jsonb_build_object('timestamp', to_char(u.timestamp at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI'),
                              'text', u.message) as e
      from public.incident_updates u where u.incident_id = p_incident_id
    union all
    -- Console updates carry an ISO instant; V4's carried SA wall-clock text.
    select jsonb_build_object('timestamp',
             case when coalesce(x ->> 'timestamp', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                  then to_char((x ->> 'timestamp')::timestamptz at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI')
                  else coalesce(x ->> 'timestamp', '') end,
             'text', coalesce(x ->> 'text', ''))
      from public.disaster_logs d, jsonb_array_elements(coalesce(d.updates, '[]'::jsonb)) x
     where d.incident_id = p_incident_id
  ) s;

  insert into public.post_mortem_reports (
    tenant_id, silo, incident_id, incident_number, report_number, filed_by,
    incident_type, location, start_time, end_time, total_duration_hours,
    injuries, fatalities, displaced_people, root_cause, lessons_learned,
    timeline_snapshot, reporting_officer, report_filed_at
  ) values (
    v_incident.tenant_id, 'EthekwiniDisaster', v_incident.id, v_incident.incident_number,
    'PM-' || v_incident.incident_number, auth.uid(),
    coalesce(nullif(trim(coalesce(v_incident.disaster_type, '')), ''), v_incident.incident_type),
    v_incident.location_address, v_start, v_end,
    round((extract(epoch from (v_end - v_start)) / 3600)::numeric, 2),
    (f ->> 'injuries')::int, (f ->> 'fatalities')::int, (f ->> 'displaced_people')::int,
    v_cause, v_lessons, v_timeline, v_officer, v_now
  ) returning * into v_report;

  -- 0073: the report finishes EthekwiniDisaster's part; the call is resolved once every department has finished.
  v_incident := public.finish_department_by_report(p_incident_id, 'EthekwiniDisaster', v_now);

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[REPORT] Post-mortem %s filed by %s (%s injured, %s fatalities, %s displaced)',
      v_report.report_number, v_officer, v_report.injuries, v_report.fatalities, v_report.displaced_people),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'REPORT_FILED', 'incidents',
    v_incident.id::text, format('Post-mortem %s filed for %s', v_report.report_number, v_incident.incident_number));

  perform public.notify_incident_chain(
    v_incident, case when v_incident.status = 'Resolved' then 'resolved' else 'report_filed' end,
    format('%s: post-mortem filed by %s', v_incident.incident_number, v_officer),
    format('%s · %s displaced', v_report.incident_type, v_report.displaced_people)
  );

  return v_report;
end $$;

-- ── 11. Calls already on record ─────────────────────────────────────────────

-- Every call gets its parts. A live call keeps where each department is: the
-- call's lead leads their department, and the first of another department
-- already on it leads that one. A finished call's report belongs to the
-- department that filed it; the others are recorded as not needed.
do $$
declare
  r public.incidents;
begin
  for r in select * from public.incidents loop
    perform public.ensure_incident_departments(r);
  end loop;
end $$;

update public.incident_responders ir
   set role = 'lead', updated_at = now()
  from public.incident_departments d
 where d.incident_id = ir.incident_id and d.silo = ir.silo and d.lead_id = ir.user_id and ir.role <> 'lead';

notify pgrst, 'reload schema';
