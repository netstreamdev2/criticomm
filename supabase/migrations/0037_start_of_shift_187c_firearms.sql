-- ============================================================================
-- 0037 — Start of shift: full DMPS 187(c) vehicle inspection + armoury register
-- ============================================================================
--
-- The mobile start-of-shift flow now mirrors the V4 platform:
--
--   1. Readiness assessment           mental_checks            (unchanged)
--   2. Select unit                     assign_vehicle()         (unchanged)
--   3. Vehicle inspection 187(c)       vehicle_checklists       (+ full form)
--   4. Firearm & loadout (police)      issue_shift_firearm()    (new)
--      …or "No firearm"                declare_shift_no_firearm() (new)
--
-- Firearms are no longer typed in by the officer. Admins and supervisors
-- pre-log every firearm in `firearms` (directly, or by issuing it on the
-- console, which registers the serial); the officer picks one that is
-- Available (or already booked out to them) and the RPC books it out.
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

-- ── 1. Vehicle inspection 187(c) ────────────────────────────────────────────
-- One row is still one inspection. The five "essential" booleans keep gating
-- duty exactly as before; the 67-item sheet, details and sign-off are the
-- official record that goes on file and into the PDF.

alter table public.vehicle_checklists
  add column if not exists form_version          text,
  add column if not exists inspection_ref        text,
  add column if not exists ndm_number            text,
  add column if not exists mileage_km            int,
  add column if not exists shift_type            text,
  add column if not exists inspection_date       date,
  add column if not exists items                 jsonb not null default '{}'::jsonb,
  add column if not exists items_ok              int not null default 0,
  add column if not exists items_fault           int not null default 0,
  add column if not exists items_nil             int not null default 0,
  add column if not exists fault_remarks         text,
  add column if not exists inspector_name        text,
  add column if not exists signature_svg         text,
  add column if not exists photo_paths           text[] not null default '{}',
  add column if not exists licence_disk_path     text,
  add column if not exists licence_photo_path    text,
  add column if not exists declaration_accepted  boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicle_checklists_shift_type_chk') then
    alter table public.vehicle_checklists add constraint vehicle_checklists_shift_type_chk
      check (shift_type is null or shift_type in ('DAY','NIGHT','MORNING','AFTERNOON'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicle_checklists_mileage_chk') then
    alter table public.vehicle_checklists add constraint vehicle_checklists_mileage_chk
      check (mileage_km is null or mileage_km between 0 and 2000000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicle_checklists_signature_len_chk') then
    -- An SVG path of a signature is a few KB; this only stops abuse.
    alter table public.vehicle_checklists add constraint vehicle_checklists_signature_len_chk
      check (signature_svg is null or length(signature_svg) <= 200000);
  end if;
end $$;

create index if not exists vehicle_checklists_apparatus_idx
  on public.vehicle_checklists (apparatus_id, checked_at desc);

-- The record must stand on its own. The client validates for a friendly
-- error; the server re-validates so no client build can file a hollow sheet
-- (V4 filed "0/67 items · PASSED" because nothing checked).
create or replace function public.validate_vehicle_187c() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_bad   int;
  v_total int;
  v_name  text;
begin
  if new.form_version is distinct from '187c' then
    return new;
  end if;

  if coalesce(trim(new.ndm_number), '') = '' then
    raise exception 'NDM number is required';
  end if;
  if new.mileage_km is null then
    raise exception 'Current mileage is required';
  end if;
  if new.shift_type is null then
    raise exception 'Shift is required';
  end if;
  if not new.declaration_accepted then
    raise exception 'The inspection declaration must be accepted';
  end if;
  if coalesce(new.signature_svg, '') = '' then
    raise exception 'The inspector signature is required';
  end if;
  if jsonb_typeof(new.items) <> 'object' then
    raise exception 'Inspection items are malformed';
  end if;

  select count(*), count(*) filter (where value not in ('"ok"','"fault"','"nil"'))
    into v_total, v_bad
  from jsonb_each(new.items);
  if v_bad > 0 then
    raise exception 'Every inspection item must be OK, Fault or NIL';
  end if;
  if v_total < 67 then
    raise exception 'All 67 inspection items must be completed (% done)', v_total;
  end if;

  select count(*) filter (where value = '"ok"'),
         count(*) filter (where value = '"fault"'),
         count(*) filter (where value = '"nil"')
    into new.items_ok, new.items_fault, new.items_nil
  from jsonb_each(new.items);

  if new.items_fault > 0 and coalesce(trim(new.fault_remarks), '') = '' then
    raise exception 'Describe the faults found before submitting';
  end if;

  -- Who inspected and when are facts the server knows; never trust a client.
  select trim(p.rank || ' ' || p.first_name || ' ' || p.last_name) into v_name
  from public.personnel p
  where p.user_id = auth.uid() and p.tenant_id = public.current_tenant()
  limit 1;
  new.inspector_name := coalesce(v_name, new.inspector_name);
  new.inspection_date := (now() at time zone 'Africa/Johannesburg')::date;
  return new;
end $$;

drop trigger if exists validate_vehicle_187c_insert on public.vehicle_checklists;
create trigger validate_vehicle_187c_insert before insert on public.vehicle_checklists
  for each row execute function public.validate_vehicle_187c();

-- ── 2. Armoury register ─────────────────────────────────────────────────────

create table if not exists public.firearms (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default public.current_tenant(),
  silo           silo not null default 'MetroPolice',
  serial_number  text not null,
  make           text not null,
  model          text not null,
  calibre        text,
  firearm_type   text not null default 'Sidearm'
                 check (firearm_type in ('Sidearm','Rifle','Shotgun','Less-lethal','Other')),
  status         text not null default 'Available'
                 check (status in ('Available','Issued','Maintenance','Retired')),
  issued_to      uuid references auth.users(id) on delete set null,
  issued_at      timestamptz,
  notes          text,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, serial_number)
);
create index if not exists firearms_tenant_idx on public.firearms (tenant_id);
create index if not exists firearms_status_idx on public.firearms (tenant_id, silo, status);
alter table public.firearms enable row level security;

-- Officers see the register for their own service (Ethekwini field officers
-- draw from the Metro Police armoury, same as vehicles).
drop policy if exists firearms_read on public.firearms;
create policy firearms_read on public.firearms for select to authenticated
  using (
    public.is_global()
    or silo = public.current_silo()
    or (public.current_silo() = 'Ethekwini' and silo = 'MetroPolice')
  );

-- Only command staff maintain the register (add, retire, mark returned).
drop policy if exists firearms_command_write on public.firearms;
create policy firearms_command_write on public.firearms for all to authenticated
  using (
    public.role_in('SystemAdmin','SuperAdmin','SystemController')
    or (silo = public.current_silo()
        and public.role_in('Admin','System','Supervisor','Captain','Chief'))
  )
  with check (
    public.role_in('SystemAdmin','SuperAdmin','SystemController')
    or (silo = public.current_silo()
        and public.role_in('Admin','System','Supervisor','Captain','Chief'))
  );

drop policy if exists tenant_isolation on public.firearms;
create policy tenant_isolation on public.firearms as restrictive for all to authenticated
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

-- Returning a firearm is just setting status back to Available.
create or replace function public.touch_firearm() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.status <> 'Issued' then
    new.issued_to := null;
    new.issued_at := null;
  end if;
  return new;
end $$;
drop trigger if exists touch_firearm_update on public.firearms;
create trigger touch_firearm_update before insert or update on public.firearms
  for each row execute function public.touch_firearm();

-- ── 2b. The console issue register feeds the armoury ────────────────────────
-- Supervisors already issue firearms on the console (/police/firearms/new →
-- firearm_authorizations). Every serial issued there is a firearm the service
-- holds, so it lands in the register and officers can select it at the start
-- of shift without anyone keying it in twice. Existing entries are kept as
-- they are; the register stays the authority for status.

create or replace function public.register_authorized_firearm() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_serial text := trim(coalesce(new.firearm_number, ''));
  v_make   text := nullif(trim(coalesce(new.make, '')), '');
begin
  if v_serial = '' then
    return new;
  end if;
  insert into public.firearms (tenant_id, silo, serial_number, make, model, notes, created_by)
  values (
    new.tenant_id, new.silo, v_serial,
    coalesce(split_part(v_make, ' ', 1), 'Unknown'),
    coalesce(nullif(trim(substr(v_make, length(split_part(v_make, ' ', 1)) + 1)), ''), '—'),
    'Added from issue register ' || new.form_number,
    auth.uid()
  )
  on conflict (tenant_id, serial_number) do nothing;
  return new;
end $$;

drop trigger if exists register_authorized_firearm_insert on public.firearm_authorizations;
create trigger register_authorized_firearm_insert after insert on public.firearm_authorizations
  for each row execute function public.register_authorized_firearm();

insert into public.firearms (tenant_id, silo, serial_number, make, model, notes)
select distinct on (a.tenant_id, trim(a.firearm_number))
  a.tenant_id, a.silo, trim(a.firearm_number),
  coalesce(split_part(nullif(trim(a.make), ''), ' ', 1), 'Unknown'),
  coalesce(nullif(trim(substr(trim(a.make), length(split_part(trim(a.make), ' ', 1)) + 1)), ''), '—'),
  'Added from issue register ' || a.form_number
from public.firearm_authorizations a
where trim(coalesce(a.firearm_number, '')) <> ''
order by a.tenant_id, trim(a.firearm_number), a.created_at desc
on conflict (tenant_id, serial_number) do nothing;

-- ── 3. Link armoury checklists to the register ──────────────────────────────

alter table public.firearm_checklists
  add column if not exists firearm_id     uuid references public.firearms(id) on delete set null,
  add column if not exists chamber_status text,
  add column if not exists condition      text,
  add column if not exists shift_start    boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'firearm_checklists_chamber_chk') then
    alter table public.firearm_checklists add constraint firearm_checklists_chamber_chk
      check (chamber_status is null or chamber_status in ('condition_1','condition_3','unloaded'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'firearm_checklists_condition_chk') then
    alter table public.firearm_checklists add constraint firearm_checklists_condition_chk
      check (condition is null or condition in ('clean','requires_cleaning','damaged'));
  end if;
end $$;

-- ── 4. Duty gate, one rule per step ─────────────────────────────────────────

create or replace function public.sa_today_start() returns timestamptz
language sql stable set search_path = public as $$
  select ((now() at time zone 'Africa/Johannesburg')::date::timestamp
    at time zone 'Africa/Johannesburg');
$$;

create or replace function public.shift_readiness_passed_today() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from (
      select * from public.mental_checks
      where user_id = auth.uid() and tenant_id = public.current_tenant()
        and timestamp >= public.sa_today_start()
      order by timestamp desc, id desc limit 1
    ) m
    where m.memory_recall and m.judgment and m.situational_awareness
      and m.not_under_influence and m.anger_check and m.reflexes
  );
$$;

-- The latest signed 187(c) sheet today, for the vehicle the officer holds.
create or replace function public.shift_vehicle_passed_today() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from (
      select v.* from public.vehicle_checklists v
      join public.personnel p on p.user_id = v.user_id
        and p.tenant_id = v.tenant_id
        and p.assigned_apparatus_id = v.apparatus_id
      where v.user_id = auth.uid() and v.tenant_id = public.current_tenant()
        and v.checked_at >= public.sa_today_start()
        and v.officer_submitted and v.form_version = '187c'
      order by v.checked_at desc, v.id desc limit 1
    ) v
    where v.lights_functional and v.tires_condition_ok
      and v.equipment_stocked and v.comms_working and v.brakes_responsive
      and v.declaration_accepted
  );
