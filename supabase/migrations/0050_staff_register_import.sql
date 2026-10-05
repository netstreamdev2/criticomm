-- ============================================================================
-- 0050 — The staff register: importing HR's staff list, role review, leavers
-- ============================================================================
--
-- Run after 0049.
--
-- Agreed design: apps/web/handbook/staff-onboarding.html, "Bringing
-- eThekwini's staff across".
--
--   1. A SystemAdmin imports HR's staff list. The file is checked in their
--      browser; only the rows they confirm reach these functions, which check
--      every row again. People are matched by badge number: an existing one
--      is updated in place, a new one is added, nobody is ever duplicated.
--      A blank cell never erases what the register holds.
--   2. Importing grants nothing. It fills the register; only an invitation,
--      accepted by the person themselves, creates an account (0049). An
--      account holder's department is never changed by an import: that is a
--      role change, made on their account page (0048).
--   3. Every import is a permanent record: who, when, the file's name and
--      fingerprint, the reason, and how many people were added and updated.
--   4. Role review: each person gets a suggested role. A SystemAdmin, or a
--      department Admin for their own department, confirms it before
--      invitations go out in bulk. Administrator roles are never set this way:
--      they are invited one at a time, with a second SystemAdmin's approval.
--   5. Leavers are checked, not guessed: people a staff list leaves out are
--      shown for review, and an administrator marks them as left, with a
--      reason. A leaver's open invitations are cancelled.
--
-- A badge number belongs to one current person. New duplicates are refused;
-- duplicates already in a register stay workable and are shown for cleanup.
-- Once there are none, a unique index makes the rule permanent (re-run this
-- migration after cleaning up to add it).
--
-- Safe to re-run.
-- ============================================================================

begin;

-- ── 1. What the register holds ──────────────────────────────────────────────

alter table public.personnel
  add column if not exists work_email             text,
  add column if not exists work_cellphone         text,
  -- The role they hold in the system they come from, as HR's list gave it.
  add column if not exists previous_role          text,
  -- The role they will be invited as; confirmed by an administrator.
  add column if not exists proposed_role          public.user_role,
  add column if not exists role_confirmed_at      timestamptz,
  add column if not exists role_confirmed_by      uuid,
  add column if not exists role_confirmed_by_name text,
  -- The last staff list that named them, and when.
  add column if not exists hr_import_id           uuid,
  add column if not exists hr_seen_at             timestamptz,
  add column if not exists left_at                timestamptz,
  add column if not exists left_reason            text,
  add column if not exists left_by                uuid,
  add column if not exists left_by_name           text;

alter table public.personnel drop constraint if exists personnel_proposed_role_check;
alter table public.personnel add constraint personnel_proposed_role_check check (
  proposed_role is null or proposed_role::text not in (
    'SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'System',
    'Officer', 'Metro', 'Chief', 'Operator', 'Responder', 'Security', 'Citizen'));

create index if not exists personnel_badge_lookup
  on public.personnel (tenant_id, public.normalise_badge(badge_number));

-- One current person per badge number, enforced as people are added or
-- renumbered. Rows already sharing a badge are left alone, so duty, dispatch
-- and every other update keep working while they are cleaned up.
create or replace function public.guard_personnel_badge() returns trigger
language plpgsql set search_path to 'public' as $$
declare
  v_other text;
begin
  if new.left_at is not null then return new; end if;
  if tg_op = 'UPDATE'
     and public.normalise_badge(new.badge_number) = public.normalise_badge(old.badge_number)
     and new.tenant_id is not distinct from old.tenant_id
     and old.left_at is null then
    return new;
  end if;
  if public.normalise_badge(new.badge_number) = '' then
    raise exception 'Every person in the staff register needs a badge or force number' using errcode = '22023';
  end if;
  select btrim(first_name || ' ' || last_name) into v_other
    from public.personnel
   where tenant_id = new.tenant_id and id <> new.id and left_at is null
     and public.normalise_badge(badge_number) = public.normalise_badge(new.badge_number)
   limit 1;
  if found then
    raise exception 'Badge number % already belongs to % in the staff register', btrim(new.badge_number), v_other
      using errcode = '23505';
  end if;
  return new;
end $$;

