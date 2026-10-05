-- ============================================================================
-- 0051 — Armoury and fleet registers, and the end of a shift
-- ============================================================================
--
-- Run after 0050.
--
-- Finishes the police start-of-shift loop (0037) from the other end:
--
--   1. The armoury is managed on the console: firearms are added one at a
--      time or imported from a spreadsheet, sent to maintenance, retired, and
--      received back by the armourer. Custody (booked out to whom) changes
--      only through the app or these functions; nothing is ever deleted.
--   2. The officer returns their firearm at the end of the shift: unloaded,
--      checked, rounds counted back. Rounds that do not come back need an
--      explanation and tell the supervisors.
--   3. Ending a shift needs the firearm back, releases the vehicle, records
--      the mileage and any fault found, and goes off duty. A short break is
--      still just "off duty" and keeps the kit.
--   4. A vehicle that fails its 187(c) inspection is taken off the road at
--      once, released from the officer (who chooses another), and the
--      supervisors are told. Only fleet control puts it back into service.
--   5. Vehicles are added one at a time or imported, and decommissioned
--      rather than deleted, so their inspection history stays intact.
--
-- Safe to re-run.
-- ============================================================================

begin;

-- ── 1. Who runs an armoury, who runs a fleet ────────────────────────────────

-- Mirrors firearms_command_write (0045).
create or replace function public.can_manage_armoury(p_silo public.silo) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.role_in('SystemAdmin', 'SuperAdmin', 'SystemController')
      or (p_silo = public.current_silo()
          and public.role_in('Admin', 'System', 'Supervisor', 'Captain', 'FireChief'));
$$;

-- Fleet control: apparatus_admin_all (0002), plus the station commanders who
-- put a repaired vehicle back on the road.
create or replace function public.can_manage_fleet(p_silo public.silo) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.role_in('SystemAdmin', 'SuperAdmin', 'SystemController')
      or (p_silo = public.current_silo()
          and public.role_in('Admin', 'Supervisor', 'Captain', 'FireChief'));
$$;

-- Tell the people responsible for a department's kit.
create or replace function public.notify_command(
  p_tenant uuid, p_silo public.silo, p_title text, p_body text, p_severity text, p_link text
) returns void language sql security definer set search_path to 'public' as $$
  insert into public.alerts (tenant_id, silo, target_user_id, kind, severity, title, body, link,
                             presentation, requires_ack, created_by_name)
  select p_tenant, p.silo, p.id, 'equipment', p_severity, p_title, p_body, p_link, 'toast', false, 'HikTech armoury and fleet'
    from public.profiles p
   where p.tenant_id = p_tenant and p.deactivated_at is null
     and p.silo = p_silo and p.role in ('Supervisor', 'Captain', 'FireChief', 'Admin');
$$;

revoke all on function public.can_manage_armoury(public.silo) from public, anon;
revoke all on function public.can_manage_fleet(public.silo) from public, anon;
grant execute on function public.can_manage_armoury(public.silo) to authenticated;
grant execute on function public.can_manage_fleet(public.silo) to authenticated;
revoke all on function public.notify_command(uuid, public.silo, text, text, text, text) from public, anon, authenticated;

-- ── 2. The armoury register ─────────────────────────────────────────────────

alter table public.firearms
  add column if not exists station                text,
  add column if not exists status_note            text,
  add column if not exists status_changed_at      timestamptz,
  add column if not exists status_changed_by_name text;

alter table public.firearm_checklists
  add column if not exists received_by      uuid,
  add column if not exists received_by_name text;

create index if not exists firearms_serial_lookup
  on public.firearms (tenant_id, upper(regexp_replace(serial_number, '[^A-Za-z0-9]', '', 'g')));

-- Custody changes only through the app (issue_shift_firearm,
-- return_shift_firearm) or the armourer (receive_firearm). Everything else
-- about a firearm stays editable by command staff, as 0037 allowed.
create or replace function public.guard_firearm_custody() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Firearms stay on the register: retire one instead' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'Issued' or new.issued_to is not null then
      raise exception 'A firearm is booked out by the officer, at the start of their shift' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.status = 'Issued') is distinct from (old.status = 'Issued')
     or new.issued_to is distinct from old.issued_to
     or new.issued_at is distinct from old.issued_at then
    raise exception 'Booking a firearm out or back in is recorded through the app or the armoury page'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_firearm_custody on public.firearms;
create trigger guard_firearm_custody before insert or update or delete on public.firearms
  for each row execute function public.guard_firearm_custody();