$$;

create or replace function public.shift_requires_firearm() returns boolean
language sql stable set search_path = public as $$
  select public.current_silo() in ('MetroPolice','Ethekwini');
$$;

create or replace function public.shift_firearm_issued_today() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.firearm_checklists c
    join public.firearms f on f.id = c.firearm_id
    where c.user_id = auth.uid() and c.tenant_id = public.current_tenant()
      and c.shift_start and c.kind = 'Issue' and c.passed
      and c.condition <> 'damaged'
      and c.created_at >= public.sa_today_start()
      and f.status = 'Issued' and f.issued_to = auth.uid()
  );
$$;

-- An officer who is not drawing a firearm this shift (none on the register,
-- or not armed today) says so on the record instead. Either a book-out or
-- that declaration completes the firearm step; silence does not.
create table if not exists public.shift_no_firearm_declarations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant(),
  silo        silo not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  user_name   text,
  reason      text,
  created_at  timestamptz not null default now()
);
create index if not exists shift_no_firearm_user_idx
  on public.shift_no_firearm_declarations (user_id, created_at desc);
alter table public.shift_no_firearm_declarations enable row level security;

-- Written only through declare_shift_no_firearm(); read by the officer and command.
drop policy if exists shift_no_firearm_read on public.shift_no_firearm_declarations;
create policy shift_no_firearm_read on public.shift_no_firearm_declarations for select to authenticated
  using (
    user_id = auth.uid()
    or public.role_in('SystemAdmin','SuperAdmin','SystemController')
    or (silo = public.current_silo()
        and public.role_in('Admin','System','Supervisor','Captain','Chief'))
  );
