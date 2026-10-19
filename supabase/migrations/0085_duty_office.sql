-- ============================================================================
-- 0085 — The duty office, eThekwini's way (the Oracle DCP programs)
-- ============================================================================
--
-- Run after 0084. Safe to re-run.
--
-- eThekwini Metro Police roster through a central duty office (the systems
-- controller). The screens they use today, and that this follows:
--
--   DCPSTFM  Staff maintenance     the member's record, LEO record, access
--   BCPCSM   Call sign maintenance  call sign, patrol area, start, stop, break, rank
--   DCPSTFM  Section details       section, short description, station, zone,
--                                   division, overtime code
--   DCPENTM  Endorsements          numbered instructions that print on the sheet
--   DCPABSM  Absence codes         AL, SL, AW, SU, IO, LD ...
--   DCPDUTA  Duty allocation       section + from/to dates, call signs, staff
--   DCPDUTM  Duty maintenance      call sign history, change a duty
--   DCPDUTY  Duties for operation  the parade sheet (sign on, off, overtime)
--   DCPLEAM  Leave maintenance     the office captures leave; it marks duty absent
--
-- 1. Access is given per person, per screen: View or Edit (Oracle's
--    Enquiry / Update). The systems controller tier (SystemController,
--    SystemAdmin, SuperAdmin) has Edit everywhere and grants the rest.
--    Rostering a department (can_manage_roster) now follows the Duty
--    Allocation grant instead of rank. So nothing changes on the day this
--    runs, everyone who rosters today is given the grants matching what they
--    do today, once; the controller then adds and removes.
-- 2. Stations (OR, B, CH, NR, DR, W) become their own list. The six rows 0033
--    seeded as "sections" were stations; they are copied across and retired
--    as sections (Reactivate brings one back).
-- 3. Call signs are the duty posts, with start, stop, break, rank and section.
-- 4. The member's record carries the Oracle fields. ID number, birth date,
--    address and next of kin sit in their own table that only Staff
--    Maintenance access (and the member) can read.
-- 5. The office captures leave and absence for a member (form submitted
--    Y/N). It is approved as captured and marks their duty Leave, Sick or
--    Absent. Members still ask for their own leave; codes such as AWOL and
--    Suspended are captured by the office only.
-- 6. Duty allocation books a section's call signs for a date range in one go.
--    It refuses leave, court and double booking per day, with the reason,
--    issues the shifts and tells each member once.
--
-- Every write goes through a SECURITY DEFINER function that checks who is
-- asking. Nothing is granted to anon.
-- ============================================================================


-- ── 1. Access per person, per screen ────────────────────────────────────────

create table if not exists public.module_access (
  tenant_id       uuid not null default public.current_tenant(),
  user_id         uuid not null,
  module          text not null check (module in ('STFM', 'CSNM', 'SECM', 'ENTM', 'ABSM', 'DUTA', 'DUTM', 'DUTR', 'LEAM')),
  level           text not null check (level in ('View', 'Edit')),
  granted_by      uuid,
  granted_by_name text,
  granted_at      timestamptz not null default now(),
  primary key (user_id, module)
);
alter table public.module_access enable row level security;

/** What a screen code is called, for messages and the audit log. */
create or replace function public.module_label(p_module text) returns text
language sql immutable as $$
  select case p_module
    when 'STFM' then 'Staff Maintenance' when 'CSNM' then 'Call Signs' when 'SECM' then 'Sections'
    when 'ENTM' then 'Endorsements' when 'ABSM' then 'Absence Codes' when 'DUTA' then 'Duty Allocation'
    when 'DUTM' then 'Duty Maintenance' when 'DUTR' then 'Duties for Operation' when 'LEAM' then 'Maintain Leave'
    else p_module end;
$$;

/**
 * The signed-in person's access to a screen for a department: 'Edit', 'View'
 * or null. The controller tier has Edit everywhere. Everyone else has what
 * they were granted, in their own department only. p_silo null means the
 * screen is not about one department (absence codes).
 */
create or replace function public.module_level(p_module text, p_silo public.silo default null)
returns text
language sql stable security definer set search_path to 'public' as $$
  select case
    when public.schedule_rank(p.role) >= 4 then 'Edit'
    when p_silo is not null and p.silo is distinct from p_silo then null
    else (select m.level from public.module_access m
           where m.user_id = p.id and m.module = p_module and m.tenant_id = p.tenant_id)
  end
  from public.profiles p
  where p.id = auth.uid() and p.deactivated_at is null;
$$;

create or replace function public.can_module(p_module text, p_silo public.silo, p_edit boolean default false)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.module_level(p_module, p_silo) = 'Edit'
                  or (not p_edit and public.module_level(p_module, p_silo) = 'View'), false);
$$;

/** My screens, for the menus: every code with my level. */
create or replace function public.my_modules()
returns table (module text, level text)
language sql stable security definer set search_path to 'public' as $$
  select m.code, public.module_level(m.code, p.silo)
    from unnest(array['STFM', 'CSNM', 'SECM', 'ENTM', 'ABSM', 'DUTA', 'DUTM', 'DUTR', 'LEAM']) as m(code)
    cross join public.profiles p
   where p.id = auth.uid() and p.deactivated_at is null
     and public.module_level(m.code, p.silo) is not null;
$$;

revoke all on function public.module_level(text, public.silo) from public, anon;
revoke all on function public.can_module(text, public.silo, boolean) from public, anon;
revoke all on function public.my_modules() from public, anon;
grant execute on function public.module_level(text, public.silo) to authenticated;
grant execute on function public.can_module(text, public.silo, boolean) to authenticated;
grant execute on function public.my_modules() to authenticated;

/** Give, change or take away one person's access to one screen. The controller tier only. */
create or replace function public.set_module_access(p_user uuid, p_module text, p_level text)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v_them record;
  v_level text := nullif(btrim(coalesce(p_level, '')), '');
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  if me.rank < 4 then
    raise exception 'Only the systems controller gives access' using errcode = '42501';
  end if;
  if p_module not in ('STFM', 'CSNM', 'SECM', 'ENTM', 'ABSM', 'DUTA', 'DUTM', 'DUTR', 'LEAM') then
    raise exception 'Unknown screen' using errcode = '22023';
  end if;
  if v_level is not null and v_level not in ('View', 'Edit') then
    raise exception 'Access is View or Edit' using errcode = '22023';
  end if;
  select id, tenant_id, silo, full_name into v_them from public.profiles where id = p_user;
  if not found or v_them.tenant_id <> me.tenant_id then
    raise exception 'That person has no account here' using errcode = '22023';
  end if;

  if v_level is null then
    delete from public.module_access where user_id = p_user and module = p_module;
  else
    insert into public.module_access (tenant_id, user_id, module, level, granted_by, granted_by_name)
    values (me.tenant_id, p_user, p_module, v_level, me.id, me.full_name)
    on conflict (user_id, module) do update
      set level = excluded.level, granted_by = excluded.granted_by,
          granted_by_name = excluded.granted_by_name, granted_at = now();
  end if;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (me.tenant_id, v_them.silo, me.id, me.full_name, v_them.silo::text, 'AccessChanged', 'module_access',
          p_user::text, format('%s: %s %s', coalesce(v_them.full_name, 'member'), public.module_label(p_module),
                               coalesce(v_level, 'removed')));
