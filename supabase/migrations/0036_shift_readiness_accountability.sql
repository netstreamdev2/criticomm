-- Keep shift declarations as durable, append-only records. Older vehicle
-- records are not trusted as proof of an officer inspection because the old
-- assign_vehicle RPC created an automatic all-true row on selection.
alter table public.vehicle_checklists
  add column if not exists officer_submitted boolean not null default false;

drop policy if exists mental_checks_self_all on public.mental_checks;
drop policy if exists mental_checks_supervisor_read on public.mental_checks;
create policy mental_checks_self_read on public.mental_checks for select
  using (user_id = auth.uid());
create policy mental_checks_self_insert on public.mental_checks for insert
  with check (user_id = auth.uid() and silo = public.current_silo());
create policy mental_checks_command_read on public.mental_checks for select
  using (
    public.role_in('SystemAdmin','SuperAdmin','SystemController')
    or (silo = public.current_silo() and public.role_in(
      'Admin','System','Supervisor','Captain','Chief','FireChief'))
  );

drop policy if exists vehicle_checklists_self_all on public.vehicle_checklists;
drop policy if exists vehicle_checklists_supervisor_read on public.vehicle_checklists;
create policy vehicle_checklists_self_read on public.vehicle_checklists for select
  using (user_id = auth.uid());
create policy vehicle_checklists_self_insert on public.vehicle_checklists for insert
  with check (
    user_id = auth.uid() and silo = public.current_silo()
    and exists (
      select 1 from public.personnel p
      where p.user_id = auth.uid() and p.tenant_id = public.current_tenant()
        and p.assigned_apparatus_id = apparatus_id
    )
  );
create policy vehicle_checklists_command_read on public.vehicle_checklists for select
  using (
    public.role_in('SystemAdmin','SuperAdmin','SystemController')
    or (silo = public.current_silo() and public.role_in(
      'Admin','System','Supervisor','Captain','Chief','FireChief'))
  );

-- A client must not choose the date of a declaration. Retakes create new rows
-- rather than changing earlier answers.
create or replace function public.stamp_mental_check() returns trigger
language plpgsql set search_path = public as $$
begin
  new.timestamp := now();
  return new;
end $$;
drop trigger if exists stamp_mental_check_insert on public.mental_checks;
create trigger stamp_mental_check_insert before insert on public.mental_checks
  for each row execute function public.stamp_mental_check();

create or replace function public.stamp_vehicle_checklist() returns trigger
language plpgsql set search_path = public as $$
begin
  new.checked_at := now();
  return new;
end $$;
drop trigger if exists stamp_vehicle_checklist_insert on public.vehicle_checklists;
create trigger stamp_vehicle_checklist_insert before insert on public.vehicle_checklists
  for each row execute function public.stamp_vehicle_checklist();

-- Midnight in Johannesburg, expressed as a timestamptz, so a shift really
-- resets at the local day boundary even when the database runs in UTC.
create or replace function public.has_completed_shift_start_today() returns boolean
language sql stable security definer set search_path = public as $$
  with boundary as (
    select ((now() at time zone 'Africa/Johannesburg')::date::timestamp
      at time zone 'Africa/Johannesburg') as today_start
  ), latest_mental as (
    select m.* from public.mental_checks m, boundary b
    where m.user_id = auth.uid() and m.tenant_id = public.current_tenant()
      and m.timestamp >= b.today_start
    order by m.timestamp desc, m.id desc limit 1
  ), latest_vehicle as (
    select v.* from public.vehicle_checklists v
    join public.personnel p on p.user_id = v.user_id
      and p.tenant_id = v.tenant_id
      and p.assigned_apparatus_id = v.apparatus_id
    cross join boundary b
    where v.user_id = auth.uid() and v.tenant_id = public.current_tenant()
      and v.checked_at >= b.today_start and v.officer_submitted
    order by v.checked_at desc, v.id desc limit 1
  )
  select exists (
    select 1 from latest_mental m
    where m.memory_recall and m.judgment and m.situational_awareness
      and m.not_under_influence and m.anger_check and m.reflexes
  ) and exists (
    select 1 from latest_vehicle v
    where v.lights_functional and v.tires_condition_ok
      and v.equipment_stocked and v.comms_working and v.brakes_responsive
  );