drop policy if exists tenant_isolation on public.shift_no_firearm_declarations;
create policy tenant_isolation on public.shift_no_firearm_declarations as restrictive for all to authenticated
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

create or replace function public.shift_firearm_resolved_today() returns boolean
language sql stable security definer set search_path = public as $$
  select public.shift_firearm_issued_today()
      or exists (
        select 1 from public.shift_no_firearm_declarations d
        where d.user_id = auth.uid() and d.tenant_id = public.current_tenant()
          and d.created_at >= public.sa_today_start()
      );
$$;

create or replace function public.has_completed_shift_start_today() returns boolean
language sql stable security definer set search_path = public as $$
  select public.shift_readiness_passed_today()
     and public.shift_vehicle_passed_today()
     and (not public.shift_requires_firearm() or public.shift_firearm_resolved_today());
$$;

create or replace function public.declare_shift_no_firearm(p_reason text default null)
returns public.shift_no_firearm_declarations
language plpgsql security definer set search_path = public as $$
declare
  v_person public.personnel;
  v_row    public.shift_no_firearm_declarations;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into v_person from public.personnel
  where user_id = auth.uid() and tenant_id = public.current_tenant();
  if not found then raise exception 'No personnel record is linked to this account'; end if;
  if not public.shift_readiness_passed_today() then
    raise exception 'Complete the readiness assessment first';
  end if;
  if not public.shift_vehicle_passed_today() then
    raise exception 'Complete and sign the vehicle inspection first';
  end if;

  insert into public.shift_no_firearm_declarations (tenant_id, silo, user_id, user_name, reason)
  values (
    public.current_tenant(), v_person.silo, auth.uid(),
    trim(v_person.rank || ' ' || v_person.first_name || ' ' || v_person.last_name),
    nullif(trim(coalesce(p_reason, '')), '')
  ) returning * into v_row;
  return v_row;