end $$;
revoke all on function public.set_module_access(uuid, text, text) from public, anon;
grant execute on function public.set_module_access(uuid, text, text) to authenticated;

-- Read: your own access, and anyone's to those who can open Staff Maintenance.
drop policy if exists module_access_read on public.module_access;
create policy module_access_read on public.module_access for select to authenticated using (
  user_id = auth.uid()
  or public.can_module('STFM', (select p.silo from public.profiles p where p.id = module_access.user_id))
);
drop policy if exists tenant_isolation on public.module_access;
create policy tenant_isolation on public.module_access as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());

-- Once per organisation: what people roster today, as grants.
create table if not exists public.module_access_seeded (
  tenant_id uuid primary key,
  seeded_at timestamptz not null default now()
);
alter table public.module_access_seeded enable row level security;

do $$
declare t record;
begin
  for t in select distinct p.tenant_id from public.profiles p
            where not exists (select 1 from public.module_access_seeded s where s.tenant_id = p.tenant_id)
  loop
    insert into public.module_access (tenant_id, user_id, module, level, granted_by_name)
    select p.tenant_id, p.id, g.module, g.level, 'Carried over (0085)'
      from public.profiles p
      cross join lateral (values
        ('DUTA', 'Edit'), ('DUTM', 'Edit'), ('DUTR', 'View'), ('ENTM', 'Edit'), ('LEAM', 'Edit'),
        ('CSNM', case when public.schedule_rank(p.role) = 3 then 'Edit' else 'View' end),
        ('SECM', case when public.schedule_rank(p.role) = 3 then 'Edit' else 'View' end),
        ('ABSM', 'View')
      ) as g(module, level)
     where p.tenant_id = t.tenant_id and p.deactivated_at is null
       and public.schedule_rank(p.role) between 1 and 3
    on conflict (user_id, module) do nothing;
    -- Department administrators keep their people's records.
    insert into public.module_access (tenant_id, user_id, module, level, granted_by_name)
    select p.tenant_id, p.id, 'STFM', 'Edit', 'Carried over (0085)'
      from public.profiles p
     where p.tenant_id = t.tenant_id and p.deactivated_at is null and public.schedule_rank(p.role) = 3
    on conflict (user_id, module) do nothing;
    insert into public.module_access_seeded (tenant_id) values (t.tenant_id);
  end loop;
end $$;

-- Rostering a department follows the Duty Allocation grant, not rank.
create or replace function public.can_manage_roster(p_silo public.silo) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.deactivated_at is null
       and (public.schedule_rank(p.role) >= 4
            or (p.silo = p_silo and exists (
                  select 1 from public.module_access m
                   where m.user_id = p.id and m.module = 'DUTA' and m.level = 'Edit' and m.tenant_id = p.tenant_id)))
  );
$$;

-- ── 2. Stations and sections ────────────────────────────────────────────────

create table if not exists public.stations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default public.current_tenant(),
  silo       public.silo not null default 'MetroPolice',
  code       text not null check (code ~ '^[A-Z0-9]{1,6}$'),
  name       text not null check (length(btrim(name)) > 0),
  zone       text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, silo, code)
);
alter table public.stations enable row level security;
drop policy if exists stations_read on public.stations;
create policy stations_read on public.stations for select to authenticated using (true);
drop policy if exists tenant_isolation on public.stations;
create policy tenant_isolation on public.stations as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());

alter table public.sections
  add column if not exists short_desc    text,
  add column if not exists station_code  text,
  add column if not exists division      text,
  add column if not exists overtime_code text;

-- The six rows 0033 seeded as sections are Oracle's stations.
insert into public.stations (tenant_id, silo, code, name, zone)
select s.tenant_id, s.silo, s.code, s.name, s.region
  from public.sections s
 where (s.code, s.name) in (('NR', 'North Region'), ('W', 'Inner West'), ('DR', 'Durban Central'),
                            ('B', 'Beachfront'), ('CH', 'Chatsworth'), ('OR', 'Operational Response Services'))
on conflict (tenant_id, silo, code) do nothing;
update public.sections s set active = false
 where s.active and s.station_code is null and s.short_desc is null
   and (s.code, s.name) in (('NR', 'North Region'), ('W', 'Inner West'), ('DR', 'Durban Central'),
                            ('B', 'Beachfront'), ('CH', 'Chatsworth'), ('OR', 'Operational Response Services'));

-- Sections and stations change only through the functions below.
drop policy if exists sections_write on public.sections;

