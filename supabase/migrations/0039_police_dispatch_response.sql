-- ============================================================================
-- 0039 — Police dispatch → response → report, end to end
-- ============================================================================
--
-- Operations Manual ch. 6 (life of a call), 7 (status model), 22.3 (assign a
-- unit), 23 (working an incident), 14 (Metro Police officer).
--
--   Dispatcher assigns a MANNED unit      dispatch_unit()
--     → the officer(s) in it get a personal, blocking alert (+ push)
--   Officer accepts: Mark En Route         update_responder_status()
--     → accepted_by is stamped; the dispatcher and the routed department's
--       command (Supervisor, Captain, Admin, SystemController) are told who
--   Arrived → On Scene                     update_responder_status()
--   Officer files the case report          file_incident_report()
--     → the call is Resolved; command is told; the officer is released
--   Case manager / supervisor closes       close_case()        (unchanged)
--
-- Rules the database enforces (so no client build can skip them):
--   • a unit with an open call cannot be dispatched again;
--   • only an on-duty officer's unit can be dispatched;
--   • an officer works one call at a time — they cannot accept another until
--     the current one is resolved by filing its report;
--   • a police call cannot be resolved without a filed report;
--   • at most 10 photos per case file;
--   • the case record is permanent: timeline entries, evidence and filed
--     reports can be added to but never edited or deleted, and incidents
--     cannot be deleted. Like a bank statement — corrections are new entries.
--
-- Also fixes: officers could not read the timeline/evidence of a call owned by
-- another department but routed to theirs (silo-only read policies), and the
-- Police / Metro / Security roles were missing from update_responder_status.
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. Columns ──────────────────────────────────────────────────────────────

alter table public.incidents
  add column if not exists accepted_by     uuid references auth.users(id) on delete set null,
  add column if not exists accepted_at     timestamptz,
  add column if not exists dispatched_by_id uuid references auth.users(id) on delete set null,
  add column if not exists resolved_at     timestamptz,
  add column if not exists resolved_by     uuid references auth.users(id) on delete set null,
  add column if not exists report_filed_at timestamptz;

create index if not exists incidents_accepted_by_open_idx
  on public.incidents (accepted_by) where status not in ('Resolved', 'Closed');
create index if not exists incidents_unit_open_idx
  on public.incidents (unit_id) where status not in ('Resolved', 'Closed');

alter table public.metro_reports
  add column if not exists report_type text,
  add column if not exists details     jsonb not null default '{}'::jsonb,
  add column if not exists filed_by    uuid references auth.users(id) on delete set null,
  add column if not exists filed_at    timestamptz;

create unique index if not exists metro_reports_one_per_incident
  on public.metro_reports (incident_id) where incident_id is not null and filed_at is not null;

-- ── 2. Helpers ──────────────────────────────────────────────────────────────

create or replace function public.try_uuid(p text) returns uuid
language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

-- The vehicle the signed-in officer holds this shift.
create or replace function public.my_apparatus_id() returns uuid
language sql stable security definer set search_path = public as $$
  select assigned_apparatus_id from public.personnel
  where user_id = auth.uid() and tenant_id = public.current_tenant()
  limit 1;
$$;

-- May the caller work this incident? Its own department, a department it was
-- routed to, the global desks, or the officer whose unit it is assigned to.
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
        or (i.unit_id is not null and i.unit_id = public.my_apparatus_id())
      )
  );
$$;

revoke execute on function public.my_apparatus_id() from public, anon;
revoke execute on function public.can_work_incident(uuid) from public, anon;
grant  execute on function public.my_apparatus_id() to authenticated;
grant  execute on function public.can_work_incident(uuid) to authenticated;
grant  execute on function public.try_uuid(text) to authenticated;

-- ── 3. Read/write access for the officer working the call ───────────────────

-- You can always see the call your unit was sent to, whichever department owns it.
drop policy if exists incidents_assigned_read on public.incidents;
create policy incidents_assigned_read on public.incidents for select to authenticated
  using (accepted_by = auth.uid() or (unit_id is not null and unit_id = public.my_apparatus_id()));

drop policy if exists incident_updates_worked_read on public.incident_updates;
create policy incident_updates_worked_read on public.incident_updates for select to authenticated
  using (public.can_work_incident(incident_id));
