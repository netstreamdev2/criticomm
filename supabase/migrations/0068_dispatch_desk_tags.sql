-- ============================================================================
-- 0068 — A call reaches only the dispatch desks it was sent to
-- ============================================================================
--
-- Run after 0067.
--
-- Every Dispatcher could see every call: a burglary logged for Metro Police
-- landed on the Fire, EMS and Disaster dispatch desks too, whatever the call
-- taker meant. Now the call taker tags the departments the call is for
-- (Police, Fire & Rescue, EMS, Disaster Management — one or several) and only
-- those dispatch desks receive it:
--
--   incidents.tagged_silos   the desks the call was sent to at intake, or
--                            later by a dispatcher bringing another department
--                            in (tag_incident_departments). Never shrinks.
--
--   A department's desk      (Dispatcher, ControlRoom or IncidentLogger in
--                            Metro Police, Fire & Rescue, EMS or Disaster
--                            Management) sees a call only when it is tagged for
--                            them, logged under their department, sent to
--                            their crews, or logged by them. The same wall
--                            covers its timeline, attachments and responders,
--                            and realtime, which reads the same rules.
--   The control room         (the central desk, silo Ethekwini) sees every
--                            call, as before.
--   A department's desk      dispatches its own department's crews only; to
--                            bring in another department it sends the call to
--                            that department's desk.
--
-- log_incoming_call() now requires at least one department. Safe to re-run.
-- ============================================================================

alter table public.incidents
  add column if not exists tagged_silos public.silo[] not null default '{}';
comment on column public.incidents.tagged_silos is
  'Dispatch desks this call was sent to (0068): at intake by the call taker, or later by a dispatcher. Never shrinks.';

-- The caller's department, when they sit on a department's dispatch desk
-- rather than the central control room. Null for everyone else.
create or replace function public.desk_silo()
returns public.silo language sql stable security definer set search_path to 'public' as $$
  select pr.silo from public.profiles pr
   where pr.id = auth.uid() and pr.deactivated_at is null
     and pr.role in ('Dispatcher', 'ControlRoom', 'IncidentLogger')
     and pr.silo <> 'Ethekwini'
$$;
revoke all on function public.desk_silo() from public, anon;
grant execute on function public.desk_silo() to authenticated;

-- ── The wall ────────────────────────────────────────────────────────────────

drop policy if exists incidents_desk_read on public.incidents;
create policy incidents_desk_read on public.incidents as restrictive for select to authenticated using (
  (select public.desk_silo()) is null
  or silo = (select public.desk_silo())
  or (select public.desk_silo()) = any (coalesce(dispatched_silos, '{}'))
  or (select public.desk_silo()) = any (coalesce(tagged_silos, '{}'))
  or created_by = auth.uid()
);

drop policy if exists incidents_desk_write on public.incidents;
create policy incidents_desk_write on public.incidents as restrictive for update to authenticated using (
  (select public.desk_silo()) is null
  or silo = (select public.desk_silo())
  or (select public.desk_silo()) = any (coalesce(dispatched_silos, '{}'))
  or (select public.desk_silo()) = any (coalesce(tagged_silos, '{}'))
  or created_by = auth.uid()
);

-- A call's timeline, attachments and crew go with the call: a desk that
-- cannot see the call cannot read them (the subquery reads incidents under
-- the caller's own rules).
drop policy if exists incident_updates_desk_read on public.incident_updates;
create policy incident_updates_desk_read on public.incident_updates as restrictive for select to authenticated using (
  (select public.desk_silo()) is null
  or exists (select 1 from public.incidents i where i.id = incident_updates.incident_id)
);

drop policy if exists incident_attachments_desk_read on public.incident_attachments;
create policy incident_attachments_desk_read on public.incident_attachments as restrictive for select to authenticated using (
  (select public.desk_silo()) is null
  or exists (select 1 from public.incidents i where i.id = incident_attachments.incident_id)
);

drop policy if exists incident_responders_desk_read on public.incident_responders;
create policy incident_responders_desk_read on public.incident_responders as restrictive for select to authenticated using (
  (select public.desk_silo()) is null
  or exists (select 1 from public.incidents i where i.id = incident_responders.incident_id)
);

-- What any change to a call must keep, whoever makes it and however
-- (the dispatch functions are SECURITY DEFINER, so the policies above do not
-- see them; this trigger does).
create or replace function public.guard_desk_scope() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_desk public.silo := public.desk_silo();
  v_extra public.silo;
begin
  -- The departments a call was sent to stay on its record.
  if not (coalesce(old.tagged_silos, '{}') <@ coalesce(new.tagged_silos, '{}')) then
    raise exception 'The departments % was sent to stay on its record', old.incident_number using errcode = '42501';
  end if;
  if v_desk is null then return new; end if;

  -- A department's desk works the calls sent to it, and only those.
  if not (old.silo = v_desk or v_desk = any (coalesce(old.dispatched_silos, '{}'))
          or v_desk = any (coalesce(old.tagged_silos, '{}')) or old.created_by = auth.uid()) then
    raise exception '% was not sent to your dispatch desk', old.incident_number using errcode = '42501';
  end if;
  if new.silo is distinct from old.silo then
    raise exception 'A department''s dispatch desk does not move a call to another department' using errcode = '42501';
  end if;
  -- It sends its own crews; another department is brought in through its desk.
  select s into v_extra from unnest(coalesce(new.dispatched_silos, '{}')) s
   where s <> v_desk and not s = any (coalesce(old.dispatched_silos, '{}'))
   limit 1;
  if v_extra is not null then
    raise exception 'Your desk dispatches % crews only. Send the call to the % dispatch desk to bring them in.',
      public.department_label(v_desk), public.department_label(v_extra) using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_desk_scope on public.incidents;
create trigger guard_desk_scope before update on public.incidents
  for each row execute function public.guard_desk_scope();

-- ── Intake: the call taker says which desks get the call ────────────────────

drop function if exists public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text
);

