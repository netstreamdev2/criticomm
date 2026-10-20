-- ============================================================================
-- 0086 — The systems controller creates logins too
-- ============================================================================
--
-- Run after 0085. Safe to re-run.
--
-- The systems controller (SystemController) runs the duty office: they add a
-- new member in Staff Maintenance and roster them. They now also give that
-- member a login, as a SystemAdmin does, instead of waiting for one:
--
--   * invite by email, SMS or printed code, resend and cancel (vet_invitation,
--     can_manage_invitation, and they read the invitations list);
--   * "Create login now": set the password and the login works at once
--     (create_direct_account, 0055);
--   * set and confirm the role on the Logins tab (set_register_roles), and
--     mark leavers (vet_register_change), as the Logins tab offers.
--
-- What does not change:
--   * They never invite a SystemAdmin or the SuperAdmin.
--   * A powerful role (Admin, SystemController, SystemAdmin) still waits for a
--     second SystemAdmin's approval, and only a SystemAdmin approves
--     (decide_account_request is untouched), so nobody approves their own.
--   * Importing HR's staff list and moving people between departments stay
--     with the SystemAdmin.
--   * Every invitation and login keeps its reason on the permanent record.
-- ============================================================================

-- ── 1. Who may invite whom (0049) ───────────────────────────────────────────

create or replace function public.vet_invitation(
  p_actor public.profiles, p_role public.user_role, p_silo public.silo, p_reason text
) returns void language plpgsql stable security definer set search_path to 'public' as $$
declare
  c_tenant_wide constant text[] := array[
    'SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'System',
    'Dispatcher', 'ControlRoom', 'IncidentLogger', 'Viewer'
  ];
begin
  if p_actor.role not in ('SuperAdmin', 'SystemAdmin', 'SystemController', 'Admin') then
    raise exception 'Only an administrator or the systems controller can invite people' using errcode = '42501';
  end if;
  if p_role::text in ('Officer', 'Metro', 'Chief', 'Operator', 'Responder', 'Security', 'Citizen') then
    raise exception 'The % role is no longer used', p_role using errcode = '22023';
  end if;
  if p_role = 'System' then
    raise exception 'System is the automation account, not a role for a person' using errcode = '42501';
  end if;
  if p_role = 'SuperAdmin' and p_actor.role <> 'SuperAdmin' then
    raise exception 'Only a SuperAdmin can invite a SuperAdmin' using errcode = '42501';
  end if;
  if p_actor.role = 'SystemController' and p_role = 'SystemAdmin' then
    raise exception 'Only a SystemAdmin can invite a SystemAdmin' using errcode = '42501';
  end if;
  if p_actor.role = 'Admin' then
    if p_silo is distinct from p_actor.silo then
      raise exception 'A department administrator invites people into their own department only'
        using errcode = '42501';
    end if;
    if p_role::text = any (c_tenant_wide) then
      raise exception 'Only a SystemAdmin can invite someone as %', p_role using errcode = '42501';
    end if;
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give a reason of at least 10 characters — it goes on the permanent record'
      using errcode = '22023';
  end if;
end $$;
revoke all on function public.vet_invitation(public.profiles, public.user_role, public.silo, text) from public, anon, authenticated;

-- Send, resend or cancel: the controller, for any invitation below SystemAdmin.
create or replace function public.can_manage_invitation(p_actor public.profiles, p_inv public.account_invitations)
returns boolean language sql stable as $$
  select case
    when p_actor.role in ('SuperAdmin', 'SystemAdmin') then true
    when p_actor.role = 'SystemController' then p_inv.role::text not in ('SuperAdmin', 'SystemAdmin')
    when p_actor.role = 'Admin' then
      p_inv.silo = p_actor.silo
      and p_inv.role::text <> all (array['SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'System',
                                         'Dispatcher', 'ControlRoom', 'IncidentLogger', 'Viewer'])
    else false
  end;
$$;
revoke all on function public.can_manage_invitation(public.profiles, public.account_invitations) from public, anon, authenticated;

-- The invitations list.
drop policy if exists account_invitations_read on public.account_invitations;
create policy account_invitations_read on public.account_invitations for select to authenticated
  using (
    public.role_in('SystemAdmin', 'SuperAdmin', 'SystemController')
    or (public.role_in('Admin') and silo = public.current_silo())
    or invited_by = auth.uid()
  );

-- ── 2. "Create login now" (0055) ────────────────────────────────────────────

