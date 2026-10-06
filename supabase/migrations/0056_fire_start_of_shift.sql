-- Fire & Rescue: the V4 five-step flow, with durable, signed equipment checks.
-- Police keeps its 187(c), firearm and bodycam gate. Existing rows are not
-- backfilled as passing Fire inspections.
alter table public.vehicle_checklists
  add column if not exists scba_checked boolean,
  add column if not exists water_tank_full boolean,
  add column if not exists pump_operational boolean,
  add column if not exists hoses_and_nozzles_stocked boolean,
  add column if not exists ladders_secured boolean,
  add column if not exists turnout_gear_complete boolean;

-- Same self-insert, command-read and restrictive tenant policies as 0036/0030.
-- The trigger additionally serialises against assignment/end-of-shift and
-- verifies the real appliance, rather than trusting the submitted identifier.
create or replace function public.validate_fire_inspection() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_person public.personnel;
  v_vehicle public.apparatus;
  v_pass boolean;
begin
  if new.form_version is distinct from 'fire-v1' then return new; end if;
  perform public.require_role('Firefighter','FireChief','Chief','Responder','Supervisor','Admin','SystemAdmin','SuperAdmin');
  if public.current_silo() is distinct from 'MetroFire'::public.silo
     or new.silo is distinct from 'MetroFire'::public.silo
     or new.user_id is distinct from auth.uid()
     or new.tenant_id is distinct from public.current_tenant() then
    raise exception 'Fire inspections must belong to the signed-in firefighter and their department' using errcode = '42501';
  end if;
  select * into v_person from public.personnel
   where user_id = auth.uid() and tenant_id = public.current_tenant() and silo = 'MetroFire' for update;
  if not found or v_person.assigned_apparatus_id is distinct from new.apparatus_id then
    raise exception 'Select an available Fire appliance before inspecting it';
  end if;
  select * into v_vehicle from public.apparatus
   where id = new.apparatus_id and tenant_id = public.current_tenant() and silo = 'MetroFire' for update;
  if not found or v_vehicle.status <> 'In Use' then
    raise exception 'This appliance is no longer assigned and available for inspection';
  end if;
  if not public.shift_readiness_passed_today() then
    raise exception 'Complete today''s readiness assessment first';
  end if;
  if new.fuel_level is null or new.fuel_level not in ('1/4','1/2','3/4','Full') then
    raise exception 'Choose the appliance fuel level';
  end if;
  if new.scba_checked is null or new.water_tank_full is null or new.pump_operational is null
     or new.hoses_and_nozzles_stocked is null or new.ladders_secured is null or new.turnout_gear_complete is null
     or new.lights_functional is null or new.tires_condition_ok is null or new.equipment_stocked is null
     or new.comms_working is null or new.brakes_responsive is null then
    raise exception 'Answer every appliance and equipment check';
  end if;
  if not coalesce(new.declaration_accepted, false)
     or coalesce(new.signature_svg, '') !~ '<path[^>]+d="M[0-9]'
     or length(new.signature_svg) > 200000 then
    raise exception 'Confirm the declaration and sign the Fire inspection';
  end if;
  v_pass := new.lights_functional and new.tires_condition_ok and new.equipment_stocked
    and new.comms_working and new.brakes_responsive and new.scba_checked and new.water_tank_full
    and new.pump_operational and new.hoses_and_nozzles_stocked and new.ladders_secured and new.turnout_gear_complete;
  if not v_pass and coalesce(btrim(new.fault_remarks), '') = '' then
    raise exception 'Describe the failed checks before filing the inspection';
  end if;
  if length(coalesce(new.fault_remarks, '')) > 4000 then raise exception 'Inspection notes are too long'; end if;
  new.officer_submitted := true;
  new.checked_at := now();
  new.inspection_date := (now() at time zone 'Africa/Johannesburg')::date;
  new.inspector_name := trim(concat_ws(' ', v_person.rank, v_person.first_name, v_person.last_name));
  new.inspection_ref := 'FIRE-' || to_char(new.inspection_date, 'YYYYMMDD') || '-' || upper(left(new.id::text, 8));
  -- Reuse the fleet/compliance summary columns; every item is counted server-side.
  new.items := jsonb_build_object(
    'lights_functional', case when new.lights_functional then 'ok' else 'fault' end,
    'tires_condition_ok', case when new.tires_condition_ok then 'ok' else 'fault' end,
    'equipment_stocked', case when new.equipment_stocked then 'ok' else 'fault' end,
    'comms_working', case when new.comms_working then 'ok' else 'fault' end,
    'brakes_responsive', case when new.brakes_responsive then 'ok' else 'fault' end,
    'scba_checked', case when new.scba_checked then 'ok' else 'fault' end,
    'water_tank_full', case when new.water_tank_full then 'ok' else 'fault' end,
    'pump_operational', case when new.pump_operational then 'ok' else 'fault' end,
    'hoses_and_nozzles_stocked', case when new.hoses_and_nozzles_stocked then 'ok' else 'fault' end,
    'ladders_secured', case when new.ladders_secured then 'ok' else 'fault' end,
    'turnout_gear_complete', case when new.turnout_gear_complete then 'ok' else 'fault' end);
  select count(*) filter (where value = '"ok"'), count(*) filter (where value = '"fault"')
    into new.items_ok, new.items_fault from jsonb_each(new.items);
  new.items_nil := 0;
  return new;
