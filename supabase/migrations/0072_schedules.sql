-- ============================================================================
-- 0072 — Schedules: who works when, who sets it, and who is late
-- ============================================================================
--
-- Run after 0071.
--
-- One roster for every department. A roster line (public.rosters) is one
-- person on one shift, with a start and an end; the post, vehicle and call
-- sign are details of the line. Everything below is enforced here, so the
-- console, the phone and any future screen obey the same rules.
--
-- WHO SETS WHAT (schedule_rank):
--   5  SuperAdmin                        the platform
--   4  SystemAdmin, SystemController     the organisation (HR): public holidays,
--                                        every department
--   3  Admin                             their department: shift types,
--                                        rotations, late and no-show minutes
--   2  Captain, FireChief                their department's roster and people
--   1  Supervisor                        their department's roster and people
--   0  everyone else                     their own schedule
--
--   Rostering needs rank 1+ in the department (4+ anywhere). Deciding about a
--   person — their leave, excusing their lateness, changing a shift that has
--   started — needs a higher rank than theirs, in their department, and is
--   never done to yourself. Organisation HR (rank 4) may decide for one another.
--
-- WHAT EACH PERSON SEES:
--   their own published shifts, attendance and leave; their department's
--   published shifts (who is on, who is off — never why); people who roster
--   the department see drafts, attendance and leave; nobody else does.
--
-- THE SHIFT, START TO FINISH:
--   generate_roster() from a rotation (drafts) → publish_roster() (one alert
--   per person) → the person confirms → going on duty in the app, or Start
--   shift on the console, checks them in → not checked in at start + grace:
--   "late" to them and to whoever oversees them; at start + no-show minutes:
--   "not started" to command as well → a senior records why
--   (record_shift_outcome). Every change to an issued shift tells the person,
--   and every change is logged in roster_changes.
--
-- LEAVE: requested by the person (checked: dates, type, overlap; the days it
-- costs are counted from their roster), decided by someone senior with a
-- reason when refused (decide_leave), cancelled by the person before it
-- starts or by someone senior (cancel_leave). Approval marks their shifts as
-- on leave; cancelling gives them back.
--
-- SWAPS: one person offers their shift for a colleague's, the colleague
-- accepts, someone senior to both approves, and the shifts change hands.
--
-- Alerts about a person's schedule are also pushed to their phone, when
-- pg_net is available (the phone schedules its own shift reminders).
--
-- Fixes on the way: members could read draft rosters and edit any field of
-- their own line; leave could be decided by any supervisor of any
-- department, including their own; captains, chiefs and department admins
-- could not roster; deactivating an account left its future shifts in place;
-- a clock-in could be dated at will.
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. Authority ────────────────────────────────────────────────────────────

create or replace function public.schedule_rank(p_role public.user_role) returns integer
language sql immutable as $$
  select case p_role::text
    when 'SuperAdmin' then 5
    when 'SystemAdmin' then 4 when 'SystemController' then 4
    when 'Admin' then 3
    when 'Captain' then 2 when 'FireChief' then 2
    when 'Supervisor' then 1
    else 0 end;
$$;

/** The South African calendar day of an instant. */
create or replace function public.sa_day(p_at timestamptz) returns date
language sql stable as $$ select (p_at at time zone 'Africa/Johannesburg')::date $$;

/** Whether a shift's status means the person is working it. */
create or replace function public.roster_active(p_status text, p_cancelled timestamptz) returns boolean
language sql immutable as $$
  select p_cancelled is null
     and coalesce(p_status, '') not in ('Leave', 'Cancelled', 'Absent', 'Sick', 'Family Responsibility');
$$;

/** The signed-in person's rank; 0 when signed out or deactivated. */
create or replace function public.schedule_actor_rank() returns integer
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select public.schedule_rank(p.role) from public.profiles p
                    where p.id = auth.uid() and p.deactivated_at is null), 0);
$$;

/** Builds and changes this department's roster. */
create or replace function public.can_manage_roster(p_silo public.silo) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.deactivated_at is null
       and public.schedule_rank(p.role) >= 1
       and (public.schedule_rank(p.role) >= 4 or p.silo = p_silo)
  );
$$;

/** Sets up this department's shift types, rotations and minutes. */
create or replace function public.can_admin_schedule(p_silo public.silo) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.deactivated_at is null
       and (public.schedule_rank(p.role) >= 4
            or (public.schedule_rank(p.role) = 3 and p.silo = p_silo))
  );
$$;

/**
 * Whether the signed-in person may decide about this person: senior to them,
 * in their department (organisation HR anywhere), and never themselves.
 */
create or replace function public.outranks(p_user uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.profiles me
      join public.profiles them on them.id = p_user
     where me.id = auth.uid() and me.deactivated_at is null
       and me.id <> them.id and me.tenant_id = them.tenant_id
       and public.schedule_rank(me.role) >= 1
       and (public.schedule_rank(me.role) > public.schedule_rank(them.role)
            or (public.schedule_rank(me.role) >= 4 and public.schedule_rank(them.role) >= 4))
       and (public.schedule_rank(me.role) >= 4 or me.silo = them.silo)
  );
$$;

revoke all on function public.schedule_actor_rank() from public, anon;
revoke all on function public.can_manage_roster(public.silo) from public, anon;
revoke all on function public.can_admin_schedule(public.silo) from public, anon;
revoke all on function public.outranks(uuid) from public, anon;
grant execute on function public.schedule_actor_rank() to authenticated;
grant execute on function public.can_manage_roster(public.silo) to authenticated;
grant execute on function public.can_admin_schedule(public.silo) to authenticated;
grant execute on function public.outranks(uuid) to authenticated;

-- ── 2. A department's set-up ────────────────────────────────────────────────

create table if not exists public.schedule_settings (
  tenant_id       uuid not null default public.current_tenant(),
  silo            public.silo not null,
  -- Not checked in this long after the start: late.
  grace_minutes   integer not null default 10 check (grace_minutes between 0 and 120),
  -- Not checked in this long after the start: not started, and command is told.
  noshow_minutes  integer not null default 60 check (noshow_minutes between 15 and 480),
  updated_by      uuid,
  updated_by_name text,
  updated_at      timestamptz not null default now(),
  primary key (tenant_id, silo),
  check (noshow_minutes > grace_minutes)
);

create table if not exists public.shift_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant(),
  silo        public.silo not null,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  -- Shown in the roster grid: D, N, 24, O.
  code        text not null check (char_length(btrim(code)) between 1 and 4),
  start_time  time not null,
  minutes     integer not null check (minutes between 30 and 1560),
  colour      text not null default '#3b82f6' check (colour ~ '^#[0-9a-fA-F]{6}$'),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (tenant_id, silo, name)
);

-- A rotation is a cycle of days, each a shift type or a day off, that every
-- team works from its own starting point. The 224: D D N N - - - -, teams
-- A to D two days apart. The 24-48: 24 - -, Red, Blue and Green a day apart.
-- Team t is on day ((date - anchor) - offset[t]) mod length of the cycle,
-- exactly as V4's generator counted.
create table if not exists public.rotations (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null default public.current_tenant(),
  silo                 public.silo not null,
  name                 text not null check (char_length(btrim(name)) between 1 and 60),
  cycle                uuid[] not null,
  teams                text[] not null,
  offsets              integer[] not null,
  anchor               date not null,
  skip_public_holidays boolean not null default false,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  unique (tenant_id, silo, name)
);

create table if not exists public.public_holidays (
  tenant_id uuid not null default public.current_tenant(),
  day       date not null,
  name      text not null check (char_length(btrim(name)) between 1 and 60),
  primary key (tenant_id, day)
);

create or replace function public.rotation_guard() returns trigger
language plpgsql set search_path to 'public' as $$
declare
  v_len int := coalesce(array_length(new.cycle, 1), 0);
  v_teams int := coalesce(array_length(new.teams, 1), 0);
  v_bad int;
begin
  if v_len < 1 or v_len > 56 then
    raise exception 'A rotation is 1 to 56 days long' using errcode = '22023';
  end if;
  if not exists (select 1 from unnest(new.cycle) c where c is not null) then
    raise exception 'A rotation needs at least one working day' using errcode = '22023';
  end if;
  if v_teams < 1 or v_teams > 12 or v_teams <> coalesce(array_length(new.offsets, 1), 0) then
    raise exception 'Give every team (1 to 12) its own starting day' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(new.teams) t where t is null or char_length(btrim(t)) not between 1 and 20)
     or (select count(distinct lower(btrim(t))) from unnest(new.teams) t) <> v_teams then
    raise exception 'Team names are 1 to 20 characters and different from one another' using errcode = '22023';
  end if;
  select count(*) into v_bad from unnest(new.cycle) c
   where c is not null
     and not exists (select 1 from public.shift_templates s
                      where s.id = c and s.tenant_id = new.tenant_id and s.silo = new.silo);
  if v_bad > 0 then
    raise exception 'A rotation uses only this department''s shift types' using errcode = '22023';
  end if;
  new.teams := array(select btrim(t) from unnest(new.teams) t);
  return new;
end $$;

drop trigger if exists rotation_guard on public.rotations;
create trigger rotation_guard before insert or update on public.rotations
  for each row execute function public.rotation_guard();

alter table public.schedule_settings enable row level security;
alter table public.shift_templates enable row level security;
alter table public.rotations enable row level security;
alter table public.public_holidays enable row level security;

do $$
declare t text;
begin
  foreach t in array array['schedule_settings', 'shift_templates', 'rotations', 'public_holidays'] loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I as restrictive for all to authenticated '
      || 'using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant())', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

drop policy if exists schedule_settings_write on public.schedule_settings;
create policy schedule_settings_write on public.schedule_settings for all to authenticated
  using (public.can_admin_schedule(silo)) with check (public.can_admin_schedule(silo));
drop policy if exists shift_templates_write on public.shift_templates;
create policy shift_templates_write on public.shift_templates for all to authenticated
  using (public.can_admin_schedule(silo)) with check (public.can_admin_schedule(silo));
drop policy if exists rotations_write on public.rotations;
create policy rotations_write on public.rotations for all to authenticated
  using (public.can_admin_schedule(silo)) with check (public.can_admin_schedule(silo));
-- Public holidays are organisation HR's.
drop policy if exists public_holidays_write on public.public_holidays;
create policy public_holidays_write on public.public_holidays for all to authenticated
  using (public.schedule_actor_rank() >= 4) with check (public.schedule_actor_rank() >= 4);

-- Starting points every department can change: V4's two rotations, and
-- office hours for Disaster Management.
do $$
declare
  t record;
  s public.silo;
  v_day uuid; v_night uuid; v_24 uuid; v_office uuid;