create or replace function public.log_incoming_call(
  p_silo silo, p_caller_name text, p_caller_number text, p_call_description text,
  p_incident_type text, p_incident_severity incident_severity, p_location_address text,
  p_location_lat double precision, p_location_lng double precision,
  p_suburb text default null, p_city text default null, p_postal_code text default null,
  p_fire_incident_type text default null, p_medical_type text default null,
  p_disaster_type text default null, p_is_caller_patient boolean default null,
  p_patient_name text default null, p_number_of_victims integer default null,
  p_notes text default null, p_source text default 'Master',
  p_client_ref uuid default null,
  p_incident_category text default null,
  p_region text default null,
  p_tagged_silos silo[] default null
)
returns public.incidents
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_incident public.incidents;
  v_existing public.incidents;
  v_taker    text;
  v_tags     silo[];
  v_number   text := regexp_replace(coalesce(p_caller_number, ''), '[[:space:]().-]', '', 'g');
  v_status   incident_status := case p_silo
                                  when 'EthekwiniDisaster' then 'Pending Analysis'::incident_status
                                  else 'Pending Dispatch'::incident_status
                                end;
begin
  perform public.require_role(
    'SystemAdmin','SuperAdmin','Admin','ControlRoom','IncidentLogger','System'
  );

  if p_client_ref is not null then
    select * into v_existing from public.incidents
     where client_ref = p_client_ref and tenant_id = public.current_tenant();
    if found then return v_existing; end if;
  end if;

  -- The desks this call goes to: the four departments, each once.
  select coalesce(array_agg(distinct s order by s), '{}') into v_tags
    from unnest(coalesce(p_tagged_silos, '{}')) s
   where s <> 'Ethekwini';
  if cardinality(v_tags) = 0 then
    raise exception 'Choose the department this call is for: Police, Fire & Rescue, EMS or Disaster Management'
      using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_caller_name, '')), '') is null then
    raise exception 'Enter the caller name' using errcode = '22023';
  end if;
  if v_number !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter the caller number with its country code, e.g. +27 82 123 4567'
      using errcode = '22023';
  end if;
  if p_is_caller_patient is null then
    raise exception 'Say whether the caller is the patient' using errcode = '22023';
  end if;
  if p_location_lat is null or p_location_lng is null
     or (p_location_lat = 0 and p_location_lng = 0) then
    raise exception 'Place the incident on the map before logging the call';
  end if;

  -- Who took the call is a fact the server knows; never take it from a form.
  select full_name into v_taker from public.profiles where id = auth.uid();

  insert into public.incidents (
    silo, source, incident_number, client_ref,
    caller_name, caller_number, call_description, notes,
    incident_type, incident_category, incident_severity,
    fire_incident_type, medical_type, disaster_type,
    location_address, suburb, city, postal_code, region, location_lat, location_lng,
    is_caller_patient, patient_name, number_of_victims,
    status, call_timestamp, incident_created_at,
    call_taken_by, created_by, tagged_silos
  ) values (
    p_silo, p_source, public.next_incident_number(p_silo), p_client_ref,
    trim(p_caller_name), v_number, p_call_description, p_notes,
    p_incident_type, nullif(trim(coalesce(p_incident_category, '')), ''), p_incident_severity,
    p_fire_incident_type, p_medical_type, p_disaster_type,
    p_location_address, p_suburb, p_city, p_postal_code,
    nullif(trim(coalesce(p_region, '')), ''), p_location_lat, p_location_lng,
    p_is_caller_patient, p_patient_name, p_number_of_victims,
    v_status, now(), now(),
    v_taker, auth.uid(), v_tags
  )
  returning * into v_incident;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (p_silo, v_incident.id,
    format('Call logged by %s and sent to the %s dispatch desk%s.', coalesce(v_taker, 'the call taker'),
      (select string_agg(public.department_label(s), ', ' order by s) from unnest(v_tags) s),
      case when cardinality(v_tags) > 1 then 's' else '' end),
    auth.uid(), v_taker);

  insert into public.audit_logs (
    silo, user_id, user_name, department, action_type, entity_type, entity_id, details
  ) values (
    p_silo, auth.uid(), v_taker,
    p_silo::text, 'CREATE_INCIDENT', 'incidents', v_incident.id::text,
    format('Logged %s call from %s at %s, for %s', p_incident_type, trim(p_caller_name), p_location_address,
      (select string_agg(public.department_label(s), ', ' order by s) from unnest(v_tags) s))
  );

  return v_incident;
