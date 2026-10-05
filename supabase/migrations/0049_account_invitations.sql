-- ============================================================================
-- 0049 — Account invitations
-- ============================================================================
--
-- Run after 0048.
--
-- The only way a person gets a HikTech account. Agreed design:
-- apps/web/handbook/staff-onboarding.html (Admin → Handbook).
--
--   1. An administrator invites someone from the staff register (personnel)
--      and chooses their role: the same ladder as a role change (0048), with
--      a written reason. SystemAdmin, Admin and SystemController invitations
--      wait for a second SystemAdmin in the existing Approvals queue.
--   2. The invitation is delivered by email, SMS or a printed activation
--      code. Each works once, expires (72 hours by default) and is stored only
--      as a keyed hash computed by the server: the database never sees a link
--      or a code.
--   3. The person proves who they are with the badge number on their staff
--      record. Five wrong tries lock the invitation; only an administrator
--      can send a new one.
--   4. They choose their own password and accept the POPIA notice. Only then
--      is the account created: the server creates the sign-in, and
--      complete_account_invitation() creates the profile, links the staff
--      record and starts the account history with who invited them and why.
--   5. Anyone who receives one by mistake can report it ("This isn't me").
--      It closes at once and the inviter is told.
--
-- Staff without email sign in with their badge number. Their sign-in address
-- is made from it (mp1042@ethekwini.badge.internal); `.internal` is reserved
-- for private networks and never delivers mail.
--
-- Invitations are a permanent record: nothing deletes one, and who, what and
-- why never change after it is made.
--
-- Safe to re-run.
-- ============================================================================

begin;

-- ── 1. Shared helpers ───────────────────────────────────────────────────────

