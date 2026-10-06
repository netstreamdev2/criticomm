-- ============================================================================
-- 0055 — Accounts created directly by a top administrator
-- ============================================================================
--
-- Run after 0049 (any order with 0050–0054).
--
-- A fourth way in, beside email, SMS and a printed code: a SystemAdmin or the
-- SuperAdmin types the person's email and a password, and the account is
-- active at once. Asked for by eThekwini. It is less safe than an invitation,
-- because the administrator knows the password and the person never proves
-- who they are or accepts the POPIA notice, so it is fenced in:
--
--   * Only a SystemAdmin or the SuperAdmin can do it (a department Admin
--     cannot), checked here and not only on the screen.
--   * The person must be on the staff register with a badge number, as for
--     every invitation, and the same role ladder applies (vet_invitation).
--   * A powerful role (SystemAdmin, Admin, SystemController) still needs a
--     second SystemAdmin, so it cannot be created this way except by the
--     SuperAdmin: use an invitation instead.
--   * It leaves the same permanent record as an invitation: a row in
--     account_invitations with channel 'direct', who made it and why, and the
--     account history entry 0048 writes for every new account.
--
-- How it runs: create_direct_account() (the administrator's own session)
-- checks everything and opens a 'direct' invitation for ten minutes. The
-- server then creates the sign-in with the password, and
-- complete_direct_account() (service role) makes the profile and closes it.
-- If the sign-in cannot be made, abandon_direct_account() cancels it.
--
-- Safe to re-run.
-- ============================================================================

begin;

-- ── 1. A fourth channel ─────────────────────────────────────────────────────

alter table public.account_invitations drop constraint if exists account_invitations_channel_check;
alter table public.account_invitations add constraint account_invitations_channel_check
  check (channel in ('email', 'sms', 'code', 'direct'));

-- ── 2. What the administrator does ──────────────────────────────────────────

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
  if v_actor.role not in ('SuperAdmin', 'SystemAdmin') then
    raise exception 'Only a SystemAdmin or the SuperAdmin can create an account directly' using errcode = '42501';
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

  -- A direct creation that never finished (the server stopped half-way)
  -- would otherwise block this person for good.
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

-- ── 3. What the server finishes (service role) ──────────────────────────────

create or replace function public.complete_direct_account(p_invitation uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_inv    public.account_invitations;
  v_person public.personnel;
begin
  select * into v_inv from public.account_invitations where id = p_invitation for update;
  if not found or v_inv.channel <> 'direct' or v_inv.status <> 'ready' or v_inv.expires_at < now() then
    raise exception 'This account can no longer be created: start again' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user and lower(email) = lower(v_inv.login_email)) then
    raise exception 'The sign-in does not belong to this account' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = p_user) then
    raise exception 'This sign-in already has an account' using errcode = '23505';
  end if;

  select * into v_person from public.personnel where id = v_inv.personnel_id for update;
  if found and v_person.user_id is not null then
    raise exception '% already has an account', v_inv.full_name using errcode = '23505';
  end if;

  perform public.stamp_account_change('Created directly: ' || v_inv.reason, v_inv.invited_by, null, null);

  insert into public.profiles (id, tenant_id, silo, role, full_name, badge_number, rank, station, platoon,
                               email, contact_number, status)
  values (p_user, v_inv.tenant_id, v_inv.silo, v_inv.role, v_inv.full_name, v_inv.badge_number,
          v_person.rank, v_person.station, v_person.platoon,
          v_inv.email, v_person.work_cellphone, 'Active');

  if v_person.id is not null then
    update public.personnel set user_id = p_user where id = v_person.id;
  end if;

  -- No POPIA version: the person has not seen the notice.
  update public.account_invitations
     set status = 'accepted', accepted_at = now(), accepted_user_id = p_user
   where id = v_inv.id
  returning * into v_inv;

  return jsonb_build_object('ok', true, 'full_name', v_inv.full_name, 'role', v_inv.role, 'silo', v_inv.silo,
    'login_email', v_inv.login_email);
end $$;

create or replace function public.abandon_direct_account(p_invitation uuid, p_note text)
returns void language sql security definer set search_path to 'public' as $$
  update public.account_invitations
     set status = 'cancelled', closed_at = now(), closed_by = invited_by, closed_by_name = invited_by_name,
         close_note = left('Not created: ' || coalesce(p_note, 'unknown error'), 300)
   where id = p_invitation and channel = 'direct' and status = 'ready';
$$;

revoke all on function public.create_direct_account(uuid, public.user_role, public.silo, text, text) from public, anon;
grant execute on function public.create_direct_account(uuid, public.user_role, public.silo, text, text) to authenticated;
revoke all on function public.complete_direct_account(uuid, uuid) from public, anon, authenticated;
revoke all on function public.abandon_direct_account(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_direct_account(uuid, uuid) to service_role;
grant execute on function public.abandon_direct_account(uuid, text) to service_role;

-- ── 4. Prove it ─────────────────────────────────────────────────────────────

do $$
begin
  if has_function_privilege('authenticated', 'public.complete_direct_account(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_direct_account(uuid, public.user_role, public.silo, text, text)', 'EXECUTE') then
    raise exception 'Direct account creation is reachable from the wrong session — nothing was changed';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
