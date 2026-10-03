-- ============================================================================
-- 0042 — Assign to an officer, respond as backup, many calls per officer
-- ============================================================================
--
-- Run after 0041.
--
-- Dispatch now has two ways to send a call:
--   route_incident()    send to all on duty in the chosen departments
--                       (0040, unchanged in spirit): the first to respond leads
--   assign_incident()   NEW — assign it to one on-duty officer: they lead
--
-- Responding (update_responder_status 'En Route') adds the officer to the
-- call's responders:
--   • the assigned officer, or the first to respond to a send-to-all call,
--     is the LEAD — their status is the call's status, and they file the report;
--   • anyone else it was sent to may respond as BACKUP — their own status
--     (En Route → On Scene) is kept beside the lead's;
--   • every responder joining is announced to the dispatcher and command,
--     and a backup joining is announced to the lead.
--
-- An officer may now hold several calls at once (0039/0040 allowed one).
-- Only the lead is held on duty until the report is filed (0039, unchanged).
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. Who a call is assigned to ────────────────────────────────────────────

alter table public.incidents
  add column if not exists assigned_to      uuid references auth.users(id) on delete set null,
  add column if not exists assigned_to_name text,
  add column if not exists assigned_at      timestamptz,
  add column if not exists assigned_by      uuid references auth.users(id) on delete set null;

create index if not exists incidents_assigned_open_idx
  on public.incidents (assigned_to) where status not in ('Resolved', 'Closed');

-- ── 2. Who is responding ────────────────────────────────────────────────────

create table if not exists public.incident_responders (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  silo        silo not null,
  name        text,
  unit_id     uuid references public.apparatus(id) on delete set null,
  role        text not null check (role in ('lead', 'backup')),
  status      incident_status not null default 'En Route',
  joined_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (incident_id, user_id)
);
create index if not exists incident_responders_user_idx on public.incident_responders (user_id);
create index if not exists incident_responders_incident_idx on public.incident_responders (incident_id);

-- Calls already accepted under 0040 get their lead row.
insert into public.incident_responders (tenant_id, incident_id, user_id, silo, name, unit_id, role, status, joined_at)
select i.tenant_id, i.id, i.accepted_by, coalesce(p.silo, i.silo), i.responding_officer, i.unit_id, 'lead',
       case when i.status in ('En Route', 'Arrived', 'On Scene', 'Transporting') then i.status else 'En Route' end,
       coalesce(i.accepted_at, now())
from public.incidents i
left join public.personnel p on p.user_id = i.accepted_by and p.tenant_id = i.tenant_id
where i.accepted_by is not null
on conflict (incident_id, user_id) do nothing;

-- Is the signed-in officer responding to this call? (Definer: no RLS loop.)
create or replace function public.is_responder(p_incident_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.incident_responders
    where incident_id = p_incident_id and user_id = auth.uid()
  );
$$;
revoke execute on function public.is_responder(uuid) from public, anon;
grant  execute on function public.is_responder(uuid) to authenticated;

-- Working a call now also covers the officer it is assigned to and every
-- responder, including backup from another department.
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
      )
  );
$$;

drop policy if exists incidents_assigned_read on public.incidents;
create policy incidents_assigned_read on public.incidents for select to authenticated
  using (
    accepted_by = auth.uid()
    or assigned_to = auth.uid()
    or (unit_id is not null and unit_id = public.my_apparatus_id())
    or public.is_responder(id)
  );

alter table public.incident_responders enable row level security;

-- Read by anyone who can work the call; written only by update_responder_status().
drop policy if exists incident_responders_read on public.incident_responders;
create policy incident_responders_read on public.incident_responders for select to authenticated
  using (user_id = auth.uid() or public.can_work_incident(incident_id));
drop policy if exists tenant_isolation on public.incident_responders;
create policy tenant_isolation on public.incident_responders as restrictive for all to authenticated
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

do $$
begin
  alter publication supabase_realtime add table public.incident_responders;