create or replace function public.create_direct_account(
  p_personnel uuid,
  p_role      public.user_role,
  p_silo      public.silo,
  p_email     text,
  p_reason    text
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor  public.profiles;
  v_person public.personnel;
  v_email  text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_reason text := btrim(coalesce(p_reason, ''));
  v_name   text;
  v_inv    public.account_invitations;
begin
  select * into v_actor from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Not signed in' using errcode = '42501'; end if;
  if v_actor.role not in ('SuperAdmin', 'SystemAdmin', 'SystemController') then
    raise exception 'Only a SystemAdmin, the systems controller or the SuperAdmin can create a login directly'
      using errcode = '42501';
  end if;
  perform public.vet_invitation(v_actor, p_role, p_silo, v_reason);
  if v_actor.role <> 'SuperAdmin' and public.is_powerful_role(p_role) then
    raise exception '% needs a second SystemAdmin''s approval: send an invitation instead', p_role
      using errcode = '42501';
  end if;

  select * into v_person from public.personnel
   where id = p_personnel and tenant_id = public.current_tenant()
   for update;
  if not found then
    raise exception 'This person is not in your organisation''s staff register' using errcode = 'P0002';
  end if;
  v_name := btrim(v_person.first_name || ' ' || v_person.last_name);
  if v_person.left_at is not null then
    raise exception '% has left: they cannot be given an account', v_name using errcode = '22023';
  end if;
  if v_person.user_id is not null then
    raise exception '% already has an account. Change their role on their account page instead.', v_name
      using errcode = '23505';
  end if;
  if public.normalise_badge(v_person.badge_number) = '' then
    raise exception 'Add a badge number to % first', v_name using errcode = '22023';
  end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  if v_email like '%.internal' then
    raise exception 'Enter the person''s real email address' using errcode = '22023';
  end if;

  update public.account_invitations
     set status = 'cancelled', closed_at = now(), closed_by = v_actor.id, closed_by_name = v_actor.full_name,
         close_note = 'Direct creation did not finish'
   where channel = 'direct' and status = 'ready' and expires_at < now()
     and (personnel_id = v_person.id or lower(login_email) = v_email);

  if exists (select 1 from public.account_invitations
              where personnel_id = v_person.id and status in ('awaiting_approval', 'ready', 'sent', 'opened')) then
    raise exception 'An invitation for % is already open. Cancel it first.', v_name using errcode = '23505';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'An account already uses %', v_email using errcode = '23505';
  end if;
  if exists (select 1 from public.account_invitations
              where lower(login_email) = v_email and status in ('awaiting_approval', 'ready', 'sent', 'opened')) then
    raise exception 'An open invitation already uses %', v_email using errcode = '23505';
  end if;

  insert into public.account_invitations (tenant_id, personnel_id, full_name, badge_number, role, silo, channel,
    email, phone, login_email, reason, needs_approval, status, expires_at, invited_by, invited_by_name,
    sent_at, sent_by_name)
  values (v_person.tenant_id, v_person.id, v_name, btrim(v_person.badge_number), p_role, p_silo, 'direct',
    v_email, null, v_email, v_reason, false, 'ready', now() + interval '10 minutes', v_actor.id, v_actor.full_name,
    now(), v_actor.full_name)
  returning * into v_inv;

  return jsonb_build_object('invitation_id', v_inv.id, 'login_email', v_inv.login_email,
    'full_name', v_inv.full_name, 'badge_number', v_inv.badge_number);
end $$;
revoke all on function public.create_direct_account(uuid, public.user_role, public.silo, text, text) from public, anon;
grant execute on function public.create_direct_account(uuid, public.user_role, public.silo, text, text) to authenticated;

-- ── 3. Roles and leavers on the Logins tab (0050) ───────────────────────────

create or replace function public.set_register_roles(p_personnel uuid[], p_role public.user_role)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor public.profiles := public.register_actor();
  v_set   int;
  v_asked int := coalesce(array_length(p_personnel, 1), 0);
begin
  if v_actor.role not in ('SystemAdmin', 'SuperAdmin', 'SystemController', 'Admin') then
    raise exception 'Only an administrator or the systems controller can set roles in the staff register' using errcode = '42501';
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

create or replace function public.vet_register_change(p_actor public.profiles, p_person public.personnel, p_reason text)
returns void language plpgsql stable security definer set search_path to 'public' as $$
begin
  if p_actor.role not in ('SystemAdmin', 'SuperAdmin', 'SystemController', 'Admin') then
    raise exception 'Only an administrator or the systems controller can do this' using errcode = '42501';
  end if;
  if p_actor.role = 'Admin' and p_person.silo <> p_actor.silo then
    raise exception 'A department administrator manages their own department only' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give a reason of at least 10 characters: it goes on the permanent record' using errcode = '22023';
  end if;
end $$;
revoke all on function public.vet_register_change(public.profiles, public.personnel, text) from public, anon, authenticated;

-- ── 4. Prove it ─────────────────────────────────────────────────────────────

do $$
begin
  if has_function_privilege('anon', 'public.create_direct_account(uuid, public.user_role, public.silo, text, text)', 'EXECUTE') then
    raise exception '0086: a visitor could create a login';
  end if;
end $$;

notify pgrst, 'reload schema';
