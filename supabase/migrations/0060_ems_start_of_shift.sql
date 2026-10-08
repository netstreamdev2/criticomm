-- EMS (Medical): the V4 start of shift — readiness, ambulance, vehicle
-- checklist, then the Medical-only inventory check and the sanitisation
-- question. Built like Fire's 0056: one signed-off row in vehicle_checklists
-- (form_version 'ems-v1'), validated and stamped on the server.
--
--   * A failed vehicle check, or "Yes — requires cleaning", takes the
--     ambulance off the road, releases the crew from it and tells command.
--     Fleet control returns it to service.
--   * Stock not confirmed keeps the ambulance with the crew but not cleared:
--     they restock and file the check again. Command is told.
--
-- Police (187(c)) and Fire (fire-v1) are unchanged. Existing rows are not
-- backfilled. Safe to re-run.

alter table public.vehicle_checklists
  add column if not exists oxygen_full        boolean,
  add column if not exists aed_battery_ok     boolean,
  add column if not exists suction_functional boolean,
  add column if not exists bvm_masks_ok       boolean,
  add column if not exists jump_bag_stocked   boolean,
  add column if not exists iv_fluids_stocked  boolean,
  add column if not exists drug_box_sealed    boolean,
  add column if not exists gloves_ppe_stocked boolean,
  add column if not exists requires_cleaning  boolean;

create or replace function public.validate_ems_inspection() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_person public.personnel;
  v_vehicle public.apparatus;
  v_vehicle_ok boolean;
  v_stock_ok boolean;
begin
  if new.form_version is distinct from 'ems-v1' then return new; end if;
  perform public.require_role('Paramedic','Doctor','Responder','Captain','Chief','Supervisor','Admin','SystemAdmin','SuperAdmin');
  if public.current_silo() is distinct from 'Medical'::public.silo
     or new.silo is distinct from 'Medical'::public.silo
     or new.user_id is distinct from auth.uid()
     or new.tenant_id is distinct from public.current_tenant() then
    raise exception 'EMS shift checks must belong to the signed-in paramedic and their department' using errcode = '42501';
  end if;
  select * into v_person from public.personnel
   where user_id = auth.uid() and tenant_id = public.current_tenant() and silo = 'Medical' for update;
  if not found or v_person.assigned_apparatus_id is distinct from new.apparatus_id then
    raise exception 'Select an available ambulance before checking it';
  end if;
  select * into v_vehicle from public.apparatus
   where id = new.apparatus_id and tenant_id = public.current_tenant() and silo = 'Medical' for update;
  if not found or v_vehicle.status <> 'In Use' then
    raise exception 'This ambulance is no longer assigned and available for checks';
  end if;
  if not public.shift_readiness_passed_today() then
    raise exception 'Complete today''s readiness assessment first';
  end if;
  if new.fuel_level is null or new.fuel_level not in ('1/4','1/2','3/4','Full') then
    raise exception 'Choose the ambulance fuel level';
  end if;
  if new.lights_functional is null or new.tires_condition_ok is null or new.equipment_stocked is null
     or new.comms_working is null or new.brakes_responsive is null then
    raise exception 'Answer every vehicle check';
  end if;
  if new.oxygen_full is null or new.aed_battery_ok is null or new.suction_functional is null
     or new.bvm_masks_ok is null or new.jump_bag_stocked is null or new.iv_fluids_stocked is null
     or new.drug_box_sealed is null or new.gloves_ppe_stocked is null then
    raise exception 'Record every inventory item';
  end if;
  if new.requires_cleaning is null then
    raise exception 'Say whether the ambulance requires cleaning';
  end if;
  if not coalesce(new.declaration_accepted, false) then
    raise exception 'Confirm the declaration before filing the check';
  end if;
  v_vehicle_ok := new.lights_functional and new.tires_condition_ok and new.equipment_stocked
    and new.comms_working and new.brakes_responsive;
  v_stock_ok := new.oxygen_full and new.aed_battery_ok and new.suction_functional and new.bvm_masks_ok
    and new.jump_bag_stocked and new.iv_fluids_stocked and new.drug_box_sealed and new.gloves_ppe_stocked;
  if not (v_vehicle_ok and v_stock_ok) and coalesce(btrim(new.fault_remarks), '') = '' then
    raise exception 'Describe the failed checks or missing stock before filing';
  end if;
  if length(coalesce(new.fault_remarks, '')) > 4000 then raise exception 'Notes are too long'; end if;
  if new.signature_svg is not null and length(new.signature_svg) > 200000 then
    raise exception 'Signature is too large';
  end if;
  new.officer_submitted := true;
  new.checked_at := now();
  new.inspection_date := (now() at time zone 'Africa/Johannesburg')::date;
  new.inspector_name := trim(concat_ws(' ', v_person.rank, v_person.first_name, v_person.last_name));
  new.inspection_ref := 'EMS-' || to_char(new.inspection_date, 'YYYYMMDD') || '-' || upper(left(new.id::text, 8));
  -- The fleet/compliance summary columns; every item is counted server-side.
  new.items := jsonb_build_object(
    'lights_functional', case when new.lights_functional then 'ok' else 'fault' end,
    'tires_condition_ok', case when new.tires_condition_ok then 'ok' else 'fault' end,
    'equipment_stocked', case when new.equipment_stocked then 'ok' else 'fault' end,
    'comms_working', case when new.comms_working then 'ok' else 'fault' end,
    'brakes_responsive', case when new.brakes_responsive then 'ok' else 'fault' end,
    'oxygen_full', case when new.oxygen_full then 'ok' else 'fault' end,
    'aed_battery_ok', case when new.aed_battery_ok then 'ok' else 'fault' end,
    'suction_functional', case when new.suction_functional then 'ok' else 'fault' end,
    'bvm_masks_ok', case when new.bvm_masks_ok then 'ok' else 'fault' end,
    'jump_bag_stocked', case when new.jump_bag_stocked then 'ok' else 'fault' end,
    'iv_fluids_stocked', case when new.iv_fluids_stocked then 'ok' else 'fault' end,
    'drug_box_sealed', case when new.drug_box_sealed then 'ok' else 'fault' end,
    'gloves_ppe_stocked', case when new.gloves_ppe_stocked then 'ok' else 'fault' end);
  select count(*) filter (where value = '"ok"'), count(*) filter (where value = '"fault"')
    into new.items_ok, new.items_fault from jsonb_each(new.items);
  new.items_nil := 0;
  return new;
