-- ============================================================================
-- 0067 — A field role belongs to its own department
-- ============================================================================
--
-- Run after 0066.
--
-- An account, an invitation and a role confirmed in the staff register could
-- pair any role with any department: a Captain or a Firefighter in Disaster
-- Management. A field role now exists only in its own department:
--
--   Police, Captain           Metro Police
--   Firefighter, Fire Chief   Fire & Rescue
--   Paramedic, Doctor         EMS
--   Disaster                  Disaster Management
--
-- Desk and administration roles (Dispatcher, Supervisor, Admin, Case Manager,
-- Staff…) fit any department. The console offers only roles that fit; these
-- triggers refuse anything else, whoever sends it:
--
--   accounts        a role and department that do not fit are refused;
--   invitations     the same;
--   staff register  a confirmed role that does not fit is refused; an
--                   import's suggestion that does not fit is dropped; a person
--                   moved to another department loses a role that no longer
--                   fits and has one confirmed there.
--
-- And an account is always in the department its person's staff register
-- entry says. An invitation for another department is refused: the register
-- is put right first, with move_register_person() (Admin → Personnel →
-- Change department), and moving an account (Admin → Users) moves its entry.
--
-- Existing records are not touched (a notice lists any that do not fit).
-- Safe to re-run.
-- ============================================================================

create or replace function public.field_role_department(p_role public.user_role)
returns public.silo language sql immutable set search_path to 'public' as $$
  select (case p_role::text
    when 'Police'      then 'MetroPolice'
    when 'Captain'     then 'MetroPolice'
    when 'Firefighter' then 'MetroFire'
    when 'FireChief'   then 'MetroFire'
    when 'Paramedic'   then 'Medical'
    when 'Doctor'      then 'Medical'
    when 'Disaster'    then 'EthekwiniDisaster'
  end)::public.silo
$$;

create or replace function public.role_fits_department(p_role public.user_role, p_silo public.silo)
returns boolean language sql immutable set search_path to 'public' as $$
  select p_role is null or p_silo is null
      or public.field_role_department(p_role) is null
      or public.field_role_department(p_role) = p_silo
$$;

-- In the words the console uses.
create or replace function public.department_label(p_silo public.silo)
returns text language sql immutable set search_path to 'public' as $$
  select case p_silo::text
    when 'Ethekwini'         then 'Control Room'
    when 'MetroPolice'       then 'Metro Police'
    when 'MetroFire'         then 'Fire & Rescue'
    when 'Medical'           then 'EMS'
    when 'EthekwiniDisaster' then 'Disaster Management'
    else p_silo::text
  end
$$;

create or replace function public.field_role_label(p_role public.user_role)
returns text language sql immutable set search_path to 'public' as $$
  select case p_role::text
    when 'Police'    then 'Police Officer'
    when 'FireChief' then 'Fire Chief'
    when 'Disaster'  then 'Disaster Management Officer'
    else p_role::text
  end
$$;

-- "A Firefighter works in Fire & Rescue. Choose a Disaster Management role."
create or replace function public.role_department_problem(p_role public.user_role, p_silo public.silo)
returns text language sql immutable set search_path to 'public' as $$
  select case when public.role_fits_department(p_role, p_silo) then null
    else format('A %s works in %s. Choose a %s role.', public.field_role_label(p_role),
                public.department_label(public.field_role_department(p_role)), public.department_label(p_silo))
  end
$$;

-- ── Accounts and invitations ────────────────────────────────────────────────

create or replace function public.guard_role_fits_department() returns trigger
language plpgsql set search_path to 'public' as $$
declare
  v_problem text := public.role_department_problem(new.role, new.silo);
begin
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists profile_role_fits_department on public.profiles;
create trigger profile_role_fits_department before insert or update of role, silo on public.profiles
  for each row execute function public.guard_role_fits_department();

drop trigger if exists invitation_role_fits_department on public.account_invitations;
create trigger invitation_role_fits_department before insert or update of role, silo on public.account_invitations
  for each row execute function public.guard_role_fits_department();

-- ── The staff register ──────────────────────────────────────────────────────
-- Named to run after guard_register_review (0050), which decides who may
-- change these columns at all.

create or replace function public.register_role_fits_department() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.proposed_role is null or public.role_fits_department(new.proposed_role, new.silo) then
    return new;
  end if;
  -- Moved to another department: their role there is confirmed afresh.
  if tg_op = 'UPDATE' and new.silo is distinct from old.silo then
    new.proposed_role := null;
    new.role_confirmed_at := null;
    new.role_confirmed_by := null;
    new.role_confirmed_by_name := null;
    return new;
  end if;
  -- An import's suggestion only: dropped, for an administrator to choose.
  if new.role_confirmed_at is null then
    new.proposed_role := null;
    return new;
  end if;
  raise exception '% (%)', public.role_department_problem(new.proposed_role, new.silo),
    trim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')) using errcode = '22023';
end $$;

drop trigger if exists register_role_fits_department on public.personnel;
create trigger register_role_fits_department before insert or update of proposed_role, silo, role_confirmed_at on public.personnel
  for each row execute function public.register_role_fits_department();

-- ── An account is in the department the staff register says ─────────────────
-- Every account starts as an invitation (a direct account too, 0055), and
-- an invitation names its person in the register: it must be for their
-- department. To give them another, the register is put right first
-- (move_register_person below), not worked around.