end $$;

revoke execute on function public.declare_shift_no_firearm(text) from public, anon;
grant  execute on function public.declare_shift_no_firearm(text) to authenticated;
revoke execute on function public.shift_firearm_resolved_today() from public, anon;
grant  execute on function public.shift_firearm_resolved_today() to authenticated;

-- ── 5. Book out a firearm ───────────────────────────────────────────────────

create or replace function public.issue_shift_firearm(
  p_firearm_id        uuid,
  p_rounds_issued     int,
  p_magazines         int,
  p_chamber_status    text,
  p_condition         text,
  p_serial_verified   boolean,
  p_barrel_clear      boolean,
  p_action_functional boolean,
  p_safety_functional boolean,
  p_sights_secure     boolean,
  p_notes             text default null
) returns public.firearm_checklists
language plpgsql security definer set search_path = public as $$
declare
  v_person  public.personnel;
  v_firearm public.firearms;
  v_row     public.firearm_checklists;
  v_notes   text := nullif(trim(coalesce(p_notes, '')), '');
  v_safe    boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in before booking out a firearm' using errcode = '42501';
  end if;

  select * into v_person from public.personnel
  where user_id = auth.uid() and tenant_id = public.current_tenant();
  if not found then raise exception 'No personnel record is linked to this account'; end if;

  if not public.shift_readiness_passed_today() then
    raise exception 'Complete the readiness assessment first';
  end if;
  if not public.shift_vehicle_passed_today() then
    raise exception 'Complete and sign the vehicle inspection first';
  end if;

  if p_chamber_status not in ('condition_1','condition_3','unloaded') then
    raise exception 'Select the chamber status';
  end if;
  if p_condition not in ('clean','requires_cleaning','damaged') then
    raise exception 'Select the firearm condition';
  end if;
  if p_rounds_issued is null or p_rounds_issued not between 0 and 500 then
    raise exception 'Rounds issued must be between 0 and 500';
  end if;
  if p_magazines is null or p_magazines not between 0 and 20 then
    raise exception 'Magazines must be between 0 and 20';
  end if;
  if p_condition <> 'clean' and v_notes is null then
    raise exception 'Describe the firearm condition in the notes';
  end if;

  select * into v_firearm from public.firearms
  where id = p_firearm_id and tenant_id = public.current_tenant()
    and (silo = v_person.silo or (v_person.silo = 'Ethekwini' and silo = 'MetroPolice'))
  for update;
  if not found then raise exception 'Firearm is not on your armoury register'; end if;
  if not (v_firearm.status = 'Available'
          or (v_firearm.status = 'Issued' and v_firearm.issued_to = auth.uid())) then
    raise exception 'Firearm % is % — select another', v_firearm.serial_number, lower(v_firearm.status);
  end if;

  insert into public.firearm_checklists (
    tenant_id, silo, user_id, user_name, kind, serial_number, make_model,
    serial_verified, barrel_clear, action_functional, safety_functional, sights_secure,
    cleaned, magazines, rounds_issued, defects,
    firearm_id, chamber_status, condition, shift_start
  ) values (
    public.current_tenant(), v_person.silo, auth.uid(),
    trim(v_person.rank || ' ' || v_person.first_name || ' ' || v_person.last_name),
    'Issue', v_firearm.serial_number, v_firearm.make || ' ' || v_firearm.model,
    coalesce(p_serial_verified, false), coalesce(p_barrel_clear, false),
    coalesce(p_action_functional, false), coalesce(p_safety_functional, false),
    coalesce(p_sights_secure, false),
    p_condition = 'clean', p_magazines, p_rounds_issued, v_notes,
    v_firearm.id, p_chamber_status, p_condition, true
  ) returning * into v_row;

  -- A firearm that fails its check goes to the armourer, not onto the street.
  v_safe := v_row.passed and p_condition <> 'damaged';
  if v_safe then
    update public.firearms
       set status = 'Issued', issued_to = auth.uid(), issued_at = now()
     where id = v_firearm.id;
  else
    update public.firearms set status = 'Maintenance' where id = v_firearm.id;
  end if;

  return v_row;
