-- ============================================================================
-- 0106 — Fire safety site inspections, as the eThekwini Fire By-law has them
-- ============================================================================
--
-- Run after 0105.
--
-- 0066 kept V4's one-page inspection: extinguishers yes/no, exits yes/no,
-- PASS or FAIL. eThekwini's fire inspectors work to the Fire By-law, 2022:
--
--   * a premises register, so a site is followed from one visit to the next:
--     what it is used for, its risk, and so how often it is inspected (high
--     risk every 6 months, moderate yearly, low every 2 years);
--   * the site checklist, by by-law section: escape routes (s.18, s.19),
--     fire equipment serviced every 12 months (s.25–s.31), the emergency plan
--     and the yearly drill (s.33), dangerous goods (s.37, s.38, s.43, s.48,
--     s.56), and the site itself (s.5, s.16, s.17, s.34);
--   * a fault becomes a compliance notice (s.81): what was found, the section,
--     what to do and by when — immediately, or 7 to 90 days — and the
--     inspector comes back then (the next day for "immediately");
--   * a danger that cannot wait gets an instruction (s.76): close the
--     premises, evacuate them, or stop the activity; fire command is told;
--   * how the notice reached the owner: handed over, refused, or fixed to the
--     premises (s.81(3)).
--
-- Filed from the phone (through the outbox, so a site with no signal is no
-- problem) or the console, through file_fire_inspection() only: it checks
-- every answer against its own copy of the checklist, numbers the visit,
-- keeps the register's dates, and a replay returns the inspection filed.
-- Inspections stay permanent (0066). The checklist below must match
-- packages/db/src/fire-inspection.ts (scripts/test-fire-inspections.mjs).
--
-- Safe to re-run.
-- ============================================================================

begin;

-- ── 1. The checklist, as the server keeps it ───────────────────────────────

create or replace function public.fire_inspection_items()
returns table (key text, label text, section text, na boolean, days int, remedy text)
language sql immutable set search_path to 'public' as $$
  values
    ('escape_routes_clear', 'Escape routes and exits are clear', 's.18(2)', false, 0, 'Clear the escape routes and exits.'),
    ('exit_doors_open', 'Exit doors open easily and are not locked shut', 's.18(3)', false, 0, 'Unlock the exit doors or fit approved locks.'),
    ('exit_signs', 'Exit signs show the way out', 's.18(4)', false, 30, 'Put up exit signs that show the way out (SANS 1186).'),
    ('fire_doors', 'Fire doors close and are not wedged open', 's.19', true, 14, 'Repair the fire doors and keep them closed.'),
    ('extinguishers', 'Fire extinguishers in place, serviced in the last 12 months', 's.25, s.31', true, 30, 'Put fire extinguishers in place and have them serviced.'),
    ('hose_reels', 'Hose reels work, serviced in the last 12 months', 's.25, s.31', true, 30, 'Have the hose reels repaired and serviced.'),
    ('hydrants_site', 'Hydrants on the site can be reached and are serviced', 's.28, s.31', true, 30, 'Clear the hydrants and have them serviced.'),
    ('alarm', 'Fire alarm and detection work, with service records', 's.26, s.31', true, 30, 'Repair the fire alarm and detection, and keep the service records.'),
    ('sprinklers', 'Sprinklers are kept in working order', 's.27, s.31', true, 60, 'Have the sprinkler system serviced.'),
    ('emergency_lights', 'Emergency lights work', 's.31', true, 30, 'Repair the emergency lights and test them monthly.'),
    ('kitchen_extraction', 'Kitchen extraction cleaned in the last 6 months', 's.22, s.31', true, 30, 'Clean and service the kitchen extraction.'),
    ('emergency_plan', 'Emergency plan kept on site', 's.33(1)', true, 30, 'Draw up an emergency preparedness plan and keep it on site.'),
    ('evacuation_drill', 'Evacuation drill in the last 12 months, with a register', 's.33(5)', true, 60, 'Hold an evacuation drill and keep the register.'),
    ('floor_plans', 'Evacuation floor plans on display', 's.33(9)', true, 30, 'Put up evacuation floor plans on every floor.'),
    ('risk_assessment', 'Latest risk assessment on site', 's.24', true, 60, 'Have the risk assessment brought up to date and keep a copy on site.'),
    ('dangerous_goods_certificate', 'Dangerous goods certificate valid', 's.37, s.38', true, 30, 'Apply for or renew the dangerous goods certificate.'),
    ('flammables_stored', 'Flammable liquids and gas stored safely', 's.43, s.56', true, 14, 'Store the flammable liquids and gas safely.'),
    ('lpg', 'Gas (LPG) within the limits and fitted properly', 's.48', true, 14, 'Have the gas installation fixed, or keep less gas.'),
    ('street_number', 'Street number can be seen from the street', 's.16(2)', false, 30, 'Put up a street number that can be seen from the street.'),
    ('fire_access', 'Fire engines can get in (fire lanes clear)', 's.17', true, 7, 'Keep the fire lanes clear for fire engines.'),
    ('population_certificate', 'Population certificate on display and not exceeded', 's.34', true, 30, 'Get a population certificate and keep within it.'),
    ('housekeeping', 'No rubbish or burnable waste piled up', 's.5', false, 7, 'Remove the rubbish and burnable waste.')