create or replace function public.guard_invitation_matches_register() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_person public.personnel;
begin
  if new.personnel_id is null then return new; end if;
  select * into v_person from public.personnel where id = new.personnel_id;
  if found and v_person.silo is distinct from new.silo then
    raise exception '% is in % in the staff register. Change their department in Personnel first, then invite them.',
      btrim(v_person.first_name || ' ' || v_person.last_name), public.department_label(v_person.silo)
      using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists invitation_matches_register on public.account_invitations;
create trigger invitation_matches_register before insert or update of silo, personnel_id on public.account_invitations
  for each row execute function public.guard_invitation_matches_register();

-- An account moved to another department (Admin → Users) takes its register
-- entry with it, so the two never disagree.
create or replace function public.sync_register_department() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  update public.personnel set silo = new.silo, updated_at = now()
   where user_id = new.id and silo is distinct from new.silo;
  return new;
end $$;

drop trigger if exists sync_register_department on public.profiles;
create trigger sync_register_department after update of silo on public.profiles
  for each row execute function public.sync_register_department();

-- And the other way: the register entry of someone with an account moves
-- only with the account; an account is linked only to an entry in its own
-- department (an invitation older than a move cannot be accepted).
create or replace function public.guard_register_matches_account() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_silo public.silo;
  v_name text := btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, ''));
begin
  if new.user_id is null then return new; end if;
  select silo into v_silo from public.profiles where id = new.user_id;
  if not found or v_silo is not distinct from new.silo then return new; end if;
  if tg_op = 'UPDATE' and new.user_id is not distinct from old.user_id then
    raise exception '% has an account in %. Change their department on their account page (Admin → Users).',
      v_name, public.department_label(v_silo) using errcode = '22023';
  end if;
  raise exception '% is in % in the staff register, not %. Send a new invitation.',
    v_name, public.department_label(new.silo), public.department_label(v_silo) using errcode = '22023';
end $$;

drop trigger if exists register_matches_account on public.personnel;
create trigger register_matches_account before insert or update of silo, user_id on public.personnel
  for each row execute function public.guard_register_matches_account();

-- Move someone without an account to another department in the register: the
-- way to put a wrong department right before inviting them. A SystemAdmin's
-- (or the SuperAdmin's) decision, with a reason; an open invitation for the
-- old department is cancelled, and a role confirmed there no longer fits and
-- is cleared (register_role_fits_department).
create or replace function public.move_register_person(p_personnel uuid, p_silo public.silo, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor  public.profiles := public.register_actor();
  v_person public.personnel;
  v_name   text;
  v_closed int;
begin
  select * into v_person from public.personnel
   where id = p_personnel and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'No such person in your staff register' using errcode = 'P0002'; end if;
  if v_actor.role not in ('SystemAdmin', 'SuperAdmin') then
    raise exception 'Only a SystemAdmin moves people between departments' using errcode = '42501';
  end if;
  perform public.vet_register_change(v_actor, v_person, p_reason);
  v_name := btrim(v_person.first_name || ' ' || v_person.last_name);
  if v_person.left_at is not null then
    raise exception '% has left the organisation. Bring them back first.', v_name using errcode = '22023';
  end if;
  if v_person.user_id is not null then
    raise exception '% has an account. Change their department on their account page (Admin → Users).', v_name
      using errcode = '22023';
  end if;
  if v_person.silo = p_silo then
    raise exception '% is already in %', v_name, public.department_label(p_silo) using errcode = '22023';
  end if;

  update public.personnel set silo = p_silo, updated_at = now() where id = v_person.id;
  update public.account_invitations
     set status = 'cancelled', closed_at = now(), closed_by = v_actor.id, closed_by_name = v_actor.full_name,
         close_note = format('Moved to %s: %s', public.department_label(p_silo), btrim(p_reason))
   where personnel_id = v_person.id and status in ('awaiting_approval', 'ready', 'sent', 'opened', 'expired', 'locked');
  get diagnostics v_closed = row_count;
  update public.account_requests
     set status = 'cancelled', decided_by = v_actor.id, decided_by_name = v_actor.full_name,
         decided_at = now(), decision_note = 'The person moved to another department'
   where status = 'pending' and invitation_id in (select id from public.account_invitations where personnel_id = v_person.id);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_person.tenant_id, p_silo, v_actor.id, v_actor.full_name, 'PersonnelMoved', 'personnel', v_person.id::text,
          format('%s (%s) moved from %s to %s. Reason: %s', v_name, v_person.badge_number,
                 public.department_label(v_person.silo), public.department_label(p_silo), btrim(p_reason)));
  return jsonb_build_object('status', 'moved', 'invitations_cancelled', v_closed);
end $$;

revoke all on function public.move_register_person(uuid, public.silo, text) from public, anon;
grant execute on function public.move_register_person(uuid, public.silo, text) to authenticated;

-- ── What is already there ───────────────────────────────────────────────────

do $$
declare
  v_accounts int;
  v_register int;
  v_split    int;
begin
  select count(*) into v_accounts from public.profiles where not public.role_fits_department(role, silo);
  select count(*) into v_register from public.personnel
   where proposed_role is not null and not public.role_fits_department(proposed_role, silo);
  select count(*) into v_split from public.personnel pe join public.profiles pr on pr.id = pe.user_id
   where pr.silo is distinct from pe.silo;
  if v_accounts > 0 or v_register > 0 then
    raise notice '% account(s) and % staff register role(s) pair a field role with another department. Change them under Admin → Users and Admin → Personnel.', v_accounts, v_register;
  end if;
  if v_split > 0 then
    raise notice '% account(s) are in a different department from their staff register entry. Move the account under Admin → Users to bring them together.', v_split;
  end if;
end $$;

notify pgrst, 'reload schema';