drop policy if exists incident_updates_worked_insert on public.incident_updates;
create policy incident_updates_worked_insert on public.incident_updates for insert to authenticated
  with check (public.can_work_incident(incident_id) and not public.role_in('Viewer'));

drop policy if exists incident_attachments_worked_read on public.incident_attachments;
create policy incident_attachments_worked_read on public.incident_attachments for select to authenticated
  using (public.can_work_incident(incident_id));
drop policy if exists incident_attachments_worked_insert on public.incident_attachments;
create policy incident_attachments_worked_insert on public.incident_attachments for insert to authenticated
  with check (public.can_work_incident(incident_id) and not public.role_in('Viewer'));

-- Evidence files: path is <silo>/<incident_id>/<kind>/<file>.
drop policy if exists incident_media_worked_read on storage.objects;
create policy incident_media_worked_read on storage.objects for select to authenticated
  using (
    bucket_id = 'incident-media'
    and public.can_work_incident(public.try_uuid((storage.foldername(name))[2]))
  );
drop policy if exists incident_media_worked_insert on storage.objects;
create policy incident_media_worked_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'incident-media'
    and auth.uid() is not null
    and public.can_work_incident(public.try_uuid((storage.foldername(name))[2]))
  );

-- Reports: readable by anyone who can work the incident, plus the existing
-- silo/global read. Written once, through file_incident_report() or the
-- console's report form — never updated or deleted.
drop policy if exists metro_reports_worked_read on public.metro_reports;
create policy metro_reports_worked_read on public.metro_reports for select to authenticated
  using (incident_id is not null and public.can_work_incident(incident_id));

drop policy if exists metro_reports_write on public.metro_reports;
drop policy if exists metro_reports_insert on public.metro_reports;
create policy metro_reports_insert on public.metro_reports for insert to authenticated
  with check (
    silo = public.current_silo()
    and public.role_in('Police','Officer','Captain','Metro','Security','Supervisor',
                       'SystemAdmin','SuperAdmin','Admin','CaseManager')
  );

-- ── 4. Permanent records ────────────────────────────────────────────────────

-- Deleting evidence was open to supervisors, global roles and the uploader.
drop policy if exists incident_attachments_delete on public.incident_attachments;
drop policy if exists incident_media_delete on storage.objects;