create or replace function public.save_station(
  p_id uuid, p_silo public.silo, p_code text, p_name text, p_zone text, p_active boolean default true
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v_id uuid;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  if not public.can_module('SECM', p_silo, true) then
    raise exception 'You do not maintain sections for %', public.department_label(p_silo) using errcode = '42501';
  end if;
  if v_code !~ '^[A-Z0-9]{1,6}$' then raise exception 'A station code is 1 to 6 letters or digits' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Name the station' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.stations (tenant_id, silo, code, name, zone, active)
    values (me.tenant_id, p_silo, v_code, btrim(p_name), nullif(btrim(coalesce(p_zone, '')), ''), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.stations
       set code = v_code, name = btrim(p_name), zone = nullif(btrim(coalesce(p_zone, '')), ''),
           active = coalesce(p_active, active)
     where id = p_id and tenant_id = me.tenant_id and silo = p_silo
    returning id into v_id;
    if v_id is null then raise exception 'Station not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Station % already exists', v_code using errcode = '23505';
end $$;

create or replace function public.save_section(
  p_id uuid, p_silo public.silo, p_code text, p_name text, p_short text, p_station text,
  p_zone text, p_division text, p_overtime text, p_active boolean default true
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v_id uuid;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_station text := nullif(upper(btrim(coalesce(p_station, ''))), '');
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  if not public.can_module('SECM', p_silo, true) then
    raise exception 'You do not maintain sections for %', public.department_label(p_silo) using errcode = '42501';
  end if;
  if v_code !~ '^[A-Z0-9]{1,6}$' then raise exception 'A section code is 1 to 6 letters or digits' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Describe the section' using errcode = '22023'; end if;
  if v_station is not null and not exists (
       select 1 from public.stations where tenant_id = me.tenant_id and silo = p_silo and code = v_station) then
    raise exception 'Station % is not on the list', v_station using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.sections (tenant_id, silo, code, name, short_desc, station_code, region, division, overtime_code, active)
    values (me.tenant_id, p_silo, v_code, btrim(p_name), nullif(btrim(coalesce(p_short, '')), ''), v_station,
            nullif(btrim(coalesce(p_zone, '')), ''), nullif(btrim(coalesce(p_division, '')), ''),
            nullif(btrim(coalesce(p_overtime, '')), ''), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.sections
       set code = v_code, name = btrim(p_name), short_desc = nullif(btrim(coalesce(p_short, '')), ''),
           station_code = v_station, region = nullif(btrim(coalesce(p_zone, '')), ''),
           division = nullif(btrim(coalesce(p_division, '')), ''),
           overtime_code = nullif(btrim(coalesce(p_overtime, '')), ''), active = coalesce(p_active, active)
     where id = p_id and tenant_id = me.tenant_id and silo = p_silo
    returning id into v_id;
    if v_id is null then raise exception 'Section not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (me.tenant_id, p_silo, me.id, me.full_name, p_silo::text, 'SectionSaved', 'section', v_id::text,
          format('%s %s', v_code, btrim(p_name)));
  return v_id;
exception when unique_violation then
  raise exception 'Section % already exists', v_code using errcode = '23505';
end $$;

revoke all on function public.save_station(uuid, public.silo, text, text, text, boolean) from public, anon;
revoke all on function public.save_section(uuid, public.silo, text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.save_station(uuid, public.silo, text, text, text, boolean) to authenticated;
grant execute on function public.save_section(uuid, public.silo, text, text, text, text, text, text, text, boolean) to authenticated;

-- ── 3. Call signs (the duty posts) ──────────────────────────────────────────

alter table public.duty_posts
  add column if not exists section_id  uuid references public.sections (id) on delete set null,
  add column if not exists start_time  time,
  add column if not exists stop_time   time,
  add column if not exists break_time  time,
  add column if not exists rank        text,
  add column if not exists description text;

create or replace function public.save_call_sign(
  p_id uuid, p_silo public.silo, p_call_sign text, p_station text, p_section uuid,
  p_start time, p_stop time, p_break time, p_rank text, p_description text, p_active boolean default true
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v_id uuid;
  v_sign text := upper(regexp_replace(btrim(coalesce(p_call_sign, '')), '\s+', ' ', 'g'));
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  if not public.can_module('CSNM', p_silo, true) then
    raise exception 'You do not maintain call signs for %', public.department_label(p_silo) using errcode = '42501';
  end if;
  if length(v_sign) = 0 or length(v_sign) > 20 then raise exception 'A call sign is 1 to 20 characters' using errcode = '22023'; end if;
  if p_start is null or p_stop is null then raise exception 'Give the start and stop times' using errcode = '22023'; end if;
  if p_start = p_stop then raise exception 'Start and stop cannot be the same time' using errcode = '22023'; end if;
  if p_section is not null and not exists (
       select 1 from public.sections where id = p_section and tenant_id = me.tenant_id and silo = p_silo) then
    raise exception 'That section belongs to another department' using errcode = '22023';
  end if;
  if coalesce(p_active, true) and exists (
       select 1 from public.duty_posts d
        where d.tenant_id = me.tenant_id and d.silo = p_silo and d.active
          and upper(coalesce(d.call_sign, '')) = v_sign and d.id is distinct from p_id) then
    raise exception 'Call sign % is already in use', v_sign using errcode = '23505';
  end if;

  if p_id is null then
    insert into public.duty_posts (tenant_id, silo, name, call_sign, station, section_id, start_time, stop_time,
                                   break_time, rank, description, active)
    values (me.tenant_id, p_silo, v_sign, v_sign, nullif(upper(btrim(coalesce(p_station, ''))), ''), p_section,
            p_start, p_stop, p_break, nullif(btrim(coalesce(p_rank, '')), ''),
            nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.duty_posts
       set name = v_sign, call_sign = v_sign, station = nullif(upper(btrim(coalesce(p_station, ''))), ''),
           section_id = p_section, start_time = p_start, stop_time = p_stop, break_time = p_break,
           rank = nullif(btrim(coalesce(p_rank, '')), ''), description = nullif(btrim(coalesce(p_description, '')), ''),
           active = coalesce(p_active, active)
     where id = p_id and tenant_id = me.tenant_id and silo = p_silo
    returning id into v_id;
    if v_id is null then raise exception 'Call sign not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (me.tenant_id, p_silo, me.id, me.full_name, p_silo::text, 'CallSignSaved', 'call_sign', v_id::text,
          format('%s %s-%s', v_sign, to_char(p_start, 'HH24:MI'), to_char(p_stop, 'HH24:MI')));
  return v_id;
end $$;
revoke all on function public.save_call_sign(uuid, public.silo, text, text, uuid, time, time, time, text, text, boolean) from public, anon;
grant execute on function public.save_call_sign(uuid, public.silo, text, text, uuid, time, time, time, text, text, boolean) to authenticated;

-- ── 4. The member's record ──────────────────────────────────────────────────

alter table public.personnel
  add column if not exists persal_number   text,
  add column if not exists region          text,
  add column if not exists la_code         text,
  add column if not exists department_name text,
  add column if not exists section_id      uuid references public.sections (id) on delete set null,
  add column if not exists weekend_group   text,
  add column if not exists duty_allocation boolean not null default true,
  add column if not exists join_date       date,
  add column if not exists resign_date     date;
alter table public.personnel drop constraint if exists personnel_weekend_group_check;
alter table public.personnel add constraint personnel_weekend_group_check
  check (weekend_group is null or weekend_group in ('A', 'B'));

-- Personal details: only Staff Maintenance and the member themselves.
create table if not exists public.staff_private (
  personnel_id       uuid primary key references public.personnel (id) on delete cascade,
  tenant_id          uuid not null default public.current_tenant(),
  id_number          text,
  birth_date         date,
  address_1          text,
  address_2          text,
  address_3          text,
  address_4          text,
  post_code          text,
  phone              text,
  email              text,
  nok_name           text,
  nok_relation       text,
  nok_phone          text,
  nok_email          text,
  nok_address        text,
  emergency_name     text,
  emergency_relation text,
  emergency_phone    text,
  emergency_email    text,
  emergency_address  text,
  comments           text,
  updated_at         timestamptz not null default now(),
  updated_by_name    text
);
alter table public.staff_private enable row level security;

-- Law enforcement officer record: radio, warrant area, effective dates.
create table if not exists public.leo_records (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default public.current_tenant(),
  personnel_id    uuid not null references public.personnel (id) on delete cascade,
  radio           text,
  eff_from        date,
  eff_to          date,
  warrant_area    text,
  region          text,
  created_at      timestamptz not null default now(),
  created_by_name text
);
create index if not exists leo_records_person_idx on public.leo_records (personnel_id, eff_from desc);
alter table public.leo_records enable row level security;

/** Whether the signed-in person may read this member's private record. */
create or replace function public.can_read_staff(p_personnel uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.personnel pe
     where pe.id = p_personnel
       and (pe.user_id = auth.uid() or public.can_module('STFM', pe.silo)));
$$;
revoke all on function public.can_read_staff(uuid) from public, anon;
grant execute on function public.can_read_staff(uuid) to authenticated;

drop policy if exists staff_private_read on public.staff_private;
create policy staff_private_read on public.staff_private for select to authenticated
  using (public.can_read_staff(personnel_id));
drop policy if exists leo_records_read on public.leo_records;
create policy leo_records_read on public.leo_records for select to authenticated
  using (public.can_read_staff(personnel_id));
drop policy if exists tenant_isolation on public.staff_private;
create policy tenant_isolation on public.staff_private as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
drop policy if exists tenant_isolation on public.leo_records;
create policy tenant_isolation on public.leo_records as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());

/**
 * Save a member's record (p_personnel null adds a new member). Only the keys
 * given are changed; an empty value clears a field. Staff Maintenance Edit.
 */
create or replace function public.save_staff_record(
  p_personnel uuid, p_silo public.silo, p_fields jsonb, p_private jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v public.personnel;
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  pv jsonb := coalesce(p_private, '{}'::jsonb);
  v_section uuid;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;

  if p_personnel is null then
    if not public.can_module('STFM', p_silo, true) then
      raise exception 'You do not maintain staff for %', public.department_label(p_silo) using errcode = '42501';
    end if;
    if length(btrim(coalesce(f ->> 'first_name', ''))) = 0 or length(btrim(coalesce(f ->> 'last_name', ''))) = 0 then
      raise exception 'Give the forename and name' using errcode = '22023';
    end if;
    if length(btrim(coalesce(f ->> 'badge_number', ''))) = 0 then
      raise exception 'Give the staff number' using errcode = '22023';
    end if;
    insert into public.personnel (tenant_id, silo, first_name, last_name, badge_number, rank)
    values (me.tenant_id, p_silo, btrim(f ->> 'first_name'), btrim(f ->> 'last_name'),
            btrim(f ->> 'badge_number'), coalesce(nullif(btrim(f ->> 'rank'), ''), ''))
    returning * into v;
  else
    select * into v from public.personnel where id = p_personnel and tenant_id = me.tenant_id for update;
    if not found then raise exception 'Staff member not found' using errcode = 'P0002'; end if;
    if not public.can_module('STFM', v.silo, true) then
      raise exception 'You do not maintain staff for %', public.department_label(v.silo) using errcode = '42501';
    end if;
  end if;

  if f ? 'section_id' and nullif(f ->> 'section_id', '') is not null then
    select id into v_section from public.sections
     where id = (f ->> 'section_id')::uuid and tenant_id = me.tenant_id and silo = v.silo;
    if v_section is null then raise exception 'That section belongs to another department' using errcode = '22023'; end if;
  end if;
  if f ? 'weekend_group' and nullif(btrim(f ->> 'weekend_group'), '') is not null
     and upper(btrim(f ->> 'weekend_group')) not in ('A', 'B') then
    raise exception 'Weekend is A or B' using errcode = '22023';
  end if;
  if f ? 'first_name' and length(btrim(coalesce(f ->> 'first_name', ''))) = 0 then
    raise exception 'Give the forename' using errcode = '22023';
  end if;
  if f ? 'last_name' and length(btrim(coalesce(f ->> 'last_name', ''))) = 0 then
    raise exception 'Give the name' using errcode = '22023';
  end if;
  if f ? 'badge_number' and length(btrim(coalesce(f ->> 'badge_number', ''))) = 0 then
    raise exception 'Give the staff number' using errcode = '22023';
  end if;

  update public.personnel set
    first_name      = case when f ? 'first_name' then btrim(f ->> 'first_name') else first_name end,
    last_name       = case when f ? 'last_name' then btrim(f ->> 'last_name') else last_name end,
    badge_number    = case when f ? 'badge_number' then btrim(f ->> 'badge_number') else badge_number end,
    rank            = case when f ? 'rank' then coalesce(nullif(btrim(f ->> 'rank'), ''), '') else rank end,
    force_number    = case when f ? 'force_number' then nullif(btrim(f ->> 'force_number'), '') else force_number end,
    service_number  = case when f ? 'service_number' then nullif(btrim(f ->> 'service_number'), '') else service_number end,
    persal_number   = case when f ? 'persal_number' then nullif(btrim(f ->> 'persal_number'), '') else persal_number end,
    region          = case when f ? 'region' then nullif(btrim(f ->> 'region'), '') else region end,
    la_code         = case when f ? 'la_code' then nullif(btrim(f ->> 'la_code'), '') else la_code end,
    department_name = case when f ? 'department_name' then nullif(btrim(f ->> 'department_name'), '') else department_name end,
    station         = case when f ? 'station' then nullif(upper(btrim(f ->> 'station')), '') else station end,
    section_id      = case when f ? 'section_id' then v_section else section_id end,
    platoon         = case when f ? 'platoon' then nullif(upper(btrim(f ->> 'platoon')), '') else platoon end,
    weekend_group   = case when f ? 'weekend_group' then nullif(upper(btrim(f ->> 'weekend_group')), '') else weekend_group end,
    duty_allocation = case when f ? 'duty_allocation' then coalesce((f ->> 'duty_allocation')::boolean, true) else duty_allocation end,
    join_date       = case when f ? 'join_date' then nullif(f ->> 'join_date', '')::date else join_date end,
    resign_date     = case when f ? 'resign_date' then nullif(f ->> 'resign_date', '')::date else resign_date end,
    work_email      = case when f ? 'work_email' then nullif(btrim(f ->> 'work_email'), '') else work_email end,
    work_cellphone  = case when f ? 'work_cellphone' then nullif(btrim(f ->> 'work_cellphone'), '') else work_cellphone end,
    updated_at      = now()
  where id = v.id;

  if pv <> '{}'::jsonb then
    insert into public.staff_private (personnel_id, tenant_id) values (v.id, me.tenant_id)
    on conflict (personnel_id) do nothing;
    update public.staff_private set
      id_number          = case when pv ? 'id_number' then nullif(btrim(pv ->> 'id_number'), '') else id_number end,
      birth_date         = case when pv ? 'birth_date' then nullif(pv ->> 'birth_date', '')::date else birth_date end,
      address_1          = case when pv ? 'address_1' then nullif(btrim(pv ->> 'address_1'), '') else address_1 end,
      address_2          = case when pv ? 'address_2' then nullif(btrim(pv ->> 'address_2'), '') else address_2 end,
      address_3          = case when pv ? 'address_3' then nullif(btrim(pv ->> 'address_3'), '') else address_3 end,
      address_4          = case when pv ? 'address_4' then nullif(btrim(pv ->> 'address_4'), '') else address_4 end,
      post_code          = case when pv ? 'post_code' then nullif(btrim(pv ->> 'post_code'), '') else post_code end,
      phone              = case when pv ? 'phone' then nullif(btrim(pv ->> 'phone'), '') else phone end,
      email              = case when pv ? 'email' then nullif(btrim(pv ->> 'email'), '') else email end,
      nok_name           = case when pv ? 'nok_name' then nullif(btrim(pv ->> 'nok_name'), '') else nok_name end,
      nok_relation       = case when pv ? 'nok_relation' then nullif(btrim(pv ->> 'nok_relation'), '') else nok_relation end,
      nok_phone          = case when pv ? 'nok_phone' then nullif(btrim(pv ->> 'nok_phone'), '') else nok_phone end,
      nok_email          = case when pv ? 'nok_email' then nullif(btrim(pv ->> 'nok_email'), '') else nok_email end,
      nok_address        = case when pv ? 'nok_address' then nullif(btrim(pv ->> 'nok_address'), '') else nok_address end,
      emergency_name     = case when pv ? 'emergency_name' then nullif(btrim(pv ->> 'emergency_name'), '') else emergency_name end,
      emergency_relation = case when pv ? 'emergency_relation' then nullif(btrim(pv ->> 'emergency_relation'), '') else emergency_relation end,
      emergency_phone    = case when pv ? 'emergency_phone' then nullif(btrim(pv ->> 'emergency_phone'), '') else emergency_phone end,
      emergency_email    = case when pv ? 'emergency_email' then nullif(btrim(pv ->> 'emergency_email'), '') else emergency_email end,
      emergency_address  = case when pv ? 'emergency_address' then nullif(btrim(pv ->> 'emergency_address'), '') else emergency_address end,
      comments           = case when pv ? 'comments' then nullif(left(btrim(pv ->> 'comments'), 2000), '') else comments end,
      updated_at = now(), updated_by_name = me.full_name
    where personnel_id = v.id;
  end if;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (me.tenant_id, v.silo, me.id, me.full_name, v.silo::text,
          case when p_personnel is null then 'StaffAdded' else 'StaffUpdated' end, 'personnel', v.id::text,
          format('%s %s (%s)', v.first_name, v.last_name, v.badge_number));
  return v.id;
end $$;
revoke all on function public.save_staff_record(uuid, public.silo, jsonb, jsonb) from public, anon;
grant execute on function public.save_staff_record(uuid, public.silo, jsonb, jsonb) to authenticated;

create or replace function public.add_leo_record(
  p_personnel uuid, p_radio text, p_from date, p_to date, p_area text, p_region text
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v_silo public.silo;
  v_id uuid;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select silo into v_silo from public.personnel where id = p_personnel and tenant_id = me.tenant_id;
  if v_silo is null then raise exception 'Staff member not found' using errcode = 'P0002'; end if;
  if not public.can_module('STFM', v_silo, true) then
    raise exception 'You do not maintain staff for %', public.department_label(v_silo) using errcode = '42501';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'Eff to cannot be before eff from' using errcode = '22023';
  end if;
  insert into public.leo_records (tenant_id, personnel_id, radio, eff_from, eff_to, warrant_area, region, created_by_name)
  values (me.tenant_id, p_personnel, nullif(btrim(coalesce(p_radio, '')), ''), p_from, p_to,
          nullif(btrim(coalesce(p_area, '')), ''), nullif(btrim(coalesce(p_region, '')), ''), me.full_name)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.remove_leo_record(p_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v_silo public.silo;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select pe.silo into v_silo from public.leo_records l join public.personnel pe on pe.id = l.personnel_id
   where l.id = p_id and l.tenant_id = me.tenant_id;
  if v_silo is null then raise exception 'Record not found' using errcode = 'P0002'; end if;
  if not public.can_module('STFM', v_silo, true) then
    raise exception 'You do not maintain staff for %', public.department_label(v_silo) using errcode = '42501';
  end if;
  delete from public.leo_records where id = p_id;
end $$;
revoke all on function public.add_leo_record(uuid, text, date, date, text, text) from public, anon;
revoke all on function public.remove_leo_record(uuid) from public, anon;
grant execute on function public.add_leo_record(uuid, text, date, date, text, text) to authenticated;
grant execute on function public.remove_leo_record(uuid) to authenticated;

-- ── 5. Endorsements: numbered, issued by the office ─────────────────────────

create sequence if not exists public.endorsement_seq start 100001;
alter table public.endorsements
  add column if not exists seq            bigint default nextval('public.endorsement_seq'),
  add column if not exists code           text,
  add column if not exists issued_by_name text;

create or replace function public.issue_endorsement(
  p_user uuid, p_type text, p_code text, p_details text, p_start date, p_end date
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v_them record;
  v_id uuid;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select pr.id, pr.tenant_id, pr.silo, pr.full_name, pr.badge_number into v_them
    from public.profiles pr where pr.id = p_user and pr.deactivated_at is null;
  if not found or v_them.tenant_id <> me.tenant_id then
    raise exception 'That person has no active account here' using errcode = '22023';
  end if;
  if not public.can_module('ENTM', v_them.silo, true) then
    raise exception 'You do not issue endorsements for %', public.department_label(v_them.silo) using errcode = '42501';
  end if;
  if p_type not in ('Court Attendance', 'Special Event', 'Special Instruction', 'Restriction') then
    raise exception 'Choose the endorsement type' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_details, ''))) < 3 then
    raise exception 'Write the instruction' using errcode = '22023';
  end if;
  if p_start is null then raise exception 'Give the date' using errcode = '22023'; end if;
  if p_end is not null and p_end < p_start then
    raise exception 'The end date cannot be before the start' using errcode = '22023';
  end if;
  insert into public.endorsements (tenant_id, silo, user_id, employee_name, badge_number, type, code, details,
                                   start_date, end_date, is_active, created_by, issued_by_name)
  values (me.tenant_id, v_them.silo, p_user, v_them.full_name, v_them.badge_number, p_type,
          nullif(btrim(coalesce(p_code, '')), ''), left(btrim(p_details), 500), p_start,
          coalesce(p_end, case when p_type = 'Court Attendance' then p_start end), true, me.id::text, me.full_name)
  returning id into v_id;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (me.tenant_id, v_them.silo, me.id, me.full_name, v_them.silo::text, 'EndorsementIssued', 'endorsement',
          v_id::text, format('%s: %s %s', v_them.full_name, p_type, left(btrim(p_details), 200)));
  return v_id;
end $$;

create or replace function public.withdraw_endorsement(p_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v public.endorsements;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select * into v from public.endorsements where id = p_id and tenant_id = me.tenant_id;
  if not found then raise exception 'Endorsement not found' using errcode = 'P0002'; end if;
  if not public.can_module('ENTM', v.silo, true) then
    raise exception 'You do not issue endorsements for %', public.department_label(v.silo) using errcode = '42501';
  end if;
  update public.endorsements set is_active = false where id = p_id;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (me.tenant_id, v.silo, me.id, me.full_name, v.silo::text, 'EndorsementWithdrawn', 'endorsement', p_id::text,
          format('%s: %s', coalesce(v.employee_name, ''), v.type));
end $$;
revoke all on function public.issue_endorsement(uuid, text, text, text, date, date) from public, anon;
revoke all on function public.withdraw_endorsement(uuid) from public, anon;
grant execute on function public.issue_endorsement(uuid, text, text, text, date, date) to authenticated;
grant execute on function public.withdraw_endorsement(uuid) to authenticated;

-- ── 6. Absence codes ────────────────────────────────────────────────────────
-- The LeaveType list (Admin → Configuration) is the absence code register:
-- code = Oracle code, name = what members see, detail2 = 'Office' when only
-- the office captures it, detail3 = entitlement days.

update public.command_records c set code = v.code
  from (values ('Annual', 'AL'), ('Sick', 'SL'), ('Family Responsibility', 'FR'), ('Study', 'ST'),
               ('Maternity/Paternity', 'MT'), ('Unpaid', 'UL'), ('Special', 'SP')) as v(name, code)
 where c.module = 'LeaveType' and c.name = v.name and c.code is null;

insert into public.command_records (tenant_id, silo, module, code, name, detail2, status, created_by)
select t.id, 'Ethekwini', 'LeaveType', v.code, v.name, v.office, 'Active', 'Absence codes (0085)'
  from public.tenants t
  cross join (values
    ('AW', 'AWOL', 'Office'),
    ('CL', 'Compassionate', null),
    ('CO', 'Course', 'Office'),
    ('EL', 'Exam', null),
    ('ES', 'Half exam, half study', null),
    ('HD', 'Half day', null),
    ('IO', 'Injury on duty (IOD)', 'Office'),
    ('LD', 'Light duties', 'Office'),
    ('SU', 'Suspended from duty', 'Office'),
    ('L1', 'One day', null)
  ) as v(code, name, office)
 where exists (select 1 from public.command_records c where c.tenant_id = t.id and c.module = 'LeaveType')
   and not exists (select 1 from public.command_records c
                    where c.tenant_id = t.id and c.module = 'LeaveType' and (c.code = v.code or c.name = v.name));

-- Members ask only for codes that are not office-only.
create or replace function public.leave_type_ok(p_tenant uuid, p_name text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select case
    when exists (select 1 from public.command_records c
                  where c.tenant_id = p_tenant and c.module = 'LeaveType' and c.status = 'Active')
      then exists (select 1 from public.command_records c
                    where c.tenant_id = p_tenant and c.module = 'LeaveType' and c.status = 'Active'
                      and c.name = p_name and coalesce(c.detail2, '') <> 'Office')
    else p_name in ('Annual', 'Sick', 'Family Responsibility', 'Maternity/Paternity', 'Study', 'Special', 'Unpaid')
  end;
$$;

create or replace function public.save_absence_code(
  p_id uuid, p_code text, p_name text, p_office_only boolean, p_entitlement integer, p_active boolean default true
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v_id uuid;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  if not public.can_module('ABSM', null, true) then
    raise exception 'You do not maintain absence codes' using errcode = '42501';
  end if;
  if v_code !~ '^[A-Z0-9]{1,3}$' then raise exception 'An absence code is 1 to 3 letters or digits' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Describe the absence' using errcode = '22023'; end if;
  if p_entitlement is not null and (p_entitlement < 0 or p_entitlement > 366) then
    raise exception 'Days a year are 0 to 366' using errcode = '22023';
  end if;
  if exists (select 1 from public.command_records c
              where c.tenant_id = me.tenant_id and c.module = 'LeaveType' and c.id is distinct from p_id
                and (upper(coalesce(c.code, '')) = v_code or c.name = btrim(p_name))) then
    raise exception 'Code % or that description is already used', v_code using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.command_records (tenant_id, silo, module, code, name, detail2, detail3, status, created_by)
    values (me.tenant_id, 'Ethekwini', 'LeaveType', v_code, btrim(p_name),
            case when p_office_only then 'Office' end, p_entitlement::text,
            case when coalesce(p_active, true) then 'Active' else 'Inactive' end, me.full_name)
    returning id into v_id;
  else
    update public.command_records
       set code = v_code, name = btrim(p_name), detail2 = case when p_office_only then 'Office' end,
           detail3 = p_entitlement::text,
           status = case when coalesce(p_active, true) then 'Active' else 'Inactive' end
     where id = p_id and tenant_id = me.tenant_id and module = 'LeaveType'
    returning id into v_id;
    if v_id is null then raise exception 'Absence code not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (me.tenant_id, me.silo, me.id, me.full_name, me.silo::text, 'AbsenceCodeSaved', 'absence_code', v_id::text,
          format('%s %s', v_code, btrim(p_name)));
  return v_id;
end $$;
revoke all on function public.save_absence_code(uuid, text, text, boolean, integer, boolean) from public, anon;
grant execute on function public.save_absence_code(uuid, text, text, boolean, integer, boolean) to authenticated;

-- ── 7. Leave captured by the office ─────────────────────────────────────────

create sequence if not exists public.leave_seq start 500001;
alter table public.leave_entries
  add column if not exists absence_code     text,
  add column if not exists form_submitted   boolean not null default false,
  add column if not exists captured_by      uuid,
  add column if not exists captured_by_name text;

-- Those who maintain leave read it, as those who roster do.
drop policy if exists leave_office_read on public.leave_entries;
create policy leave_office_read on public.leave_entries for select to authenticated
  using (public.can_module('LEAM', silo));

/** What leave costs (as leave_days, 0072), for the office's own capture: no caller check here, callers check. */
create or replace function public.leave_days_office(p_tenant uuid, p_user uuid, p_from date, p_to date)
returns numeric
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_last date;
  v_rostered int := 0;
  v_working int := 0;
begin
  if p_to < p_from then return 0; end if;
  select max(duty_date) into v_last from public.rosters
   where tenant_id = p_tenant and user_id = p_user and cancelled_at is null and duty_date >= p_from;
  if v_last is not null then
    select count(distinct duty_date) into v_rostered from public.rosters
     where tenant_id = p_tenant and user_id = p_user and cancelled_at is null
       and duty_date between p_from and least(p_to, v_last);
  end if;
  select count(*) into v_working
    from generate_series(greatest(p_from, coalesce(v_last + 1, p_from)), p_to, interval '1 day') d
   where extract(isodow from d) < 6
     and not exists (select 1 from public.public_holidays h where h.tenant_id = p_tenant and h.day = d::date);
  return v_rostered + v_working;
end $$;
revoke all on function public.leave_days_office(uuid, uuid, date, date) from public, anon, authenticated;

/** The roster status a captured absence puts on the member's duty. */
create or replace function public.absence_duty_status(p_code text) returns text
language sql immutable as $$
  select case upper(coalesce(p_code, ''))
    when 'SL' then 'Sick' when 'FR' then 'Family Responsibility'
    when 'AW' then 'Absent' when 'SU' then 'Absent'
    else 'Leave' end;
$$;

/**
 * The office captures leave or an absence for a member, from the form they
 * handed in. It stands as captured (approved) and marks their duty in those
 * dates. Maintain Leave Edit; never your own.
 */
create or replace function public.capture_leave(
  p_user uuid, p_code text, p_from date, p_to date, p_form_submitted boolean, p_notes text default null
) returns public.leave_entries
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v_them record;
  v_type record;
  v public.leave_entries;
  v_today date := public.sa_day(now());
  v_overlap text;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  if p_user = me.id then raise exception 'Someone else captures your own leave' using errcode = '42501'; end if;
  select pr.id, pr.tenant_id, pr.silo, pr.full_name into v_them
    from public.profiles pr where pr.id = p_user and pr.deactivated_at is null;
  if not found or v_them.tenant_id <> me.tenant_id then
    raise exception 'That person has no active account here' using errcode = '22023';
  end if;
  if not public.can_module('LEAM', v_them.silo, true) then
    raise exception 'You do not maintain leave for %', public.department_label(v_them.silo) using errcode = '42501';
  end if;
  select c.code, c.name into v_type from public.command_records c
   where c.tenant_id = me.tenant_id and c.module = 'LeaveType' and c.status = 'Active'
     and upper(coalesce(c.code, '')) = upper(btrim(coalesce(p_code, '')))
   limit 1;
  if not found then raise exception 'Choose an absence code from the list' using errcode = '22023'; end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'The last day cannot be before the first' using errcode = '22023';
  end if;
  if p_from < v_today - 92 or p_to > v_today + 400 or p_to - p_from > 365 then
    raise exception 'Capture leave from three months back to a year ahead' using errcode = '22023';
  end if;
  select format('%s already has %s leave from %s to %s.', coalesce(v_them.full_name, 'They'), lower(l.status),
                to_char(l.eff_from, 'DD Mon'), to_char(l.eff_to, 'DD Mon YYYY'))
    into v_overlap
    from public.leave_entries l
   where l.user_id = p_user and l.status in ('Pending', 'Approved') and l.eff_from <= p_to and l.eff_to >= p_from
   limit 1;
  if v_overlap is not null then raise exception '%', v_overlap using errcode = 'P0001'; end if;

  insert into public.leave_entries (
    tenant_id, silo, user_id, leave_seq, eff_from, eff_to, absence, absence_code, status, reason,
    approved_by, approved_at, decided_by, applicant_name, applied_at, days,
    form_submitted, captured_by, captured_by_name
  ) values (
    me.tenant_id, v_them.silo, p_user, nextval('public.leave_seq')::text, p_from, p_to, v_type.name, v_type.code,
    'Approved', nullif(left(btrim(coalesce(p_notes, '')), 1000), ''),
    me.full_name, now(), me.id, v_them.full_name, now(),
    public.leave_days_office(me.tenant_id, p_user, p_from, p_to),
    coalesce(p_form_submitted, false), me.id, me.full_name
  ) returning * into v;

  perform set_config('criticom.roster_quiet', 'on', true);
  update public.rosters set status = public.absence_duty_status(v_type.code), leave_id = v.id
   where tenant_id = me.tenant_id and user_id = p_user
     and duty_date between p_from and p_to
     and public.roster_active(status, cancelled_at);
  update public.shift_swaps s set status = 'Withdrawn'
   where s.status in ('Requested', 'Accepted')
     and exists (select 1 from public.rosters r where r.id in (s.requester_line, s.partner_line) and r.leave_id = v.id);
  perform set_config('criticom.roster_quiet', 'off', true);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (me.tenant_id, v_them.silo, me.id, me.full_name, v_them.silo::text, 'LeaveCaptured', 'leave', v.id::text,
          format('%s: %s %s %s to %s, form %s', v_them.full_name, v_type.code, v_type.name, p_from, p_to,
                 case when v.form_submitted then 'submitted' else 'outstanding' end));
  perform public.schedule_alert(me.tenant_id, v_them.silo, p_user, 'leave_decision', 'Leave captured',
    format('%s, %s to %s.', v_type.name, to_char(p_from, 'DD Mon'), to_char(p_to, 'DD Mon YYYY')), 'Low', '/leave');
  return v;
end $$;

/** Mark whether the member's leave form has been handed in. */
create or replace function public.set_leave_form(p_id uuid, p_submitted boolean) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v public.leave_entries;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select * into v from public.leave_entries where id = p_id and tenant_id = me.tenant_id;
  if not found then raise exception 'Leave not found' using errcode = 'P0002'; end if;
  if not public.can_module('LEAM', v.silo, true) then
    raise exception 'You do not maintain leave for %', public.department_label(v.silo) using errcode = '42501';
  end if;
  update public.leave_entries set form_submitted = coalesce(p_submitted, false) where id = p_id;
end $$;
revoke all on function public.capture_leave(uuid, text, date, date, boolean, text) from public, anon;
revoke all on function public.set_leave_form(uuid, boolean) from public, anon;
grant execute on function public.capture_leave(uuid, text, date, date, boolean, text) to authenticated;
grant execute on function public.set_leave_form(uuid, boolean) to authenticated;

-- ── 8. Duty allocation and maintenance ──────────────────────────────────────

/**
 * Book a section's call signs for a date range: p_lines is
 * [{ "post_id": uuid, "user_id": uuid }, ...]. Each pair works every day in
 * the range at the call sign's times (or p_start / p_end when given). A day a
 * member cannot work (leave, court, another shift) is left out with the
 * reason. Shifts are issued at once; each member is told once. Booking the
 * same call sign for the same member and day again adds nothing.
 */
create or replace function public.allocate_duty(
  p_section uuid, p_from date, p_to date, p_lines jsonb,
  p_start time default null, p_end time default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v_sec public.sections;
  e jsonb;
  v_post public.duty_posts;
  v_person record;
  d date;
  v_start timestamptz;
  v_end timestamptz;
  v_created int := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_told jsonb := '{}'::jsonb;
  v_user uuid;
  k text;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select * into v_sec from public.sections where id = p_section and tenant_id = me.tenant_id;
  if not found then raise exception 'Choose the section' using errcode = '22023'; end if;
  if not public.can_module('DUTA', v_sec.silo, true) then
    raise exception 'You do not allocate duty for %', public.department_label(v_sec.silo) using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Duty to cannot be before duty from' using errcode = '22023';
  end if;
  if p_to - p_from > 62 then raise exception 'Allocate up to two months at a time' using errcode = '22023'; end if;
  if p_from < public.sa_day(now()) - 1 or p_to > public.sa_day(now()) + 400 then
    raise exception 'Allocate from today to a year ahead' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Pair at least one call sign with a member' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 200 then raise exception 'Up to 200 pairs at a time' using errcode = '22023'; end if;

  perform set_config('criticom.roster_quiet', 'on', true);
  for e in select * from jsonb_array_elements(p_lines) loop
    select * into v_post from public.duty_posts
     where id = (e ->> 'post_id')::uuid and tenant_id = me.tenant_id and silo = v_sec.silo and active;
    if not found then raise exception 'A call sign is not available in this department' using errcode = '22023'; end if;
    if coalesce(p_start, v_post.start_time) is null or coalesce(p_end, v_post.stop_time) is null then
      raise exception 'Call sign % has no start and stop time', v_post.call_sign using errcode = '22023';
    end if;
    v_user := (e ->> 'user_id')::uuid;
    select pr.full_name, pr.silo, pe.duty_allocation, pe.station, pe.platoon into v_person
      from public.profiles pr left join public.personnel pe on pe.user_id = pr.id
     where pr.id = v_user and pr.tenant_id = me.tenant_id and pr.deactivated_at is null
     limit 1;
    if not found or v_person.silo is distinct from v_sec.silo then
      raise exception 'A member is not in %', public.department_label(v_sec.silo) using errcode = '22023';
    end if;
    if v_person.duty_allocation is false then
      v_skipped := v_skipped || jsonb_build_object('name', v_person.full_name, 'call_sign', v_post.call_sign,
                     'day', p_from, 'reason', 'Not for duty allocation (staff record says N)');
      continue;
    end if;

    for d in select generate_series(p_from, p_to, interval '1 day')::date loop
      v_start := (d + coalesce(p_start, v_post.start_time)) at time zone 'Africa/Johannesburg';
      v_end := (d + coalesce(p_end, v_post.stop_time)) at time zone 'Africa/Johannesburg';
      if v_end <= v_start then v_end := v_end + interval '1 day'; end if;
      if exists (select 1 from public.rosters r
                  where r.tenant_id = me.tenant_id and r.user_id = v_user and r.post_id = v_post.id
                    and r.start_at = v_start and public.roster_active(r.status, r.cancelled_at)) then
        continue;
      end if;
      begin
        insert into public.rosters (
          tenant_id, silo, user_id, user_name, station, activity_type, start_at, end_at,
          post_id, post, call_sign, sector, shift_group_code, special_instructions,
          published, published_at, status, created_by_supervisor_id, created_by_supervisor_name
        ) values (
          me.tenant_id, v_sec.silo, v_user, coalesce(v_person.full_name, ''),
          coalesce(nullif(v_post.station, ''), v_sec.station_code, v_person.station, ''),
          v_sec.name, v_start, v_end, v_post.id, v_post.call_sign, v_post.call_sign, v_sec.code,
          v_person.platoon, nullif(btrim(coalesce(p_note, '')), ''),
          true, now(), 'Present', me.id::text, me.full_name
        );
        v_created := v_created + 1;
        k := v_user::text;
        v_told := jsonb_set(v_told, array[k], to_jsonb(coalesce((v_told ->> k)::int, 0) + 1));
      exception when others then
        v_skipped := v_skipped || jsonb_build_object('name', v_person.full_name, 'call_sign', v_post.call_sign,
                       'day', d, 'reason', sqlerrm);
      end;
    end loop;
  end loop;
  perform set_config('criticom.roster_quiet', 'off', true);

  for k in select jsonb_object_keys(v_told) loop
    if k::uuid is distinct from me.id then
      perform public.schedule_alert(me.tenant_id, v_sec.silo, k::uuid, 'shift_published',
        format('Duty allocated: %s shift%s', v_told ->> k, case when (v_told ->> k)::int = 1 then '' else 's' end),
        format('%s, %s to %s. Open My Schedule to confirm.', v_sec.name,
               to_char(p_from, 'DD Mon'), to_char(p_to, 'DD Mon YYYY')));
    end if;
  end loop;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (me.tenant_id, v_sec.silo, me.id, me.full_name, v_sec.silo::text, 'DutyAllocated', 'section', v_sec.id::text,
          format('%s %s to %s: %s shift(s), %s left out', v_sec.code, p_from, p_to, v_created, jsonb_array_length(v_skipped)));
  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end $$;
revoke all on function public.allocate_duty(uuid, date, date, jsonb, time, time, text) from public, anon;
grant execute on function public.allocate_duty(uuid, date, date, jsonb, time, time, text) to authenticated;

/**
 * Duty maintenance: change one duty's call sign, member or times. A duty that
 * has started keeps its member and times; only its call sign can change.
 */
create or replace function public.change_duty(
  p_line uuid, p_post uuid, p_user uuid, p_start timestamptz, p_end timestamptz
) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v public.rosters;
  v_post public.duty_posts;
  v_name text;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select * into v from public.rosters where id = p_line and tenant_id = me.tenant_id for update;
  if not found then raise exception 'Duty not found' using errcode = 'P0002'; end if;
  if not public.can_module('DUTM', v.silo, true) then
    raise exception 'You do not maintain duty for %', public.department_label(v.silo) using errcode = '42501';
  end if;
  if v.cancelled_at is not null then raise exception 'This duty was cancelled' using errcode = '22023'; end if;
  if p_post is not null then
    select * into v_post from public.duty_posts where id = p_post and tenant_id = me.tenant_id and silo = v.silo and active;
    if not found then raise exception 'That call sign is not available' using errcode = '22023'; end if;
  end if;
  if v.start_at <= now() and (
       (p_user is not null and p_user is distinct from v.user_id)
       or (p_start is not null and p_start is distinct from v.start_at)
       or (p_end is not null and p_end is distinct from v.end_at)) then
    raise exception 'This duty has started. Only its call sign can change.' using errcode = '42501';
  end if;
  if p_user is not null and p_user is distinct from v.user_id then
    select full_name into v_name from public.profiles where id = p_user and tenant_id = me.tenant_id and deactivated_at is null;
  end if;

  update public.rosters set
    post_id   = coalesce(v_post.id, post_id),
    post      = coalesce(v_post.call_sign, post),
    call_sign = coalesce(v_post.call_sign, call_sign),
    station   = coalesce(nullif(v_post.station, ''), station),
    user_id   = coalesce(p_user, user_id),
    user_name = coalesce(v_name, user_name),
    start_at  = coalesce(p_start, start_at),
    end_at    = coalesce(p_end, end_at)
  where id = p_line;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (me.tenant_id, v.silo, me.id, me.full_name, v.silo::text, 'DutyChanged', 'roster', p_line::text,
          format('%s %s: call sign %s, member %s', v.user_name, to_char(v.start_at at time zone 'Africa/Johannesburg', 'DD Mon HH24:MI'),
                 coalesce(v_post.call_sign, v.call_sign, '-'), coalesce(v_name, v.user_name)));
end $$;
revoke all on function public.change_duty(uuid, uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.change_duty(uuid, uuid, uuid, timestamptz, timestamptz) to authenticated;

-- ── 9. Duties for operation: the operations a sheet is printed for ──────────

-- Whoever prints the parade sheet sees who signed on and off in the app.
drop policy if exists shift_attendance_office_read on public.shift_attendance;
create policy shift_attendance_office_read on public.shift_attendance for select to authenticated
  using (public.can_module('DUTR', silo));

insert into public.command_records (tenant_id, silo, module, code, name, status, created_by)
select t.id, 'MetroPolice', 'DutyOperation', v.code, v.name, 'Active', 'Duty office (0085)'
  from public.tenants t
  cross join (values ('X1', 'Bylaws Enforcement'), ('X2', 'Patrol'), ('X3', 'Special Operations')) as v(code, name)
 where not exists (select 1 from public.command_records c
                    where c.tenant_id = t.id and c.module = 'DutyOperation' and c.code = v.code);

-- ── 10. Nothing for strangers ───────────────────────────────────────────────

revoke all on public.module_access, public.module_access_seeded, public.stations,
              public.staff_private, public.leo_records from anon;
revoke insert, update, delete on public.module_access, public.module_access_seeded, public.stations,
              public.staff_private, public.leo_records from authenticated;
grant select on public.module_access, public.stations, public.staff_private, public.leo_records to authenticated;

-- Prove it: every new table refuses anon and has row rules on.
do $$
declare t text;
begin
  foreach t in array array['module_access', 'module_access_seeded', 'stations', 'staff_private', 'leo_records'] loop
    if has_table_privilege('anon', 'public.' || t, 'select') then
      raise exception '0085: anon can read %', t;
    end if;
    if has_table_privilege('authenticated', 'public.' || t, 'insert') then
      raise exception '0085: % takes direct writes', t;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception '0085: row rules are off on %', t;
    end if;
  end loop;
end $$;


notify pgrst, 'reload schema';