end $$;

revoke execute on function public.issue_shift_firearm(uuid,int,int,text,text,boolean,boolean,boolean,boolean,boolean,text) from public, anon;
grant  execute on function public.issue_shift_firearm(uuid,int,int,text,text,boolean,boolean,boolean,boolean,boolean,text) to authenticated;

revoke execute on function public.shift_readiness_passed_today() from public, anon;
revoke execute on function public.shift_vehicle_passed_today()   from public, anon;
revoke execute on function public.shift_firearm_issued_today()   from public, anon;
revoke execute on function public.has_completed_shift_start_today() from public, anon;
grant  execute on function public.shift_readiness_passed_today() to authenticated;
grant  execute on function public.shift_vehicle_passed_today()   to authenticated;
grant  execute on function public.shift_firearm_issued_today()   to authenticated;
grant  execute on function public.shift_requires_firearm()       to authenticated;
grant  execute on function public.has_completed_shift_start_today() to authenticated;

-- ── 6. Inspection photos ────────────────────────────────────────────────────
-- Path: <tenant_id>/<user_id>/<inspection_ref>/<file>. Officers write only
-- into their own folder; command staff in the same tenant can read all.

insert into storage.buckets (id, name, public) values
  ('shift-inspections', 'shift-inspections', false)
on conflict (id) do nothing;

drop policy if exists shift_inspections_insert on storage.objects;
create policy shift_inspections_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'shift-inspections'
    and (storage.foldername(name))[1] = public.current_tenant()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists shift_inspections_read on storage.objects;
create policy shift_inspections_read on storage.objects for select to authenticated
  using (
    bucket_id = 'shift-inspections'
    and (storage.foldername(name))[1] = public.current_tenant()::text
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or public.role_in('SystemAdmin','SuperAdmin','SystemController',
                        'Admin','System','Supervisor','Captain','Chief','FireChief')
    )
  );

notify pgrst, 'reload schema';