end $$;

revoke execute on function public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text, silo[]
) from public, anon;
grant execute on function public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text, silo[]
) to authenticated, service_role;

-- ── Bringing another department in ──────────────────────────────────────────
-- A dispatcher who finds the call needs another department sends it to that
-- department's desk: it is tagged, its dispatchers are told, and the timeline
-- says who did it.

create or replace function public.tag_incident_departments(p_incident uuid, p_silos silo[], p_note text default null)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_desk     public.silo := public.desk_silo();
  v_name     text;
  v_new      silo[];
begin
  perform public.require_role(
    'SystemAdmin','SuperAdmin','Admin','Supervisor','Dispatcher','ControlRoom','IncidentLogger','System','SystemController'
  );
  select * into v_incident from public.incidents
   where id = p_incident and tenant_id = public.current_tenant() for update;
  if not found or (v_desk is not null and not (
       v_incident.silo = v_desk or v_desk = any (coalesce(v_incident.dispatched_silos, '{}'))
       or v_desk = any (coalesce(v_incident.tagged_silos, '{}')) or v_incident.created_by = auth.uid())) then
    raise exception 'No such call on your desk' using errcode = 'P0002';
  end if;
  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is closed', v_incident.incident_number using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct s order by s), '{}') into v_new
    from unnest(coalesce(p_silos, '{}')) s
   where s <> 'Ethekwini' and not s = any (coalesce(v_incident.tagged_silos, '{}'));
  if cardinality(v_new) = 0 then return v_incident; end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  update public.incidents
     set tagged_silos = coalesce(tagged_silos, '{}') || v_new, updated_at = now()
   where id = v_incident.id
  returning * into v_incident;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('Sent to the %s dispatch desk by %s%s', (select string_agg(public.department_label(s), ', ' order by s) from unnest(v_new) s),
      coalesce(v_name, 'a dispatcher'),
      case when nullif(btrim(coalesce(p_note, '')), '') is not null then ': ' || btrim(p_note) else '.' end),
    auth.uid(), v_name);

  -- Its dispatchers are told; the call was not on their screens until now.
  insert into public.alerts (
    tenant_id, silo, target_user_id, kind, severity, title, body, incident_id,
    link, presentation, requires_ack, created_by, created_by_name
  )
  select v_incident.tenant_id, pr.silo, pr.id, 'incident_new', v_incident.incident_severity::text,
         format('%s sent to your desk', v_incident.incident_number),
         format('%s · %s', v_incident.incident_type, v_incident.location_address),
         v_incident.id, '/dispatch/assign/' || v_incident.id::text,
         case when v_incident.incident_severity in ('High', 'Critical') then 'modal' else 'toast' end,
         v_incident.incident_severity in ('High', 'Critical'), auth.uid(), v_name
    from public.profiles pr
   where pr.tenant_id = v_incident.tenant_id and pr.deactivated_at is null
     and pr.role in ('Dispatcher', 'ControlRoom') and pr.silo = any (v_new) and pr.id <> auth.uid();

  insert into public.audit_logs (silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.silo, auth.uid(), v_name, v_incident.silo::text, 'TAG_INCIDENT', 'incidents', v_incident.id::text,
    format('%s sent to %s', v_incident.incident_number,
      (select string_agg(public.department_label(s), ', ' order by s) from unnest(v_new) s)));
  return v_incident;
end $$;

revoke all on function public.tag_incident_departments(uuid, silo[], text) from public, anon;
grant execute on function public.tag_incident_departments(uuid, silo[], text) to authenticated;

notify pgrst, 'reload schema';