begin
  for t in select id from public.tenants loop
    foreach s in array array['MetroPolice', 'Medical', 'Ethekwini']::public.silo[] loop
      if not exists (select 1 from public.shift_templates where tenant_id = t.id and silo = s) then
        insert into public.shift_templates (tenant_id, silo, name, code, start_time, minutes, colour, sort_order)
        values (t.id, s, 'Day shift', 'D', case when s = 'Medical' then time '07:00' else time '06:00' end, 720, '#f59e0b', 1)
        returning id into v_day;
        insert into public.shift_templates (tenant_id, silo, name, code, start_time, minutes, colour, sort_order)
        values (t.id, s, 'Night shift', 'N', case when s = 'Medical' then time '19:00' else time '18:00' end, 720, '#6366f1', 2)
        returning id into v_night;
        insert into public.rotations (tenant_id, silo, name, cycle, teams, offsets, anchor)
        values (t.id, s, '224: 2 days, 2 nights, 4 off',
                array[v_day, v_day, v_night, v_night, null, null, null, null]::uuid[],
                array['A', 'B', 'C', 'D'], array[0, 2, 4, 6], date '2026-01-01');
      end if;
    end loop;

    if not exists (select 1 from public.shift_templates where tenant_id = t.id and silo = 'MetroFire') then
      insert into public.shift_templates (tenant_id, silo, name, code, start_time, minutes, colour, sort_order)
      values (t.id, 'MetroFire', '24-hour shift', '24', time '08:00', 1440, '#ef4444', 1)
      returning id into v_24;
      insert into public.rotations (tenant_id, silo, name, cycle, teams, offsets, anchor)
      values (t.id, 'MetroFire', '24-48: 24 hours on, 48 off', array[v_24, null, null]::uuid[],
              array['Red', 'Blue', 'Green'], array[0, 1, 2], date '2026-01-01');
    end if;

    if not exists (select 1 from public.shift_templates where tenant_id = t.id and silo = 'EthekwiniDisaster') then
      insert into public.shift_templates (tenant_id, silo, name, code, start_time, minutes, colour, sort_order)
      values (t.id, 'EthekwiniDisaster', 'Office hours', 'O', time '08:00', 510, '#10b981', 1)
      returning id into v_office;
      insert into public.shift_templates (tenant_id, silo, name, code, start_time, minutes, colour, sort_order)
      values (t.id, 'EthekwiniDisaster', 'Standby', 'S', time '16:30', 930, '#64748b', 2);
      -- Anchored on a Monday: Monday to Friday, weekends and public holidays off.
      insert into public.rotations (tenant_id, silo, name, cycle, teams, offsets, anchor, skip_public_holidays)
      values (t.id, 'EthekwiniDisaster', 'Office hours: Monday to Friday',
              array[v_office, v_office, v_office, v_office, v_office, null, null]::uuid[],
              array['Office'], array[0], date '2026-01-05', true);
    end if;

    -- South African public holidays (Public Holidays Act: one on a Sunday
    -- moves to the Monday).
    insert into public.public_holidays (tenant_id, day, name) values
      (t.id, '2026-01-01', 'New Year''s Day'), (t.id, '2026-03-21', 'Human Rights Day'),
      (t.id, '2026-04-03', 'Good Friday'), (t.id, '2026-04-06', 'Family Day'),
      (t.id, '2026-04-27', 'Freedom Day'), (t.id, '2026-05-01', 'Workers'' Day'),
      (t.id, '2026-06-16', 'Youth Day'), (t.id, '2026-08-10', 'National Women''s Day (observed)'),
      (t.id, '2026-09-24', 'Heritage Day'), (t.id, '2026-12-16', 'Day of Reconciliation'),
      (t.id, '2026-12-25', 'Christmas Day'), (t.id, '2026-12-26', 'Day of Goodwill'),
      (t.id, '2027-01-01', 'New Year''s Day'), (t.id, '2027-03-22', 'Human Rights Day (observed)'),
      (t.id, '2027-03-26', 'Good Friday'), (t.id, '2027-03-29', 'Family Day'),
      (t.id, '2027-04-27', 'Freedom Day'), (t.id, '2027-05-01', 'Workers'' Day'),
      (t.id, '2027-06-16', 'Youth Day'), (t.id, '2027-08-09', 'National Women''s Day'),
      (t.id, '2027-09-24', 'Heritage Day'), (t.id, '2027-12-16', 'Day of Reconciliation'),
      (t.id, '2027-12-25', 'Christmas Day'), (t.id, '2027-12-27', 'Day of Goodwill (observed)')
    on conflict (tenant_id, day) do nothing;
  end loop;
end $$;

-- ── 3. Roster lines ─────────────────────────────────────────────────────────

alter table public.rosters
  add column if not exists template_id   uuid references public.shift_templates (id) on delete set null,
  add column if not exists rotation_id   uuid references public.rotations (id) on delete set null,
  add column if not exists team          text,
  add column if not exists leave_id      uuid references public.leave_entries (id) on delete set null,
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancelled_by  uuid,
  add column if not exists cancel_reason text;

-- Lines built on the week board took their times from the shift only.
update public.rosters r
   set start_at = s.start_time, end_at = s.end_time
  from public.shifts s
 where r.shift_id = s.id and r.start_at is null;
update public.rosters set duty_date = public.sa_day(start_at)
 where start_at is not null and duty_date is distinct from public.sa_day(start_at);

create index if not exists rosters_user_start_idx on public.rosters (user_id, start_at);
create index if not exists rosters_live_start_idx on public.rosters (start_at)
  where published and cancelled_at is null;
create index if not exists rosters_leave_idx on public.rosters (leave_id) where leave_id is not null;

/** The person a line is for, as the roster sees them. */
create or replace function public.roster_person_internal(p_user uuid)
returns table (full_name text, badge_number text, silo public.silo, tenant_id uuid, active boolean)
language sql stable security definer set search_path to 'public' as $$
  select p.full_name, coalesce(nullif(btrim(p.badge_number), ''),
                               (select pe.badge_number from public.personnel pe where pe.user_id = p.id limit 1)),
         p.silo, p.tenant_id, p.deactivated_at is null
    from public.profiles p where p.id = p_user;
$$;

create or replace function public.roster_person(p_user uuid, p_silo public.silo)
returns table (full_name text, badge_number text, silo public.silo, tenant_id uuid, active boolean)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  -- Only for whoever rosters the department.
  if not public.can_manage_roster(p_silo) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return query select * from public.roster_person_internal(p_user);
end $$;

/**
 * Why this person cannot work this shift, or null. The same checks as V4:
 * approved leave, a court date, another shift at the same time, and a vehicle
 * already out on another post.
 */
create or replace function public.roster_clash_internal(
  p_tenant uuid, p_user uuid, p_start timestamptz, p_end timestamptz,
  p_exclude uuid, p_vehicle text, p_post uuid
) returns text
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_name text;
  v record;
  v_from date := public.sa_day(p_start);
  v_to date := public.sa_day(p_end - interval '1 second');