-- Badge numbers compared forgivingly. Mirrors normaliseBadge() in
-- packages/db/src/onboarding.ts.
create or replace function public.normalise_badge(p_badge text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p_badge, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- Mirrors badgeSignInEmail() in packages/db/src/onboarding.ts.
create or replace function public.badge_sign_in_email(p_badge text, p_tenant_slug text)
returns text language sql immutable as $$
  select lower(public.normalise_badge(p_badge)) || '@' || p_tenant_slug || '.badge.internal';
$$;

-- rate_limit_hit() (0028) counts per signed-in user. People accepting an
-- invitation are not signed in yet, so the server counts them by a key of its
-- own (their network address). Service role only.
create or replace function public.rate_limit_hit_key(p_key text, p_limit int, p_window_seconds int)
returns table (allowed boolean, remaining int, reset_at timestamptz)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_key    text := 'key:' || coalesce(p_key, '');
  v_window interval := make_interval(secs => greatest(1, p_window_seconds));
  v_limit  int := greatest(1, p_limit);
  v_row    public.rate_limit_buckets;
begin
  insert into public.rate_limit_buckets (key, window_start, count)
  values (v_key, now(), 1)
  on conflict (key) do update
    set window_start = case
                         when public.rate_limit_buckets.window_start < now() - v_window then now()
                         else public.rate_limit_buckets.window_start
                       end,
        count        = case
                         when public.rate_limit_buckets.window_start < now() - v_window then 1
                         else public.rate_limit_buckets.count + 1
                       end
  returning * into v_row;

  return query select v_row.count <= v_limit, greatest(0, v_limit - v_row.count), v_row.window_start + v_window;
end $$;

-- ── 2. The invitations ──────────────────────────────────────────────────────

create table if not exists public.account_invitations (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  personnel_id      uuid references public.personnel (id) on delete set null,
  full_name         text not null,
  badge_number      text not null,
  role              public.user_role not null,
  silo              public.silo not null,
  channel           text not null check (channel in ('email', 'sms', 'code')),
  -- Where it goes: the email address (which is also how they will sign in),
  -- or the cellphone for an SMS. A printed code goes nowhere.
  email             text,
  phone             text,
  -- The sign-in created on acceptance: the email, or the badge address.
  login_email       text not null,
  reason            text not null,
  -- Set at creation for SystemAdmin, Admin and SystemController invitations
  -- made by anyone but the SuperAdmin: nothing is sent until approved.
  needs_approval    boolean not null default false,
  status            text not null default 'ready' check (status in (
                      'awaiting_approval', 'ready', 'sent', 'opened',
                      'accepted', 'rejected', 'expired', 'cancelled', 'locked', 'reported')),
  -- Keyed hash of the link token or activation code; the secret itself is
  -- never stored. Null until sent, and again if a delivery fails.
  secret_hash       text unique,
  expires_at        timestamptz,
  attempts          int not null default 0,
  delivery_error    text,
  send_count        int not null default 0,
  invited_by        uuid not null,
  invited_by_name   text,
  approved_by       uuid,
  approved_by_name  text,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  sent_by_name      text,
  opened_at         timestamptz,
  accepted_at       timestamptz,
  accepted_user_id  uuid,
  policy_version    text,
  closed_at         timestamptz,
  closed_by         uuid,
  closed_by_name    text,
  close_note        text
);

-- One open invitation per person, and per sign-in address.
create unique index if not exists account_invitations_one_open_person
  on public.account_invitations (personnel_id)
  where status in ('awaiting_approval', 'ready', 'sent', 'opened');
create unique index if not exists account_invitations_one_open_login
  on public.account_invitations (lower(login_email))
  where status in ('awaiting_approval', 'ready', 'sent', 'opened');
create index if not exists account_invitations_tenant_idx
  on public.account_invitations (tenant_id, status, created_at desc);

alter table public.account_invitations enable row level security;

-- SystemAdmins see the organisation's invitations; a department Admin sees
-- their department's; anyone sees the ones they made. Every write goes
-- through the functions below.
drop policy if exists account_invitations_read on public.account_invitations;
create policy account_invitations_read on public.account_invitations for select to authenticated
  using (
    public.role_in('SystemAdmin', 'SuperAdmin')
    or (public.role_in('Admin') and silo = public.current_silo())
    or invited_by = auth.uid()
  );
drop policy if exists tenant_isolation on public.account_invitations;
create policy tenant_isolation on public.account_invitations as restrictive for all to authenticated
  using (tenant_id = (select public.current_tenant()))
  with check (tenant_id = (select public.current_tenant()));

-- A permanent record: never deleted, and who, what and why never change.
create or replace function public.guard_account_invitation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Invitations are a permanent record: cancel one instead' using errcode = '42501';
  end if;
  if (new.tenant_id, new.personnel_id, new.full_name, new.badge_number, new.role, new.silo, new.channel,
      new.email, new.phone, new.login_email, new.reason, new.needs_approval, new.invited_by, new.created_at)
     is distinct from
     (old.tenant_id, old.personnel_id, old.full_name, old.badge_number, old.role, old.silo, old.channel,
      old.email, old.phone, old.login_email, old.reason, old.needs_approval, old.invited_by, old.created_at)
     -- The staff record may be removed later; the invitation keeps its copy.
     and not (new.personnel_id is null and old.personnel_id is not null
              and (new.tenant_id, new.full_name, new.badge_number, new.role, new.silo, new.channel, new.email,
                   new.phone, new.login_email, new.reason, new.invited_by, new.created_at)
                  is not distinct from
                  (old.tenant_id, old.full_name, old.badge_number, old.role, old.silo, old.channel, old.email,
                   old.phone, old.login_email, old.reason, old.invited_by, old.created_at)) then
    raise exception 'Who was invited, as what and why cannot be changed: cancel it and invite again'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_account_invitation on public.account_invitations;
create trigger guard_account_invitation before update or delete on public.account_invitations
  for each row execute function public.guard_account_invitation();

-- ── 3. Approvals: invitations join the second-SystemAdmin queue (0048) ──────

alter table public.account_requests add column if not exists invitation_id uuid;
alter table public.account_requests alter column user_id drop not null;
alter table public.account_requests drop constraint if exists account_requests_action_check;
alter table public.account_requests add constraint account_requests_action_check
  check (action in ('role', 'deactivate', 'reactivate', 'invite'));
alter table public.account_requests drop constraint if exists account_requests_subject_check;
alter table public.account_requests add constraint account_requests_subject_check
  check ((action = 'invite' and invitation_id is not null) or (action <> 'invite' and user_id is not null));
create unique index if not exists account_requests_one_open_invite
  on public.account_requests (invitation_id) where status = 'pending';

-- 0048's guard, now also freezing which invitation a request is about.
create or replace function public.guard_account_request() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Account requests are a permanent record' using errcode = '42501';
  end if;
  if old.status <> 'pending' then
    raise exception 'This request has already been decided' using errcode = '42501';
  end if;
  if (new.tenant_id, new.user_id, new.invitation_id, new.action, new.from_role, new.to_role, new.from_silo,
      new.to_silo, new.reason, new.requested_by, new.requested_at)
     is distinct from
     (old.tenant_id, old.user_id, old.invitation_id, old.action, old.from_role, old.to_role, old.from_silo,
      old.to_silo, old.reason, old.requested_by, old.requested_at) then
    raise exception 'Only the decision on a request can be recorded' using errcode = '42501';
  end if;
  return new;
end $$;

-- 0048's notifications, now also wording invitations and linking to them.
create or replace function public.notify_account_request(p_req public.account_requests, p_event text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_what text := case p_req.action
    when 'invite' then format('invite %s as %s in %s', p_req.user_name, p_req.to_role, p_req.to_silo)
    when 'deactivate' then format('deactivate %s', p_req.user_name)
    when 'reactivate' then format('reactivate %s', p_req.user_name)
    else case
      when p_req.to_role = p_req.from_role then format('move %s to %s', p_req.user_name, p_req.to_silo)
      else format('change %s from %s to %s', p_req.user_name, p_req.from_role, p_req.to_role) end
  end;
  v_link text := case when p_req.action = 'invite' then '/admin/invitations'
                      else '/admin/users/' || p_req.user_id::text end;
  v_sent int;
begin
  if p_event = 'requested' then
    insert into public.alerts (tenant_id, silo, target_user_id, kind, severity, title, body, link,
                               presentation, requires_ack, created_by, created_by_name)
    select p_req.tenant_id, p.silo, p.id, 'approval', 'High',
           'Approval needed: ' || v_what,
           format('Requested by %s. Reason: %s', p_req.requested_by_name, p_req.reason),
           '/admin/approvals', 'toast', false, p_req.requested_by, p_req.requested_by_name
      from public.profiles p
     where p.tenant_id = p_req.tenant_id and p.deactivated_at is null and p.role = 'SystemAdmin'
       and p.id <> p_req.requested_by and p.id is distinct from p_req.user_id;
    get diagnostics v_sent = row_count;

    -- No other SystemAdmin to ask: the platform owner decides.
    if v_sent = 0 then
      insert into public.alerts (tenant_id, silo, target_user_id, kind, severity, title, body, link,
                                 presentation, requires_ack, created_by, created_by_name)
      select p_req.tenant_id, p.silo, p.id, 'approval', 'High',
             'Approval needed: ' || v_what,
             format('Requested by %s — no other SystemAdmin can approve it. Reason: %s',
               p_req.requested_by_name, p_req.reason),
             '/admin/approvals', 'toast', false, p_req.requested_by, p_req.requested_by_name
        from public.profiles p
       where p.tenant_id = p_req.tenant_id and p.deactivated_at is null and p.role = 'SuperAdmin'
         and p.id <> p_req.requested_by and p.id is distinct from p_req.user_id;
    end if;
  else
    insert into public.alerts (tenant_id, silo, target_user_id, kind, severity, title, body, link,
                               presentation, requires_ack, created_by, created_by_name)
    select p_req.tenant_id, p.silo, p.id, 'approval',
           case when p_event = 'approved' then 'Medium' else 'High' end,
           format('%s: %s', initcap(p_event), v_what),
           format('%s by %s%s', initcap(p_event), coalesce(p_req.decided_by_name, 'the system'),
             coalesce('. ' || nullif(p_req.decision_note, ''), '')),
           v_link, 'toast', false, p_req.decided_by, p_req.decided_by_name
      from public.profiles p
     where p.id = p_req.requested_by;
  end if;
end $$;
revoke all on function public.notify_account_request(public.account_requests, text) from public, anon, authenticated;

-- ── 4. Who may invite whom ──────────────────────────────────────────────────

-- The role ladder, applied to someone who has no account yet. Mirrors
-- rolesInvitableBy() in packages/db/src/onboarding.ts.
create or replace function public.vet_invitation(
  p_actor public.profiles, p_role public.user_role, p_silo public.silo, p_reason text
) returns void language plpgsql stable security definer set search_path to 'public' as $$
declare
  c_tenant_wide constant text[] := array[
    'SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'System',
    'Dispatcher', 'ControlRoom', 'IncidentLogger', 'Viewer'
  ];
begin
  if p_actor.role not in ('SuperAdmin', 'SystemAdmin', 'Admin') then
    raise exception 'Only an administrator can invite people' using errcode = '42501';
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

-- May this administrator send, resend or cancel this invitation?
create or replace function public.can_manage_invitation(p_actor public.profiles, p_inv public.account_invitations)
returns boolean language sql stable as $$
  select case
    when p_actor.role in ('SuperAdmin', 'SystemAdmin') then true
    when p_actor.role = 'Admin' then
      p_inv.silo = p_actor.silo
      and p_inv.role::text <> all (array['SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'System',
                                         'Dispatcher', 'ControlRoom', 'IncidentLogger', 'Viewer'])
    else false
  end;
$$;

-- Tell the person who sent an invitation how it went.
create or replace function public.notify_inviter(
  p_inv public.account_invitations, p_title text, p_body text, p_severity text
) returns void language sql security definer set search_path to 'public' as $$
  insert into public.alerts (tenant_id, silo, target_user_id, kind, severity, title, body, link,
                             presentation, requires_ack, created_by_name)
  select p_inv.tenant_id, p.silo, p.id, 'invitation', p_severity, p_title, p_body,
         '/admin/invitations', 'toast', false, 'HikTech invitations'
    from public.profiles p
   where p.id = p_inv.invited_by and p.deactivated_at is null;
$$;

revoke all on function public.vet_invitation(public.profiles, public.user_role, public.silo, text) from public, anon, authenticated;
revoke all on function public.can_manage_invitation(public.profiles, public.account_invitations) from public, anon, authenticated;
revoke all on function public.notify_inviter(public.account_invitations, text, text, text) from public, anon, authenticated;

-- ── 5. What an administrator does ───────────────────────────────────────────

-- Invite someone from the staff register.
create or replace function public.create_account_invitation(
  p_personnel uuid,
  p_role      public.user_role,
  p_silo      public.silo,
  p_channel   text,
  p_email     text,
  p_phone     text,
  p_reason    text
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor  public.profiles;
  v_person public.personnel;
  v_slug   text;
  v_email  text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone  text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_login  text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_name   text;
  v_inv    public.account_invitations;
  v_req    public.account_requests;
begin
  select * into v_actor from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform public.vet_invitation(v_actor, p_role, p_silo, v_reason);

  select * into v_person from public.personnel
   where id = p_personnel and tenant_id = public.current_tenant()
   for update;
  if not found then
    raise exception 'This person is not in your organisation''s staff register' using errcode = 'P0002';
  end if;
  v_name := btrim(v_person.first_name || ' ' || v_person.last_name);
  if v_actor.role = 'Admin' and v_person.silo is distinct from v_actor.silo then
    raise exception 'A department administrator invites people in their own department only' using errcode = '42501';
  end if;
  if v_person.user_id is not null then
    raise exception '% already has an account. Change their role on their account page instead.', v_name
      using errcode = '23505';
  end if;
  if public.normalise_badge(v_person.badge_number) = '' then
    raise exception 'Add a badge number to % first: it is how they prove who they are', v_name
      using errcode = '22023';
  end if;
  if exists (select 1 from public.account_invitations
              where personnel_id = v_person.id and status in ('awaiting_approval', 'ready', 'sent', 'opened')) then
    raise exception 'An invitation for % is already open. Resend or cancel it instead.', v_name
      using errcode = '23505';
  end if;

  select slug into v_slug from public.tenants where id = v_person.tenant_id;
  if p_channel = 'email' then
    if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'Enter a valid email address' using errcode = '22023';
    end if;
    v_login := v_email;
    v_phone := null;
  elsif p_channel = 'sms' then
    if v_phone is null or length(regexp_replace(v_phone, '\D', '', 'g')) not between 9 and 15 then
      raise exception 'Enter a valid cellphone number' using errcode = '22023';
    end if;
    v_email := null;
    v_login := public.badge_sign_in_email(v_person.badge_number, v_slug);
  elsif p_channel = 'code' then
    v_email := null;
    v_phone := null;
    v_login := public.badge_sign_in_email(v_person.badge_number, v_slug);
  else
    raise exception 'Choose how the invitation is delivered' using errcode = '22023';
  end if;

  if exists (select 1 from auth.users where lower(email) = v_login) then
    if p_channel = 'email' then
      raise exception 'An account already uses %. Check the address with the person.', v_login using errcode = '23505';
    end if;
    raise exception 'An account already signs in with badge number %', v_person.badge_number using errcode = '23505';
  end if;
  if exists (select 1 from public.account_invitations
              where lower(login_email) = v_login and status in ('awaiting_approval', 'ready', 'sent', 'opened')) then
    raise exception 'Another open invitation already uses this sign-in' using errcode = '23505';
  end if;

  insert into public.account_invitations (tenant_id, personnel_id, full_name, badge_number, role, silo, channel,
    email, phone, login_email, reason, needs_approval, status, invited_by, invited_by_name)
  values (v_person.tenant_id, v_person.id, v_name, btrim(v_person.badge_number), p_role, p_silo, p_channel,
    v_email, v_phone, v_login, v_reason,
    v_actor.role <> 'SuperAdmin' and public.is_powerful_role(p_role),
    case when v_actor.role <> 'SuperAdmin' and public.is_powerful_role(p_role) then 'awaiting_approval' else 'ready' end,
    v_actor.id, v_actor.full_name)
  returning * into v_inv;

  if v_inv.status = 'awaiting_approval' then
    insert into public.account_requests (tenant_id, invitation_id, user_name, action, to_role, to_silo, reason,
      requested_by, requested_by_name)
    values (v_inv.tenant_id, v_inv.id, v_inv.full_name, 'invite', p_role, p_silo, v_reason,
      v_actor.id, v_actor.full_name)
    returning * into v_req;
    perform public.notify_account_request(v_req, 'requested');
    return jsonb_build_object('status', 'awaiting_approval', 'invitation_id', v_inv.id, 'request_id', v_req.id);
  end if;
  return jsonb_build_object('status', 'ready', 'invitation_id', v_inv.id);
end $$;

-- Record a freshly issued link or code (the server keeps the secret, the
-- database its keyed hash) and start the clock. Sending again cancels the
-- previous one, resets the wrong tries and reopens a locked or expired one.
create or replace function public.issue_invitation_secret(p_invitation uuid, p_secret_hash text, p_ttl_hours int)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor public.profiles;
  v_inv   public.account_invitations;
  v_org   text;
begin
  select * into v_actor from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into v_inv from public.account_invitations
   where id = p_invitation and tenant_id = public.current_tenant()
   for update;
  if not found then raise exception 'No such invitation in your organisation' using errcode = 'P0002'; end if;
  if not public.can_manage_invitation(v_actor, v_inv) then
    raise exception 'Your role cannot send this invitation' using errcode = '42501';
  end if;
  if v_inv.status = 'awaiting_approval' then
    raise exception 'This invitation has not been approved by a second SystemAdmin yet' using errcode = '42501';
  end if;
  if v_inv.status not in ('ready', 'sent', 'opened', 'expired', 'locked') then
    raise exception 'This invitation is % and can no longer be sent. Invite them again instead.',
      replace(v_inv.status, '_', ' ') using errcode = '22023';
  end if;
  if v_inv.needs_approval and v_inv.approved_by is null then
    raise exception 'This invitation has not been approved by a second SystemAdmin' using errcode = '42501';
  end if;
  if coalesce(length(p_secret_hash), 0) < 32 then
    raise exception 'Missing invitation secret' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles pr join public.personnel pe on pe.user_id = pr.id
              where pe.id = v_inv.personnel_id) then
    raise exception '% already has an account', v_inv.full_name using errcode = '23505';
  end if;

  update public.account_invitations
     set secret_hash = p_secret_hash,
         expires_at = now() + make_interval(hours => least(greatest(coalesce(p_ttl_hours, 72), 1), 168)),
         attempts = 0,
         status = 'sent',
         sent_at = now(),
         sent_by_name = v_actor.full_name,
         send_count = send_count + 1,
         delivery_error = null,
         opened_at = null,
         closed_at = null, closed_by = null, closed_by_name = null, close_note = null
   where id = v_inv.id
  returning * into v_inv;

  select name into v_org from public.tenants where id = v_inv.tenant_id;
  return jsonb_build_object(
    'id', v_inv.id, 'full_name', v_inv.full_name, 'badge_number', v_inv.badge_number,
    'role', v_inv.role, 'silo', v_inv.silo, 'channel', v_inv.channel,
    'email', v_inv.email, 'phone', v_inv.phone, 'login_email', v_inv.login_email,
    'expires_at', v_inv.expires_at, 'invited_by_name', v_inv.invited_by_name,
    'sent_by_name', v_inv.sent_by_name, 'organisation', v_org);
end $$;

-- The email or SMS did not go: forget the secret so nothing half-sent can be
-- used, and show why on the invitations list.
create or replace function public.record_invitation_delivery_failure(p_invitation uuid, p_error text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor public.profiles;
  v_inv   public.account_invitations;
begin
  select * into v_actor from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into v_inv from public.account_invitations
   where id = p_invitation and tenant_id = public.current_tenant()
   for update;
  if not found or not public.can_manage_invitation(v_actor, v_inv) then
    raise exception 'No such invitation in your organisation' using errcode = 'P0002';
  end if;
  if v_inv.status = 'sent' then
    update public.account_invitations
       set status = 'ready', secret_hash = null, expires_at = null,
           delivery_error = left(coalesce(p_error, 'Delivery failed'), 300)
     where id = v_inv.id;
  end if;
end $$;

-- Withdraw an invitation for good. One waiting for approval takes its
-- request with it.
create or replace function public.cancel_account_invitation(p_invitation uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor public.profiles;
  v_inv   public.account_invitations;
begin
  select * into v_actor from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into v_inv from public.account_invitations
   where id = p_invitation and tenant_id = public.current_tenant()
   for update;
  if not found then raise exception 'No such invitation in your organisation' using errcode = 'P0002'; end if;
  if not public.can_manage_invitation(v_actor, v_inv) and v_inv.invited_by <> v_actor.id then
    raise exception 'Your role cannot cancel this invitation' using errcode = '42501';
  end if;
  if v_inv.status not in ('awaiting_approval', 'ready', 'sent', 'opened', 'expired', 'locked') then
    raise exception 'This invitation is already %', replace(v_inv.status, '_', ' ') using errcode = '22023';
  end if;

  update public.account_invitations
     set status = 'cancelled', closed_at = now(), closed_by = v_actor.id, closed_by_name = v_actor.full_name,
         close_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Cancelled by an administrator')
   where id = v_inv.id;
  update public.account_requests
     set status = 'cancelled', decided_by = v_actor.id, decided_by_name = v_actor.full_name,
         decided_at = now(), decision_note = 'The invitation was cancelled'
   where invitation_id = v_inv.id and status = 'pending';
  return jsonb_build_object('status', 'cancelled');
end $$;

-- ── 6. What the invited person does (service role only) ─────────────────────
-- The public invitation pages and the app call these through the server,
-- which hashes the link or code and limits attempts per network address.

-- What the invitation offers. Opening a link calls only this: it changes
-- nothing, so a mail scanner opening it first uses nothing up.
create or replace function public.preview_invitation(p_secret_hash text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_inv public.account_invitations;
  v_org text;
begin
  select * into v_inv from public.account_invitations where secret_hash = p_secret_hash;
  if not found then return jsonb_build_object('state', 'unknown'); end if;

  if v_inv.status in ('sent', 'opened') and v_inv.expires_at < now() then
    update public.account_invitations set status = 'expired', closed_at = now(), close_note = 'Not accepted in time'
     where id = v_inv.id;
    return jsonb_build_object('state', 'expired', 'invited_by_name', v_inv.invited_by_name);
  end if;
  if v_inv.status not in ('sent', 'opened') then
    return jsonb_build_object('state', case v_inv.status
      when 'accepted' then 'used' when 'locked' then 'locked' when 'expired' then 'expired' else 'closed' end,
      'invited_by_name', v_inv.invited_by_name);
  end if;

  select name into v_org from public.tenants where id = v_inv.tenant_id;
  return jsonb_build_object(
    'state', 'ok', 'first_name', split_part(v_inv.full_name, ' ', 1), 'role', v_inv.role, 'silo', v_inv.silo,
    'organisation', v_org, 'invited_by_name', v_inv.invited_by_name, 'expires_at', v_inv.expires_at,
    'channel', v_inv.channel, 'email', v_inv.email,
    'sign_in', case when v_inv.login_email like '%.badge.internal' then 'badge' else 'email' end,
    'tries_left', greatest(0, 5 - v_inv.attempts));
end $$;

-- Check the badge number. A wrong one counts; the fifth locks the invitation
-- and tells the inviter. A right one shows the full details.
create or replace function public.check_invitation_badge(p_secret_hash text, p_badge text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_inv public.account_invitations;
begin
  select * into v_inv from public.account_invitations where secret_hash = p_secret_hash for update;
  if not found then return jsonb_build_object('ok', false, 'state', 'unknown'); end if;
  if v_inv.status in ('sent', 'opened') and v_inv.expires_at < now() then
    update public.account_invitations set status = 'expired', closed_at = now(), close_note = 'Not accepted in time'
     where id = v_inv.id;
    return jsonb_build_object('ok', false, 'state', 'expired');
  end if;
  if v_inv.status not in ('sent', 'opened') then
    return jsonb_build_object('ok', false, 'state', case v_inv.status
      when 'accepted' then 'used' when 'locked' then 'locked' when 'expired' then 'expired' else 'closed' end);
  end if;

  if public.normalise_badge(p_badge) <> '' and public.normalise_badge(p_badge) = public.normalise_badge(v_inv.badge_number) then
    update public.account_invitations
       set status = 'opened', opened_at = coalesce(opened_at, now())
     where id = v_inv.id;
    return jsonb_build_object('ok', true, 'state', 'ok', 'full_name', v_inv.full_name,
      'login_email', v_inv.login_email,
      'sign_in', case when v_inv.login_email like '%.badge.internal' then 'badge' else 'email' end);
  end if;

  update public.account_invitations set attempts = attempts + 1 where id = v_inv.id
  returning * into v_inv;
  if v_inv.attempts >= 5 then
    update public.account_invitations
       set status = 'locked', closed_at = now(), close_note = 'Locked after 5 wrong badge numbers'
     where id = v_inv.id
    returning * into v_inv;
    perform public.notify_inviter(v_inv, 'Invitation locked: ' || v_inv.full_name,
      'Someone typed a wrong badge number 5 times. Check with them, then send a new invitation.', 'High');
    return jsonb_build_object('ok', false, 'state', 'locked');
  end if;
  return jsonb_build_object('ok', false, 'state', 'wrong', 'tries_left', 5 - v_inv.attempts);
end $$;

-- Create the account. The server has already created the sign-in (with the
-- password the person chose) for exactly this invitation's address; this
-- re-checks everything, then makes the profile, links the staff record and
-- closes the invitation. If it fails, the server removes that sign-in.
create or replace function public.complete_account_invitation(
  p_secret_hash    text,
  p_badge          text,
  p_user           uuid,
  p_policy_version text
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_inv     public.account_invitations;
  v_person  public.personnel;
  v_request uuid;
begin
  select * into v_inv from public.account_invitations where secret_hash = p_secret_hash for update;
  if not found or v_inv.status not in ('sent', 'opened') or v_inv.expires_at < now() then
    raise exception 'This invitation can no longer be used' using errcode = '22023';
  end if;
  if public.normalise_badge(p_badge) = '' or public.normalise_badge(p_badge) <> public.normalise_badge(v_inv.badge_number) then
    raise exception 'The badge number does not match' using errcode = '42501';
  end if;
  if coalesce(btrim(p_policy_version), '') = '' then
    raise exception 'The POPIA notice must be accepted' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user and lower(email) = lower(v_inv.login_email)) then
    raise exception 'The sign-in does not belong to this invitation' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = p_user) then
    raise exception 'This sign-in already has an account' using errcode = '23505';
  end if;

  select * into v_person from public.personnel where id = v_inv.personnel_id for update;
  if found and v_person.user_id is not null then
    raise exception '% already has an account', v_inv.full_name using errcode = '23505';
  end if;

  select id into v_request from public.account_requests
   where invitation_id = v_inv.id and status = 'approved' order by decided_at desc limit 1;
  -- The account's history starts with who invited them, who approved it, and why.
  perform public.stamp_account_change(v_inv.reason, v_inv.invited_by, v_inv.approved_by, v_request);

  insert into public.profiles (id, tenant_id, silo, role, full_name, badge_number, rank, station, platoon,
                               email, contact_number, status)
  values (p_user, v_inv.tenant_id, v_inv.silo, v_inv.role, v_inv.full_name, v_inv.badge_number,
          v_person.rank, v_person.station, v_person.platoon,
          v_inv.email, v_inv.phone, 'Active');

  if v_person.id is not null then
    update public.personnel set user_id = p_user where id = v_person.id;
  end if;

  update public.account_invitations
     set status = 'accepted', accepted_at = now(), accepted_user_id = p_user, policy_version = btrim(p_policy_version)
   where id = v_inv.id
  returning * into v_inv;

  perform public.notify_inviter(v_inv, 'Invitation accepted: ' || v_inv.full_name,
    format('%s is now on HikTech as %s.', v_inv.full_name, v_inv.role), 'Low');

  return jsonb_build_object('ok', true, 'full_name', v_inv.full_name, 'role', v_inv.role, 'silo', v_inv.silo,
    'login_email', v_inv.login_email,
    'sign_in', case when v_inv.login_email like '%.badge.internal' then 'badge' else 'email' end);
end $$;

-- "This isn't me": close it at once and tell the inviter.
create or replace function public.report_invitation(p_secret_hash text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_inv public.account_invitations;
begin
  select * into v_inv from public.account_invitations where secret_hash = p_secret_hash for update;
  if not found then return jsonb_build_object('ok', false, 'state', 'unknown'); end if;
  if v_inv.status not in ('sent', 'opened') then
    return jsonb_build_object('ok', false, 'state', 'closed');
  end if;
  update public.account_invitations
     set status = 'reported', closed_at = now(),
         close_note = 'Reported by the recipient as not theirs' || coalesce(': ' || nullif(left(btrim(coalesce(p_note, '')), 300), ''), '')
   where id = v_inv.id
  returning * into v_inv;
  perform public.notify_inviter(v_inv, 'Invitation reported: ' || v_inv.full_name,
    'Whoever received it says it is not theirs. Check the address or number before inviting again.', 'High');
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.rate_limit_hit_key(text, int, int) from public, anon, authenticated;
revoke all on function public.preview_invitation(text) from public, anon, authenticated;
revoke all on function public.check_invitation_badge(text, text) from public, anon, authenticated;
revoke all on function public.complete_account_invitation(text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.report_invitation(text, text) from public, anon, authenticated;
grant execute on function public.rate_limit_hit_key(text, int, int) to service_role;
grant execute on function public.preview_invitation(text) to service_role;
grant execute on function public.check_invitation_badge(text, text) to service_role;
grant execute on function public.complete_account_invitation(text, text, uuid, text) to service_role;
grant execute on function public.report_invitation(text, text) to service_role;

revoke all on function public.create_account_invitation(uuid, public.user_role, public.silo, text, text, text, text) from public, anon;
revoke all on function public.issue_invitation_secret(uuid, text, int) from public, anon;
revoke all on function public.record_invitation_delivery_failure(uuid, text) from public, anon;
revoke all on function public.cancel_account_invitation(uuid, text) from public, anon;
grant execute on function public.create_account_invitation(uuid, public.user_role, public.silo, text, text, text, text) to authenticated;
grant execute on function public.issue_invitation_secret(uuid, text, int) to authenticated;
grant execute on function public.record_invitation_delivery_failure(uuid, text) to authenticated;
grant execute on function public.cancel_account_invitation(uuid, text) to authenticated;

-- ── 7. Deciding invitation requests ─────────────────────────────────────────

-- 0048's decision, now also deciding invitations: approving one makes it
-- ready to send (the approver's screen sends it straight away); rejecting or
-- expiring one closes it.
create or replace function public.decide_account_request(
  p_request uuid,
  p_approve boolean,
  p_note    text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor  public.profiles;
  v_req    public.account_requests;
  v_target public.profiles;
  v_inv    public.account_invitations;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_actor from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Not signed in' using errcode = '42501'; end if;
  if v_actor.role not in ('SystemAdmin', 'SuperAdmin') then
    raise exception 'Only a SystemAdmin can decide account requests' using errcode = '42501';
  end if;

  select * into v_req from public.account_requests
   where id = p_request and tenant_id = public.current_tenant()
   for update;
  if not found then raise exception 'No such request in your organisation' using errcode = 'P0002'; end if;
  if v_req.status <> 'pending' then
    raise exception 'This request was already %', v_req.status using errcode = '22023';
  end if;
  if v_req.requested_by = v_actor.id then
    raise exception 'You made this request — a second SystemAdmin must decide it' using errcode = '42501';
  end if;
  if v_req.user_id = v_actor.id then
    raise exception 'This request is about your own account — another SystemAdmin must decide it'
      using errcode = '42501';
  end if;

  if v_req.action = 'invite' then
    select * into v_inv from public.account_invitations where id = v_req.invitation_id for update;
  end if;

  if v_req.requested_at < now() - interval '7 days' then
    update public.account_requests
       set status = 'expired', decided_at = now(), decision_note = 'Not decided within 7 days'
     where id = v_req.id;
    if v_inv.id is not null and v_inv.status = 'awaiting_approval' then
      update public.account_invitations
         set status = 'cancelled', closed_at = now(), close_note = 'Approval not given within 7 days'
       where id = v_inv.id;
    end if;
    return jsonb_build_object('status', 'expired');
  end if;

  if not p_approve then
    if v_note is null or length(v_note) < 5 then
      raise exception 'Say why you are rejecting it — the requester is told' using errcode = '22023';
    end if;
    update public.account_requests
       set status = 'rejected', decided_by = v_actor.id, decided_by_name = v_actor.full_name,
           decided_at = now(), decision_note = v_note
     where id = v_req.id
    returning * into v_req;
    if v_inv.id is not null and v_inv.status = 'awaiting_approval' then
      update public.account_invitations
         set status = 'rejected', closed_at = now(), closed_by = v_actor.id, closed_by_name = v_actor.full_name,
             close_note = 'Approval refused: ' || v_note
       where id = v_inv.id;
    end if;
    perform public.notify_account_request(v_req, 'rejected');
    return jsonb_build_object('status', 'rejected');
  end if;

  if v_req.action = 'invite' then
    if v_inv.id is null or v_inv.status <> 'awaiting_approval' then
      raise exception 'The invitation has changed since this request was made. Reject it and invite again'
        using errcode = '22023';
    end if;
    update public.account_invitations
       set status = 'ready', approved_by = v_actor.id, approved_by_name = v_actor.full_name
     where id = v_inv.id;
    update public.account_requests
       set status = 'approved', decided_by = v_actor.id, decided_by_name = v_actor.full_name,
           decided_at = now(), decision_note = v_note
     where id = v_req.id
    returning * into v_req;
    perform public.notify_account_request(v_req, 'approved');
    return jsonb_build_object('status', 'approved', 'invitation_id', v_inv.id);
  end if;

  -- Approving a change to an account: it must still be as it was when asked for.
  select * into v_target from public.profiles where id = v_req.user_id for update;
  if not found
     or (v_req.action = 'role' and (v_target.role is distinct from v_req.from_role
                                    or v_target.silo is distinct from v_req.from_silo
                                    or v_target.deactivated_at is not null))
     or (v_req.action = 'deactivate' and v_target.deactivated_at is not null)
     or (v_req.action = 'reactivate' and v_target.deactivated_at is null) then
    raise exception 'The account has changed since this request was made. Reject it and ask for a fresh one'
      using errcode = '22023';
  end if;

  perform public.stamp_account_change(v_req.reason, v_req.requested_by, v_actor.id, v_req.id);
  if v_req.action = 'role' then
    update public.profiles set role = v_req.to_role, silo = v_req.to_silo where id = v_target.id;
  else
    if v_req.action = 'deactivate' then
      perform public.assert_no_open_incident(v_target);
    end if;
    perform public.apply_account_active(v_target.id, v_req.action = 'reactivate', v_req.reason, v_req.requested_by);
  end if;

  update public.account_requests
     set status = 'approved', decided_by = v_actor.id, decided_by_name = v_actor.full_name,
         decided_at = now(), decision_note = v_note
   where id = v_req.id
  returning * into v_req;
  perform public.notify_account_request(v_req, 'approved');
  return jsonb_build_object('status', 'approved');
end $$;

-- 0048's withdrawal, now also closing the invitation a request was about.
create or replace function public.cancel_account_request(p_request uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_req public.account_requests;
begin
  select * into v_req from public.account_requests
   where id = p_request and tenant_id = public.current_tenant()
   for update;
  if not found then raise exception 'No such request in your organisation' using errcode = 'P0002'; end if;
  if v_req.requested_by is distinct from auth.uid() then
    raise exception 'Only the person who made a request can withdraw it' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request was already %', v_req.status using errcode = '22023';
  end if;
  update public.account_requests
     set status = 'cancelled', decided_by = auth.uid(), decided_by_name = v_req.requested_by_name,
         decided_at = now(), decision_note = 'Withdrawn by the requester'
   where id = v_req.id;
  if v_req.action = 'invite' then
    update public.account_invitations
       set status = 'cancelled', closed_at = now(), closed_by = auth.uid(), closed_by_name = v_req.requested_by_name,
           close_note = 'Withdrawn before approval'
     where id = v_req.invitation_id and status = 'awaiting_approval';
  end if;
  return jsonb_build_object('status', 'cancelled');
end $$;

revoke all on function public.decide_account_request(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_account_request(uuid) from public, anon;
grant execute on function public.decide_account_request(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_account_request(uuid) to authenticated;

-- ── 8. Prove it ─────────────────────────────────────────────────────────────

do $$
declare
  v_bad text;
begin
  -- Every table carrying tenant_id has its wall (0046's rule).
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

  -- Nobody signed in can write invitations except through the functions.
  select string_agg(policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'public' and tablename = 'account_invitations' and permissive = 'PERMISSIVE'
     and cmd <> 'SELECT';
  if v_bad is not null then
    raise exception 'account_invitations has write policies: % — nothing was changed', v_bad;
  end if;

  -- The person-facing steps are not reachable from a browser session.
  if has_function_privilege('authenticated', 'public.complete_account_invitation(text, text, uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.preview_invitation(text)', 'EXECUTE') then
    raise exception 'Invitation acceptance is callable from a browser — nothing was changed';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