end $$;
drop trigger if exists validate_ems_inspection on public.vehicle_checklists;
create trigger validate_ems_inspection before insert on public.vehicle_checklists
  for each row execute function public.validate_ems_inspection();

create or replace function public.apply_ems_inspection() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_vehicle public.apparatus;
  v_vehicle_ok boolean;
  v_stock_ok boolean;
  v_failed text;
  v_short text;
  v_reason text;
begin
  if new.form_version is distinct from 'ems-v1' then return null; end if;
  perform public.require_role('Paramedic','Doctor','Responder','Captain','Chief','Supervisor','Admin','SystemAdmin','SuperAdmin');
  v_vehicle_ok := new.lights_functional and new.tires_condition_ok and new.equipment_stocked
    and new.comms_working and new.brakes_responsive;
  v_stock_ok := new.oxygen_full and new.aed_battery_ok and new.suction_functional and new.bvm_masks_ok
    and new.jump_bag_stocked and new.iv_fluids_stocked and new.drug_box_sealed and new.gloves_ppe_stocked;
  update public.apparatus set last_inspection_id = new.id, last_inspection_at = new.checked_at,
    last_inspection_result = case
      when not v_vehicle_ok or new.requires_cleaning then 'fail'
      when not v_stock_ok then 'faults'
      else 'pass' end
   where id = new.apparatus_id and tenant_id = new.tenant_id and silo = 'Medical'
   returning * into v_vehicle;
  if not found then raise exception 'Ambulance not found'; end if;

  v_failed := concat_ws(', ',
    case when not new.lights_functional then 'lights and siren' end,
    case when not new.tires_condition_ok then 'tyres' end,
    case when not new.equipment_stocked then 'emergency equipment' end,
    case when not new.comms_working then 'radio / GPS' end,
    case when not new.brakes_responsive then 'brakes' end);
  v_short := concat_ws(', ',
    case when not new.oxygen_full then 'oxygen' end,
    case when not new.aed_battery_ok then 'defibrillator / AED' end,
    case when not new.suction_functional then 'suction unit' end,
    case when not new.bvm_masks_ok then 'BVM and masks' end,
    case when not new.jump_bag_stocked then 'jump bag' end,
    case when not new.iv_fluids_stocked then 'IV fluids and giving sets' end,
    case when not new.drug_box_sealed then 'drug box' end,
    case when not new.gloves_ppe_stocked then 'gloves and PPE' end);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (new.tenant_id, new.silo, new.user_id, new.inspector_name, 'EmsShiftCheckFiled', 'vehicle_checklists',
    new.id::text, format('%s / %s: %s. %s of 13 checks passed%s.', new.inspection_ref, v_vehicle.unit_number,
      case when v_vehicle_ok and v_stock_ok and not new.requires_cleaning then 'cleared'
           when not v_vehicle_ok or new.requires_cleaning then 'off the road'
           else 'stock short' end,
      new.items_ok, case when new.requires_cleaning then '; requires cleaning' else '' end));

  if not v_vehicle_ok or new.requires_cleaning then
    v_reason := concat_ws('. ',
      case when not v_vehicle_ok then format('Failed EMS check %s: %s', new.inspection_ref, v_failed) end,
      case when new.requires_cleaning then format('Off road for cleaning (%s)', new.inspection_ref) end,
      nullif(btrim(new.fault_remarks), ''));
    update public.apparatus set status = 'Out of Service', status_note = v_reason,
      status_changed_at = now(), status_changed_by_name = new.inspector_name
     where id = new.apparatus_id and tenant_id = new.tenant_id;
    update public.personnel set assigned_apparatus_id = null, is_on_duty = false
     where assigned_apparatus_id = new.apparatus_id and tenant_id = new.tenant_id;
    perform public.notify_command(new.tenant_id, new.silo,
      case when v_vehicle_ok then 'Ambulance off road for cleaning: ' else 'Ambulance not cleared: ' end || v_vehicle.unit_number,
      v_reason || '. Checked by ' || new.inspector_name, 'High', '/shift/today');
    return null;
  end if;

  if not v_stock_ok then
    perform public.notify_command(new.tenant_id, new.silo, 'Ambulance stock short: ' || v_vehicle.unit_number,
      format('%s: %s. %s Checked by %s; the crew must restock and check again before going on duty.',
        new.inspection_ref, v_short, coalesce(btrim(new.fault_remarks) || '.', ''), new.inspector_name),
      'Medium', '/shift/today');
  end if;
  return null;