$$;
revoke all on function public.fire_inspection_items() from public, anon;
grant execute on function public.fire_inspection_items() to authenticated;

create or replace function public.fire_occupancies() returns text[]
language sql immutable as $$
  select array['Shop or office', 'Factory or workshop', 'Warehouse or store', 'Shopping centre', 'Restaurant or tavern',
               'Hotel or guest house', 'Flats or hostel', 'Hospital or clinic', 'Old age home', 'School or crèche',
               'Stadium, hall or church', 'Fuel station or gas store', 'Other']
$$;

-- ── 2. The premises register ───────────────────────────────────────────────

create table if not exists public.fire_premises (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null default public.current_tenant(),
  silo               public.silo not null default 'MetroFire' check (silo = 'MetroFire'),
  name               text not null check (length(name) between 1 and 200),
  address            text not null check (length(address) between 1 and 300),
  occupancy          text not null,
  risk               text not null default 'Moderate' check (risk in ('High', 'Moderate', 'Low')),
  interval_months    int not null default 12 check (interval_months in (6, 12, 24)),
  contact_person     text check (contact_person is null or length(contact_person) <= 120),
  contact_number     text check (contact_number is null or length(contact_number) <= 30),
  lat                double precision check (lat is null or lat between -90 and 90),
  lng                double precision check (lng is null or lng between -180 and 180),
  last_inspection_id uuid,
  last_inspected_at  timestamptz,
  last_outcome       text,
  next_due           date,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.fire_premises is
  'Fire safety premises register (0106): what a site is used for, its risk and when it is next due; written by file_fire_inspection() and save_fire_premises() only.';

create unique index if not exists fire_premises_one
  on public.fire_premises (tenant_id, lower(btrim(name)), lower(btrim(address)));
create index if not exists fire_premises_due on public.fire_premises (tenant_id, next_due);

alter table public.fire_premises enable row level security;
drop policy if exists tenant_isolation on public.fire_premises;
create policy tenant_isolation on public.fire_premises as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
drop policy if exists fire_premises_read on public.fire_premises;
create policy fire_premises_read on public.fire_premises for select to authenticated
  using (silo = public.current_silo() or public.is_global() or public.role_in('CaseManager', 'SystemController'));
revoke all on public.fire_premises from anon;
revoke insert, update, delete on public.fire_premises from authenticated;
grant select on public.fire_premises to authenticated;

-- ── 3. The inspection, as the by-law has it ────────────────────────────────

alter table public.fire_safety_inspections
  add column if not exists premises_id        uuid references public.fire_premises (id),
  add column if not exists kind               text,
  add column if not exists checklist          jsonb not null default '{}'::jsonb,
  add column if not exists outcome            text,
  add column if not exists notice_items       jsonb not null default '[]'::jsonb,
  add column if not exists comply_by          date,
  add column if not exists reinspect_on       date,
  add column if not exists instruction        text,
  add column if not exists instruction_reason text,
  add column if not exists person_in_charge   text,
  add column if not exists served             text,
  add column if not exists lat                double precision,
  add column if not exists lng                double precision,
  add column if not exists accuracy           real,
  add column if not exists client_ref         uuid,
  add column if not exists previous_id        uuid references public.fire_safety_inspections (id),
  add column if not exists repeat_failure     boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fire_inspections_kind_check') then
    alter table public.fire_safety_inspections add constraint fire_inspections_kind_check
      check (kind is null or kind in ('Routine', 'Complaint', 'Re-inspection', 'Certificate', 'After a fire', 'Event'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fire_inspections_outcome_check') then
    alter table public.fire_safety_inspections add constraint fire_inspections_outcome_check
      check (outcome is null or outcome in ('Compliant', 'Compliance notice', 'Instruction'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fire_inspections_instruction_check') then
    alter table public.fire_safety_inspections add constraint fire_inspections_instruction_check
      check (instruction is null or instruction in ('Close the premises', 'Evacuate the premises', 'Stop the activity'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fire_inspections_served_check') then
    alter table public.fire_safety_inspections add constraint fire_inspections_served_check
      check (served is null or served in ('Handed over', 'Refused to sign', 'Affixed to the premises'));
  end if;
end $$;

create unique index if not exists fire_inspections_client_ref
  on public.fire_safety_inspections (tenant_id, client_ref) where client_ref is not null;
create index if not exists fire_inspections_premises on public.fire_safety_inspections (premises_id, inspected_at desc);

-- Filed through file_fire_inspection() only, as every other record is (the
-- 0066 form wrote the table directly).
drop policy if exists fire_inspections_insert on public.fire_safety_inspections;
revoke insert, update, delete on public.fire_safety_inspections from authenticated;
grant select on public.fire_safety_inspections to authenticated;

-- ── 4. What follows a filed inspection ─────────────────────────────────────

-- Every inspection is audited. Fire command hears of an instruction at once,
-- and of a site that has not put right what its notice said.
create or replace function public.after_fire_inspection() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (new.tenant_id, 'MetroFire', new.inspector_id, new.inspector_name, 'MetroFire', 'FireInspectionFiled',
    'fire_safety_inspections', new.id::text,
    format('%s: %s at %s — %s', new.inspection_ref, new.business_name, new.address, coalesce(new.outcome, new.result)));
  if new.outcome = 'Instruction' then
    perform public.notify_command(new.tenant_id, 'MetroFire',
      format('%s: %s', new.instruction, new.business_name),
      format('%s · %s. %s', new.inspection_ref, new.address, coalesce(new.instruction_reason, '')), 'High', '/fire/inspections/' || new.id);
  elsif new.repeat_failure then
    perform public.notify_command(new.tenant_id, 'MetroFire',
      format('Notice not complied with: %s', new.business_name),
      format('%s · %s. Consider a fine or court (s.79).', new.inspection_ref, new.address), 'Medium', '/fire/inspections/' || new.id);
  elsif new.outcome is null and new.result = 'FAIL' then
    perform public.notify_command(new.tenant_id, 'MetroFire', 'Fire safety inspection failed: ' || new.business_name,
      format('%s · %s. %s', new.inspection_ref, new.address, coalesce(new.notes, '')), 'Medium', '/fire/inspections');
  end if;
  return null;
end $$;

drop trigger if exists after_fire_inspection on public.fire_safety_inspections;
create trigger after_fire_inspection after insert on public.fire_safety_inspections
  for each row execute function public.after_fire_inspection();

-- ── 5. Filing an inspection ────────────────────────────────────────────────

create or replace function public.file_fire_inspection(p_client_ref uuid, p_fields jsonb)
returns public.fire_safety_inspections
language plpgsql security definer set search_path to 'public' as $$
declare
  f          jsonb := coalesce(p_fields, '{}'::jsonb);
  v_check    jsonb := case when jsonb_typeof(p_fields -> 'checklist') = 'object' then p_fields -> 'checklist' else '{}'::jsonb end;
  v_given    jsonb := case when jsonb_typeof(p_fields -> 'notice') = 'array' then p_fields -> 'notice' else '[]'::jsonb end;
  v_kind     text := btrim(coalesce(p_fields ->> 'kind', ''));
  v_instr    text := nullif(btrim(coalesce(p_fields ->> 'instruction', '')), '');
  v_reason   text := nullif(btrim(coalesce(p_fields ->> 'instruction_reason', '')), '');
  v_served   text := nullif(btrim(coalesce(p_fields ->> 'served', '')), '');
  v_person   text := nullif(left(btrim(coalesce(p_fields ->> 'person_in_charge', '')), 120), '');
  v_notes    text := nullif(btrim(coalesce(p_fields ->> 'notes', '')), '');
  v_cperson  text := nullif(left(btrim(coalesce(p_fields ->> 'contact_person', '')), 120), '');
  v_cnumber  text := nullif(btrim(coalesce(p_fields ->> 'contact_number', '')), '');
  v_row      public.fire_safety_inspections;
  v_prev     public.fire_safety_inspections;
  v_prem     public.fire_premises;
  v_pid      uuid;
  v_name     text;
  v_address  text;
  v_occ      text;
  v_risk     text;
  v_item     record;
  v_key      text;
  v_ans      text;
  v_days     int;
  v_max      int := 0;
  v_fail     text[] := '{}';
  v_notice   jsonb := '[]'::jsonb;
  v_outcome  text;
  v_today    date := (now() at time zone 'Africa/Johannesburg')::date;
  v_comply   date;
  v_back     date;
  v_next     date;
  v_lat      double precision;
  v_lng      double precision;
  v_acc      real;
  v_repeat   boolean := false;
begin
  perform public.require_role('Firefighter', 'Captain', 'FireChief', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin');
  if public.current_silo() is distinct from 'MetroFire' then
    raise exception 'Only Fire & Rescue files a fire safety inspection' using errcode = '42501';
  end if;
  if p_client_ref is null then
    raise exception 'The inspection has no reference; open it again and file it' using errcode = '22023';
  end if;

  -- Replay (the outbox, or a double tap): the inspection filed.
  select * into v_row from public.fire_safety_inspections
   where tenant_id = public.current_tenant() and client_ref = p_client_ref;
  if found then return v_row; end if;

  if v_kind not in ('Routine', 'Complaint', 'Re-inspection', 'Certificate', 'After a fire', 'Event') then
    raise exception 'Choose why you are inspecting.' using errcode = 'P0001';
  end if;

  -- Every check answered, from this checklist only; N/A only where it may be.
  for v_key in select jsonb_object_keys(v_check) loop
    if not exists (select 1 from public.fire_inspection_items() i where i.key = v_key) then
      raise exception 'Unknown check: %', v_key using errcode = 'P0001';
    end if;
  end loop;
  for v_item in select * from public.fire_inspection_items() loop
    v_ans := v_check ->> v_item.key;
    if v_ans is null or v_ans not in ('yes', 'no', 'na') or (v_ans = 'na' and not v_item.na) then
      raise exception 'Answer every check: %', v_item.label using errcode = 'P0001';
    end if;
    if v_ans = 'no' then
      select case when (e ->> 'days') ~ '^[0-9]{1,3}$' then (e ->> 'days')::int end into v_days
        from jsonb_array_elements(v_given) e
       where jsonb_typeof(e) = 'object' and e ->> 'key' = v_item.key
       limit 1;
      v_days := coalesce(v_days, v_item.days);
      if v_days not in (0, 7, 14, 30, 60, 90) then
        raise exception 'Choose the time to put it right: immediately, or 7, 14, 30, 60 or 90 days.' using errcode = 'P0001';
      end if;
      v_fail := v_fail || v_item.key;
      v_max := greatest(v_max, v_days);
      v_notice := v_notice || jsonb_build_array(jsonb_build_object(
        'key', v_item.key, 'label', v_item.label, 'section', v_item.section, 'remedy', v_item.remedy, 'days', v_days));
    end if;
  end loop;

  -- The instruction (s.76) and how the notice was served (s.81).
  if v_instr is not null and v_instr not in ('Close the premises', 'Evacuate the premises', 'Stop the activity') then
    raise exception 'Choose the instruction: close the premises, evacuate them, or stop the activity.' using errcode = 'P0001';
  end if;
  if v_instr is not null and length(coalesce(v_reason, '')) < 10 then
    raise exception 'Say why the instruction is given (at least 10 characters).' using errcode = 'P0001';
  end if;
  v_outcome := case when v_instr is not null then 'Instruction'
                    when cardinality(v_fail) > 0 then 'Compliance notice'
                    else 'Compliant' end;
  if v_outcome <> 'Compliant' then
    if v_served is null or v_served not in ('Handed over', 'Refused to sign', 'Affixed to the premises') then
      raise exception 'Say how the notice was served.' using errcode = 'P0001';
    end if;
    if v_served <> 'Affixed to the premises' and v_person is null then
      raise exception 'Enter the name of the person in charge.' using errcode = 'P0001';
    end if;
  else
    v_served := null;
  end if;
  if length(coalesce(v_notes, '')) > 4000 or length(coalesce(v_reason, '')) > 1000 then
    raise exception 'An answer is too long.' using errcode = 'P0001';
  end if;
  if v_cnumber is not null and v_cnumber !~ '^\+?[0-9 ()-]{7,20}$' then
    raise exception 'The contact number is not a phone number.' using errcode = 'P0001';
  end if;

  -- Where the phone was (kept as the inspector's own proof of the visit).
  if jsonb_typeof(f -> 'lat') = 'number' and jsonb_typeof(f -> 'lng') = 'number' then
    v_lat := (f ->> 'lat')::double precision;
    v_lng := (f ->> 'lng')::double precision;
    if v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      v_lat := null; v_lng := null;
    elsif jsonb_typeof(f -> 'accuracy') = 'number' then
      v_acc := least((f ->> 'accuracy')::numeric, 100000)::real;
    end if;
  end if;

  -- The premises: one on the register, or a new one (the same name and
  -- address is the same premises).
  if nullif(btrim(coalesce(f ->> 'premises_id', '')), '') is not null then
    begin
      v_pid := (f ->> 'premises_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'That premises is not on the register.' using errcode = 'P0002';
    end;
    select * into v_prem from public.fire_premises
     where id = v_pid and tenant_id = public.current_tenant() for update;
    if not found then raise exception 'That premises is not on the register.' using errcode = 'P0002'; end if;
  else
    v_name := nullif(left(btrim(coalesce(f ->> 'name', '')), 200), '');
    v_address := nullif(left(btrim(coalesce(f ->> 'address', '')), 300), '');
    v_occ := btrim(coalesce(f ->> 'occupancy', ''));
    v_risk := btrim(coalesce(f ->> 'risk', ''));
    if v_name is null then raise exception 'Enter the name of the business or site.' using errcode = 'P0001'; end if;
    if v_address is null then raise exception 'Enter the address.' using errcode = 'P0001'; end if;
    if not (v_occ = any (public.fire_occupancies())) then
      raise exception 'Choose what the premises are used for.' using errcode = 'P0001';
    end if;
    if v_risk not in ('High', 'Moderate', 'Low') then raise exception 'Choose the risk.' using errcode = 'P0001'; end if;
    select * into v_prem from public.fire_premises
     where tenant_id = public.current_tenant()
       and lower(btrim(name)) = lower(v_name) and lower(btrim(address)) = lower(v_address)
     for update;
    if not found then
      insert into public.fire_premises (tenant_id, name, address, occupancy, risk, interval_months, contact_person, contact_number, lat, lng)
      values (public.current_tenant(), v_name, v_address, v_occ, v_risk,
              case v_risk when 'High' then 6 when 'Low' then 24 else 12 end, v_cperson, v_cnumber, v_lat, v_lng)
      returning * into v_prem;
    end if;
  end if;

  -- Following up a notice: was the same fault still there?
  if v_prem.last_inspection_id is not null then
    select * into v_prev from public.fire_safety_inspections where id = v_prem.last_inspection_id;
    if found and v_prev.outcome in ('Compliance notice', 'Instruction') then
      v_repeat := exists (
        select 1 from jsonb_array_elements(coalesce(v_prev.notice_items, '[]'::jsonb)) e
         where e ->> 'key' = any (v_fail));
    else
      v_prev := null;
    end if;
  end if;

  -- The dates: put right by the longest time given; back then (the next day
  -- for "immediately"); a compliant site is next due after its months.
  if v_outcome = 'Compliant' then
    v_next := (v_today + make_interval(months => v_prem.interval_months))::date;
  else
    v_comply := v_today + v_max;
    v_back := case when v_max = 0 then v_today + 1 else v_comply end;
    v_next := v_back;
  end if;

  -- The notes say what was wrong when the inspector wrote none.
  if v_notes is null and v_outcome <> 'Compliant' then
    v_notes := left(concat_ws(' ',
      case when cardinality(v_fail) > 0 then 'Not compliant: ' || (
        select string_agg(format('%s (%s)', e ->> 'label', e ->> 'section'), '; ')
          from jsonb_array_elements(v_notice) e) || '.' end,
      case when v_instr is not null then format('%s: %s', v_instr, v_reason) end), 4000);
  end if;

  insert into public.fire_safety_inspections (
    tenant_id, business_name, address, contact_person, extinguishers, exits, notes, result,
    premises_id, kind, checklist, outcome, notice_items, comply_by, reinspect_on,
    instruction, instruction_reason, person_in_charge, served, lat, lng, accuracy,
    client_ref, previous_id, repeat_failure
  ) values (
    public.current_tenant(), v_prem.name, v_prem.address,
    coalesce(v_person, v_cperson, v_prem.contact_person, 'Not given'),
    case v_check ->> 'extinguishers' when 'yes' then 'Yes' when 'no' then 'No' else 'N/A' end,
    case when v_check ->> 'escape_routes_clear' = 'no' or v_check ->> 'exit_doors_open' = 'no' then 'No' else 'Yes' end,
    v_notes, case when v_outcome = 'Compliant' then 'PASS' else 'FAIL' end,
    v_prem.id, v_kind, v_check,
    v_outcome, v_notice, v_comply, v_back,
    v_instr, case when v_instr is not null then left(v_reason, 1000) end, v_person, v_served, v_lat, v_lng, v_acc,
    p_client_ref, v_prev.id, v_repeat
  ) returning * into v_row;

  update public.fire_premises
     set last_inspection_id = v_row.id,
         last_inspected_at  = v_row.inspected_at,
         last_outcome       = v_outcome,
         next_due           = v_next,
         contact_person     = coalesce(v_cperson, contact_person),
         contact_number     = coalesce(v_cnumber, contact_number),
         lat                = coalesce(lat, v_lat),
         lng                = coalesce(lng, v_lng),
         updated_at         = now()
   where id = v_prem.id;

  return v_row;
end $$;

revoke all on function public.file_fire_inspection(uuid, jsonb) from public, anon;
grant execute on function public.file_fire_inspection(uuid, jsonb) to authenticated;

-- ── 6. The register, kept from the console ─────────────────────────────────

-- Fire command puts a site on the register before its first visit, or changes
-- its use, risk or contact; the inspector adds one by inspecting it.
create or replace function public.save_fire_premises(p_id uuid, p_fields jsonb)
returns public.fire_premises
language plpgsql security definer set search_path to 'public' as $$
declare
  f        jsonb := coalesce(p_fields, '{}'::jsonb);
  v        public.fire_premises;
  v_name   text := nullif(left(btrim(coalesce(f ->> 'name', '')), 200), '');
  v_addr   text := nullif(left(btrim(coalesce(f ->> 'address', '')), 300), '');
  v_occ    text := btrim(coalesce(f ->> 'occupancy', ''));
  v_risk   text := btrim(coalesce(f ->> 'risk', ''));
  v_person text := nullif(left(btrim(coalesce(f ->> 'contact_person', '')), 120), '');
  v_number text := nullif(btrim(coalesce(f ->> 'contact_number', '')), '');
  v_who    text;
begin
  perform public.require_role('Captain', 'FireChief', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin');
  if public.current_silo() is distinct from 'MetroFire' then
    raise exception 'Only Fire & Rescue keeps the premises register' using errcode = '42501';
  end if;
  if v_name is null then raise exception 'Enter the name of the business or site.' using errcode = 'P0001'; end if;
  if v_addr is null then raise exception 'Enter the address.' using errcode = 'P0001'; end if;
  if not (v_occ = any (public.fire_occupancies())) then
    raise exception 'Choose what the premises are used for.' using errcode = 'P0001';
  end if;
  if v_risk not in ('High', 'Moderate', 'Low') then raise exception 'Choose the risk.' using errcode = 'P0001'; end if;
  if v_number is not null and v_number !~ '^\+?[0-9 ()-]{7,20}$' then
    raise exception 'The contact number is not a phone number.' using errcode = 'P0001';
  end if;

  select full_name into v_who from public.profiles where id = auth.uid();
  if p_id is null then
    begin
      insert into public.fire_premises (tenant_id, name, address, occupancy, risk, interval_months, contact_person, contact_number)
      values (public.current_tenant(), v_name, v_addr, v_occ, v_risk,
              case v_risk when 'High' then 6 when 'Low' then 24 else 12 end, v_person, v_number)
      returning * into v;
    exception when unique_violation then
      raise exception '% at % is already on the register.', v_name, v_addr using errcode = '23505';
    end;
  else
    update public.fire_premises
       set name = v_name, address = v_addr, occupancy = v_occ, risk = v_risk,
           interval_months = case v_risk when 'High' then 6 when 'Low' then 24 else 12 end,
           contact_person = v_person, contact_number = v_number,
           -- A new risk moves the next routine visit; a notice's date stays.
           next_due = case when last_outcome = 'Compliant' and last_inspected_at is not null
                           then ((last_inspected_at at time zone 'Africa/Johannesburg')::date
                                 + make_interval(months => case v_risk when 'High' then 6 when 'Low' then 24 else 12 end))::date
                           else next_due end,
           updated_at = now()
     where id = p_id and tenant_id = public.current_tenant()
    returning * into v;
    if not found then raise exception 'That premises is not on the register.' using errcode = 'P0002'; end if;
  end if;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (public.current_tenant(), 'MetroFire', auth.uid(), v_who, 'MetroFire',
    case when p_id is null then 'FirePremisesAdded' else 'FirePremisesChanged' end, 'fire_premises', v.id::text,
    format('%s at %s · %s · %s risk', v.name, v.address, v.occupancy, v.risk));
  return v;
end $$;

revoke all on function public.save_fire_premises(uuid, jsonb) from public, anon;
grant execute on function public.save_fire_premises(uuid, jsonb) to authenticated;

-- ── 7. Prove it ────────────────────────────────────────────────────────────

do $$
declare
  v_bad text;
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fire_premises'
                  and policyname = 'tenant_isolation' and permissive = 'RESTRICTIVE') then
    raise exception 'No tenant wall on fire_premises — nothing was changed';
  end if;
  select string_agg(tablename || '.' || policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'public' and tablename in ('fire_premises', 'fire_safety_inspections')
     and permissive = 'PERMISSIVE' and cmd <> 'SELECT';
  if v_bad is not null then
    raise exception 'Write policies found on %: nothing was changed', v_bad;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