drop trigger if exists guard_personnel_badge on public.personnel;
create trigger guard_personnel_badge before insert or update of badge_number, tenant_id, left_at on public.personnel
  for each row execute function public.guard_personnel_badge();

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'personnel_one_badge') then
    if exists (select 1 from public.personnel where left_at is null
                group by tenant_id, public.normalise_badge(badge_number) having count(*) > 1) then
      raise notice 'Some badge numbers belong to more than one person in the staff register. New duplicates are refused; clean these up (Admin → Personnel lists them), then re-run 0050 to make the rule permanent.';
    else
      create unique index personnel_one_badge
        on public.personnel (tenant_id, public.normalise_badge(badge_number)) where left_at is null;
    end if;
  end if;
end $$;

-- Role review, import bookkeeping and leaving change only through the
-- functions below: they record who decided, and check they may.
create or replace function public.guard_register_review() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if (new.previous_role, new.proposed_role, new.role_confirmed_at, new.role_confirmed_by, new.role_confirmed_by_name,
        new.hr_import_id, new.hr_seen_at, new.left_at, new.left_reason, new.left_by, new.left_by_name)
       is distinct from (null::text, null::public.user_role, null::timestamptz, null::uuid, null::text,
                         null::uuid, null::timestamptz, null::timestamptz, null::text, null::uuid, null::text) then
      raise exception 'Roles for invitation, imports and leaving are recorded through the staff register screens'
        using errcode = '42501';
    end if;
  elsif (new.previous_role, new.proposed_role, new.role_confirmed_at, new.role_confirmed_by, new.role_confirmed_by_name,
         new.hr_import_id, new.hr_seen_at, new.left_at, new.left_reason, new.left_by, new.left_by_name)
        is distinct from
        (old.previous_role, old.proposed_role, old.role_confirmed_at, old.role_confirmed_by, old.role_confirmed_by_name,
         old.hr_import_id, old.hr_seen_at, old.left_at, old.left_reason, old.left_by, old.left_by_name) then
    raise exception 'Roles for invitation, imports and leaving are recorded through the staff register screens'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_register_review on public.personnel;
create trigger guard_register_review before insert or update on public.personnel
  for each row execute function public.guard_register_review();

-- Someone who has left cannot be invited.
create or replace function public.guard_invite_leaver() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if exists (select 1 from public.personnel where id = new.personnel_id and left_at is not null) then
    raise exception '% has left the organisation. Bring them back in the staff register before inviting them.',
      new.full_name using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists guard_invite_leaver on public.account_invitations;
create trigger guard_invite_leaver before insert on public.account_invitations
  for each row execute function public.guard_invite_leaver();

-- ── 2. Every import, permanently ────────────────────────────────────────────

create table if not exists public.staff_imports (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  imported_by      uuid not null,
  imported_by_name text,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  status           text not null default 'in_progress' check (status in ('in_progress', 'complete')),
  file_name        text not null,
  -- SHA-256 of the exact file, so the list used can be matched later.
  file_sha256      text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  reason           text not null,
  -- The departments the list covers: people in them it leaves out are shown for review.
  departments      public.silo[] not null,
  row_count        int not null,
  skipped          int not null default 0,
  added            int not null default 0,
  updated          int not null default 0,
  unchanged        int not null default 0,
  not_listed       int
);
create index if not exists staff_imports_tenant_idx on public.staff_imports (tenant_id, started_at desc);

alter table public.staff_imports enable row level security;
drop policy if exists staff_imports_read on public.staff_imports;
create policy staff_imports_read on public.staff_imports for select to authenticated
  using (public.role_in('SystemAdmin', 'SuperAdmin', 'Admin'));
drop policy if exists tenant_isolation on public.staff_imports;
create policy tenant_isolation on public.staff_imports as restrictive for all to authenticated
  using (tenant_id = (select public.current_tenant()))
  with check (tenant_id = (select public.current_tenant()));

create or replace function public.guard_staff_import() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Staff-list imports are a permanent record' using errcode = '42501';
  end if;
  if old.status = 'complete' then
    raise exception 'A finished import cannot be changed' using errcode = '42501';
  end if;
  if (new.tenant_id, new.imported_by, new.started_at, new.file_name, new.file_sha256, new.reason, new.departments,
      new.row_count, new.skipped)
     is distinct from
     (old.tenant_id, old.imported_by, old.started_at, old.file_name, old.file_sha256, old.reason, old.departments,
      old.row_count, old.skipped) then
    raise exception 'Who imported what, and why, cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_staff_import on public.staff_imports;