end $$;
drop trigger if exists apply_ems_inspection on public.vehicle_checklists;
create trigger apply_ems_inspection after insert on public.vehicle_checklists
  for each row execute function public.apply_ems_inspection();

-- 0056's function with a Medical branch. The Fire and default branches are
-- copied unchanged.
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
  ) when public.current_silo() = 'Medical' then exists (
    -- The latest EMS check today, for the ambulance the paramedic holds.
    select 1 from (
      select v.* from public.vehicle_checklists v
      join public.personnel p on p.user_id = v.user_id and p.tenant_id = v.tenant_id
        and p.assigned_apparatus_id = v.apparatus_id and p.silo = 'Medical'
      join public.apparatus a on a.id = v.apparatus_id and a.tenant_id = v.tenant_id
        and a.silo = 'Medical' and a.status = 'In Use'
      where v.user_id = auth.uid() and v.tenant_id = public.current_tenant() and v.silo = 'Medical'
        and v.checked_at >= public.sa_today_start() and v.officer_submitted
      order by v.checked_at desc, v.id desc limit 1
    ) v
    where v.form_version = 'ems-v1' and v.declaration_accepted and v.requires_cleaning is false
      and v.lights_functional and v.tires_condition_ok and v.equipment_stocked and v.comms_working and v.brakes_responsive
      and v.oxygen_full and v.aed_battery_ok and v.suction_functional and v.bvm_masks_ok
      and v.jump_bag_stocked and v.iv_fluids_stocked and v.drug_box_sealed and v.gloves_ppe_stocked
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

revoke all on function public.validate_ems_inspection() from public, anon, authenticated;
revoke all on function public.apply_ems_inspection() from public, anon, authenticated;
revoke all on function public.shift_vehicle_passed_today() from public, anon;
grant execute on function public.shift_vehicle_passed_today() to authenticated;
notify pgrst, 'reload schema';