-- Belt and braces: the same rule enforced by trigger, so it also binds the
-- service role and any future policy. The only UPDATE allowed is the one a
-- foreign key performs when a user account is removed (ON DELETE SET NULL on
-- the uploader/author columns) — the record itself never changes.
create or replace function public.forbid_record_mutation() returns trigger
language plpgsql as $$
declare
  v_key  text;
  v_keys text[] := array['uploaded_by', 'created_by', 'filed_by'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Records in % are permanent and cannot be deleted', tg_table_name
      using errcode = '42501';
  end if;

  foreach v_key in array v_keys loop
    if (to_jsonb(new) -> v_key) is distinct from (to_jsonb(old) -> v_key)
       and (to_jsonb(new) -> v_key) <> 'null'::jsonb then
      raise exception 'Records in % are permanent and cannot be edited', tg_table_name
        using errcode = '42501';
    end if;
  end loop;

  if (to_jsonb(new) - v_keys) is distinct from (to_jsonb(old) - v_keys) then
    raise exception 'Records in % are permanent and cannot be edited — add a new entry instead', tg_table_name
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists permanent_incident_updates on public.incident_updates;
create trigger permanent_incident_updates before update or delete on public.incident_updates
  for each row execute function public.forbid_record_mutation();

drop trigger if exists permanent_incident_attachments on public.incident_attachments;
create trigger permanent_incident_attachments before update or delete on public.incident_attachments
  for each row execute function public.forbid_record_mutation();

drop trigger if exists permanent_metro_reports on public.metro_reports;
create trigger permanent_metro_reports before update or delete on public.metro_reports
  for each row execute function public.forbid_record_mutation();

create or replace function public.forbid_incident_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Incidents are permanent records and cannot be deleted — close them instead'
    using errcode = '42501';
end $$;
drop trigger if exists permanent_incidents on public.incidents;
create trigger permanent_incidents before delete on public.incidents
  for each row execute function public.forbid_incident_delete();

-- Evidence files themselves. Supabase may not let the SQL editor attach a
-- trigger to storage.objects; with the delete policy gone, clients still
-- cannot delete, so a refusal here is reported rather than failing the file.
create or replace function public.forbid_evidence_object_delete() returns trigger
language plpgsql as $$
begin
  if old.bucket_id = 'incident-media' then
    raise exception 'Evidence files are permanent and cannot be deleted' using errcode = '42501';
  end if;
  return old;
end $$;
do $$
begin
  drop trigger if exists permanent_incident_media on storage.objects;
  create trigger permanent_incident_media before delete on storage.objects
    for each row execute function public.forbid_evidence_object_delete();
exception when insufficient_privilege then
  raise notice 'storage.objects trigger not installed (insufficient privilege); delete policy removed instead';
end $$;

-- At most 10 photos per case file. Voice notes are unlimited.
create or replace function public.limit_incident_photos() returns trigger
language plpgsql as $$
begin
  if new.kind = 'image' and (
    select count(*) from public.incident_attachments
    where incident_id = new.incident_id and kind = 'image'
  ) >= 10 then
    raise exception 'This case file already holds 10 photos — the maximum' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists limit_incident_photos_insert on public.incident_attachments;
create trigger limit_incident_photos_insert before insert on public.incident_attachments
  for each row execute function public.limit_incident_photos();

-- ── 5. Telling the chain of command ─────────────────────────────────────────

-- One targeted alert each to the dispatcher who sent the call and the command
-- staff of the departments it was routed to, so "who took it" reaches the
-- people who answer for it — without broadcasting to every officer's phone.
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
      and p.id is distinct from auth.uid()
      and (
        p.id = p_incident.dispatched_by_id
        or p.role = 'SystemController'
        or (p.role in ('Supervisor', 'Captain', 'Admin')
            and (p.silo = p_incident.silo or p.silo = any(coalesce(p_incident.dispatched_silos, '{}'))))
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

-- ── 6. Dispatch a manned unit ───────────────────────────────────────────────

create or replace function public.dispatch_unit(
  p_incident_id uuid, p_unit_id uuid, p_unit_type text, p_target_silos silo[]
)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_unit     public.apparatus;
  v_busy     text;
  v_name     text;
  v_crew     text;
  r          record;
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
    raise exception '% has already been accepted by %', v_incident.incident_number,
      coalesce(v_incident.responding_officer, 'a unit');
  end if;

  select * into v_unit from public.apparatus
  where id = p_unit_id and tenant_id = public.current_tenant();
  if not found then raise exception 'Unit not found'; end if;

  -- One call per unit: a crew already working a call cannot be sent to another.
  select incident_number into v_busy from public.incidents
  where unit_id = p_unit_id and id <> p_incident_id
    and status not in ('Resolved', 'Closed')
    and tenant_id = public.current_tenant()
  limit 1;
  if v_busy is not null then
    raise exception 'Unit % is already committed to %', v_unit.unit_number, v_busy;
  end if;

  select string_agg(trim(p.rank || ' ' || p.first_name || ' ' || p.last_name), ', ')
    into v_crew
  from public.personnel p
  where p.assigned_apparatus_id = p_unit_id and p.is_on_duty
    and p.tenant_id = public.current_tenant();
  if v_crew is null then
    raise exception 'No officer is on duty in unit %', v_unit.unit_number;
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();

  update public.incidents
     set status           = 'Dispatched',
         dispatch_time    = coalesce(dispatch_time, now()),
         unit_id          = p_unit_id,
         unit_type        = p_unit_type,
         -- The crew has not acted yet: En Route is theirs to set.
         unit_status      = 'Dispatched',
         dispatched_silos = array(
           select distinct s from unnest(coalesce(dispatched_silos, '{}') || p_target_silos) s
         ),
         dispatched_by    = coalesce(v_name, dispatched_by),
         dispatched_by_id = auth.uid(),
         updated_at       = now()
   where id = p_incident_id
  returning * into v_incident;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[DISPATCH] Unit %s assigned (%s) by %s', v_unit.unit_number, v_crew, coalesce(v_name, 'dispatch')),
    auth.uid(), v_name);

  insert into public.audit_logs (silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.silo, auth.uid(), v_name, v_incident.silo::text, 'DISPATCH', 'incidents', v_incident.id::text,
    format('Dispatched unit %s (%s) to %s', v_unit.unit_number, v_crew, v_incident.incident_number));

  -- A personal, blocking alert for each on-duty officer in the unit.
  for r in
    select p.user_id, p.silo from public.personnel p
    where p.assigned_apparatus_id = p_unit_id and p.is_on_duty and p.user_id is not null
      and p.tenant_id = public.current_tenant()
  loop
    insert into public.alerts (
      silo, target_user_id, kind, severity, title, body, incident_id, link,
      presentation, requires_ack, created_by, created_by_name
    ) values (
      r.silo, r.user_id, 'assignment', v_incident.incident_severity::text,
      format('%s assigned to your unit', v_incident.incident_number),
      format('%s · %s', v_incident.incident_type, v_incident.location_address),
      v_incident.id, format('/incidents/%s', v_incident.id),
      'modal', true, auth.uid(), v_name
    );
  end loop;

  return v_incident;
end $$;

-- ── 7. Status changes by the crew ───────────────────────────────────────────

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
  v_mine     uuid;
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

  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;

  -- Field crews act only on the call their unit was sent to; the desks and
  -- command may still correct a status on anyone's behalf.
  v_field := public.role_in('Responder','Police','Officer','Metro','Security','Firefighter',
                            'Paramedic','Doctor','Disaster');
  if v_field then
    v_mine := public.my_apparatus_id();
    if v_incident.accepted_by is distinct from auth.uid()
       and (v_incident.unit_id is null or v_incident.unit_id is distinct from v_mine) then
      raise exception '% has not been assigned to your unit', v_incident.incident_number;
    end if;

    if v_incident.accepted_by is null and p_status <> 'Dispatched' then
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
         arrived_timestamp   = case
                                 when p_status in ('Arrived','On Scene') and arrived_timestamp is null
                                   then v_at
                                 else arrived_timestamp
                               end,
         -- The officer who accepts is the responding officer, even if a desk
         -- touched the status first.
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

-- ── 8. File the case report — the officer's close-out ───────────────────────

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

  update public.incidents
     set status          = 'Resolved',
         unit_status     = 'Resolved',
         resolved_at     = now(),
         resolved_by     = auth.uid(),
         report_filed_at = now(),
         updated_at      = now()
   where id = p_incident_id
  returning * into v_incident;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[REPORT] %s report filed by %s — call resolved', coalesce(p_report_type, 'Case'), coalesce(v_name, 'officer')),
    auth.uid(), v_name);

  insert into public.audit_logs (silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.silo, auth.uid(), v_name, 'MetroPolice', 'REPORT_FILED', 'incidents', v_incident.id::text,
    format('%s report filed for %s; call resolved', coalesce(p_report_type, 'Case'), v_incident.incident_number));

  perform public.notify_incident_chain(
    v_incident, 'resolved',
    format('%s resolved — report filed by %s', v_incident.incident_number, coalesce(v_name, 'officer')),
    format('%s · %s', v_incident.incident_type, v_incident.location_address)
  );

  return v_report;