$$;

-- Vehicle selection reserves a real available unit. It must never certify an
-- inspection or put an officer on duty before the inspection is submitted.
create or replace function public.assign_vehicle(p_apparatus_id uuid)
returns public.apparatus
language plpgsql security definer set search_path = public as $$
declare
  v_person public.personnel;
  v_vehicle public.apparatus;
  v_today_start timestamptz := ((now() at time zone 'Africa/Johannesburg')::date::timestamp
    at time zone 'Africa/Johannesburg');
begin
  perform public.require_role(
    'SystemAdmin','SuperAdmin','Admin','Supervisor','System',
    'Responder','Police','Officer','Metro','Security','Captain','Firefighter','FireChief','Chief',
    'Paramedic','Doctor','Disaster');

  select * into v_person from public.personnel
  where user_id = auth.uid() and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'No personnel record is linked to this account'; end if;
  if not exists (
    select 1 from (
      select * from public.mental_checks
      where user_id = auth.uid() and tenant_id = public.current_tenant()
        and timestamp >= v_today_start
      order by timestamp desc, id desc limit 1
    ) m
    where m.memory_recall and m.judgment and m.situational_awareness
      and m.not_under_influence and m.anger_check and m.reflexes
  ) then
    raise exception 'Complete the readiness assessment before selecting a vehicle';
  end if;
  if v_person.assigned_apparatus_id is not null then
    raise exception 'A vehicle is already assigned to this officer';
  end if;

  update public.apparatus
  set status = 'In Use'
  where id = p_apparatus_id and tenant_id = public.current_tenant() and status = 'Available'
    and (silo = v_person.silo or (v_person.silo = 'Ethekwini' and silo = 'MetroPolice'))
  returning * into v_vehicle;
  if not found then raise exception 'Vehicle is unavailable for this officer'; end if;

  update public.personnel
  set assigned_apparatus_id = p_apparatus_id, is_on_duty = false
  where id = v_person.id and tenant_id = public.current_tenant();
  return v_vehicle;
end $$;

-- Duty status is also changed from the Profile screen, so enforce clearance
-- in the RPC rather than relying on this one mobile form.
create or replace function public.toggle_duty(
  p_on_duty boolean,
  p_latitude double precision default null,
  p_longitude double precision default null
) returns public.personnel
language plpgsql security definer set search_path = public as $$
declare
  v_person public.personnel;
begin
  if auth.uid() is null then raise exception 'Sign in before changing duty status'; end if;
  if p_on_duty and not public.has_completed_shift_start_today() then
    raise exception 'Complete today''s readiness and vehicle inspection first';
  end if;

  update public.personnel
  set is_on_duty = p_on_duty,
      latitude = case when p_on_duty then p_latitude else null end,
      longitude = case when p_on_duty then p_longitude else null end,
      last_login = case when p_on_duty then now() else last_login end
  where user_id = auth.uid() and tenant_id = public.current_tenant()
  returning * into v_person;
  if not found then raise exception 'No personnel record is linked to this account'; end if;
  return v_person;
end $$;

-- The personnel table also has a self-update policy. Guard that write path so
-- setting is_on_duty directly cannot skip the same readiness rule.
create or replace function public.guard_duty_clearance() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.is_on_duty and not old.is_on_duty
    and new.user_id = auth.uid()
    and not public.has_completed_shift_start_today()
  then
    raise exception 'Complete today''s readiness and vehicle inspection first';
  end if;
  return new;
end $$;
drop trigger if exists guard_duty_clearance_update on public.personnel;
create trigger guard_duty_clearance_update before update of is_on_duty on public.personnel
  for each row execute function public.guard_duty_clearance();

notify pgrst, 'reload schema';