end $$;
drop trigger if exists validate_fire_inspection on public.vehicle_checklists;
create trigger validate_fire_inspection before insert on public.vehicle_checklists
  for each row execute function public.validate_fire_inspection();

-- A Fire-specific trigger leaves 0051's Police inspection handling unchanged.
create or replace function public.apply_fire_inspection() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_vehicle public.apparatus;
  v_pass boolean;
  v_failed text;
  v_reason text;
begin
  if new.form_version is distinct from 'fire-v1' then return null; end if;
  perform public.require_role('Firefighter','FireChief','Chief','Responder','Supervisor','Admin','SystemAdmin','SuperAdmin');
  v_pass := new.items_fault = 0 and new.items_ok = 11 and new.declaration_accepted;
  update public.apparatus set last_inspection_id = new.id, last_inspection_at = new.checked_at,
    last_inspection_result = case when v_pass then 'pass' else 'fail' end
   where id = new.apparatus_id and tenant_id = new.tenant_id and silo = 'MetroFire'
   returning * into v_vehicle;
  if not found then raise exception 'Fire appliance not found'; end if;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (new.tenant_id, new.silo, new.user_id, new.inspector_name, 'FireInspectionFiled', 'vehicle_checklists',
    new.id::text, format('%s / %s: %s. %s of 11 checks passed.', new.inspection_ref,
      v_vehicle.unit_number, case when v_pass then 'passed' else 'failed' end, new.items_ok));
  if v_pass then return null; end if;
  v_failed := concat_ws(', ',
    case when not new.lights_functional then 'lights and siren' end,
    case when not new.tires_condition_ok then 'tyres' end,
    case when not new.equipment_stocked then 'emergency equipment' end,
    case when not new.comms_working then 'radio / GPS' end,
    case when not new.brakes_responsive then 'brakes' end,
    case when not new.scba_checked then 'SCBA' end,
    case when not new.water_tank_full then 'water tank' end,
    case when not new.pump_operational then 'pump' end,
    case when not new.hoses_and_nozzles_stocked then 'hoses / nozzles' end,
    case when not new.ladders_secured then 'ladders' end,
    case when not new.turnout_gear_complete then 'turnout gear / PPE' end);
  v_reason := format('Failed Fire inspection %s: %s. %s', new.inspection_ref, v_failed, btrim(new.fault_remarks));
  update public.apparatus set status = 'Out of Service', status_note = v_reason,
    status_changed_at = now(), status_changed_by_name = new.inspector_name
   where id = new.apparatus_id and tenant_id = new.tenant_id;
  update public.personnel set assigned_apparatus_id = null, is_on_duty = false
   where assigned_apparatus_id = new.apparatus_id and tenant_id = new.tenant_id;
  perform public.notify_command(new.tenant_id, new.silo, 'Fire appliance not cleared: ' || v_vehicle.unit_number,
    v_reason || '. Inspected by ' || new.inspector_name, 'High', '/shift/today');
  return null;
end $$;
drop trigger if exists apply_fire_inspection on public.vehicle_checklists;
create trigger apply_fire_inspection after insert on public.vehicle_checklists
  for each row execute function public.apply_fire_inspection();

create or replace function public.shift_vehicle_passed_today() returns boolean
language sql stable security definer set search_path = public as $$
  select case when public.current_silo() = 'MetroFire' then exists (
    select 1 from (
      select v.* from public.vehicle_checklists v
      join public.personnel p on p.user_id = v.user_id and p.tenant_id = v.tenant_id
        and p.assigned_apparatus_id = v.apparatus_id and p.silo = 'MetroFire'
      join public.apparatus a on a.id = v.apparatus_id and a.tenant_id = v.tenant_id
        and a.silo = 'MetroFire' and a.status = 'In Use'
      where v.user_id = auth.uid() and v.tenant_id = public.current_tenant() and v.silo = 'MetroFire'
        and v.checked_at >= public.sa_today_start() and v.officer_submitted
      order by v.checked_at desc, v.id desc limit 1
    ) v
    where v.form_version = 'fire-v1' and v.declaration_accepted
      and v.lights_functional and v.tires_condition_ok and v.equipment_stocked and v.comms_working and v.brakes_responsive
      and v.scba_checked and v.water_tank_full and v.pump_operational
      and v.hoses_and_nozzles_stocked and v.ladders_secured and v.turnout_gear_complete
  ) else exists (
    -- Original 0037 gate, unchanged for Police and the other departments.
    select 1 from (
      select v.* from public.vehicle_checklists v
      join public.personnel p on p.user_id = v.user_id and p.tenant_id = v.tenant_id
        and p.assigned_apparatus_id = v.apparatus_id
      where v.user_id = auth.uid() and v.tenant_id = public.current_tenant()
        and v.checked_at >= public.sa_today_start() and v.officer_submitted and v.form_version = '187c'
      order by v.checked_at desc, v.id desc limit 1
    ) v
    where v.lights_functional and v.tires_condition_ok and v.equipment_stocked
      and v.comms_working and v.brakes_responsive and v.declaration_accepted
  ) end;
$$;

revoke all on function public.validate_fire_inspection() from public, anon, authenticated;
revoke all on function public.apply_fire_inspection() from public, anon, authenticated;
revoke all on function public.shift_vehicle_passed_today() from public, anon;
grant execute on function public.shift_vehicle_passed_today() to authenticated;
notify pgrst, 'reload schema';