exception when duplicate_object then null;
          when undefined_object then null;
end $$;

-- ── 3. Send to all on duty ──────────────────────────────────────────────────

-- As 0040, except: it clears any assignment (the call is open again), and
-- every on-duty officer in the departments is alerted — busy or not, since
-- officers may now hold several calls.
create or replace function public.route_incident(p_incident_id uuid, p_silos silo[], p_notes text default null)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_name     text;
  v_on_duty  int;
  v_to       text;
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
    and p.silo = any(p_silos);

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[DISPATCH] Sent to all on duty in %s (%s officers). First to respond leads; others may join as backup.',
           v_to, v_on_duty),
    auth.uid(), v_name);

  insert into public.audit_logs (silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_incident.silo, auth.uid(), v_name, 'IncidentRouted', 'incident', v_incident.id::text,
    format('Dispatched %s to all on duty in %s (%s officers)', v_incident.incident_number, v_to, v_on_duty));

  return v_incident;
end $$;

revoke execute on function public.route_incident(uuid, silo[], text) from public, anon;
grant  execute on function public.route_incident(uuid, silo[], text) to authenticated;

-- ── 4. Assign to one officer ────────────────────────────────────────────────

-- The officer must be on duty. Re-assigning is allowed until someone leads
-- the call; the officer it is taken from is told.
create or replace function public.assign_incident(p_incident_id uuid, p_user_id uuid, p_notes text default null)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_person   public.personnel;
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
  if v_incident.accepted_by is not null then
    raise exception '% is already led by %', v_incident.incident_number,
      coalesce(v_incident.responding_officer, 'an officer')
      using hint = 'Other officers can still join it as backup from the app.';
  end if;

  select * into v_person from public.personnel
  where user_id = p_user_id and tenant_id = v_incident.tenant_id;
  if not found then raise exception 'That officer has no personnel record'; end if;
  v_officer := trim(coalesce(v_person.rank, '') || ' ' || v_person.first_name || ' ' || v_person.last_name);
  if not v_person.is_on_duty then
    raise exception '% is not on duty', v_officer;
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  v_previous := v_incident.assigned_to;

  update public.incidents
     set status           = 'Dispatched',
         dispatch_time    = coalesce(dispatch_time, now()),
         dispatched_silos = array(
           select distinct s from unnest(coalesce(dispatched_silos, '{}') || array[v_person.silo]) s
         ),
         dispatched_by    = coalesce(v_name, dispatched_by),
         dispatched_by_id = auth.uid(),
         assigned_to      = p_user_id,
         assigned_to_name = v_officer,
         assigned_at      = now(),
         assigned_by      = auth.uid(),
         unit_id          = null,
         unit_status      = 'Dispatched',
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
    format('[ASSIGNED] Assigned to %s by %s', v_officer, coalesce(v_name, 'dispatch')),
    auth.uid(), v_name);

  insert into public.audit_logs (silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_incident.silo, auth.uid(), v_name, 'IncidentAssigned', 'incident', v_incident.id::text,
    format('Assigned %s to %s', v_incident.incident_number, v_officer));

  return v_incident;
end $$;

revoke execute on function public.assign_incident(uuid, uuid, text) from public, anon;
grant  execute on function public.assign_incident(uuid, uuid, text) to authenticated;

-- ── 5. Responding, lead or backup ───────────────────────────────────────────

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

  -- Field crews move only their own place on the call; the desks and command
  -- may still correct the call's status on anyone's behalf.
  v_field := public.role_in('Responder','Police','Officer','Metro','Security','Firefighter',
                            'Paramedic','Doctor','Disaster');
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

  -- A police call is resolved by its case report, never by a bare status.
  if p_status in ('Resolved', 'Closed') and v_incident.report_filed_at is null
     and ('MetroPolice' = any(coalesce(v_incident.dispatched_silos, '{}')) or v_incident.silo = 'MetroPolice')
     and v_field then
    raise exception 'File the incident report to close %', v_incident.incident_number;
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