begin
  select coalesce(nullif(btrim(full_name), ''), 'This person') into v_name from public.profiles where id = p_user;

  select l.eff_from, l.eff_to into v from public.leave_entries l
   where l.user_id = p_user and l.status = 'Approved'
     and l.eff_from <= v_to and l.eff_to >= v_from
   order by l.eff_from limit 1;
  if found then
    return format('%s is on approved leave from %s to %s.', v_name,
                  to_char(v.eff_from, 'DD Mon'), to_char(v.eff_to, 'DD Mon YYYY'));
  end if;

  select e.details into v from public.endorsements e
   where e.user_id = p_user and e.is_active and e.type = 'Court Attendance'
     and e.start_date <= v_to and (e.end_date is null or e.end_date >= v_from)
   limit 1;
  if found then
    return format('%s is booked for court then%s.', v_name,
                  case when nullif(btrim(v.details), '') is not null then ' (' || btrim(v.details) || ')' else '' end);
  end if;

  select r.start_at, r.end_at into v from public.rosters r
   where r.user_id = p_user and r.tenant_id = p_tenant
     and r.id is distinct from p_exclude
     and public.roster_active(r.status, r.cancelled_at)
     and r.start_at < p_end and r.end_at > p_start
   order by r.start_at limit 1;
  if found then
    return format('%s is already on a shift from %s to %s.', v_name,
                  to_char(v.start_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI'),
                  to_char(v.end_at at time zone 'Africa/Johannesburg', 'HH24:MI'));
  end if;

  -- A crew shares its vehicle; two different posts cannot.
  if nullif(btrim(p_vehicle), '') is not null then
    select r.user_name into v from public.rosters r
     where r.tenant_id = p_tenant and r.id is distinct from p_exclude
       and lower(btrim(r.vehicle)) = lower(btrim(p_vehicle))
       and r.post_id is distinct from p_post
       and public.roster_active(r.status, r.cancelled_at)
       and r.start_at < p_end and r.end_at > p_start
     limit 1;
    if found then
      return format('Vehicle %s is already out with %s on another post then.', btrim(p_vehicle), v.user_name);
    end if;
  end if;
  return null;
end $$;

create or replace function public.roster_clash(
  p_silo public.silo, p_tenant uuid, p_user uuid, p_start timestamptz, p_end timestamptz,
  p_exclude uuid, p_vehicle text, p_post uuid
) returns text
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.can_manage_roster(p_silo) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return public.roster_clash_internal(p_tenant, p_user, p_start, p_end, p_exclude, p_vehicle, p_post);
end $$;

revoke all on function public.roster_person_internal(uuid) from public, anon, authenticated;
revoke all on function public.roster_person(uuid, public.silo) from public, anon;
revoke all on function public.roster_clash_internal(uuid, uuid, timestamptz, timestamptz, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.roster_clash(public.silo, uuid, uuid, timestamptz, timestamptz, uuid, text, uuid) from public, anon;
grant execute on function public.roster_person(uuid, public.silo) to authenticated;
grant execute on function public.roster_clash(public.silo, uuid, uuid, timestamptz, timestamptz, uuid, text, uuid) to authenticated;

-- Runs as the writer, so current_user tells a browser session ('authenticated')
-- from the trusted writers: these functions (SECURITY DEFINER), the service
-- role, the SQL editor.
create or replace function public.roster_line_guard() returns trigger
language plpgsql set search_path to 'public' as $$
declare
  v_trusted boolean := current_user not in ('authenticated', 'anon');
  v_cmp public.rosters;
  v_person record;
  v_clash text;
begin
  if tg_op = 'DELETE' then
    if not v_trusted and old.published and old.start_at is not null and old.start_at <= now() then
      raise exception 'A shift that has started cannot be deleted. Cancel it with a reason instead.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if not v_trusted then
    if tg_op = 'UPDATE' and not public.can_manage_roster(old.silo) then
      -- The person themselves: they confirm their own issued duty, nothing else.
      if old.user_id is distinct from auth.uid() or not old.published then
        raise exception 'Only your supervisor can change this duty' using errcode = '42501';
      end if;
      v_cmp := new;
      v_cmp.acknowledged_at := old.acknowledged_at;
      if v_cmp is distinct from old then
        raise exception 'You can confirm your duty; your supervisor makes any change to it' using errcode = '42501';
      end if;
      -- The first confirmation stands, and it is never in the future.
      if old.acknowledged_at is not null then
        new.acknowledged_at := old.acknowledged_at;
      elsif new.acknowledged_at is not null then
        new.acknowledged_at := least(greatest(new.acknowledged_at, coalesce(old.published_at, old.created_at)), now());
      end if;
      return new;
    end if;

    if tg_op = 'UPDATE' then
      if new.silo is distinct from old.silo or new.tenant_id is distinct from old.tenant_id then
        raise exception 'A shift cannot be moved to another department' using errcode = '42501';
      end if;
      if (new.cancelled_at, new.cancelled_by, new.cancel_reason, new.leave_id)
         is distinct from (old.cancelled_at, old.cancelled_by, old.cancel_reason, old.leave_id) then
        raise exception 'Cancel a shift with Cancel shift, so the reason is kept' using errcode = '42501';
      end if;
      -- A shift that has started is part of the record.
      if old.published and old.start_at is not null and old.start_at <= now()
         and (new.user_id, new.start_at, new.end_at, new.status, new.published)
             is distinct from (old.user_id, old.start_at, old.end_at, old.status, old.published)
         and not public.outranks(old.user_id) then
        raise exception 'This shift has started. Only someone senior to % can change it.', old.user_name
          using errcode = '42501';
      end if;
      -- Only the person confirms their duty; a change may ask them to again.
      if new.acknowledged_at is distinct from old.acknowledged_at and new.acknowledged_at is not null
         and old.user_id is distinct from auth.uid() then
        raise exception 'Only the person on the shift can confirm it' using errcode = '42501';
      end if;
    else
      if new.cancelled_at is not null or new.leave_id is not null then
        raise exception 'A new shift cannot start cancelled or on leave' using errcode = '22023';
      end if;
      if new.user_id is distinct from auth.uid() then new.acknowledged_at := null; end if;
    end if;
  end if;

  -- Times come from the week-board shift when not given; the day from the start.
  if new.start_at is null and new.shift_id is not null then
    select s.start_time, s.end_time into new.start_at, new.end_at from public.shifts s where s.id = new.shift_id;
  end if;
  if new.start_at is not null then new.duty_date := public.sa_day(new.start_at); end if;
  if tg_op = 'INSERT' then
    if new.user_id is null then
      raise exception 'Choose who works this shift' using errcode = '22023';
    end if;
    if new.start_at is null or new.end_at is null then
      raise exception 'A shift needs a start and an end' using errcode = '22023';
    end if;
  end if;
  new.station := coalesce(new.station, '');
  new.activity_type := coalesce(new.activity_type, '');

  if new.start_at is not null and new.end_at is not null
     and public.roster_active(new.status, new.cancelled_at)
     and (tg_op = 'INSERT'
          or new.user_id is distinct from old.user_id
          or new.start_at is distinct from old.start_at
          or new.end_at is distinct from old.end_at
          or new.vehicle is distinct from old.vehicle
          or new.post_id is distinct from old.post_id
          or not public.roster_active(old.status, old.cancelled_at)) then
    if new.end_at <= new.start_at then
      raise exception 'A shift ends after it starts' using errcode = '22023';
    end if;
    if new.end_at - new.start_at > interval '26 hours' or new.end_at - new.start_at < interval '30 minutes' then
      raise exception 'A shift is between 30 minutes and 26 hours long' using errcode = '22023';
    end if;
    if tg_op = 'INSERT' or new.user_id is distinct from old.user_id then
      if v_trusted then
        select * into v_person from public.roster_person_internal(new.user_id);
      else
        select * into v_person from public.roster_person(new.user_id, new.silo);
      end if;
      if not found or not v_person.active or v_person.tenant_id is distinct from new.tenant_id then
        raise exception 'That person has no active account here' using errcode = '22023';
      end if;
      if v_person.silo is distinct from new.silo then
        raise exception '% is not in this department', coalesce(v_person.full_name, 'That person') using errcode = '22023';
      end if;
      if tg_op = 'INSERT' or nullif(btrim(new.user_name), '') is null or new.user_id is distinct from old.user_id then
        new.user_name := coalesce(nullif(btrim(v_person.full_name), ''), new.user_name, '');
        new.badge_number := coalesce(v_person.badge_number, new.badge_number);
      end if;
    end if;
    if v_trusted then
      v_clash := public.roster_clash_internal(new.tenant_id, new.user_id, new.start_at, new.end_at,
                                              new.id, new.vehicle, new.post_id);
    else
      v_clash := public.roster_clash(new.silo, new.tenant_id, new.user_id, new.start_at, new.end_at,
                                     new.id, new.vehicle, new.post_id);
    end if;
    if v_clash is not null then
      raise exception '%', v_clash using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists roster_line_guard on public.rosters;
create trigger roster_line_guard before insert or update or delete on public.rosters
  for each row execute function public.roster_line_guard();

-- Every change to a roster line, permanently.
create table if not exists public.roster_changes (
  id         bigint generated always as identity primary key,
  tenant_id  uuid not null,
  silo       public.silo not null,
  roster_id  uuid not null,
  user_id    uuid,
  actor_id   uuid,
  actor_name text,
  action     text not null,
  detail     jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);
create index if not exists roster_changes_line_idx on public.roster_changes (tenant_id, roster_id, at);
create index if not exists roster_changes_person_idx on public.roster_changes (tenant_id, user_id, at desc);
alter table public.roster_changes enable row level security;
drop policy if exists tenant_isolation on public.roster_changes;
create policy tenant_isolation on public.roster_changes as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
drop policy if exists roster_changes_read on public.roster_changes;
create policy roster_changes_read on public.roster_changes for select to authenticated
  using (user_id = auth.uid() or public.can_manage_roster(silo));
revoke all on public.roster_changes from anon;
revoke insert, update, delete on public.roster_changes from authenticated;

/** "Day shift · Tue 13 Oct · 06:00–18:00 · Station 4" */
create or replace function public.schedule_line_label(
  p_template uuid, p_activity text, p_start timestamptz, p_end timestamptz, p_station text
) returns text
language sql stable security definer set search_path to 'public' as $$
  select concat_ws(' · ',
    coalesce((select name from public.shift_templates where id = p_template), nullif(btrim(p_activity), ''), 'Shift'),
    to_char(p_start at time zone 'Africa/Johannesburg', 'Dy DD Mon'),
    to_char(p_start at time zone 'Africa/Johannesburg', 'HH24:MI') || '–' || to_char(p_end at time zone 'Africa/Johannesburg', 'HH24:MI'),
    nullif(btrim(p_station), ''));
$$;
revoke all on function public.schedule_line_label(uuid, text, timestamptz, timestamptz, text) from public, anon, authenticated;

-- ── 4. Alerts about a person's schedule ─────────────────────────────────────

create or replace function public.schedule_alert(
  p_tenant uuid, p_silo public.silo, p_user uuid, p_kind text, p_title text, p_body text,
  p_severity text default 'Medium', p_link text default '/roster/mine'
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if p_user is null then return null; end if;
  insert into public.alerts (
    tenant_id, silo, target_user_id, kind, severity, title, body, link,
    presentation, requires_ack, created_by, created_by_name, expires_at
  ) values (
    p_tenant, p_silo, p_user, p_kind, p_severity, left(p_title, 140), left(p_body, 500), p_link,
    'toast', false, null, 'Schedule', now() + interval '3 days'
  ) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.schedule_alert(uuid, public.silo, uuid, text, text, text, text, text) from public, anon, authenticated;

-- Alerts the server pushes to a locked phone (pg_net). Shift reminders are
-- scheduled by the phone itself and need no signal.
create or replace function public.schedule_push_kinds() returns text[]
language sql immutable as $$
  select array['shift_published', 'shift_changed', 'shift_confirm', 'shift_late', 'shift_noshow',
               'shift_team_late', 'shift_team_noshow', 'shift_outcome', 'leave_decision', 'swap'];
$$;

create or replace function public.push_schedule_alert() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  t record;
begin
  if new.target_user_id is null or not (new.kind = any (public.schedule_push_kinds())) then return null; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return null; end if;
  for t in select token from public.push_tokens where user_id = new.target_user_id loop
    begin
      perform net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        body := jsonb_build_object(
          'to', t.token, 'title', new.title, 'body', coalesce(new.body, ''),
          'sound', 'default', 'priority', 'high', 'channelId', 'alerts',
          'data', jsonb_build_object('alertId', new.id, 'kind', new.kind, 'screen', 'schedule')),
        headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb
      );
    exception when others then null;
    end;
  end loop;
  return null;
exception when others then
  -- A push that cannot go must never stop the alert itself.
  return null;
end $$;
revoke all on function public.push_schedule_alert() from public, anon, authenticated;

drop trigger if exists push_schedule_alert on public.alerts;
create trigger push_schedule_alert after insert on public.alerts
  for each row execute function public.push_schedule_alert();

do $$
begin
  begin
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_net unavailable (%). Schedule alerts reach phones while the app is open, not on a locked phone.', sqlerrm;
  end;
end $$;

/**
 * Who is told about this person's shift: their manager where one is set, the
 * senior people of their department who are working now, and department
 * command when asked (a no-show) or when nobody senior is working.
 */
create or replace function public.schedule_overseers(p_user uuid, p_include_command boolean default false)
returns setof uuid
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v record;
  r record;
  v_found boolean := false;
begin
  select id, tenant_id, silo, public.schedule_rank(role) as rk into v from public.profiles where id = p_user;
  if not found then return; end if;

  for r in
    select m.id from public.reporting_lines rl join public.profiles m on m.id = rl.manager_id
     where rl.member_kind = 'user' and rl.member_id = p_user and rl.manager_kind = 'user'
       and m.deactivated_at is null and m.tenant_id = v.tenant_id and m.id <> p_user
  loop
    v_found := true;
    return next r.id;
  end loop;

  for r in
    select p.id from public.profiles p
     where p.tenant_id = v.tenant_id and p.silo = v.silo and p.deactivated_at is null and p.id <> p_user
       and public.schedule_rank(p.role) between 1 and 3 and public.schedule_rank(p.role) > v.rk
       and (exists (select 1 from public.personnel pe where pe.user_id = p.id and pe.is_on_duty)
            or exists (select 1 from public.shift_attendance a
                        where a.user_id = p.id and a.checked_in_at is not null and a.ended_at is null and a.end_at > now()))
     limit 10
  loop
    v_found := true;
    return next r.id;
  end loop;

  if p_include_command or not v_found then
    for r in
      select p.id from public.profiles p
       where p.tenant_id = v.tenant_id and p.silo = v.silo and p.deactivated_at is null and p.id <> p_user
         and public.schedule_rank(p.role) between 2 and 3 and public.schedule_rank(p.role) > v.rk
       limit 6
    loop
      v_found := true;
      return next r.id;
    end loop;
  end if;

  if not v_found then
    for r in
      select p.id from public.profiles p
       where p.tenant_id = v.tenant_id and p.silo = v.silo and p.deactivated_at is null and p.id <> p_user
         and public.schedule_rank(p.role) between 1 and 3 and public.schedule_rank(p.role) > v.rk
       limit 6
    loop
      return next r.id;
    end loop;
  end if;
end $$;

/**
 * Who decides this person's leave or swap: their manager when senior to them,
 * else the next tier up in their department, else organisation HR.
 */
create or replace function public.schedule_approvers(p_user uuid)
returns setof uuid
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v record;
  v_tier int;
  r record;
  v_found boolean := false;
begin
  select id, tenant_id, silo, public.schedule_rank(role) as rk into v from public.profiles where id = p_user;
  if not found then return; end if;

  for r in
    select m.id from public.reporting_lines rl join public.profiles m on m.id = rl.manager_id
     where rl.member_kind = 'user' and rl.member_id = p_user and rl.manager_kind = 'user'
       and m.deactivated_at is null and m.tenant_id = v.tenant_id and m.id <> p_user
       and public.schedule_rank(m.role) > v.rk and (m.silo = v.silo or public.schedule_rank(m.role) >= 4)
  loop
    v_found := true;
    return next r.id;
  end loop;
  if v_found then return; end if;

  select min(public.schedule_rank(p.role)) into v_tier from public.profiles p
   where p.tenant_id = v.tenant_id and p.silo = v.silo and p.deactivated_at is null and p.id <> p_user
     and public.schedule_rank(p.role) between 1 and 3 and public.schedule_rank(p.role) > v.rk;
  if v_tier is not null then
    for r in
      select p.id from public.profiles p
       where p.tenant_id = v.tenant_id and p.silo = v.silo and p.deactivated_at is null and p.id <> p_user
         and public.schedule_rank(p.role) = v_tier
       limit 12
    loop
      return next r.id;
    end loop;
    return;
  end if;

  for r in
    select p.id from public.profiles p
     where p.tenant_id = v.tenant_id and p.deactivated_at is null and p.id <> p_user
       and public.schedule_rank(p.role) = 4
     limit 6
  loop
    return next r.id;
  end loop;
end $$;

revoke all on function public.schedule_overseers(uuid, boolean) from public, anon, authenticated;
revoke all on function public.schedule_approvers(uuid) from public, anon, authenticated;

-- ── 5. Telling the person when an issued shift changes ──────────────────────

create or replace function public.roster_line_after() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_quiet boolean := coalesce(current_setting('criticom.roster_quiet', true), '') = 'on';
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_row public.rosters := case when tg_op = 'DELETE' then old else new end;
  v_action text;
  v_label text;
begin
  if tg_op = 'UPDATE' and new is not distinct from old then return null; end if;

  v_action := case
    when tg_op = 'INSERT' then 'added'
    when tg_op = 'DELETE' then 'removed'
    when new.cancelled_at is not null and old.cancelled_at is null then 'cancelled'
    when new.published and not old.published then 'published'
    when not new.published and old.published then 'withdrawn'
    when new.status = 'Leave' and coalesce(old.status, '') <> 'Leave' then 'on_leave'
    when coalesce(old.status, '') = 'Leave' and coalesce(new.status, '') <> 'Leave' then 'leave_cancelled'
    when new.user_id is distinct from old.user_id then 'reassigned'
    when (new.start_at, new.end_at) is distinct from (old.start_at, old.end_at) then 'retimed'
    when (new.post_id, new.vehicle, new.station, new.call_sign, new.sector, new.special_instructions)
         is distinct from (old.post_id, old.vehicle, old.station, old.call_sign, old.sector, old.special_instructions) then 'details'
    when new.acknowledged_at is distinct from old.acknowledged_at then 'confirmed'
    else 'updated' end;

  select full_name into v_actor_name from public.profiles where id = v_actor;
  insert into public.roster_changes (tenant_id, silo, roster_id, user_id, actor_id, actor_name, action, detail)
  values (v_row.tenant_id, v_row.silo, v_row.id, v_row.user_id, v_actor,
          coalesce(v_actor_name, case when v_actor is null then 'Criticomm' end), v_action,
          jsonb_build_object(
            'start_at', v_row.start_at, 'end_at', v_row.end_at, 'post_id', v_row.post_id,
            'published', v_row.published, 'status', v_row.status, 'reason', v_row.cancel_reason,
            'before', case when tg_op = 'UPDATE' then jsonb_build_object(
              'user_id', old.user_id, 'start_at', old.start_at, 'end_at', old.end_at,
              'status', old.status, 'published', old.published) end));

  if v_quiet or v_row.user_id is null or v_row.start_at is null or v_row.end_at is null or v_row.end_at < now() then
    return null;
  end if;

  v_label := public.schedule_line_label(v_row.template_id, v_row.activity_type, v_row.start_at, v_row.end_at, v_row.station);

  if tg_op = 'INSERT' then
    if new.published and public.roster_active(new.status, new.cancelled_at) and new.user_id is distinct from v_actor then
      perform public.schedule_alert(new.tenant_id, new.silo, new.user_id, 'shift_changed',
        'New shift', v_label || '. Open My Schedule to confirm it.');
    end if;
  elsif tg_op = 'DELETE' then
    if old.published and old.user_id is distinct from v_actor then
      perform public.schedule_alert(old.tenant_id, old.silo, old.user_id, 'shift_changed',
        'Shift removed', v_label || ' is no longer on your roster.');
    end if;
  elsif v_action = 'published' then
    -- Publishing a day or a month is one alert, not one per shift.
    if new.user_id is distinct from v_actor
       and public.automation_claim('roster_published', new.user_id::text, to_char(now(), 'YYYYMMDDHH24MI')) then
      perform public.schedule_alert(new.tenant_id, new.silo, new.user_id, 'shift_published',
        'New shifts on your roster', 'Open My Schedule to see them and confirm.');
    end if;
  elsif old.published and new.published then
    if v_action = 'cancelled' and new.user_id is distinct from v_actor then
      perform public.schedule_alert(new.tenant_id, new.silo, new.user_id, 'shift_changed',
        'Shift cancelled', v_label || coalesce('. ' || nullif(btrim(new.cancel_reason), ''), '') || '.');
    elsif v_action = 'reassigned' then
      if old.user_id is distinct from v_actor then
        perform public.schedule_alert(old.tenant_id, old.silo, old.user_id, 'shift_changed',
          'Shift moved to someone else',
          public.schedule_line_label(old.template_id, old.activity_type, old.start_at, old.end_at, old.station)
          || ' is no longer yours.');
      end if;
      if new.user_id is distinct from v_actor then
        perform public.schedule_alert(new.tenant_id, new.silo, new.user_id, 'shift_changed',
          'New shift', v_label || '. Open My Schedule to confirm it.');
      end if;
    elsif v_action in ('retimed', 'details') and new.user_id is distinct from v_actor
          and public.automation_claim('roster_changed', new.id::text, to_char(now(), 'YYYYMMDDHH24MI')) then
      perform public.schedule_alert(new.tenant_id, new.silo, new.user_id, 'shift_changed',
        'Shift changed', 'Now: ' || v_label || '.');
    end if;
  elsif old.published and not new.published and old.user_id is distinct from v_actor then
    perform public.schedule_alert(old.tenant_id, old.silo, old.user_id, 'shift_changed',
      'Shift removed', v_label || ' is no longer on your roster.');
  end if;
  return null;
end $$;
revoke all on function public.roster_line_after() from public, anon, authenticated;

drop trigger if exists roster_line_after on public.rosters;
create trigger roster_line_after after insert or update or delete on public.rosters
  for each row execute function public.roster_line_after();

-- ── 6. Who sees roster lines ────────────────────────────────────────────────
-- Drafts only to whoever rosters the department. Issued shifts to the
-- person, their department, and the desks that see every department.

drop policy if exists rosters_read on public.rosters;
create policy rosters_read on public.rosters for select to authenticated using (
  public.can_manage_roster(silo)
  or (published and (user_id = auth.uid() or silo = public.current_silo() or public.is_global()))
);

drop policy if exists rosters_supervisor_all on public.rosters;
drop policy if exists rosters_manage on public.rosters;
create policy rosters_manage on public.rosters for all to authenticated
  using (public.can_manage_roster(silo)) with check (public.can_manage_roster(silo));

-- The person confirming their own issued duty (roster_line_guard allows that
-- one field only).
drop policy if exists rosters_self_acknowledge on public.rosters;
create policy rosters_self_acknowledge on public.rosters for update to authenticated
  using (user_id = auth.uid() and published)
  with check (user_id = auth.uid() and published);

-- The week board's shifts follow the same authority.
drop policy if exists shifts_supervisor_all on public.shifts;
create policy shifts_supervisor_all on public.shifts for all to authenticated
  using (public.can_manage_roster(silo)) with check (public.can_manage_roster(silo));

-- So do endorsements (a court date keeps someone off the roster that day).
drop policy if exists endorsements_supervisor_all on public.endorsements;
create policy endorsements_supervisor_all on public.endorsements for all to authenticated
  using (public.can_manage_roster(silo)) with check (public.can_manage_roster(silo));

-- ── 7. Attendance: did they start, and when ─────────────────────────────────

create table if not exists public.shift_attendance (
  roster_id         uuid primary key references public.rosters (id) on delete cascade,
  tenant_id         uuid not null,
  silo              public.silo not null,
  user_id           uuid not null,
  start_at          timestamptz not null,
  end_at            timestamptz not null,
  checked_in_at     timestamptz,
  check_in_source   text check (check_in_source in ('start_of_shift', 'clock_in', 'console')),
  late_minutes      integer,
  late_alerted_at   timestamptz,
  noshow_alerted_at timestamptz,
  outcome           text check (outcome in ('Present', 'Excused', 'Sick', 'Absent without leave', 'Swapped')),
  outcome_reason    text,
  outcome_by        uuid,
  outcome_by_name   text,
  outcome_at        timestamptz,
  ended_at          timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists shift_attendance_person_idx on public.shift_attendance (user_id, start_at desc);
create index if not exists shift_attendance_dept_idx on public.shift_attendance (tenant_id, silo, start_at desc);
alter table public.shift_attendance enable row level security;
drop policy if exists tenant_isolation on public.shift_attendance;
create policy tenant_isolation on public.shift_attendance as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
drop policy if exists shift_attendance_read on public.shift_attendance;
create policy shift_attendance_read on public.shift_attendance for select to authenticated
  using (user_id = auth.uid() or public.can_manage_roster(silo));
revoke all on public.shift_attendance from anon;
revoke insert, update, delete on public.shift_attendance from authenticated;

/** Check this person in to the shift they are due on at this moment. */
create or replace function public.schedule_check_in(p_user uuid, p_at timestamptz, p_source text)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v public.rosters;
  v_late int;
  v_was_late boolean;
  o uuid;
begin
  select r.* into v from public.rosters r
   where r.user_id = p_user and r.published and public.roster_active(r.status, r.cancelled_at)
     and r.start_at - interval '3 hours' <= p_at and p_at < r.end_at
     and not exists (select 1 from public.shift_attendance a where a.roster_id = r.id and a.checked_in_at is not null)
   order by r.start_at
   limit 1;
  if not found then return null; end if;

  v_late := greatest(0, floor(extract(epoch from (p_at - v.start_at)) / 60))::int;
  insert into public.shift_attendance (roster_id, tenant_id, silo, user_id, start_at, end_at,
                                       checked_in_at, check_in_source, late_minutes)
  values (v.id, v.tenant_id, v.silo, v.user_id, v.start_at, v.end_at, p_at, p_source, v_late)
  on conflict (roster_id) do update
     set checked_in_at = excluded.checked_in_at, check_in_source = excluded.check_in_source,
         late_minutes = excluded.late_minutes
   where shift_attendance.checked_in_at is null
  returning late_alerted_at is not null into v_was_late;

  -- Those told they were late hear that they have started.
  if coalesce(v_was_late, false) then
    for o in select distinct x from public.schedule_overseers(p_user, false) x loop
      perform public.schedule_alert(v.tenant_id, v.silo, o, 'shift_started_late',
        format('%s has started', v.user_name),
        format('%s started at %s, %s min late.',
               public.schedule_line_label(v.template_id, v.activity_type, v.start_at, v.end_at, v.station),
               to_char(p_at at time zone 'Africa/Johannesburg', 'HH24:MI'), v_late),
        'Low', '/roster/allocation');
    end loop;
  end if;
  return v.id;
end $$;

create or replace function public.schedule_check_out(p_user uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  update public.shift_attendance a set ended_at = p_at
   where a.roster_id = (
     select x.roster_id from public.shift_attendance x
      where x.user_id = p_user and x.checked_in_at is not null and x.ended_at is null and x.checked_in_at <= p_at
      order by x.start_at desc limit 1);
end $$;

revoke all on function public.schedule_check_in(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.schedule_check_out(uuid, timestamptz) from public, anon, authenticated;

-- Going on duty in the app (after the start of shift) is the check-in for
-- field crews; going off duty ends it.
create or replace function public.personnel_duty_attendance() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.user_id is null then return null; end if;
  if new.is_on_duty and not coalesce(old.is_on_duty, false) then
    perform public.schedule_check_in(new.user_id, now(), 'start_of_shift');
  elsif not new.is_on_duty and coalesce(old.is_on_duty, false) then
    perform public.schedule_check_out(new.user_id, now());
  end if;
  return null;
exception when others then
  -- Attendance must never stop someone going on or off duty.
  return null;
end $$;
revoke all on function public.personnel_duty_attendance() from public, anon, authenticated;

drop trigger if exists personnel_duty_attendance on public.personnel;
create trigger personnel_duty_attendance after update of is_on_duty on public.personnel
  for each row execute function public.personnel_duty_attendance();

-- A clock-in is when it happened: a browser session cannot date it.
create or replace function public.attendance_event_guard() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.at := now();
  end if;
  return new;
end $$;

drop trigger if exists attendance_event_guard on public.attendance_events;
create trigger attendance_event_guard before insert on public.attendance_events
  for each row execute function public.attendance_event_guard();

create or replace function public.attendance_event_checkin() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.kind = 'clock_in' then
    perform public.schedule_check_in(new.user_id, new.at, case when new.source = 'console' then 'console' else 'clock_in' end);
  elsif new.kind = 'clock_out' then
    perform public.schedule_check_out(new.user_id, new.at);
  end if;
  return null;
exception when others then
  return null;
end $$;
revoke all on function public.attendance_event_checkin() from public, anon, authenticated;

drop trigger if exists attendance_event_checkin on public.attendance_events;
create trigger attendance_event_checkin after insert on public.attendance_events
  for each row execute function public.attendance_event_checkin();

-- ── 8. Rostering ────────────────────────────────────────────────────────────

/** The signed-in person, for the functions below. */
create or replace function public.schedule_me()
returns table (id uuid, tenant_id uuid, silo public.silo, rank integer, full_name text)
language sql stable security definer set search_path to 'public' as $$
  select p.id, p.tenant_id, p.silo, public.schedule_rank(p.role), p.full_name
    from public.profiles p where p.id = auth.uid() and p.deactivated_at is null;
$$;
revoke all on function public.schedule_me() from public, anon, authenticated;

/** One shift for one person, from a shift type. Returns the line. */
create or replace function public.add_shift(
  p_user uuid, p_day date, p_template uuid, p_publish boolean default false, p_note text default null
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v_t public.shift_templates;
  v_start timestamptz;
  v_id uuid;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select * into v_t from public.shift_templates where id = p_template and active;
  if not found or v_t.tenant_id <> me.tenant_id then
    raise exception 'That shift type is not available' using errcode = '22023';
  end if;
  if not public.can_manage_roster(v_t.silo) then
    raise exception 'You do not roster %', public.department_label(v_t.silo) using errcode = '42501';
  end if;
  if p_day is null or p_day < public.sa_day(now()) - 31 or p_day > public.sa_day(now()) + 400 then
    raise exception 'Choose a day within the next year' using errcode = '22023';
  end if;
  v_start := (p_day + v_t.start_time) at time zone 'Africa/Johannesburg';

  insert into public.rosters (
    tenant_id, silo, user_id, user_name, station, activity_type, start_at, end_at, template_id,
    published, published_at, status, special_instructions, created_by_supervisor_id, created_by_supervisor_name
  )
  select v_t.tenant_id, v_t.silo, p_user, coalesce(pr.full_name, ''), coalesce(pe.station, pr.station, ''),
         v_t.name, v_start, v_start + make_interval(mins => v_t.minutes), v_t.id,
         coalesce(p_publish, false), case when p_publish then now() end, 'Present',
         nullif(btrim(coalesce(p_note, '')), ''), me.id::text, me.full_name
    from public.profiles pr
    left join public.personnel pe on pe.user_id = pr.id
   where pr.id = p_user
   limit 1
  returning id into v_id;
  if v_id is null then raise exception 'That person has no account here' using errcode = '22023'; end if;
  return v_id;
end $$;

/**
 * Build the roster from a rotation: every team member on their team's
 * working days, as drafts. Anyone who cannot work a day (leave, court,
 * another shift) is left out with the reason. Running it again adds nothing
 * already there.
 */
create or replace function public.generate_roster(
  p_rotation uuid, p_from date, p_to date, p_teams text[] default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v_rot public.rotations;
  v_len int;
  v_day date;
  i int;
  v_pos int;
  v_tpl uuid;
  v_t public.shift_templates;
  v_start timestamptz;
  p record;
  v_created int := 0;
  v_skipped int := 0;
  v_present int := 0;
  v_reasons jsonb := '[]'::jsonb;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select * into v_rot from public.rotations where id = p_rotation and active;
  if not found or v_rot.tenant_id <> me.tenant_id then
    raise exception 'That rotation is not available' using errcode = '22023';
  end if;
  if not public.can_manage_roster(v_rot.silo) then
    raise exception 'You do not roster %', public.department_label(v_rot.silo) using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'Choose up to three months at a time' using errcode = '22023';
  end if;
  if p_from < public.sa_day(now()) - 31 then
    raise exception 'A roster is built for the days ahead' using errcode = '22023';
  end if;

  v_len := array_length(v_rot.cycle, 1);
  perform set_config('criticom.roster_quiet', 'on', true);

  v_day := p_from;
  while v_day <= p_to loop
    if v_rot.skip_public_holidays and exists (
         select 1 from public.public_holidays h where h.tenant_id = v_rot.tenant_id and h.day = v_day) then
      v_day := v_day + 1;
      continue;
    end if;
    for i in 1 .. array_length(v_rot.teams, 1) loop
      if p_teams is not null and not exists (
           select 1 from unnest(p_teams) t where lower(btrim(t)) = lower(v_rot.teams[i])) then
        continue;
      end if;
      v_pos := (((v_day - v_rot.anchor) - v_rot.offsets[i]) % v_len + v_len) % v_len;
      v_tpl := v_rot.cycle[v_pos + 1];
      if v_tpl is null then continue; end if;
      select * into v_t from public.shift_templates where id = v_tpl;
      if not found or not v_t.active then continue; end if;
      v_start := (v_day + v_t.start_time) at time zone 'Africa/Johannesburg';

      for p in
        select pr.id, pr.full_name, coalesce(pe.station, pr.station, '') as station
          from public.personnel pe
          join public.profiles pr on pr.id = pe.user_id
         where pe.tenant_id = v_rot.tenant_id and pe.silo = v_rot.silo and pr.silo = v_rot.silo
           and pr.deactivated_at is null and pe.left_at is null
           and lower(btrim(coalesce(pe.platoon, ''))) = lower(v_rot.teams[i])
         order by pr.full_name
      loop
        if exists (select 1 from public.rosters r
                    where r.user_id = p.id and r.start_at = v_start and r.cancelled_at is null) then
          v_present := v_present + 1;
          continue;
        end if;
        begin
          insert into public.rosters (
            tenant_id, silo, user_id, user_name, station, activity_type, start_at, end_at,
            template_id, rotation_id, team, published, status, created_by_supervisor_id, created_by_supervisor_name
          ) values (
            v_rot.tenant_id, v_rot.silo, p.id, coalesce(p.full_name, ''), p.station, v_t.name,
            v_start, v_start + make_interval(mins => v_t.minutes), v_t.id, v_rot.id, v_rot.teams[i],
            false, 'Present', me.id::text, me.full_name
          );
          v_created := v_created + 1;
        exception when others then
          v_skipped := v_skipped + 1;
          if jsonb_array_length(v_reasons) < 200 then
            v_reasons := v_reasons || jsonb_build_object('name', p.full_name, 'day', v_day, 'reason', sqlerrm);
          end if;
        end;
      end loop;
    end loop;
    v_day := v_day + 1;
  end loop;

  perform set_config('criticom.roster_quiet', 'off', true);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_rot.tenant_id, v_rot.silo, me.id, me.full_name, v_rot.silo::text, 'RosterGenerated', 'rotation', v_rot.id::text,
          format('%s, %s to %s: %s shift(s) drafted, %s left out', v_rot.name, p_from, p_to, v_created, v_skipped));
  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'already', v_present, 'reasons', v_reasons);
end $$;

/** Issue every draft in a range: one alert per person, then each confirms. */
create or replace function public.publish_roster(p_silo public.silo, p_from date, p_to date)
returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  r record;
  v_total int := 0;
  v_summary jsonb;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  if not public.can_manage_roster(p_silo) then
    raise exception 'You do not roster %', public.department_label(p_silo) using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'Choose up to three months at a time' using errcode = '22023';
  end if;

  perform set_config('criticom.roster_quiet', 'on', true);
  with issued as (
    update public.rosters set published = true, published_at = now()
     where tenant_id = me.tenant_id and silo = p_silo and duty_date between p_from and p_to
       and not published and cancelled_at is null
    returning user_id, start_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('user_id', g.user_id, 'n', g.n, 'first_at', g.first_at, 'last_at', g.last_at)), '[]'::jsonb)
    into v_summary
    from (select user_id, count(*) as n, min(start_at) as first_at, max(start_at) as last_at
            from issued group by user_id) g;
  perform set_config('criticom.roster_quiet', 'off', true);

  for r in select (e ->> 'user_id')::uuid as user_id, (e ->> 'n')::int as n,
                  (e ->> 'first_at')::timestamptz as first_at, (e ->> 'last_at')::timestamptz as last_at
             from jsonb_array_elements(v_summary) e
  loop
    v_total := v_total + r.n;
    if r.user_id is distinct from me.id then
      perform public.schedule_alert(me.tenant_id, p_silo, r.user_id, 'shift_published',
        format('Your roster is out: %s shift%s', r.n, case when r.n = 1 then '' else 's' end),
        format('From %s to %s. Open My Schedule to see them and confirm.',
               to_char(r.first_at at time zone 'Africa/Johannesburg', 'Dy DD Mon'),
               to_char(r.last_at at time zone 'Africa/Johannesburg', 'Dy DD Mon')));
    end if;
  end loop;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (me.tenant_id, p_silo, me.id, me.full_name, p_silo::text, 'RosterPublished', 'roster',
          p_from::text || '..' || p_to::text, format('%s shift(s) issued, %s to %s', v_total, p_from, p_to));
  return v_total;
end $$;

/** Cancel an issued shift with a reason (a draft is simply removed). */
create or replace function public.cancel_shift(p_roster uuid, p_reason text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v public.rosters;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select * into v from public.rosters where id = p_roster for update;
  if not found or v.tenant_id <> me.tenant_id then raise exception 'Shift not found' using errcode = 'P0002'; end if;
  if not public.can_manage_roster(v.silo) then
    raise exception 'You do not roster %', public.department_label(v.silo) using errcode = '42501';
  end if;
  if v.cancelled_at is not null then return; end if;
  if not v.published then
    delete from public.rosters where id = p_roster;
    return;
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why the shift is cancelled' using errcode = '22023';
  end if;
  if v.start_at <= now() and not public.outranks(v.user_id) then
    raise exception 'This shift has started. Only someone senior to % can cancel it.', v.user_name using errcode = '42501';
  end if;
  update public.rosters
     set cancelled_at = now(), cancelled_by = me.id, cancel_reason = left(btrim(p_reason), 300), status = 'Cancelled'
   where id = p_roster;
  update public.shift_swaps set status = 'Withdrawn'
   where (requester_line = p_roster or partner_line = p_roster) and status in ('Requested', 'Accepted');
end $$;

/**
 * Put someone on a post for a day. Their shift that day carries the post;
 * with no shift that day, one is added from the shift type given.
 */
create or replace function public.assign_post(p_post uuid, p_day date, p_user uuid, p_template uuid default null)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v_post record;
  v_line uuid;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select * into v_post from public.duty_posts where id = p_post and active;
  if not found or v_post.tenant_id <> me.tenant_id then raise exception 'That post is not available' using errcode = '22023'; end if;
  if not public.can_manage_roster(v_post.silo) then
    raise exception 'You do not roster %', public.department_label(v_post.silo) using errcode = '42501';
  end if;

  select r.id into v_line from public.rosters r
   where r.user_id = p_user and r.tenant_id = me.tenant_id and r.silo = v_post.silo and r.duty_date = p_day
     and public.roster_active(r.status, r.cancelled_at)
   order by r.start_at limit 1;
  if v_line is null then
    if p_template is null then
      raise exception 'They have no shift that day. Choose the shift they work.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.shift_templates where id = p_template and silo = v_post.silo) then
      raise exception 'That shift type belongs to another department' using errcode = '22023';
    end if;
    v_line := public.add_shift(p_user, p_day, p_template, false, null);
  end if;

  update public.rosters
     set post_id = v_post.id, post = v_post.name,
         station = coalesce(nullif(btrim(v_post.station), ''), station),
         vehicle = v_post.vehicle, sector = v_post.sector, call_sign = v_post.call_sign,
         activity_type = coalesce(nullif(btrim(v_post.activity_type), ''), activity_type)
   where id = v_line;
  return v_line;
end $$;

/** Take someone off a post; the shift itself stays unless it was only ever this post. */
create or replace function public.clear_post(p_roster uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v public.rosters;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select * into v from public.rosters where id = p_roster for update;
  if not found or v.tenant_id <> me.tenant_id then raise exception 'Shift not found' using errcode = 'P0002'; end if;
  if not public.can_manage_roster(v.silo) then
    raise exception 'You do not roster %', public.department_label(v.silo) using errcode = '42501';
  end if;
  if not v.published and v.template_id is null and v.rotation_id is null then
    delete from public.rosters where id = p_roster;
  else
    update public.rosters set post_id = null, post = null, vehicle = null, sector = null, call_sign = null
     where id = p_roster;
  end if;
end $$;

/** Copy a day's shifts and posts onto another day, as drafts. */
create or replace function public.copy_roster_day(p_silo public.silo, p_from date, p_to date)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  r public.rosters;
  v_shift interval := (p_to - p_from) * interval '1 day';
  v_copied int := 0;
  v_skipped int := 0;
  v_reasons jsonb := '[]'::jsonb;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  if not public.can_manage_roster(p_silo) then
    raise exception 'You do not roster %', public.department_label(p_silo) using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'Choose two different days' using errcode = '22023';
  end if;
  for r in
    select * from public.rosters
     where tenant_id = me.tenant_id and silo = p_silo and duty_date = p_from
       and public.roster_active(status, cancelled_at) and start_at is not null and end_at is not null
     order by start_at
  loop
    if exists (select 1 from public.rosters x where x.user_id = r.user_id and x.duty_date = p_to
                and public.roster_active(x.status, x.cancelled_at)) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      insert into public.rosters (
        tenant_id, silo, user_id, user_name, badge_number, station, activity_type, start_at, end_at,
        template_id, rotation_id, team, post_id, post, vehicle, sector, call_sign, special_instructions,
        published, status, created_by_supervisor_id, created_by_supervisor_name
      ) values (
        r.tenant_id, r.silo, r.user_id, r.user_name, r.badge_number, r.station, r.activity_type,
        r.start_at + v_shift, r.end_at + v_shift, r.template_id, r.rotation_id, r.team, r.post_id, r.post,
        r.vehicle, r.sector, r.call_sign, r.special_instructions, false, 'Present', me.id::text, me.full_name
      );
      v_copied := v_copied + 1;
    exception when others then
      v_skipped := v_skipped + 1;
      if jsonb_array_length(v_reasons) < 100 then
        v_reasons := v_reasons || jsonb_build_object('name', r.user_name, 'reason', sqlerrm);
      end if;
    end;
  end loop;
  return jsonb_build_object('copied', v_copied, 'skipped', v_skipped, 'reasons', v_reasons);
end $$;

/** Put a member in a team (the platoon a rotation rosters). */
create or replace function public.set_member_team(p_user uuid, p_team text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v_pe record;
  v_team text := nullif(btrim(coalesce(p_team, '')), '');
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select pe.id, pe.silo, pe.tenant_id into v_pe from public.personnel pe where pe.user_id = p_user limit 1;
  if not found or v_pe.tenant_id <> me.tenant_id then
    raise exception 'That person has no staff record' using errcode = '22023';
  end if;
  if not public.can_manage_roster(v_pe.silo) then
    raise exception 'You do not roster %', public.department_label(v_pe.silo) using errcode = '42501';
  end if;
  if v_team is not null and char_length(v_team) > 20 then
    raise exception 'A team name is up to 20 characters' using errcode = '22023';
  end if;
  update public.personnel set platoon = v_team where id = v_pe.id;
end $$;

/** Start shift at the console: a clock-in, which checks the person in. */
create or replace function public.start_my_shift() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v record;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  insert into public.attendance_events (tenant_id, silo, user_id, user_name, kind, at, source)
  values (me.tenant_id, me.silo, me.id, me.full_name, 'clock_in', now(), 'console');

  select a.roster_id, a.checked_in_at, a.late_minutes, r.start_at, r.end_at,
         public.schedule_line_label(r.template_id, r.activity_type, r.start_at, r.end_at, r.station) as label
    into v
    from public.shift_attendance a join public.rosters r on r.id = a.roster_id
   where a.user_id = me.id and a.checked_in_at is not null and a.end_at > now()
   order by a.checked_in_at desc limit 1;
  if not found then
    return jsonb_build_object('checked_in', false);
  end if;
  return jsonb_build_object('checked_in', true, 'roster_id', v.roster_id, 'label', v.label,
                            'late_minutes', v.late_minutes, 'checked_in_at', v.checked_in_at);
end $$;

/** A senior records why someone was late or did not start. */
create or replace function public.record_shift_outcome(p_roster uuid, p_outcome text, p_reason text)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v public.rosters;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select * into v from public.rosters where id = p_roster;
  if not found or v.tenant_id <> me.tenant_id then raise exception 'Shift not found' using errcode = 'P0002'; end if;
  if not public.outranks(v.user_id) then
    raise exception 'Only someone senior to % records this', v.user_name using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('Present', 'Excused', 'Sick', 'Absent without leave', 'Swapped') then
    raise exception 'Choose Present, Excused, Sick, Absent without leave or Swapped' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why' using errcode = '22023';
  end if;
  if v.start_at > now() then
    raise exception 'This shift has not started yet' using errcode = '22023';
  end if;

  insert into public.shift_attendance (roster_id, tenant_id, silo, user_id, start_at, end_at,
                                       outcome, outcome_reason, outcome_by, outcome_by_name, outcome_at)
  values (v.id, v.tenant_id, v.silo, v.user_id, v.start_at, v.end_at,
          p_outcome, left(btrim(p_reason), 500), me.id, me.full_name, now())
  on conflict (roster_id) do update
     set outcome = excluded.outcome, outcome_reason = excluded.outcome_reason,
         outcome_by = excluded.outcome_by, outcome_by_name = excluded.outcome_by_name, outcome_at = excluded.outcome_at;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v.tenant_id, v.silo, me.id, me.full_name, v.silo::text, 'ShiftOutcome', 'roster', v.id::text,
          format('%s, %s: %s. %s', v.user_name,
                 public.schedule_line_label(v.template_id, v.activity_type, v.start_at, v.end_at, v.station),
                 p_outcome, btrim(p_reason)));
  perform public.schedule_alert(v.tenant_id, v.silo, v.user_id, 'shift_outcome',
    format('Recorded for your shift: %s', p_outcome),
    format('%s. %s', public.schedule_line_label(v.template_id, v.activity_type, v.start_at, v.end_at, v.station),
           btrim(p_reason)), 'Low');
end $$;

/** Punctuality for a department over a period: one row per person. */
create or replace function public.attendance_summary(p_silo public.silo, p_from date, p_to date)
returns table (
  user_id uuid, user_name text, shifts integer, started integer, late integer, late_minutes integer,
  not_started integer, excused integer, sick integer, absent integer
)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  me record;
  v_grace int;
begin
  select * into me from public.schedule_me();
  if me.id is null or not public.can_manage_roster(p_silo) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 370 then
    raise exception 'Choose up to a year' using errcode = '22023';
  end if;
  select coalesce((select grace_minutes from public.schedule_settings s
                    where s.tenant_id = me.tenant_id and s.silo = p_silo), 10) into v_grace;
  return query
    select r.user_id, max(r.user_name),
           count(*)::int,
           count(a.checked_in_at)::int,
           count(*) filter (where a.late_minutes > v_grace)::int,
           coalesce(sum(a.late_minutes) filter (where a.late_minutes > v_grace), 0)::int,
           count(*) filter (where a.checked_in_at is null and coalesce(a.outcome, '') not in ('Present', 'Excused', 'Sick', 'Swapped'))::int,
           count(*) filter (where a.outcome = 'Excused')::int,
           count(*) filter (where a.outcome = 'Sick')::int,
           count(*) filter (where a.outcome = 'Absent without leave')::int
      from public.rosters r
      left join public.shift_attendance a on a.roster_id = r.id
     where r.tenant_id = me.tenant_id and r.silo = p_silo and r.published
       and public.roster_active(r.status, r.cancelled_at)
       and r.duty_date between p_from and p_to and r.start_at < now()
     group by r.user_id
     order by max(r.user_name);
end $$;

-- ── 9. Leave ────────────────────────────────────────────────────────────────

alter table public.leave_entries
  add column if not exists days            numeric(6, 1),
  add column if not exists review_comments text,
  add column if not exists decided_by      uuid,
  add column if not exists cancelled_at    timestamptz,
  add column if not exists cancelled_by    uuid,
  add column if not exists cancel_reason   text,
  add column if not exists applicant_name  text,
  add column if not exists applied_at      timestamptz default now();

/**
 * What a leave request costs: the shifts it covers on the person's roster,
 * and, beyond the last day they are rostered, working days (Monday to Friday,
 * not public holidays).
 */
create or replace function public.leave_days(p_tenant uuid, p_user uuid, p_from date, p_to date)
returns numeric
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_silo public.silo;
  v_last date;
  v_rostered int := 0;
  v_working int := 0;
begin
  select silo into v_silo from public.profiles where id = p_user;
  if auth.uid() is not null and p_user <> auth.uid() and not public.can_manage_roster(v_silo) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
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
revoke all on function public.leave_days(uuid, uuid, date, date) from public, anon;
grant execute on function public.leave_days(uuid, uuid, date, date) to authenticated;

create or replace function public.leave_type_ok(p_tenant uuid, p_name text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select case
    when exists (select 1 from public.command_records c
                  where c.tenant_id = p_tenant and c.module = 'LeaveType' and c.status = 'Active')
      then exists (select 1 from public.command_records c
                    where c.tenant_id = p_tenant and c.module = 'LeaveType' and c.status = 'Active' and c.name = p_name)
    else p_name in ('Annual', 'Sick', 'Family Responsibility', 'Maternity/Paternity', 'Study', 'Special', 'Unpaid')
  end;
$$;
revoke all on function public.leave_type_ok(uuid, text) from public, anon;
grant execute on function public.leave_type_ok(uuid, text) to authenticated;

create or replace function public.leave_overlap(p_user uuid, p_from date, p_to date, p_exclude uuid)
returns text
language plpgsql stable security definer set search_path to 'public' as $$
declare v record;
begin
  if auth.uid() is not null and p_user <> auth.uid()
     and not public.can_manage_roster((select silo from public.profiles where id = p_user)) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select l.eff_from, l.eff_to, l.status into v from public.leave_entries l
   where l.user_id = p_user and l.id is distinct from p_exclude and l.status in ('Pending', 'Approved')
     and l.eff_from <= p_to and l.eff_to >= p_from
   limit 1;
  if not found then return null; end if;
  return format('You already have %s leave from %s to %s.', lower(v.status),
                to_char(v.eff_from, 'DD Mon'), to_char(v.eff_to, 'DD Mon YYYY'));
end $$;
revoke all on function public.leave_overlap(uuid, date, date, uuid) from public, anon;
grant execute on function public.leave_overlap(uuid, date, date, uuid) to authenticated;

-- The person asks; only the functions below decide or cancel.
create or replace function public.leave_guard() returns trigger
language plpgsql set search_path to 'public' as $$
declare
  me record;
  v_overlap text;
  v_today date := public.sa_day(now());
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Leave is never deleted. Cancel it instead.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Leave is decided or cancelled from the leave screen' using errcode = '42501';
  end if;

  select p.id, p.tenant_id, p.silo, p.full_name into me
    from public.profiles p where p.id = auth.uid() and p.deactivated_at is null;
  if not found or new.user_id is distinct from me.id then
    raise exception 'You can only ask for your own leave' using errcode = '42501';
  end if;
  new.silo := me.silo;
  new.tenant_id := me.tenant_id;
  new.status := 'Pending';
  new.approved_by := null; new.approved_at := null; new.decided_by := null; new.review_comments := null;
  new.cancelled_at := null; new.cancelled_by := null; new.cancel_reason := null;
  new.applied_at := now();
  new.applicant_name := me.full_name;
  new.reason := nullif(left(btrim(coalesce(new.reason, '')), 1000), '');

  if new.eff_from is null or new.eff_to is null or new.eff_to < new.eff_from then
    raise exception 'The last day of leave cannot be before the first' using errcode = '22023';
  end if;
  if new.eff_from < v_today - 30 or new.eff_to > v_today + 400 or new.eff_to - new.eff_from > 365 then
    raise exception 'Leave is asked for within the coming year' using errcode = '22023';
  end if;
  if not public.leave_type_ok(me.tenant_id, new.absence) then
    raise exception 'Choose a leave type from the list' using errcode = '22023';
  end if;
  v_overlap := public.leave_overlap(me.id, new.eff_from, new.eff_to, new.id);
  if v_overlap is not null then
    raise exception '%', v_overlap using errcode = 'P0001';
  end if;
  new.days := public.leave_days(me.tenant_id, me.id, new.eff_from, new.eff_to);
  return new;
end $$;

drop trigger if exists leave_guard on public.leave_entries;
create trigger leave_guard before insert or update or delete on public.leave_entries
  for each row execute function public.leave_guard();

create or replace function public.leave_requested() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare o uuid;
begin
  if new.status <> 'Pending' or new.user_id is null then return null; end if;
  for o in select distinct x from public.schedule_approvers(new.user_id) x loop
    perform public.schedule_alert(new.tenant_id, new.silo, o, 'leave_request',
      format('Leave request: %s', coalesce(new.applicant_name, 'a member')),
      format('%s leave, %s to %s (%s day%s).', coalesce(new.absence, 'Leave'),
             to_char(new.eff_from, 'DD Mon'), to_char(new.eff_to, 'DD Mon YYYY'),
             coalesce(new.days, 0), case when coalesce(new.days, 0) = 1 then '' else 's' end),
      'Low', '/leave');
  end loop;
  return null;
exception when others then return null;
end $$;
revoke all on function public.leave_requested() from public, anon, authenticated;

drop trigger if exists leave_requested on public.leave_entries;
create trigger leave_requested after insert on public.leave_entries
  for each row execute function public.leave_requested();

-- Leave is read by the person and by those who roster their department.
drop policy if exists leave_self_read on public.leave_entries;
drop policy if exists leave_admin_all on public.leave_entries;
drop policy if exists leave_read on public.leave_entries;
create policy leave_read on public.leave_entries for select to authenticated
  using (user_id = auth.uid() or public.can_manage_roster(silo));
drop policy if exists leave_self_insert on public.leave_entries;
create policy leave_self_insert on public.leave_entries for insert to authenticated
  with check (user_id = auth.uid() and status = 'Pending');

create or replace function public.decide_leave(p_id uuid, p_approve boolean, p_comment text default null)
returns public.leave_entries
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v public.leave_entries;
  v_days numeric;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select * into v from public.leave_entries where id = p_id for update;
  if not found or v.tenant_id <> me.tenant_id then raise exception 'Leave request not found' using errcode = 'P0002'; end if;
  if v.user_id = me.id then raise exception 'You cannot decide your own leave' using errcode = '42501'; end if;
  if not public.outranks(v.user_id) then
    raise exception 'Only someone senior to % in their department decides this', coalesce(v.applicant_name, 'them')
      using errcode = '42501';
  end if;
  if v.status <> 'Pending' then
    if (v.status = 'Approved' and p_approve) or (v.status = 'Rejected' and not p_approve) then return v; end if;
    raise exception 'This request was already %', lower(v.status) using errcode = '22023';
  end if;
  if not p_approve and char_length(btrim(coalesce(p_comment, ''))) < 3 then
    raise exception 'Say why the leave is not approved' using errcode = '22023';
  end if;

  v_days := public.leave_days(v.tenant_id, v.user_id, v.eff_from, v.eff_to);
  update public.leave_entries
     set status = case when p_approve then 'Approved' else 'Rejected' end,
         approved_by = me.full_name, approved_at = now(), decided_by = me.id,
         review_comments = nullif(left(btrim(coalesce(p_comment, '')), 1000), ''),
         days = case when p_approve then v_days else days end
   where id = p_id
  returning * into v;

  if p_approve then
    perform set_config('criticom.roster_quiet', 'on', true);
    update public.rosters set status = 'Leave', leave_id = v.id
     where tenant_id = v.tenant_id and user_id = v.user_id
       and duty_date between v.eff_from and v.eff_to
       and public.roster_active(status, cancelled_at);
    update public.shift_swaps s set status = 'Withdrawn'
     where s.status in ('Requested', 'Accepted')
       and exists (select 1 from public.rosters r where r.id in (s.requester_line, s.partner_line) and r.leave_id = v.id);
    perform set_config('criticom.roster_quiet', 'off', true);
  end if;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v.tenant_id, v.silo, me.id, me.full_name, v.silo::text, 'LeaveDecision', 'leave', v.id::text,
          format('%s: %s leave %s to %s %s. %s', coalesce(v.applicant_name, ''), v.absence, v.eff_from, v.eff_to,
                 lower(v.status), coalesce(v.review_comments, '')));
  perform public.schedule_alert(v.tenant_id, v.silo, v.user_id, 'leave_decision',
    case when p_approve then 'Leave approved' else 'Leave not approved' end,
    format('%s leave, %s to %s.%s', v.absence, to_char(v.eff_from, 'DD Mon'), to_char(v.eff_to, 'DD Mon YYYY'),
           coalesce(' ' || v.review_comments, '')),
    case when p_approve then 'Low' else 'Medium' end, '/leave');
  return v;
end $$;

create or replace function public.cancel_leave(p_id uuid, p_reason text default null)
returns public.leave_entries
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  v public.leave_entries;
  v_was text;
  r record;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select * into v from public.leave_entries where id = p_id for update;
  if not found or v.tenant_id <> me.tenant_id then raise exception 'Leave request not found' using errcode = 'P0002'; end if;
  if v.status = 'Cancelled' then return v; end if;
  if v.status not in ('Pending', 'Approved') then
    raise exception 'Leave that was not approved cannot be cancelled' using errcode = '22023';
  end if;
  if v.user_id = me.id then
    if v.status = 'Approved' and v.eff_from <= public.sa_day(now()) then
      raise exception 'Your leave has started. Ask your supervisor to cancel it.' using errcode = '42501';
    end if;
  else
    if not public.outranks(v.user_id) then
      raise exception 'Only % or someone senior to them can cancel this', coalesce(v.applicant_name, 'the member')
        using errcode = '42501';
    end if;
    if char_length(btrim(coalesce(p_reason, ''))) < 3 then
      raise exception 'Say why the leave is cancelled' using errcode = '22023';
    end if;
  end if;

  v_was := v.status;
  update public.leave_entries
     set status = 'Cancelled', cancelled_at = now(), cancelled_by = me.id,
         cancel_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), '')
   where id = p_id
  returning * into v;

  if v_was = 'Approved' then
    -- Shifts still ahead come back; the ones that have passed stay as leave.
    perform set_config('criticom.roster_quiet', 'on', true);
    for r in select id from public.rosters where leave_id = v.id and start_at > now() loop
      begin
        update public.rosters set status = 'Present', leave_id = null where id = r.id;
      exception when others then
        update public.rosters set status = 'Cancelled', leave_id = null, cancelled_at = now(), cancelled_by = me.id,
               cancel_reason = 'Leave cancelled; the shift clashed with another' where id = r.id;
      end;
    end loop;
    perform set_config('criticom.roster_quiet', 'off', true);
  end if;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v.tenant_id, v.silo, me.id, me.full_name, v.silo::text, 'LeaveCancelled', 'leave', v.id::text,
          format('%s: %s leave %s to %s cancelled (was %s). %s', coalesce(v.applicant_name, ''), v.absence,
                 v.eff_from, v.eff_to, lower(v_was), coalesce(v.cancel_reason, '')));
  if v.user_id <> me.id then
    perform public.schedule_alert(v.tenant_id, v.silo, v.user_id, 'leave_decision', 'Leave cancelled',
      format('%s leave, %s to %s.%s', v.absence, to_char(v.eff_from, 'DD Mon'), to_char(v.eff_to, 'DD Mon YYYY'),
             coalesce(' ' || v.cancel_reason, '')), 'Medium', '/leave');
  elsif v_was = 'Approved' and v.decided_by is not null then
    perform public.schedule_alert(v.tenant_id, v.silo, v.decided_by, 'leave_request',
      format('Leave cancelled by %s', coalesce(v.applicant_name, 'the member')),
      format('%s leave, %s to %s. Their shifts are back on the roster.', v.absence,
             to_char(v.eff_from, 'DD Mon'), to_char(v.eff_to, 'DD Mon YYYY')), 'Low', '/leave');
  end if;
  return v;
end $$;

-- ── 10. Swaps ───────────────────────────────────────────────────────────────

create table if not exists public.shift_swaps (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default public.current_tenant(),
  silo             public.silo not null,
  requester_id     uuid not null,
  requester_line   uuid not null references public.rosters (id) on delete cascade,
  partner_id       uuid not null,
  partner_line     uuid not null references public.rosters (id) on delete cascade,
  note             text,
  status           text not null default 'Requested'
                   check (status in ('Requested', 'Accepted', 'Declined', 'Approved', 'Refused', 'Withdrawn', 'Expired')),
  responded_at     timestamptz,
  decided_by       uuid,
  decided_by_name  text,
  decided_at       timestamptz,
  decision_comment text,
  created_at       timestamptz not null default now()
);
create unique index if not exists shift_swaps_open_requester on public.shift_swaps (requester_line)
  where status in ('Requested', 'Accepted');
create unique index if not exists shift_swaps_open_partner on public.shift_swaps (partner_line)
  where status in ('Requested', 'Accepted');
alter table public.shift_swaps enable row level security;
drop policy if exists tenant_isolation on public.shift_swaps;
create policy tenant_isolation on public.shift_swaps as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
drop policy if exists shift_swaps_read on public.shift_swaps;
create policy shift_swaps_read on public.shift_swaps for select to authenticated
  using (requester_id = auth.uid() or partner_id = auth.uid() or public.can_manage_roster(silo));
revoke all on public.shift_swaps from anon;
revoke insert, update, delete on public.shift_swaps from authenticated;

create or replace function public.request_swap(p_id uuid, p_my_line uuid, p_their_line uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  a public.rosters;
  b public.rosters;
  v_clash text;
  v_existing public.shift_swaps;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  -- A resend of a request already made returns it.
  select * into v_existing from public.shift_swaps where id = p_id;
  if found then
    if v_existing.requester_id = me.id then return v_existing.id; end if;
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  select * into a from public.rosters where id = p_my_line;
  select * into b from public.rosters where id = p_their_line;
  if a.id is null or b.id is null or a.tenant_id <> me.tenant_id or b.tenant_id <> me.tenant_id then
    raise exception 'Shift not found' using errcode = 'P0002';
  end if;
  if a.user_id <> me.id then raise exception 'Offer one of your own shifts' using errcode = '42501'; end if;
  if b.user_id = me.id then raise exception 'Choose a colleague''s shift' using errcode = '22023'; end if;
  if a.silo <> b.silo then raise exception 'Swaps are within your department' using errcode = '22023'; end if;
  if not (a.published and b.published and public.roster_active(a.status, a.cancelled_at)
          and public.roster_active(b.status, b.cancelled_at)) then
    raise exception 'Both shifts must be on the issued roster' using errcode = '22023';
  end if;
  if a.start_at <= now() + interval '1 hour' or b.start_at <= now() + interval '1 hour' then
    raise exception 'A shift starting within the hour cannot be swapped' using errcode = '22023';
  end if;
  if a.start_at < b.end_at and b.start_at < a.end_at then
    raise exception 'Those shifts overlap. Ask your supervisor to change posts instead.' using errcode = '22023';
  end if;
  v_clash := public.roster_clash_internal(b.tenant_id, b.user_id, a.start_at, a.end_at, b.id, null, null);
  if v_clash is not null then raise exception '%', v_clash using errcode = 'P0001'; end if;
  v_clash := public.roster_clash_internal(a.tenant_id, a.user_id, b.start_at, b.end_at, a.id, null, null);
  if v_clash is not null then raise exception '%', v_clash using errcode = 'P0001'; end if;

  insert into public.shift_swaps (id, tenant_id, silo, requester_id, requester_line, partner_id, partner_line, note)
  values (p_id, a.tenant_id, a.silo, me.id, a.id, b.user_id, b.id, nullif(left(btrim(coalesce(p_note, '')), 300), ''));

  perform public.schedule_alert(a.tenant_id, a.silo, b.user_id, 'swap',
    format('Swap request from %s', me.full_name),
    format('Your %s for their %s. Open My Schedule to answer.',
           public.schedule_line_label(b.template_id, b.activity_type, b.start_at, b.end_at, b.station),
           public.schedule_line_label(a.template_id, a.activity_type, a.start_at, a.end_at, a.station)));
  return p_id;
end $$;

create or replace function public.respond_swap(p_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  s public.shift_swaps;
  o uuid;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select * into s from public.shift_swaps where id = p_id for update;
  if not found or s.partner_id <> me.id then raise exception 'Swap not found' using errcode = 'P0002'; end if;
  if (s.status = 'Accepted' and p_accept) or (s.status = 'Declined' and not p_accept) then return; end if;
  if s.status <> 'Requested' then raise exception 'This swap is %', lower(s.status) using errcode = '22023'; end if;

  update public.shift_swaps set status = case when p_accept then 'Accepted' else 'Declined' end, responded_at = now()
   where id = p_id;
  perform public.schedule_alert(s.tenant_id, s.silo, s.requester_id, 'swap',
    case when p_accept then format('%s accepted your swap', me.full_name) else format('%s declined your swap', me.full_name) end,
    case when p_accept then 'It goes to your supervisor to approve.' else 'Your shift stays yours.' end);
  if p_accept then
    for o in select distinct x from public.schedule_approvers(s.requester_id) x loop
      perform public.schedule_alert(s.tenant_id, s.silo, o, 'swap_waiting', 'Shift swap to approve',
        format('%s and %s want to swap shifts.', (select full_name from public.profiles where id = s.requester_id), me.full_name),
        'Low', '/roster');
    end loop;
  end if;
end $$;

create or replace function public.decide_swap(p_id uuid, p_approve boolean, p_comment text default null) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  s public.shift_swaps;
  a public.rosters;
  b public.rosters;
  v_req record;
  v_par record;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select * into s from public.shift_swaps where id = p_id for update;
  if not found or s.tenant_id <> me.tenant_id then raise exception 'Swap not found' using errcode = 'P0002'; end if;
  if me.id in (s.requester_id, s.partner_id) then raise exception 'You cannot approve your own swap' using errcode = '42501'; end if;
  if not (public.can_manage_roster(s.silo) and public.outranks(s.requester_id) and public.outranks(s.partner_id)) then
    raise exception 'Only someone senior to both decides this swap' using errcode = '42501';
  end if;
  if (s.status = 'Approved' and p_approve) or (s.status = 'Refused' and not p_approve) then return; end if;
  if s.status <> 'Accepted' then raise exception 'This swap is %', lower(s.status) using errcode = '22023'; end if;
  if not p_approve and char_length(btrim(coalesce(p_comment, ''))) < 3 then
    raise exception 'Say why the swap is refused' using errcode = '22023';
  end if;

  if p_approve then
    select * into a from public.rosters where id = s.requester_line for update;
    select * into b from public.rosters where id = s.partner_line for update;
    if a.user_id <> s.requester_id or b.user_id <> s.partner_id
       or not public.roster_active(a.status, a.cancelled_at) or not public.roster_active(b.status, b.cancelled_at)
       or a.start_at <= now() or b.start_at <= now() then
      update public.shift_swaps set status = 'Expired' where id = p_id;
      raise exception 'The shifts have changed since the swap was asked for' using errcode = '22023';
    end if;
    select full_name, badge_number into v_req from public.profiles where id = s.requester_id;
    select full_name, badge_number into v_par from public.profiles where id = s.partner_id;
    perform set_config('criticom.roster_quiet', 'on', true);
    update public.rosters set user_id = s.partner_id, user_name = v_par.full_name, badge_number = v_par.badge_number,
           acknowledged_at = null where id = a.id;
    update public.rosters set user_id = s.requester_id, user_name = v_req.full_name, badge_number = v_req.badge_number,
           acknowledged_at = null where id = b.id;
    perform set_config('criticom.roster_quiet', 'off', true);
  end if;

  update public.shift_swaps
     set status = case when p_approve then 'Approved' else 'Refused' end,
         decided_by = me.id, decided_by_name = me.full_name, decided_at = now(),
         decision_comment = nullif(left(btrim(coalesce(p_comment, '')), 500), '')
   where id = p_id;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (s.tenant_id, s.silo, me.id, me.full_name, s.silo::text, 'ShiftSwap', 'shift_swap', s.id::text,
          case when p_approve then 'Swap approved' else 'Swap refused: ' || btrim(p_comment) end);
  perform public.schedule_alert(s.tenant_id, s.silo, s.requester_id, 'swap',
    case when p_approve then 'Swap approved' else 'Swap not approved' end,
    case when p_approve then 'Your roster has changed. Open My Schedule to confirm.' else btrim(p_comment) end);
  perform public.schedule_alert(s.tenant_id, s.silo, s.partner_id, 'swap',
    case when p_approve then 'Swap approved' else 'Swap not approved' end,
    case when p_approve then 'Your roster has changed. Open My Schedule to confirm.' else btrim(p_comment) end);
end $$;

create or replace function public.withdraw_swap(p_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  me record;
  s public.shift_swaps;
begin
  select * into me from public.schedule_me();
  if me.id is null then raise exception 'Sign in again' using errcode = '42501'; end if;
  select * into s from public.shift_swaps where id = p_id for update;
  if not found or s.requester_id <> me.id then raise exception 'Swap not found' using errcode = 'P0002'; end if;
  if s.status = 'Withdrawn' then return; end if;
  if s.status not in ('Requested', 'Accepted') then raise exception 'This swap is %', lower(s.status) using errcode = '22023'; end if;
  update public.shift_swaps set status = 'Withdrawn' where id = p_id;
  perform public.schedule_alert(s.tenant_id, s.silo, s.partner_id, 'swap',
    format('%s withdrew the swap', me.full_name), 'Your shift stays yours.', 'Low');
end $$;

-- ── 11. An account deactivated leaves the roster ────────────────────────────

create or replace function public.deactivated_leaves_roster() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.deactivated_at is not null and old.deactivated_at is null then
    perform set_config('criticom.roster_quiet', 'on', true);
    update public.rosters
       set cancelled_at = now(), status = 'Cancelled', cancel_reason = 'Account deactivated'
     where user_id = new.id and start_at > now() and cancelled_at is null;
    update public.shift_swaps set status = 'Withdrawn'
     where (requester_id = new.id or partner_id = new.id) and status in ('Requested', 'Accepted');
    perform set_config('criticom.roster_quiet', 'off', true);
  end if;
  return null;
end $$;
revoke all on function public.deactivated_leaves_roster() from public, anon, authenticated;

drop trigger if exists deactivated_leaves_roster on public.profiles;
create trigger deactivated_leaves_roster after update of deactivated_at on public.profiles
  for each row execute function public.deactivated_leaves_roster();

-- ── 12. Late and not started: the minute-by-minute check ────────────────────

create or replace function public.schedule_attendance_tick()
returns table (affected integer, detail text)
language plpgsql security definer set search_path to 'public' as $$
declare
  r record;
  o uuid;
  v_on boolean;
  v_since timestamptz;
  v_clock timestamptz;
  v_label text;
  v_mins int;
  n_late int := 0;
  n_noshow int := 0;
  n_found int := 0;
begin
  -- Swaps whose shifts have begun can no longer happen.
  update public.shift_swaps s set status = 'Expired'
   where s.status in ('Requested', 'Accepted')
     and exists (select 1 from public.rosters x where x.id in (s.requester_line, s.partner_line) and x.start_at <= now());

  for r in
    select ro.id, ro.tenant_id, ro.silo, ro.user_id, ro.user_name, ro.start_at, ro.end_at, ro.station,
           ro.template_id, ro.activity_type, ro.duty_date,
           a.late_alerted_at, a.noshow_alerted_at,
           coalesce(ss.grace_minutes, 10) as grace, coalesce(ss.noshow_minutes, 60) as noshow
      from public.rosters ro
      left join public.shift_attendance a on a.roster_id = ro.id
      left join public.schedule_settings ss on ss.tenant_id = ro.tenant_id and ss.silo = ro.silo
     where ro.published and public.roster_active(ro.status, ro.cancelled_at)
       and ro.user_id is not null
       and ro.start_at > now() - interval '26 hours' and ro.end_at > now()
       and ro.start_at <= now() - make_interval(mins => coalesce(ss.grace_minutes, 10))
       and a.checked_in_at is null and a.outcome is null
       and (a.late_alerted_at is null
            or (a.noshow_alerted_at is null
                and ro.start_at <= now() - make_interval(mins => coalesce(ss.noshow_minutes, 60))))
     order by ro.start_at
     limit 500
  loop
    -- Already working: on duty in the app, or clocked in at the console.
    select pe.is_on_duty, pe.duty_started_at into v_on, v_since
      from public.personnel pe where pe.user_id = r.user_id limit 1;
    if coalesce(v_on, false) then
      perform public.schedule_check_in(r.user_id, greatest(coalesce(v_since, now()), r.start_at - interval '3 hours'),
                                       'start_of_shift');
      n_found := n_found + 1;
      continue;
    end if;
    select ev.at into v_clock from public.attendance_events ev
     where ev.user_id = r.user_id and ev.kind = 'clock_in' and ev.at >= r.start_at - interval '3 hours' and ev.at < r.end_at
       and not exists (select 1 from public.attendance_events oe
                        where oe.user_id = r.user_id and oe.kind = 'clock_out' and oe.at > ev.at)
     order by ev.at limit 1;
    if v_clock is not null then
      perform public.schedule_check_in(r.user_id, v_clock, 'clock_in');
      n_found := n_found + 1;
      continue;
    end if;

    v_label := public.schedule_line_label(r.template_id, r.activity_type, r.start_at, r.end_at, r.station);
    v_mins := floor(extract(epoch from (now() - r.start_at)) / 60)::int;

    if r.late_alerted_at is null then
      insert into public.shift_attendance (roster_id, tenant_id, silo, user_id, start_at, end_at, late_alerted_at)
      values (r.id, r.tenant_id, r.silo, r.user_id, r.start_at, r.end_at, now())
      on conflict (roster_id) do update set late_alerted_at = now()
       where shift_attendance.late_alerted_at is null;
      perform public.schedule_alert(r.tenant_id, r.silo, r.user_id, 'shift_late', 'You are late for your shift',
        format('%s. Start your shift now, or tell your supervisor.', v_label), 'High');
      for o in select distinct x from public.schedule_overseers(r.user_id, false) x loop
        perform public.schedule_alert(r.tenant_id, r.silo, o, 'shift_team_late', format('Late: %s', r.user_name),
          format('%s. Not started %s min after the start.', v_label, v_mins), 'Medium',
          '/roster/allocation?date=' || r.duty_date::text);
      end loop;
      n_late := n_late + 1;
    else
      update public.shift_attendance set noshow_alerted_at = now()
       where roster_id = r.id and noshow_alerted_at is null;
      perform public.schedule_alert(r.tenant_id, r.silo, r.user_id, 'shift_noshow', 'You have not started your shift',
        format('%s. Your supervisor has been told.', v_label), 'High');
      for o in select distinct x from public.schedule_overseers(r.user_id, true) x loop
        perform public.schedule_alert(r.tenant_id, r.silo, o, 'shift_team_noshow', format('Not started: %s', r.user_name),
          format('%s. Not started %s min after the start.', v_label, v_mins), 'High',
          '/roster/allocation?date=' || r.duty_date::text);
      end loop;
      n_noshow := n_noshow + 1;
    end if;
  end loop;

  return query select n_late + n_noshow + n_found,
    case when n_late + n_noshow + n_found = 0 then 'Everyone due has started'
    else format('%s late, %s not started, %s found already working', n_late, n_noshow, n_found) end;
end $$;
revoke all on function public.schedule_attendance_tick() from public, anon, authenticated;

-- "Confirm your next duty" goes to the phone, and skips shifts not worked.
create or replace function public.automation_duty_unacknowledged(p_config jsonb)
returns table (affected int, detail text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_lead int := public.automation_cfg_int(p_config, 'lead_hours', 12);
  v_count int := 0;
  r record;
begin
  for r in
    select ro.id, ro.tenant_id, ro.silo, ro.user_id, ro.template_id, ro.activity_type, ro.start_at, ro.end_at, ro.station
      from public.rosters ro
     where ro.published and ro.acknowledged_at is null and ro.user_id is not null
       and public.roster_active(ro.status, ro.cancelled_at)
       and ro.start_at between now() and now() + make_interval(hours => v_lead)
     limit 300
  loop
    if public.automation_claim('duty_unacknowledged', r.id::text, 'reminder') then
      perform public.schedule_alert(r.tenant_id, r.silo, r.user_id, 'shift_confirm', 'Confirm your next shift',
        public.schedule_line_label(r.template_id, r.activity_type, r.start_at, r.end_at, r.station) || '.');
      v_count := v_count + 1;
    end if;
  end loop;
  return query select v_count,
    case when v_count = 0 then 'All imminent duties acknowledged'
    else format('%s unacknowledged duty reminder(s)', v_count) end;
end $$;

insert into public.automation_rules (key, name, description, interval_minutes, config) values
  ('shift_attendance', 'Late and not started',
   'Tells a member, and whoever oversees them, when they have not started their shift: late after the department''s grace minutes, not started after its no-show minutes (Shift setup).',
   1, '{}'::jsonb)
on conflict (key) do update set name = excluded.name, description = excluded.description;

-- The engine (0028), with the new rule.
create or replace function public.run_automations(p_force_key text default null)
returns table (rule_key text, status text, affected int, detail text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r        record;
  v_run_id bigint;
  v_res    record;
begin
  for r in
    select * from public.automation_rules
     where (p_force_key is not null and key = p_force_key)
        or (p_force_key is null
            and enabled
            and (last_run_at is null
                 or last_run_at < now() - make_interval(mins => interval_minutes)))
     order by key
  loop
    insert into public.automation_runs (rule_key, triggered_by)
    values (r.key, auth.uid())
    returning id into v_run_id;

    begin
      case r.key
        when 'sla_unassigned'      then select * into v_res from public.automation_sla_unassigned(r.config);
        when 'sla_no_arrival'      then select * into v_res from public.automation_sla_no_arrival(r.config);
        when 'stale_incidents'     then select * into v_res from public.automation_stale_incidents(r.config);
        when 'cert_expiry'         then select * into v_res from public.automation_cert_expiry(r.config);
        when 'duty_unacknowledged' then select * into v_res from public.automation_duty_unacknowledged(r.config);
        when 'daily_digest'        then select * into v_res from public.automation_daily_digest(r.config);
        when 'hygiene'             then select * into v_res from public.automation_hygiene(r.config);
        when 'rate_limit_gc'       then select * into v_res from public.automation_rate_limit_gc(r.config);
        when 'shift_attendance'    then select * into v_res from public.schedule_attendance_tick();
        else
          raise exception 'Unknown automation rule "%"', r.key;
      end case;

      update public.automation_runs
         set finished_at = now(), status = 'ok',
             affected = v_res.affected, detail = v_res.detail
       where id = v_run_id;

      update public.automation_rules
         set last_run_at = now(), last_status = 'ok', last_detail = v_res.detail,
             updated_at = now()
       where key = r.key;

      rule_key := r.key; status := 'ok';
      affected := v_res.affected; detail := v_res.detail;
      return next;

    exception when others then
      update public.automation_runs
         set finished_at = now(), status = 'error', detail = sqlerrm
       where id = v_run_id;

      update public.automation_rules
         set last_run_at = now(), last_status = 'error', last_detail = sqlerrm,
             updated_at = now()
       where key = r.key;

      rule_key := r.key; status := 'error'; affected := 0; detail := sqlerrm;
      return next;
    end;
  end loop;
end $$;

revoke execute on function public.run_automations(text) from public, anon, authenticated;
grant execute on function public.run_automations(text) to service_role;

-- The engine is asked every minute; each rule still keeps its own interval.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not present. Call public.run_automations() every minute from an external scheduler.';
    return;
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'criticom-automations';
  perform cron.schedule('criticom-automations', '* * * * *', $job$ select public.run_automations(); $job$);
  raise notice 'criticom-automations now runs every minute.';
exception when others then
  raise notice 'Could not reschedule criticom-automations (%).', sqlerrm;
end $$;

-- ── 13. Who may call what ───────────────────────────────────────────────────

do $$
declare f text;
begin
  foreach f in array array[
    'public.add_shift(uuid, date, uuid, boolean, text)',
    'public.generate_roster(uuid, date, date, text[])',
    'public.publish_roster(public.silo, date, date)',
    'public.cancel_shift(uuid, text)',
    'public.assign_post(uuid, date, uuid, uuid)',
    'public.clear_post(uuid)',
    'public.copy_roster_day(public.silo, date, date)',
    'public.set_member_team(uuid, text)',
    'public.start_my_shift()',
    'public.record_shift_outcome(uuid, text, text)',
    'public.attendance_summary(public.silo, date, date)',
    'public.decide_leave(uuid, boolean, text)',
    'public.cancel_leave(uuid, text)',
    'public.request_swap(uuid, uuid, uuid, text)',
    'public.respond_swap(uuid, boolean)',
    'public.decide_swap(uuid, boolean, text)',
    'public.withdraw_swap(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