-- Put a firearm into service, send it for maintenance, or retire it.
create or replace function public.set_firearm_status(p_firearm uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor   public.profiles;
  v_firearm public.firearms;
begin
  select * into v_actor from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into v_firearm from public.firearms
   where id = p_firearm and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'No such firearm on your register' using errcode = 'P0002'; end if;
  if not public.can_manage_armoury(v_firearm.silo) then
    raise exception 'Your role cannot manage this armoury' using errcode = '42501';
  end if;
  if p_status not in ('Available', 'Maintenance', 'Retired') then
    raise exception 'Choose Available, Maintenance or Retired' using errcode = '22023';
  end if;
  if v_firearm.status = 'Issued' then
    raise exception 'Firearm % is booked out. Receive it back first.', v_firearm.serial_number using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason: it goes on the firearm''s record' using errcode = '22023';
  end if;
  update public.firearms
     set status = p_status, status_note = btrim(p_reason), status_changed_at = now(),
         status_changed_by_name = v_actor.full_name
   where id = v_firearm.id;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_firearm.tenant_id, v_firearm.silo, v_actor.id, v_actor.full_name, 'FirearmStatus', 'firearm', v_firearm.id::text,
          format('%s %s %s: %s → %s. %s', v_firearm.serial_number, v_firearm.make, v_firearm.model,
                 v_firearm.status, p_status, btrim(p_reason)));
  return jsonb_build_object('status', p_status);
end $$;

-- The return itself, shared by the officer and the armourer.
create or replace function public.record_firearm_return(
  p_firearm  public.firearms,
  p_holder   uuid,
  p_rounds   int,
  p_mags     int,
  p_condition text,
  p_checks_ok boolean,
  p_notes    text,
  p_receiver public.profiles
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_issue  public.firearm_checklists;
  v_holder public.personnel;
  v_name   text;
  v_short  int;
  v_safe   boolean;
  v_notes  text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if p_condition not in ('clean', 'requires_cleaning', 'damaged') then
    raise exception 'Select the firearm''s condition' using errcode = '22023';
  end if;
  if p_rounds is null or p_rounds not between 0 and 500 then
    raise exception 'Rounds returned must be between 0 and 500' using errcode = '22023';
  end if;
  if p_mags is null or p_mags not between 0 and 20 then
    raise exception 'Magazines must be between 0 and 20' using errcode = '22023';
  end if;

  select * into v_issue from public.firearm_checklists
   where firearm_id = p_firearm.id and user_id = p_holder and kind = 'Issue'
   order by created_at desc limit 1;
  if v_issue.id is not null and p_rounds > v_issue.rounds_issued then
    raise exception 'More rounds returned (%) than were issued (%)', p_rounds, v_issue.rounds_issued using errcode = '22023';
  end if;
  v_short := greatest(coalesce(v_issue.rounds_issued, 0) - p_rounds, 0);
  if (v_short > 0 or p_condition <> 'clean' or not p_checks_ok) and v_notes is null then
    raise exception 'Explain the missing rounds, the condition or the failed check in the notes' using errcode = '22023';
  end if;

  select * into v_holder from public.personnel where user_id = p_holder and tenant_id = p_firearm.tenant_id limit 1;
  v_name := coalesce(btrim(v_holder.rank || ' ' || v_holder.first_name || ' ' || v_holder.last_name), 'Unknown officer');

  insert into public.firearm_checklists (
    tenant_id, silo, user_id, user_name, kind, serial_number, make_model,
    serial_verified, barrel_clear, action_functional, safety_functional, sights_secure,
    cleaned, magazines, rounds_issued, rounds_returned, defects, firearm_id, chamber_status, condition,
    received_by, received_by_name
  ) values (
    p_firearm.tenant_id, p_firearm.silo, p_holder, v_name, 'Return', p_firearm.serial_number,
    p_firearm.make || ' ' || p_firearm.model,
    p_checks_ok, p_checks_ok, p_checks_ok, p_checks_ok, p_checks_ok,
    p_condition = 'clean', p_mags, coalesce(v_issue.rounds_issued, p_rounds), p_rounds, v_notes,
    p_firearm.id, 'unloaded', p_condition,
    p_receiver.id, p_receiver.full_name
  );

  -- A firearm that comes back damaged or failing a check goes to the armourer.
  v_safe := p_checks_ok and p_condition <> 'damaged';
  update public.firearms
     set status = case when v_safe then 'Available' else 'Maintenance' end,
         status_note = case when v_safe then null else coalesce(v_notes, 'Returned needing attention') end,
         status_changed_at = now(), status_changed_by_name = p_receiver.full_name
   where id = p_firearm.id;

  if v_short > 0 then
    perform public.notify_command(p_firearm.tenant_id, p_firearm.silo,
      format('Rounds unaccounted for: %s', v_name),
      format('%s of %s rounds came back with %s (%s). Note: %s', p_rounds, v_issue.rounds_issued,
             p_firearm.serial_number, p_firearm.make || ' ' || p_firearm.model, v_notes),
      'High', '/police/armoury');
  end if;
  return jsonb_build_object('status', case when v_safe then 'Available' else 'Maintenance' end, 'short', v_short);
end $$;
revoke all on function public.record_firearm_return(public.firearms, uuid, int, int, text, boolean, text, public.profiles)
  from public, anon, authenticated;

-- The officer hands their firearm back at the end of the shift, from the app.
create or replace function public.return_shift_firearm(
  p_firearm_id      uuid,
  p_rounds_returned int,
  p_magazines       int,
  p_unloaded        boolean,
  p_checks_ok       boolean,
  p_condition       text,
  p_notes           text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor   public.profiles;
  v_firearm public.firearms;
begin
  select * into v_actor from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Sign in before returning a firearm' using errcode = '42501'; end if;
  select * into v_firearm from public.firearms
   where id = p_firearm_id and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'Firearm is not on your armoury register' using errcode = 'P0002'; end if;
  if v_firearm.status <> 'Issued' or v_firearm.issued_to is distinct from auth.uid() then
    raise exception 'Firearm % is not booked out to you', v_firearm.serial_number using errcode = '22023';
  end if;
  if not coalesce(p_unloaded, false) then
    raise exception 'Unload the firearm and clear the chamber before returning it' using errcode = '22023';
  end if;
  return public.record_firearm_return(v_firearm, auth.uid(), p_rounds_returned, p_magazines, p_condition,
                                      coalesce(p_checks_ok, false), p_notes, v_actor);
end $$;

-- The armourer receives a firearm back on the officer's behalf (a dead
-- phone, a forgotten return), from the armoury page.
create or replace function public.receive_firearm(
  p_firearm_id      uuid,
  p_rounds_returned int,
  p_magazines       int,
  p_checks_ok       boolean,
  p_condition       text,
  p_notes           text
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor   public.profiles;
  v_firearm public.firearms;
begin
  select * into v_actor from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into v_firearm from public.firearms
   where id = p_firearm_id and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'No such firearm on your register' using errcode = 'P0002'; end if;
  if not public.can_manage_armoury(v_firearm.silo) then
    raise exception 'Your role cannot manage this armoury' using errcode = '42501';
  end if;
  if v_firearm.status <> 'Issued' or v_firearm.issued_to is null then
    raise exception 'Firearm % is not booked out', v_firearm.serial_number using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_notes, ''))) < 5 then
    raise exception 'Say who handed it in and why it was received here' using errcode = '22023';
  end if;
  return public.record_firearm_return(v_firearm, v_firearm.issued_to, p_rounds_returned, p_magazines, p_condition,
                                      coalesce(p_checks_ok, false), p_notes, v_actor);