end $$;

revoke execute on function public.file_incident_report(uuid, text, jsonb, jsonb) from public, anon;
grant  execute on function public.file_incident_report(uuid, text, jsonb, jsonb) to authenticated;

-- ── 9. No signing off mid-call ──────────────────────────────────────────────
-- An officer working a call stays on duty, in their vehicle, until its report
-- is filed: going off duty or signing out (cleanup_on_logout releases the
-- vehicle) would strand the call with no unit. A person doing it is refused
-- with the reason; a background sweep (no signed-in user) is quietly held
-- instead, so one officer mid-call never fails a whole batch.

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

  select incident_number into v_open from public.incidents
  where accepted_by = new.user_id and status not in ('Resolved', 'Closed')
  limit 1;
  if v_open is null then return new; end if;

  if auth.uid() is not null then
    raise exception '% is still open — file its report before going off duty or signing out', v_open;
  end if;
  new.is_on_duty            := old.is_on_duty;
  new.assigned_apparatus_id := old.assigned_apparatus_id;
  return new;
end $$;

drop trigger if exists hold_duty_during_call on public.personnel;
create trigger hold_duty_during_call
  before update of is_on_duty, assigned_apparatus_id on public.personnel
  for each row execute function public.hold_duty_during_call();

notify pgrst, 'reload schema';