create trigger guard_staff_import before update or delete on public.staff_imports
  for each row execute function public.guard_staff_import();

-- ── 3. Importing ────────────────────────────────────────────────────────────

create or replace function public.register_actor() returns public.profiles
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_actor public.profiles;
begin
  select * into v_actor from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Not signed in' using errcode = '42501'; end if;
  return v_actor;
end $$;
revoke all on function public.register_actor() from public, anon, authenticated;

-- Open an import. The browser has already checked the file; it says what it
-- found so the record is complete even if the upload stops half-way.
create or replace function public.start_staff_import(
  p_file_name   text,
  p_file_sha256 text,
  p_reason      text,
  p_departments public.silo[],
  p_row_count   int,
  p_skipped     int
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor public.profiles := public.register_actor();
  v_id    uuid;
begin
  if v_actor.role not in ('SystemAdmin', 'SuperAdmin') then
    raise exception 'Only a SystemAdmin can import the staff list' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give a reason of at least 10 characters: it goes on the permanent record' using errcode = '22023';
  end if;
  if coalesce(p_file_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'The file fingerprint is missing' using errcode = '22023';
  end if;
  if coalesce(array_length(p_departments, 1), 0) = 0 then
    raise exception 'The list names no department' using errcode = '22023';
  end if;
  insert into public.staff_imports (tenant_id, imported_by, imported_by_name, file_name, file_sha256, reason,
                                    departments, row_count, skipped)
  values (public.current_tenant(), v_actor.id, v_actor.full_name, left(btrim(coalesce(p_file_name, 'staff list')), 200),
          p_file_sha256, btrim(p_reason), p_departments, greatest(coalesce(p_row_count, 0), 0),
          greatest(coalesce(p_skipped, 0), 0))
  returning id into v_id;
  return v_id;
end $$;

-- Add or update up to 1,000 people. Every row is checked again here; one bad
-- row refuses the batch, naming the row, so nothing half-applies.
create or replace function public.import_staff_rows(p_import uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor   public.profiles := public.register_actor();
  v_import  public.staff_imports;
  v_row     jsonb;
  v_line    text;
  v_badge   text;
  v_first   text;
  v_last    text;
  v_rank    text;
  v_silo    public.silo;
  v_station text;
  v_email   text;
  v_phone   text;
  v_prev    text;
  v_force   text;
  v_role    public.user_role;
  v_matches int;
  v_person  public.personnel;
  v_added   int := 0;
  v_updated int := 0;
  v_same    int := 0;
begin
  select * into v_import from public.staff_imports
   where id = p_import and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'No such import in your organisation' using errcode = 'P0002'; end if;
  if v_import.imported_by <> v_actor.id or v_import.status <> 'in_progress' then
    raise exception 'This import is finished, or belongs to someone else' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Send at most 1,000 rows at a time' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_line    := coalesce(v_row ->> 'line', '?');
    v_badge   := btrim(coalesce(v_row ->> 'badge_number', ''));
    v_first   := btrim(coalesce(v_row ->> 'first_name', ''));
    v_last    := btrim(coalesce(v_row ->> 'last_name', ''));
    v_rank    := btrim(coalesce(v_row ->> 'rank', ''));
    v_station := nullif(btrim(coalesce(v_row ->> 'station', '')), '');
    v_email   := nullif(lower(btrim(coalesce(v_row ->> 'work_email', ''))), '');
    v_phone   := nullif(regexp_replace(coalesce(v_row ->> 'work_cellphone', ''), '[^0-9+]', '', 'g'), '');
    v_prev    := nullif(btrim(coalesce(v_row ->> 'previous_role', '')), '');
    v_force   := nullif(btrim(coalesce(v_row ->> 'force_number', '')), '');

    if public.normalise_badge(v_badge) = '' then
      raise exception 'Row %: no badge or force number', v_line using errcode = '22023';
    end if;
    if v_first = '' or v_last = '' then
      raise exception 'Row %: first names and surname are both needed', v_line using errcode = '22023';
    end if;
    if v_rank = '' then raise exception 'Row %: no rank', v_line using errcode = '22023'; end if;
    if length(v_first) > 100 or length(v_last) > 100 or length(v_rank) > 80 or length(v_badge) > 40
       or length(coalesce(v_station, '')) > 120 or length(coalesce(v_prev, '')) > 60 then
      raise exception 'Row %: a value is too long', v_line using errcode = '22023';
    end if;
    begin
      v_silo := (v_row ->> 'silo')::public.silo;
    exception when others then
      raise exception 'Row %: unknown department', v_line using errcode = '22023';
    end;
    if v_silo is null or not (v_silo = any (v_import.departments)) then
      raise exception 'Row %: department is not one this import covers', v_line using errcode = '22023';
    end if;
    if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'Row %: % is not an email address', v_line, v_email using errcode = '22023';
    end if;
    if v_phone is not null and length(regexp_replace(v_phone, '\D', '', 'g')) not between 9 and 15 then
      raise exception 'Row %: % is not a cellphone number', v_line, v_phone using errcode = '22023';
    end if;
    v_role := null;
    if nullif(v_row ->> 'proposed_role', '') is not null then
      begin
        v_role := (v_row ->> 'proposed_role')::public.user_role;
      exception when others then
        v_role := null;
      end;
      -- A suggestion only, and never an administrator role.
      if v_role is not null and (public.is_powerful_role(v_role)
         or v_role::text in ('System', 'Officer', 'Metro', 'Chief', 'Operator', 'Responder', 'Security', 'Citizen')) then
        v_role := null;
      end if;
    end if;

    select count(*) into v_matches from public.personnel
     where tenant_id = v_import.tenant_id and public.normalise_badge(badge_number) = public.normalise_badge(v_badge);
    if v_matches > 1 then
      raise exception 'Row %: badge % belongs to more than one person in the register. Fix that first.', v_line, v_badge
        using errcode = '23505';
    end if;

    if v_matches = 0 then
      insert into public.personnel (tenant_id, silo, first_name, last_name, badge_number, rank, station, work_email,
                                    work_cellphone, previous_role, force_number, proposed_role, hr_import_id, hr_seen_at)
      values (v_import.tenant_id, v_silo, v_first, v_last, v_badge, v_rank, v_station, v_email, v_phone, v_prev, v_force,
              v_role, v_import.id, now());
      v_added := v_added + 1;
    else
      select * into v_person from public.personnel
       where tenant_id = v_import.tenant_id and public.normalise_badge(badge_number) = public.normalise_badge(v_badge)
       for update;
      -- A blank cell never erases; an account holder's department is changed on their account page.
      if (v_person.first_name, v_person.last_name, v_person.rank, v_person.station, v_person.work_email,
          v_person.work_cellphone, v_person.previous_role, v_person.force_number,
          case when v_person.user_id is null then v_silo else v_person.silo end)
         is distinct from
         (v_first, v_last, v_rank, coalesce(v_station, v_person.station), coalesce(v_email, v_person.work_email),
          coalesce(v_phone, v_person.work_cellphone), coalesce(v_prev, v_person.previous_role),
          coalesce(v_force, v_person.force_number), v_person.silo)
         or v_person.left_at is not null then
        v_updated := v_updated + 1;
      else
        v_same := v_same + 1;
      end if;
      update public.personnel
         set first_name     = v_first,
             last_name      = v_last,
             rank           = v_rank,
             silo           = case when user_id is null then v_silo else silo end,
             station        = coalesce(v_station, station),
             work_email     = coalesce(v_email, work_email),
             work_cellphone = coalesce(v_phone, work_cellphone),
             previous_role  = coalesce(v_prev, previous_role),
             force_number   = coalesce(v_force, force_number),
             proposed_role  = case when user_id is null and role_confirmed_at is null and v_role is not null
                                   then v_role else proposed_role end,
             hr_import_id   = v_import.id,
             hr_seen_at     = now(),
             left_at = null, left_reason = null, left_by = null, left_by_name = null,
             updated_at     = now()
       where id = v_person.id;
    end if;
  end loop;

  update public.staff_imports
     set added = added + v_added, updated = updated + v_updated, unchanged = unchanged + v_same
   where id = v_import.id;
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'unchanged', v_same);
end $$;

-- Close the import: count who it left out, and write the audit trail.
create or replace function public.finish_staff_import(p_import uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor  public.profiles := public.register_actor();
  v_import public.staff_imports;
  v_missing int;
begin
  select * into v_import from public.staff_imports
   where id = p_import and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'No such import in your organisation' using errcode = 'P0002'; end if;
  if v_import.imported_by <> v_actor.id or v_import.status <> 'in_progress' then
    raise exception 'This import is finished, or belongs to someone else' using errcode = '42501';
  end if;
  select count(*) into v_missing from public.personnel
   where tenant_id = v_import.tenant_id and left_at is null and silo = any (v_import.departments)
     and hr_import_id is distinct from v_import.id;

  update public.staff_imports
     set status = 'complete', finished_at = now(), not_listed = v_missing
   where id = v_import.id
  returning * into v_import;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_import.tenant_id, v_actor.silo, v_actor.id, v_actor.full_name, 'StaffListImported', 'staff_import',
          v_import.id::text,
          format('%s: %s added, %s updated, %s unchanged, %s skipped, %s not in the list. Reason: %s',
                 v_import.file_name, v_import.added, v_import.updated, v_import.unchanged, v_import.skipped,
                 v_missing, v_import.reason));

  return jsonb_build_object('added', v_import.added, 'updated', v_import.updated, 'unchanged', v_import.unchanged,
                            'skipped', v_import.skipped, 'not_listed', v_missing);
end $$;

-- ── 4. Role review ──────────────────────────────────────────────────────────

-- Confirm the role these people will be invited as. Mirrors
-- registerRolesFor() in packages/db/src/register.ts.
create or replace function public.set_register_roles(p_personnel uuid[], p_role public.user_role)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor public.profiles := public.register_actor();
  v_set   int;
  v_asked int := coalesce(array_length(p_personnel, 1), 0);
begin
  if v_actor.role not in ('SystemAdmin', 'SuperAdmin', 'Admin') then
    raise exception 'Only an administrator can set roles in the staff register' using errcode = '42501';
  end if;
  if v_asked = 0 or v_asked > 2000 then
    raise exception 'Choose between 1 and 2,000 people' using errcode = '22023';
  end if;
  if public.is_powerful_role(p_role) then
    raise exception '% is invited one person at a time, with a second SystemAdmin''s approval', p_role
      using errcode = '42501';
  end if;
  if p_role::text in ('System', 'Officer', 'Metro', 'Chief', 'Operator', 'Responder', 'Security', 'Citizen') then
    raise exception 'The % role is not given to people', p_role using errcode = '22023';
  end if;
  if v_actor.role = 'Admin' then
    if p_role::text in ('Dispatcher', 'ControlRoom', 'IncidentLogger', 'Viewer') then
      raise exception 'Only a SystemAdmin can set %: it reaches past one department', p_role using errcode = '42501';
    end if;
    if exists (select 1 from public.personnel
                where id = any (p_personnel) and tenant_id = public.current_tenant() and silo <> v_actor.silo) then
      raise exception 'A department administrator sets roles in their own department only' using errcode = '42501';
    end if;
  end if;

  update public.personnel
     set proposed_role = p_role, role_confirmed_at = now(), role_confirmed_by = v_actor.id,
         role_confirmed_by_name = v_actor.full_name
   where id = any (p_personnel) and tenant_id = public.current_tenant()
     and user_id is null and left_at is null;
  get diagnostics v_set = row_count;
  return jsonb_build_object('set', v_set, 'skipped', v_asked - v_set);
end $$;

-- ── 5. Leavers ──────────────────────────────────────────────────────────────

create or replace function public.vet_register_change(p_actor public.profiles, p_person public.personnel, p_reason text)
returns void language plpgsql stable security definer set search_path to 'public' as $$
begin
  if p_actor.role not in ('SystemAdmin', 'SuperAdmin', 'Admin') then
    raise exception 'Only an administrator can do this' using errcode = '42501';
  end if;
  if p_actor.role = 'Admin' and p_person.silo <> p_actor.silo then
    raise exception 'A department administrator manages their own department only' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give a reason of at least 10 characters: it goes on the permanent record' using errcode = '22023';
  end if;
end $$;
revoke all on function public.vet_register_change(public.profiles, public.personnel, text) from public, anon, authenticated;

create or replace function public.mark_register_left(p_personnel uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor  public.profiles := public.register_actor();
  v_person public.personnel;
  v_closed int;
begin
  select * into v_person from public.personnel
   where id = p_personnel and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'No such person in your staff register' using errcode = 'P0002'; end if;
  perform public.vet_register_change(v_actor, v_person, p_reason);
  if v_person.left_at is not null then
    raise exception '% is already marked as left', btrim(v_person.first_name || ' ' || v_person.last_name) using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = v_person.user_id and deactivated_at is null) then
    raise exception '% still has an active account. Deactivate it on their account page first.',
      btrim(v_person.first_name || ' ' || v_person.last_name) using errcode = '22023';
  end if;

  update public.personnel
     set left_at = now(), left_reason = btrim(p_reason), left_by = v_actor.id, left_by_name = v_actor.full_name
   where id = v_person.id;
  update public.account_invitations
     set status = 'cancelled', closed_at = now(), closed_by = v_actor.id, closed_by_name = v_actor.full_name,
         close_note = 'Left the organisation: ' || btrim(p_reason)
   where personnel_id = v_person.id and status in ('awaiting_approval', 'ready', 'sent', 'opened', 'expired', 'locked');
  get diagnostics v_closed = row_count;
  update public.account_requests
     set status = 'cancelled', decided_by = v_actor.id, decided_by_name = v_actor.full_name,
         decided_at = now(), decision_note = 'The person left the organisation'
   where status = 'pending' and invitation_id in (select id from public.account_invitations where personnel_id = v_person.id);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_person.tenant_id, v_person.silo, v_actor.id, v_actor.full_name, 'PersonnelLeft', 'personnel', v_person.id::text,
          format('%s %s (%s) marked as left. Reason: %s', v_person.first_name, v_person.last_name,
                 v_person.badge_number, btrim(p_reason)));
  return jsonb_build_object('status', 'left', 'invitations_cancelled', v_closed);
end $$;

-- Undo a mistaken "left". Their badge must still be theirs alone.
create or replace function public.restore_register_person(p_personnel uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor  public.profiles := public.register_actor();
  v_person public.personnel;
begin
  select * into v_person from public.personnel
   where id = p_personnel and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'No such person in your staff register' using errcode = 'P0002'; end if;
  perform public.vet_register_change(v_actor, v_person, p_reason);
  if v_person.left_at is null then
    raise exception '% is not marked as left', btrim(v_person.first_name || ' ' || v_person.last_name) using errcode = '22023';
  end if;
  update public.personnel
     set left_at = null, left_reason = null, left_by = null, left_by_name = null
   where id = v_person.id;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_person.tenant_id, v_person.silo, v_actor.id, v_actor.full_name, 'PersonnelRestored', 'personnel', v_person.id::text,
          format('%s %s (%s) back in the staff register. Reason: %s', v_person.first_name, v_person.last_name,
                 v_person.badge_number, btrim(p_reason)));
  return jsonb_build_object('status', 'restored');
end $$;

revoke all on function public.start_staff_import(text, text, text, public.silo[], int, int) from public, anon;
revoke all on function public.import_staff_rows(uuid, jsonb) from public, anon;
revoke all on function public.finish_staff_import(uuid) from public, anon;
revoke all on function public.set_register_roles(uuid[], public.user_role) from public, anon;
revoke all on function public.mark_register_left(uuid, text) from public, anon;
revoke all on function public.restore_register_person(uuid, text) from public, anon;
grant execute on function public.start_staff_import(text, text, text, public.silo[], int, int) to authenticated;
grant execute on function public.import_staff_rows(uuid, jsonb) to authenticated;
grant execute on function public.finish_staff_import(uuid) to authenticated;
grant execute on function public.set_register_roles(uuid[], public.user_role) to authenticated;
grant execute on function public.mark_register_left(uuid, text) to authenticated;
grant execute on function public.restore_register_person(uuid, text) to authenticated;

-- ── 6. Prove it ─────────────────────────────────────────────────────────────

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

  select string_agg(policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'public' and tablename = 'staff_imports' and permissive = 'PERMISSIVE' and cmd <> 'SELECT';
  if v_bad is not null then
    raise exception 'staff_imports has write policies: % — nothing was changed', v_bad;
  end if;

  if has_function_privilege('anon', 'public.import_staff_rows(uuid, jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_register_roles(uuid[], public.user_role)', 'EXECUTE') then
    raise exception 'The staff register functions are callable without signing in — nothing was changed';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