end $$;

-- ── 3. The fleet register ───────────────────────────────────────────────────

alter table public.apparatus
  add column if not exists status_note            text,
  add column if not exists status_changed_at      timestamptz,
  add column if not exists status_changed_by_name text,
  add column if not exists last_inspection_id     uuid,
  add column if not exists last_inspection_at     timestamptz,
  add column if not exists last_inspection_result text;

alter table public.apparatus drop constraint if exists apparatus_last_inspection_result_check;
alter table public.apparatus add constraint apparatus_last_inspection_result_check
  check (last_inspection_result is null or last_inspection_result in ('pass', 'faults', 'fail'));

-- A vehicle off the road comes back only through fleet control, and no
-- vehicle is ever deleted: its inspections would go with it.
create or replace function public.guard_vehicle_status() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Vehicles stay on the register: decommission one instead' using errcode = '42501';
  end if;
  if old.status in ('Out of Service', 'Maintenance', 'Decommissioned')
     and new.status is distinct from old.status
     and not public.can_manage_fleet(old.silo) then
    raise exception 'Only fleet control puts vehicle % back into service', old.unit_number using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_vehicle_status on public.apparatus;
create trigger guard_vehicle_status before update or delete on public.apparatus
  for each row execute function public.guard_vehicle_status();

-- Every signed 187(c) sheet updates the vehicle. A failed one takes it off
-- the road, releases it from the officer and tells the supervisors.
create or replace function public.apply_vehicle_inspection() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_pass    boolean;
  v_vehicle public.apparatus;
  v_failed  text;
  v_reason  text;
begin
  if new.form_version is distinct from '187c' or not coalesce(new.officer_submitted, false) then
    return null;
  end if;
  v_pass := coalesce(new.lights_functional and new.tires_condition_ok and new.equipment_stocked
                     and new.comms_working and new.brakes_responsive and new.declaration_accepted, false);
  update public.apparatus
     set last_inspection_id = new.id, last_inspection_at = new.checked_at,
         last_inspection_result = case when not v_pass then 'fail' when coalesce(new.items_fault, 0) > 0 then 'faults' else 'pass' end,
         mileage = greatest(mileage, coalesce(new.mileage_km, 0))
   where id = new.apparatus_id
  returning * into v_vehicle;
  if not found or v_pass then return null; end if;

  v_failed := concat_ws(', ',
    case when not new.lights_functional then 'lights' end,
    case when not new.tires_condition_ok then 'tyres' end,
    case when not new.equipment_stocked then 'equipment' end,
    case when not new.comms_working then 'radio and comms' end,
    case when not new.brakes_responsive then 'brakes' end);
  v_reason := format('Failed inspection %s%s%s', coalesce(new.inspection_ref, ''),
                     case when v_failed <> '' then ': ' || v_failed else '' end,
                     coalesce('. ' || nullif(btrim(new.fault_remarks), ''), ''));
  update public.apparatus
     set status = 'Out of Service', status_note = v_reason, status_changed_at = now(),
         status_changed_by_name = new.inspector_name
   where id = v_vehicle.id and status <> 'Decommissioned';
  update public.personnel set assigned_apparatus_id = null
   where assigned_apparatus_id = v_vehicle.id and tenant_id = v_vehicle.tenant_id;
  perform public.notify_command(v_vehicle.tenant_id, v_vehicle.silo,
    format('Vehicle off the road: %s', v_vehicle.unit_number),
    format('%s. Inspected by %s.', v_reason, coalesce(new.inspector_name, 'an officer')),
    'High', '/shift/today');
  return null;
