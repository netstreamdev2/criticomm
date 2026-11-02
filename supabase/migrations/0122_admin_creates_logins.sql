-- ============================================================================
-- 0122 — Department administrators create logins too
-- ============================================================================
--
-- Run after 0086. Safe to re-run.
--
-- "Create login now" (0055, widened in 0086) is now open to a department
-- Admin as well: they type the person's email and a password, and the login
-- works at once.
--
-- What does not change (vet_invitation, 0086, already checks all of it):
--   * An Admin makes logins in their own department only.
--   * An Admin never gives a role that reaches past one department
--     (Dispatcher, ControlRoom, IncidentLogger, Viewer) or an admin role.
--   * A powerful role still waits for a second SystemAdmin, so it is never
--     made this way except by the SuperAdmin.
--   * The person must be on the staff register with a badge number, and the
--     reason goes on the permanent record with who made it.
-- ============================================================================

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
  if v_actor.role not in ('SuperAdmin', 'SystemAdmin', 'SystemController', 'Admin') then
    raise exception 'Only an administrator or the systems controller can create a login directly'
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
  -- The register says which department they are in; an Admin cannot pass another.
  if v_person.silo is distinct from p_silo then
    raise exception '% is in another department in the staff register', v_name using errcode = '42501';
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

-- ── Prove it ────────────────────────────────────────────────────────────────

do $$
begin
  if has_function_privilege('anon', 'public.create_direct_account(uuid, public.user_role, public.silo, text, text)', 'EXECUTE') then
    raise exception '0122: a visitor could create a login';
  end if;
end $$;

notify pgrst, 'reload schema';