end $$;

drop trigger if exists apply_vehicle_inspection on public.vehicle_checklists;
create trigger apply_vehicle_inspection after insert on public.vehicle_checklists
  for each row execute function public.apply_vehicle_inspection();

-- Return a vehicle to service, send it for maintenance, take it off the road
-- or decommission it. A vehicle on a call or with an officer is left alone.
create or replace function public.set_vehicle_status(p_apparatus uuid, p_status public.apparatus_status, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor   public.profiles;
  v_vehicle public.apparatus;
begin
  select * into v_actor from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into v_vehicle from public.apparatus
   where id = p_apparatus and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'No such vehicle in your fleet' using errcode = 'P0002'; end if;
  if not public.can_manage_fleet(v_vehicle.silo) then
    raise exception 'Your role cannot manage this fleet' using errcode = '42501';
  end if;
  if p_status not in ('Available', 'Maintenance', 'Out of Service', 'Decommissioned') then
    raise exception 'Choose Available, Maintenance, Out of Service or Decommissioned' using errcode = '22023';
  end if;
  if v_vehicle.status in ('In Use', 'En Route', 'On Scene')
     or exists (select 1 from public.personnel where assigned_apparatus_id = v_vehicle.id) then
    raise exception 'Vehicle % is with an officer. Change it when their shift ends.', v_vehicle.unit_number
      using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason: it goes on the vehicle''s record' using errcode = '22023';
  end if;
  update public.apparatus
     set status = p_status, status_note = btrim(p_reason), status_changed_at = now(),
         status_changed_by_name = v_actor.full_name, updated_at = now()
   where id = v_vehicle.id;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_vehicle.tenant_id, v_vehicle.silo, v_actor.id, v_actor.full_name, 'VehicleStatus', 'apparatus', v_vehicle.id::text,
          format('%s %s: %s → %s. %s', v_vehicle.unit_number, v_vehicle.name, v_vehicle.status, p_status, btrim(p_reason)));
  return jsonb_build_object('status', p_status);
end $$;

-- ── 4. The end of a shift ───────────────────────────────────────────────────

create table if not exists public.shift_ends (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default public.current_tenant(),
  silo         public.silo not null,
  user_id      uuid not null,
  user_name    text,
  apparatus_id uuid,
  unit_number  text,
  mileage_km   int,
  vehicle_note text,
  -- app: ended in the app; sign_out: signing out ended it; firearm_out: signed out still holding a firearm.
  source       text not null check (source in ('app', 'sign_out', 'firearm_out')),
  ended_at     timestamptz not null default now()
);
create index if not exists shift_ends_user_idx on public.shift_ends (user_id, ended_at desc);
create index if not exists shift_ends_tenant_idx on public.shift_ends (tenant_id, ended_at desc);
alter table public.shift_ends enable row level security;

drop policy if exists shift_ends_read on public.shift_ends;
create policy shift_ends_read on public.shift_ends for select to authenticated
  using (
    user_id = auth.uid()
    or public.role_in('SystemAdmin', 'SuperAdmin', 'SystemController')
    or (silo = public.current_silo()
        and public.role_in('Admin', 'System', 'Supervisor', 'Captain', 'FireChief'))
  );
drop policy if exists tenant_isolation on public.shift_ends;
create policy tenant_isolation on public.shift_ends as restrictive for all to authenticated
  using (tenant_id = (select public.current_tenant()))
  with check (tenant_id = (select public.current_tenant()));

create or replace function public.guard_shift_end() returns trigger
language plpgsql as $$
begin
  raise exception 'The end of a shift is a permanent record' using errcode = '42501';
end $$;
drop trigger if exists guard_shift_end on public.shift_ends;
create trigger guard_shift_end before update or delete on public.shift_ends
  for each row execute function public.guard_shift_end();

-- End the shift: the firearm must already be back; the vehicle is released,
-- with its mileage and any fault found; the officer goes off duty. An officer
-- leading an open call is held on duty by 0039's guard.
create or replace function public.end_shift(p_mileage_km int default null, p_vehicle_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_person  public.personnel;
  v_vehicle public.apparatus;
  v_serial  text;
  v_note    text := nullif(btrim(coalesce(p_vehicle_note, '')), '');
  v_name    text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into v_person from public.personnel
   where user_id = auth.uid() and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'No personnel record is linked to this account'; end if;
  v_name := btrim(v_person.rank || ' ' || v_person.first_name || ' ' || v_person.last_name);

  select serial_number into v_serial from public.firearms
   where issued_to = auth.uid() and status = 'Issued' and tenant_id = public.current_tenant() limit 1;
  if found then
    raise exception 'Return firearm % before ending your shift', v_serial using errcode = '22023';
  end if;

  if v_person.assigned_apparatus_id is not null then
    select * into v_vehicle from public.apparatus where id = v_person.assigned_apparatus_id for update;
    if p_mileage_km is not null and (p_mileage_km < coalesce(v_vehicle.mileage, 0) or p_mileage_km > 2000000) then
      raise exception 'Mileage cannot be below the vehicle''s last reading (% km)', v_vehicle.mileage using errcode = '22023';
    end if;
  end if;

  -- Off duty first: 0039 refuses here if they still lead an open call.
  update public.personnel
     set is_on_duty = false, latitude = null, longitude = null, assigned_apparatus_id = null
   where id = v_person.id;

  if v_vehicle.id is not null then
    update public.apparatus
       set status = case when status = 'In Use' then (case when v_note is null then 'Available' else 'Maintenance' end)::public.apparatus_status
                         else status end,
           mileage = greatest(mileage, coalesce(p_mileage_km, 0)),
           status_note = case when v_note is not null and status = 'In Use' then 'Reported at end of shift: ' || v_note else status_note end,
           status_changed_at = case when v_note is not null and status = 'In Use' then now() else status_changed_at end,
           status_changed_by_name = case when v_note is not null and status = 'In Use' then v_name else status_changed_by_name end,
           updated_at = now()
     where id = v_vehicle.id;
    if v_note is not null then
      perform public.notify_command(v_vehicle.tenant_id, v_vehicle.silo,
        format('Vehicle fault reported: %s', v_vehicle.unit_number),
        format('%s at end of shift: %s', v_name, v_note), 'Medium', '/shift/today');
    end if;
  end if;

  insert into public.shift_ends (tenant_id, silo, user_id, user_name, apparatus_id, unit_number, mileage_km, vehicle_note, source)
  values (v_person.tenant_id, v_person.silo, auth.uid(), v_name, v_vehicle.id, v_vehicle.unit_number, p_mileage_km, v_note, 'app');

  return jsonb_build_object('status', 'ended', 'vehicle', v_vehicle.unit_number,
    'vehicle_status', case when v_vehicle.id is null then null when v_note is null then 'Available' else 'Maintenance' end);
end $$;

-- Signing out still frees the vehicle (V4's logout), but now only a vehicle
-- that is simply in use, records the end of the shift, and tells command if
-- a firearm is still booked out.
create or replace function public.cleanup_on_logout() returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_person  public.personnel;
  v_vehicle public.apparatus;
  v_serial  text;
  v_name    text;
begin
  select * into v_person from public.personnel
   where user_id = auth.uid() and tenant_id = public.current_tenant();
  if not found then return; end if;
  v_name := btrim(v_person.rank || ' ' || v_person.first_name || ' ' || v_person.last_name);
  select serial_number into v_serial from public.firearms
   where issued_to = auth.uid() and status = 'Issued' and tenant_id = public.current_tenant() limit 1;

  if v_person.assigned_apparatus_id is not null then
    select * into v_vehicle from public.apparatus where id = v_person.assigned_apparatus_id;
    update public.apparatus set status = 'Available' where id = v_person.assigned_apparatus_id and status = 'In Use';
  end if;

  update public.personnel
     set is_on_duty = false, latitude = null, longitude = null, assigned_apparatus_id = null
   where id = v_person.id;

  if v_vehicle.id is not null or v_serial is not null then
    insert into public.shift_ends (tenant_id, silo, user_id, user_name, apparatus_id, unit_number, source)
    values (v_person.tenant_id, v_person.silo, auth.uid(), v_name, v_vehicle.id, v_vehicle.unit_number,
            case when v_serial is null then 'sign_out' else 'firearm_out' end);
  end if;
  if v_serial is not null then
    perform public.notify_command(v_person.tenant_id,
      case when v_person.silo = 'Ethekwini' then 'MetroPolice'::public.silo else v_person.silo end,
      format('Firearm still out: %s', v_name),
      format('%s signed out with firearm %s still booked out. Receive it on the armoury page.', v_name, v_serial),
      'High', '/police/armoury');
  end if;
end $$;

-- ── 5. Importing registers from a spreadsheet ───────────────────────────────

create table if not exists public.asset_imports (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  kind             text not null check (kind in ('firearms', 'vehicles')),
  imported_by      uuid not null,
  imported_by_name text,
  imported_at      timestamptz not null default now(),
  file_name        text not null,
  file_sha256      text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  reason           text not null,
  row_count        int not null,
  added            int not null default 0,
  updated          int not null default 0,
  unchanged        int not null default 0
);
create index if not exists asset_imports_tenant_idx on public.asset_imports (tenant_id, imported_at desc);
alter table public.asset_imports enable row level security;
drop policy if exists asset_imports_read on public.asset_imports;
create policy asset_imports_read on public.asset_imports for select to authenticated
  using (public.role_in('SystemAdmin', 'SuperAdmin', 'SystemController', 'Admin', 'Supervisor', 'Captain', 'FireChief'));
drop policy if exists tenant_isolation on public.asset_imports;
create policy tenant_isolation on public.asset_imports as restrictive for all to authenticated
  using (tenant_id = (select public.current_tenant()))
  with check (tenant_id = (select public.current_tenant()));
drop trigger if exists guard_asset_import on public.asset_imports;
create trigger guard_asset_import before update or delete on public.asset_imports
  for each row execute function public.guard_shift_end();

create or replace function public.check_asset_import(p_rows jsonb, p_file_name text, p_file_sha256 text, p_reason text)
returns public.profiles language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_actor public.profiles;
begin
  select * into v_actor from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Not signed in' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Send between 1 and 2,000 rows' using errcode = '22023';
  end if;
  if coalesce(p_file_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'The file fingerprint is missing' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give a reason of at least 10 characters: it goes on the permanent record' using errcode = '22023';
  end if;
  return v_actor;
end $$;
revoke all on function public.check_asset_import(jsonb, text, text, text) from public, anon, authenticated;

-- Firearms: matched by serial number (letters and digits only, any case).
-- New ones arrive Available; existing ones get their details updated, never
-- their custody. A blank cell never erases.
create or replace function public.import_firearms(p_rows jsonb, p_file_name text, p_file_sha256 text, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor   public.profiles := public.check_asset_import(p_rows, p_file_name, p_file_sha256, p_reason);
  v_row     jsonb;
  v_line    text;
  v_serial  text;
  v_key     text;
  v_make    text;
  v_model   text;
  v_calibre text;
  v_type    text;
  v_station text;
  v_notes   text;
  v_silo    public.silo;
  v_hits    int;
  v_existing public.firearms;
  v_added   int := 0;
  v_updated int := 0;
  v_same    int := 0;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_line    := coalesce(v_row ->> 'line', '?');
    v_serial  := btrim(coalesce(v_row ->> 'serial_number', ''));
    v_key     := upper(regexp_replace(v_serial, '[^A-Za-z0-9]', '', 'g'));
    v_make    := btrim(coalesce(v_row ->> 'make', ''));
    v_model   := btrim(coalesce(v_row ->> 'model', ''));
    v_calibre := nullif(btrim(coalesce(v_row ->> 'calibre', '')), '');
    v_type    := coalesce(nullif(btrim(coalesce(v_row ->> 'firearm_type', '')), ''), 'Sidearm');
    v_station := nullif(btrim(coalesce(v_row ->> 'station', '')), '');
    v_notes   := nullif(btrim(coalesce(v_row ->> 'notes', '')), '');
    if v_key = '' then raise exception 'Row %: no serial number', v_line using errcode = '22023'; end if;
    if v_make = '' or v_model = '' then raise exception 'Row %: make and model are both needed', v_line using errcode = '22023'; end if;
    if v_type not in ('Sidearm', 'Rifle', 'Shotgun', 'Less-lethal', 'Other') then
      raise exception 'Row %: type must be Sidearm, Rifle, Shotgun, Less-lethal or Other', v_line using errcode = '22023';
    end if;
    begin
      v_silo := (v_row ->> 'silo')::public.silo;
    exception when others then
      raise exception 'Row %: unknown department', v_line using errcode = '22023';
    end;
    if v_silo is null then raise exception 'Row %: no department', v_line using errcode = '22023'; end if;
    if not public.can_manage_armoury(v_silo) then
      raise exception 'Row %: your role cannot manage that department''s armoury', v_line using errcode = '42501';
    end if;

    select count(*) into v_hits from public.firearms
     where tenant_id = public.current_tenant()
       and upper(regexp_replace(serial_number, '[^A-Za-z0-9]', '', 'g')) = v_key;
    if v_hits > 1 then
      raise exception 'Row %: serial % matches more than one firearm on the register', v_line, v_serial using errcode = '23505';
    elsif v_hits = 0 then
      insert into public.firearms (tenant_id, silo, serial_number, make, model, calibre, firearm_type, station, notes,
                                   created_by, status_note, status_changed_at, status_changed_by_name)
      values (public.current_tenant(), v_silo, v_serial, v_make, v_model, v_calibre, v_type, v_station, v_notes,
              v_actor.id, 'Imported: ' || btrim(p_reason), now(), v_actor.full_name);
      v_added := v_added + 1;
    else
      select * into v_existing from public.firearms
       where tenant_id = public.current_tenant()
         and upper(regexp_replace(serial_number, '[^A-Za-z0-9]', '', 'g')) = v_key for update;
      if (v_existing.make, v_existing.model, v_existing.calibre, v_existing.firearm_type, v_existing.station, v_existing.notes, v_existing.silo)
         is distinct from
         (v_make, v_model, coalesce(v_calibre, v_existing.calibre), v_type, coalesce(v_station, v_existing.station),
          coalesce(v_notes, v_existing.notes), v_silo) then
        update public.firearms
           set make = v_make, model = v_model, calibre = coalesce(v_calibre, calibre), firearm_type = v_type,
               station = coalesce(v_station, station), notes = coalesce(v_notes, notes), silo = v_silo
         where id = v_existing.id;
        v_updated := v_updated + 1;
      else
        v_same := v_same + 1;
      end if;
    end if;
  end loop;

  insert into public.asset_imports (tenant_id, kind, imported_by, imported_by_name, file_name, file_sha256, reason,
                                    row_count, added, updated, unchanged)
  values (public.current_tenant(), 'firearms', v_actor.id, v_actor.full_name, left(btrim(coalesce(p_file_name, 'firearms')), 200),
          p_file_sha256, btrim(p_reason), jsonb_array_length(p_rows), v_added, v_updated, v_same);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, details)
  values (public.current_tenant(), v_actor.silo, v_actor.id, v_actor.full_name, 'FirearmsImported', 'firearm',
          format('%s: %s added, %s updated, %s unchanged. Reason: %s', p_file_name, v_added, v_updated, v_same, btrim(p_reason)));
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'unchanged', v_same);
end $$;

-- Vehicles: matched by department and unit number. New ones arrive
-- Available; existing ones get their details updated, never their status.
create or replace function public.import_vehicles(p_rows jsonb, p_file_name text, p_file_sha256 text, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor   public.profiles := public.check_asset_import(p_rows, p_file_name, p_file_sha256, p_reason);
  v_row     jsonb;
  v_line    text;
  v_unit    text;
  v_key     text;
  v_name    text;
  v_type    text;
  v_silo    public.silo;
  v_make    text;
  v_model   text;
  v_year    int;
  v_plate   text;
  v_vin     text;
  v_station text;
  v_fuel    text;
  v_disc    date;
  v_hits    int;
  v_existing public.apparatus;
  v_added   int := 0;
  v_updated int := 0;
  v_same    int := 0;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_line    := coalesce(v_row ->> 'line', '?');
    v_unit    := btrim(coalesce(v_row ->> 'unit_number', ''));
    v_key     := upper(regexp_replace(v_unit, '[^A-Za-z0-9]', '', 'g'));
    v_name    := btrim(coalesce(v_row ->> 'name', ''));
    v_type    := btrim(coalesce(v_row ->> 'type', ''));
    v_make    := nullif(btrim(coalesce(v_row ->> 'make', '')), '');
    v_model   := nullif(btrim(coalesce(v_row ->> 'model', '')), '');
    v_plate   := nullif(upper(regexp_replace(coalesce(v_row ->> 'license_plate', ''), '\s+', ' ', 'g')), '');
    v_plate   := nullif(btrim(v_plate), '');
    v_vin     := nullif(upper(btrim(coalesce(v_row ->> 'vin', ''))), '');
    v_station := nullif(btrim(coalesce(v_row ->> 'station_number', '')), '');
    v_fuel    := nullif(btrim(coalesce(v_row ->> 'fuel_type', '')), '');
    if v_key = '' then raise exception 'Row %: no unit number', v_line using errcode = '22023'; end if;
    if v_name = '' or v_type = '' then raise exception 'Row %: name and type are both needed', v_line using errcode = '22023'; end if;
    begin
      v_silo := (v_row ->> 'silo')::public.silo;
      v_year := nullif(v_row ->> 'year', '')::int;
      v_disc := nullif(v_row ->> 'disc_expiry', '')::date;
    exception when others then
      raise exception 'Row %: department, year or licence disc date not understood', v_line using errcode = '22023';
    end;
    if v_silo is null then raise exception 'Row %: no department', v_line using errcode = '22023'; end if;
    if v_year is not null and v_year not between 1950 and extract(year from now())::int + 1 then
      raise exception 'Row %: year % is not a vehicle year', v_line, v_year using errcode = '22023';
    end if;
    if not public.can_manage_fleet(v_silo) then
      raise exception 'Row %: your role cannot manage that department''s fleet', v_line using errcode = '42501';
    end if;

    select count(*) into v_hits from public.apparatus
     where tenant_id = public.current_tenant() and silo = v_silo
       and upper(regexp_replace(unit_number, '[^A-Za-z0-9]', '', 'g')) = v_key;
    if v_hits > 1 then
      raise exception 'Row %: unit % matches more than one vehicle', v_line, v_unit using errcode = '23505';
    elsif v_hits = 0 then
      begin
        insert into public.apparatus (tenant_id, silo, unit_number, name, type, make, model, year, license_plate, vin,
                                      station_number, fuel_type, disc_expiry, status_note, status_changed_at, status_changed_by_name)
        values (public.current_tenant(), v_silo, v_unit, v_name, v_type, v_make, v_model, v_year, v_plate, v_vin,
                v_station, v_fuel, v_disc, 'Imported: ' || btrim(p_reason), now(), v_actor.full_name);
      exception when unique_violation then
        raise exception 'Row %: unit number % is already in use in that department', v_line, v_unit using errcode = '23505';
      end;
      v_added := v_added + 1;
    else
      select * into v_existing from public.apparatus
       where tenant_id = public.current_tenant() and silo = v_silo
         and upper(regexp_replace(unit_number, '[^A-Za-z0-9]', '', 'g')) = v_key for update;
      if (v_existing.name, v_existing.type, v_existing.make, v_existing.model, v_existing.year, v_existing.license_plate,
          v_existing.vin, v_existing.station_number, v_existing.fuel_type, v_existing.disc_expiry)
         is distinct from
         (v_name, v_type, coalesce(v_make, v_existing.make), coalesce(v_model, v_existing.model), coalesce(v_year, v_existing.year),
          coalesce(v_plate, v_existing.license_plate), coalesce(v_vin, v_existing.vin), coalesce(v_station, v_existing.station_number),
          coalesce(v_fuel, v_existing.fuel_type), coalesce(v_disc, v_existing.disc_expiry)) then
        update public.apparatus
           set name = v_name, type = v_type, make = coalesce(v_make, make), model = coalesce(v_model, model),
               year = coalesce(v_year, year), license_plate = coalesce(v_plate, license_plate), vin = coalesce(v_vin, vin),
               station_number = coalesce(v_station, station_number), fuel_type = coalesce(v_fuel, fuel_type),
               disc_expiry = coalesce(v_disc, disc_expiry), updated_at = now()
         where id = v_existing.id;
        v_updated := v_updated + 1;
      else
        v_same := v_same + 1;
      end if;
    end if;
  end loop;

  insert into public.asset_imports (tenant_id, kind, imported_by, imported_by_name, file_name, file_sha256, reason,
                                    row_count, added, updated, unchanged)
  values (public.current_tenant(), 'vehicles', v_actor.id, v_actor.full_name, left(btrim(coalesce(p_file_name, 'vehicles')), 200),
          p_file_sha256, btrim(p_reason), jsonb_array_length(p_rows), v_added, v_updated, v_same);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, details)
  values (public.current_tenant(), v_actor.silo, v_actor.id, v_actor.full_name, 'VehiclesImported', 'apparatus',
          format('%s: %s added, %s updated, %s unchanged. Reason: %s', p_file_name, v_added, v_updated, v_same, btrim(p_reason)));
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'unchanged', v_same);
end $$;

-- ── 6. Who may call what ────────────────────────────────────────────────────

revoke all on function public.set_firearm_status(uuid, text, text) from public, anon;
revoke all on function public.return_shift_firearm(uuid, int, int, boolean, boolean, text, text) from public, anon;
revoke all on function public.receive_firearm(uuid, int, int, boolean, text, text) from public, anon;
revoke all on function public.set_vehicle_status(uuid, public.apparatus_status, text) from public, anon;
revoke all on function public.end_shift(int, text) from public, anon;
revoke all on function public.cleanup_on_logout() from public, anon;
revoke all on function public.import_firearms(jsonb, text, text, text) from public, anon;
revoke all on function public.import_vehicles(jsonb, text, text, text) from public, anon;
grant execute on function public.set_firearm_status(uuid, text, text) to authenticated;
grant execute on function public.return_shift_firearm(uuid, int, int, boolean, boolean, text, text) to authenticated;
grant execute on function public.receive_firearm(uuid, int, int, boolean, text, text) to authenticated;
grant execute on function public.set_vehicle_status(uuid, public.apparatus_status, text) to authenticated;
grant execute on function public.end_shift(int, text) to authenticated;
grant execute on function public.cleanup_on_logout() to authenticated;
grant execute on function public.import_firearms(jsonb, text, text, text) to authenticated;
grant execute on function public.import_vehicles(jsonb, text, text, text) to authenticated;

-- ── 7. Prove it ─────────────────────────────────────────────────────────────

do $$
declare
  v_bad text;
begin
  select string_agg(distinct c.table_name, ', ') into v_bad
    from information_schema.columns c
    join pg_tables pt on pt.schemaname = 'public' and pt.tablename = c.table_name
   where c.table_schema = 'public' and c.column_name = 'tenant_id'
     and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = c.table_name
                        and p.policyname = 'tenant_isolation' and p.permissive = 'RESTRICTIVE');
  if v_bad is not null then
    raise exception 'No tenant wall on: % — nothing was changed', v_bad;
  end if;
  select string_agg(tablename || '.' || policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'public' and tablename in ('shift_ends', 'asset_imports') and permissive = 'PERMISSIVE' and cmd <> 'SELECT';
  if v_bad is not null then
    raise exception 'Write policies found on %: nothing was changed', v_bad;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
