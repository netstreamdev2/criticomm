-- ============================================================================
-- 0048 — Account safety rules
-- ============================================================================
--
-- Run after 0047.
--
-- Agreed for eThekwini, and enforced here in the database so no screen,
-- script or API call can go around them:
--
--   1. TWO SYSTEMADMINS, ALWAYS. A tenant never drops below two active
--      SystemAdmins. Any demotion, deactivation, deletion or move that would
--      leave fewer is refused, whoever asks — the SQL editor included.
--      (A deliberate override exists for the platform owner:
--       alter table public.profiles disable trigger keep_two_system_admins.)
--
--   2. EVERY CHANGE HAS A REASON. Roles, departments and account status change
--      only through change_account_role() and set_account_active(). Both need
--      a written reason (10+ characters, kept forever) and the account's badge
--      number typed back as confirmation (its full name when it has no badge).
--      A browser session can no longer write those columns, create an account
--      or delete one.
--
--   3. TWO PEOPLE FOR THE POWERFUL ROLES. Any change that grants, removes or
--      touches SystemAdmin, Admin or SystemController — including deactivating
--      or reactivating such an account — waits for a second SystemAdmin to
--      approve it in decide_account_request(): never the person who asked,
--      never the person it is about. With no other SystemAdmin in the tenant,
--      the SuperAdmin decides. A SuperAdmin's own changes apply at once (they
--      own the platform, outside the tenant's governance) and are recorded
--      like any other. Unanswered requests expire after 7 days.
--
--   4. DEACTIVATE, NEVER DELETE. A deactivated account cannot sign in (banned
--      in Auth, sessions revoked), sees no data from its very next query,
--      drops off duty and off rosters, and keeps every record it ever made.
--      Someone leading or assigned an open incident cannot be deactivated
--      until it is reassigned or closed.
--
--   5. A PERMANENT HISTORY. account_history records every role, department and
--      activation change — who, when, why, who approved — from a trigger, so
--      nothing escapes it, not even an edit in the SQL editor (recorded as made
--      outside the app). It cannot be edited or deleted.
--
-- Also closes a gap found while checking the live data: a signed-in login with
-- no profile still resolved to the founding tenant and could read its
-- department-wide records. current_tenant() now requires an active profile in
-- that tenant, so a deactivated account or a half-made login sees nothing.
--
-- Safe to re-run.
-- ============================================================================

begin;

-- ── 1. Account state ────────────────────────────────────────────────────────

alter table public.profiles add column if not exists deactivated_at     timestamptz;
alter table public.profiles add column if not exists deactivated_reason text;
alter table public.profiles add column if not exists deactivated_by     uuid;

-- The token follows the profile (0046), now including the tenant and whether
-- the account is deactivated, so the web can turn a deactivated person away
-- with a clear message instead of an empty console.
create or replace function public.sync_profile_to_token()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object(
                'role', new.role::text,
                'silo', new.silo::text,
                'tenant_id', new.tenant_id::text,
                'deactivated', new.deactivated_at is not null)
   where id = new.id
     and (raw_app_meta_data ->> 'role' is distinct from new.role::text
          or raw_app_meta_data ->> 'silo' is distinct from new.silo::text
          or raw_app_meta_data ->> 'tenant_id' is distinct from new.tenant_id::text
          or coalesce(raw_app_meta_data ->> 'deactivated', 'false')
               <> (new.deactivated_at is not null)::text);
  return null;
end $$;
revoke all on function public.sync_profile_to_token() from public, anon, authenticated;

drop trigger if exists sync_profile_to_token on public.profiles;
create trigger sync_profile_to_token
  after insert or update of role, silo, tenant_id, deactivated_at on public.profiles
  for each row execute function public.sync_profile_to_token();

-- Tokens that never carried their tenant (they leaned on the founding-tenant
-- fallback) get it written in.
update auth.users u
   set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
         || jsonb_build_object('tenant_id', p.tenant_id::text,
                               'deactivated', p.deactivated_at is not null)
  from public.profiles p
 where p.id = u.id
   and (u.raw_app_meta_data ->> 'tenant_id' is distinct from p.tenant_id::text
        or u.raw_app_meta_data ->> 'deactivated' is null);

-- ── 2. Only active accounts count ───────────────────────────────────────────

-- A signed-in caller resolves to their tenant only while they hold an active
-- profile in it. No profile, a deactivated one, or one in another tenant: no
-- tenant, so every wall closes. Calls with no signed-in user (scheduler,
-- service role, SQL editor) resolve as before.
create or replace function public.current_tenant()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select t.id
    from public.tenants t
   where t.active
     and t.id = coalesce(
       nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid,
       (select f.id from public.tenants f where f.slug = 'ethekwini')
     )
     and (
       auth.uid() is null
       or exists (select 1 from public.profiles p
                   where p.id = auth.uid() and p.tenant_id = t.id and p.deactivated_at is null)
     );
$$;

-- The role helpers every policy and guarded function leans on ignore a
-- deactivated account, so it holds no role anywhere from the next query.
create or replace function public.app_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and deactivated_at is null;
$$;

create or replace function public.role_in(variadic roles user_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and deactivated_at is null and role = any (roles));
$$;

create or replace function public.is_global()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('SystemAdmin','SuperAdmin','Dispatcher','Operator','ControlRoom','IncidentLogger','Viewer','System','SystemController')
       from public.profiles where id = auth.uid() and deactivated_at is null),
    false
  );
$$;

create or replace function public.can_write_global()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select role in ('SystemAdmin','SuperAdmin','Dispatcher','Operator','ControlRoom','System','SystemController')
       from public.profiles where id = auth.uid() and deactivated_at is null),
    false
  );
$$;

-- ── 3. The permanent history ────────────────────────────────────────────────

create table if not exists public.account_history (
  id               bigserial primary key,
  tenant_id        uuid not null,
  user_id          uuid not null,
  user_name        text,
  at               timestamptz not null default now(),
  change           text not null check (change in
                     ('baseline', 'created', 'role', 'department', 'deactivated', 'reactivated', 'removed')),
  from_value       text,
  to_value         text,
  reason           text,
  actor_id         uuid,
  actor_name       text,
  approved_by      uuid,
  approved_by_name text,
  request_id       uuid,
  -- No signed-in person made it: the SQL editor, a script, the service role.
  outside_app      boolean not null default false
);
create index if not exists account_history_user_idx   on public.account_history (user_id, at desc);
create index if not exists account_history_tenant_idx on public.account_history (tenant_id, at desc);
alter table public.account_history enable row level security;

-- You see your own history; SystemAdmins see the tenant's; a department Admin
-- sees their department's. Nobody writes it but the trigger below.
drop policy if exists account_history_read on public.account_history;
create policy account_history_read on public.account_history for select to authenticated
  using (
    user_id = auth.uid()
    or public.role_in('SystemAdmin', 'SuperAdmin')
    or (public.role_in('Admin') and exists (
          select 1 from public.profiles p
           where p.id = account_history.user_id and p.silo = public.current_silo()))
  );
drop policy if exists tenant_isolation on public.account_history;
create policy tenant_isolation on public.account_history as restrictive for all to authenticated
  using (tenant_id = (select public.current_tenant()))
  with check (tenant_id = (select public.current_tenant()));

create or replace function public.forbid_record_rewrite() returns trigger
language plpgsql as $$
begin
  raise exception '% is a permanent record: it cannot be changed or deleted', tg_table_name
    using errcode = '42501';
end $$;

drop trigger if exists permanent_account_history on public.account_history;
create trigger permanent_account_history before update or delete on public.account_history
  for each row execute function public.forbid_record_rewrite();
drop trigger if exists permanent_account_history_truncate on public.account_history;
create trigger permanent_account_history_truncate before truncate on public.account_history
  for each statement execute function public.forbid_record_rewrite();

-- Written by the trigger on profiles. The change functions below pass their
-- reason, request, requester and approver in transaction-local settings;
-- without them the row still lands, marked as made outside the app.
create or replace function public.record_account_change()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_row           public.profiles := case when tg_op = 'DELETE' then old else new end;
  v_reason        text := nullif(current_setting('criticomm.reason', true), '');
  v_request       uuid := nullif(current_setting('criticomm.request_id', true), '')::uuid;
  v_actor         uuid := coalesce(nullif(current_setting('criticomm.actor_id', true), '')::uuid, auth.uid());
  v_approver      uuid := nullif(current_setting('criticomm.approved_by', true), '')::uuid;
  v_actor_name    text;
  v_approver_name text;
  v_outside       boolean;
begin
  v_outside := v_actor is null;
  select full_name into v_actor_name from public.profiles where id = v_actor;
  select full_name into v_approver_name from public.profiles where id = v_approver;

  if tg_op = 'INSERT' then
    insert into public.account_history (tenant_id, user_id, user_name, change, to_value, reason,
      actor_id, actor_name, approved_by, approved_by_name, request_id, outside_app)
    values (v_row.tenant_id, v_row.id, v_row.full_name, 'created', v_row.role::text, v_reason,
      v_actor, v_actor_name, v_approver, v_approver_name, v_request, v_outside);
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.account_history (tenant_id, user_id, user_name, change, from_value, reason,
      actor_id, actor_name, request_id, outside_app)
    values (v_row.tenant_id, v_row.id, v_row.full_name, 'removed', old.role::text, v_reason,
      v_actor, v_actor_name, v_request, v_outside);
    return null;
  end if;

  if new.role is distinct from old.role then
    insert into public.account_history (tenant_id, user_id, user_name, change, from_value, to_value, reason,
      actor_id, actor_name, approved_by, approved_by_name, request_id, outside_app)
    values (new.tenant_id, new.id, new.full_name, 'role', old.role::text, new.role::text, v_reason,
      v_actor, v_actor_name, v_approver, v_approver_name, v_request, v_outside);
  end if;
  if new.silo is distinct from old.silo then
    insert into public.account_history (tenant_id, user_id, user_name, change, from_value, to_value, reason,
      actor_id, actor_name, approved_by, approved_by_name, request_id, outside_app)
    values (new.tenant_id, new.id, new.full_name, 'department', old.silo::text, new.silo::text, v_reason,
      v_actor, v_actor_name, v_approver, v_approver_name, v_request, v_outside);
  end if;
  if (new.deactivated_at is null) is distinct from (old.deactivated_at is null) then
    insert into public.account_history (tenant_id, user_id, user_name, change, reason,
      actor_id, actor_name, approved_by, approved_by_name, request_id, outside_app)
    values (new.tenant_id, new.id, new.full_name,
      case when new.deactivated_at is null then 'reactivated' else 'deactivated' end,
      coalesce(v_reason, new.deactivated_reason),
      v_actor, v_actor_name, v_approver, v_approver_name, v_request, v_outside);
  end if;
  return null;
end $$;
revoke all on function public.record_account_change() from public, anon, authenticated;

drop trigger if exists record_account_change on public.profiles;
create trigger record_account_change
  after insert or update of role, silo, deactivated_at or delete on public.profiles
  for each row execute function public.record_account_change();

-- History starts today: one line per existing account, saying what it held.
insert into public.account_history (tenant_id, user_id, user_name, change, to_value, reason, outside_app)
select p.tenant_id, p.id, p.full_name, 'baseline', p.role::text,
       'Role on record when account history began', true
  from public.profiles p
 where not exists (select 1 from public.account_history h where h.user_id = p.id);

-- ── 4. Requests waiting for a second SystemAdmin ────────────────────────────

create table if not exists public.account_requests (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  user_id           uuid not null,
  user_name         text,
  action            text not null check (action in ('role', 'deactivate', 'reactivate')),
  from_role         public.user_role,
  to_role           public.user_role,
  from_silo         public.silo,
  to_silo           public.silo,
  reason            text not null,
  status            text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  requested_by      uuid not null,
  requested_by_name text,
  requested_at      timestamptz not null default now(),
  decided_by        uuid,
  decided_by_name   text,
  decided_at        timestamptz,
  decision_note     text
);
-- One open request per account at a time.
create unique index if not exists account_requests_one_open
  on public.account_requests (user_id) where status = 'pending';
create index if not exists account_requests_tenant_idx
  on public.account_requests (tenant_id, status, requested_at desc);
alter table public.account_requests enable row level security;

drop policy if exists account_requests_read on public.account_requests;
create policy account_requests_read on public.account_requests for select to authenticated
  using (public.role_in('SystemAdmin', 'SuperAdmin') or requested_by = auth.uid());
drop policy if exists tenant_isolation on public.account_requests;
create policy tenant_isolation on public.account_requests as restrictive for all to authenticated
  using (tenant_id = (select public.current_tenant()))
  with check (tenant_id = (select public.current_tenant()));

-- A request is decided once; what was asked never changes; none is deleted.
create or replace function public.guard_account_request() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Account requests are a permanent record' using errcode = '42501';
  end if;
  if old.status <> 'pending' then
    raise exception 'This request has already been decided' using errcode = '42501';
  end if;
  if (new.tenant_id, new.user_id, new.action, new.from_role, new.to_role, new.from_silo,
      new.to_silo, new.reason, new.requested_by, new.requested_at)
     is distinct from
     (old.tenant_id, old.user_id, old.action, old.from_role, old.to_role, old.from_silo,
      old.to_silo, old.reason, old.requested_by, old.requested_at) then
    raise exception 'Only the decision on a request can be recorded' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_account_request on public.account_requests;
create trigger guard_account_request before update or delete on public.account_requests
  for each row execute function public.guard_account_request();

-- ── 5. Browser sessions edit details, never authority ───────────────────────

-- Replaces 0046's version: the role ladder now lives in the change functions,
-- which also take the reason and the approval. Trusted writers (SECURITY
-- DEFINER functions, the service role, the SQL editor) pass; a browser
-- session may change ordinary profile details only.
create or replace function public.guard_profile_write()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Accounts are created by invitation, not directly' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Accounts are never deleted — deactivate it instead, so its records stay intact'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id then
    raise exception 'An account cannot be moved to another organisation from here' using errcode = '42501';
  end if;
  if new.role is distinct from old.role or new.silo is distinct from old.silo then
    raise exception 'Roles and departments change through Admin → Users, which records a reason'
      using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     or new.deactivated_at is distinct from old.deactivated_at
     or new.deactivated_reason is distinct from old.deactivated_reason
     or new.deactivated_by is distinct from old.deactivated_by then
    raise exception 'Accounts are deactivated through Admin → Users, which records a reason'
      using errcode = '42501';
  end if;
  if new.is_on_duty is distinct from old.is_on_duty
     or new.last_login is distinct from old.last_login
     or new.total_incidents is distinct from old.total_incidents
     or new.email is distinct from old.email then
    raise exception 'Duty state, sign-in time, totals and e-mail are kept by the system'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_profile_write() from public, anon, authenticated;

drop policy if exists profiles_admin_insert on public.profiles;
drop policy if exists profiles_admin_delete on public.profiles;

-- ── 6. Never fewer than two SystemAdmins ────────────────────────────────────

create or replace function public.keep_two_system_admins()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_left   int;
  v_tenant text;
begin
  -- Only an active SystemAdmin leaving the role, the tenant or active service.
  if old.role <> 'SystemAdmin' or old.deactivated_at is not null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and new.role = 'SystemAdmin' and new.deactivated_at is null
     and new.tenant_id = old.tenant_id then
    return new;
  end if;

  -- Two SystemAdmins removed at the same moment must not both see "enough left".
  perform pg_advisory_xact_lock(hashtext('criticomm.system_admin_floor'), hashtext(old.tenant_id::text));
  select count(*) into v_left from public.profiles
   where tenant_id = old.tenant_id and role = 'SystemAdmin'
     and deactivated_at is null and id <> old.id;

  if v_left < 2 then
    select name into v_tenant from public.tenants where id = old.tenant_id;
    raise exception '% must keep at least two SystemAdmins, and this would leave %. Appoint another SystemAdmin first.',
      coalesce(v_tenant, 'This organisation'), v_left
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.keep_two_system_admins() from public, anon, authenticated;

drop trigger if exists keep_two_system_admins on public.profiles;
create trigger keep_two_system_admins
  before update of role, deactivated_at, tenant_id or delete on public.profiles
  for each row execute function public.keep_two_system_admins();

-- ── 7. Shared checks ────────────────────────────────────────────────────────

-- Roles whose grant, removal or change needs a second SystemAdmin.
create or replace function public.is_powerful_role(p_role public.user_role)
returns boolean language sql immutable as $$
  select p_role in ('SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController');
$$;

create or replace function public.normalise_confirm(p_text text)
returns text language sql immutable as $$
  select lower(regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g'));
$$;

-- What an administrator types back to confirm: the badge number, from the
-- profile or the linked personnel record; the full name when there is none.
-- Mirrors confirmWordFor() in packages/db/src/roles.ts.
create or replace function public.account_confirm_word(p_user uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    nullif(btrim(pr.badge_number), ''),
    (select nullif(btrim(pe.badge_number), '') from public.personnel pe
      where pe.user_id = pr.id and pe.tenant_id = pr.tenant_id
      order by pe.updated_at desc nulls last limit 1),
    nullif(btrim(pr.full_name), ''),
    pr.id::text)
  from public.profiles pr where pr.id = p_user;
$$;

-- The ladder (who may change whom, to what), the reason and the confirmation.
-- Mirrors rolesAssignableBy() in packages/db/src/roles.ts.
create or replace function public.vet_account_change(
  p_actor public.profiles, p_target public.profiles,
  p_role public.user_role, p_silo public.silo,
  p_reason text, p_confirm text
) returns void language plpgsql stable security definer set search_path to 'public' as $$
declare
  c_tenant_wide constant text[] := array[
    'SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'System',
    'Dispatcher', 'ControlRoom', 'IncidentLogger', 'Viewer'
  ];
begin
  if p_target.id = p_actor.id then
    raise exception 'You cannot change your own account — ask another administrator' using errcode = '42501';
  end if;
  if p_actor.role <> 'SuperAdmin' and (p_target.role = 'SuperAdmin' or p_role = 'SuperAdmin') then
    raise exception 'Only a SuperAdmin can grant, change or remove the SuperAdmin role' using errcode = '42501';
  end if;
  if p_role = 'System' and p_target.role <> 'System' then
    raise exception 'System is the automation account, not a role for a person' using errcode = '42501';
  end if;
  if p_actor.role not in ('SuperAdmin', 'SystemAdmin', 'Admin') then
    raise exception 'Only an administrator can change accounts' using errcode = '42501';
  end if;
  if p_actor.role = 'Admin' then
    if p_target.silo is distinct from p_actor.silo or p_silo is distinct from p_target.silo then
      raise exception 'A department administrator manages accounts in their own department only'
        using errcode = '42501';
    end if;
    if p_target.role::text = any (c_tenant_wide) or p_role::text = any (c_tenant_wide) then
      raise exception 'Only a SystemAdmin can grant or change the % role',
        case when p_role::text = any (c_tenant_wide) then p_role else p_target.role end
        using errcode = '42501';
    end if;
  end if;

  -- While a change waits for approval the account is frozen: nothing may slip
  -- in underneath it and make the approved change mean something else.
  if exists (select 1 from public.account_requests
              where user_id = p_target.id and status = 'pending') then
    raise exception 'A change to this account is already waiting for approval. Decide or withdraw it first'
      using errcode = '23505';
  end if;

  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give a reason of at least 10 characters — it goes on the permanent record'
      using errcode = '22023';
  end if;
  if public.normalise_confirm(p_confirm)
     is distinct from public.normalise_confirm(public.account_confirm_word(p_target.id)) then
    raise exception 'The confirmation does not match. Type the badge number (or full name) exactly as shown'
      using errcode = '22023';
  end if;
end $$;

-- Refuse early — at request time, not at approval — a change the floor would
-- block anyway.
create or replace function public.assert_system_admin_floor(p_target public.profiles)
returns void language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_left int;
begin
  if p_target.role <> 'SystemAdmin' or p_target.deactivated_at is not null then return; end if;
  select count(*) into v_left from public.profiles
   where tenant_id = p_target.tenant_id and role = 'SystemAdmin'
     and deactivated_at is null and id <> p_target.id;
  if v_left < 2 then
    raise exception 'This organisation must keep at least two SystemAdmins, and this would leave %. Appoint another SystemAdmin first.', v_left
      using errcode = '42501';
  end if;
end $$;

-- Someone leading or assigned an open incident stays until it is handed on.
create or replace function public.assert_no_open_incident(p_target public.profiles)
returns void language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_open text;
begin
  select incident_number into v_open from public.incidents
   where tenant_id = p_target.tenant_id
     and (accepted_by = p_target.id or assigned_to = p_target.id)
     and status not in ('Resolved', 'Closed')
   limit 1;
  if v_open is not null then
    raise exception '% is leading or assigned %, which is still open. Reassign or close it first.',
      coalesce(p_target.full_name, 'This person'), v_open
      using errcode = '42501';
  end if;
end $$;

-- Tell the approvers a request is waiting, or the requester how it ended.
create or replace function public.notify_account_request(p_req public.account_requests, p_event text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_what text := case p_req.action
    when 'deactivate' then format('deactivate %s', p_req.user_name)
    when 'reactivate' then format('reactivate %s', p_req.user_name)
    else case
      when p_req.to_role = p_req.from_role then format('move %s to %s', p_req.user_name, p_req.to_silo)
      else format('change %s from %s to %s', p_req.user_name, p_req.from_role, p_req.to_role) end
  end;
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
       and p.id not in (p_req.requested_by, p_req.user_id);
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
         and p.id not in (p_req.requested_by, p_req.user_id);
    end if;
  else
    insert into public.alerts (tenant_id, silo, target_user_id, kind, severity, title, body, link,
                               presentation, requires_ack, created_by, created_by_name)
    select p_req.tenant_id, p.silo, p.id, 'approval',
           case when p_event = 'approved' then 'Medium' else 'High' end,
           format('%s: %s', initcap(p_event), v_what),
           format('%s by %s%s', initcap(p_event), coalesce(p_req.decided_by_name, 'the system'),
             coalesce('. ' || nullif(p_req.decision_note, ''), '')),
           '/admin/users/' || p_req.user_id::text, 'toast', false, p_req.decided_by, p_req.decided_by_name
      from public.profiles p
     where p.id = p_req.requested_by;
  end if;
end $$;

-- Carry the who and why to the history trigger, for this transaction only.
create or replace function public.stamp_account_change(
  p_reason text, p_actor uuid, p_approver uuid default null, p_request uuid default null
) returns void language plpgsql as $$
begin
  perform set_config('criticomm.reason', coalesce(p_reason, ''), true);
  perform set_config('criticomm.actor_id', coalesce(p_actor::text, ''), true);
  perform set_config('criticomm.approved_by', coalesce(p_approver::text, ''), true);
  perform set_config('criticomm.request_id', coalesce(p_request::text, ''), true);
end $$;

-- Deactivate or reactivate, with everything that goes with it.
create or replace function public.apply_account_active(p_target uuid, p_active boolean, p_reason text, p_by uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not p_active then
    update public.personnel set is_on_duty = false where user_id = p_target and is_on_duty;
    update public.profiles
       set deactivated_at = now(), deactivated_reason = p_reason, deactivated_by = p_by,
           status = 'Deactivated', is_on_duty = false
     where id = p_target;
    -- Cannot sign in again, and every session ends at its next refresh. The
    -- data is already closed to them by now; these make it a clean refusal.
    begin
      update auth.users set banned_until = now() + interval '100 years' where id = p_target;
    exception when others then
      raise notice 'Could not ban the sign-in for %: %', p_target, sqlerrm;
    end;
    begin
      delete from auth.sessions where user_id = p_target;
    exception when others then
      raise notice 'Could not end the sessions for %: %', p_target, sqlerrm;
    end;
  else
    update public.profiles
       set deactivated_at = null, deactivated_reason = null, deactivated_by = null, status = 'Active'
     where id = p_target;
    begin
      update auth.users set banned_until = null where id = p_target;
    exception when others then
      raise notice 'Could not lift the sign-in ban for %: %', p_target, sqlerrm;
    end;
  end if;
end $$;

revoke all on function public.is_powerful_role(public.user_role) from public, anon, authenticated;
revoke all on function public.account_confirm_word(uuid) from public, anon, authenticated;
revoke all on function public.vet_account_change(public.profiles, public.profiles, public.user_role, public.silo, text, text) from public, anon, authenticated;
revoke all on function public.assert_system_admin_floor(public.profiles) from public, anon, authenticated;
revoke all on function public.assert_no_open_incident(public.profiles) from public, anon, authenticated;
revoke all on function public.notify_account_request(public.account_requests, text) from public, anon, authenticated;
revoke all on function public.stamp_account_change(text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.apply_account_active(uuid, boolean, text, uuid) from public, anon, authenticated;

-- ── 8. The four doors ───────────────────────────────────────────────────────

-- Change a person's role and/or department.
create or replace function public.change_account_role(
  p_user    uuid,
  p_role    public.user_role,
  p_reason  text,
  p_confirm text,
  p_silo    public.silo default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor  public.profiles;
  v_target public.profiles;
  v_silo   public.silo;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_req    public.account_requests;
begin
  select * into v_actor from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Not signed in' using errcode = '42501'; end if;

  select * into v_target from public.profiles
   where id = p_user and tenant_id = public.current_tenant()
   for update;
  if not found then raise exception 'No such account in your organisation' using errcode = 'P0002'; end if;

  v_silo := coalesce(p_silo, v_target.silo);
  perform public.vet_account_change(v_actor, v_target, p_role, v_silo, v_reason, p_confirm);

  if v_target.deactivated_at is not null then
    raise exception 'This account is deactivated. Reactivate it before changing its role' using errcode = '22023';
  end if;
  if p_role = v_target.role and v_silo = v_target.silo then
    raise exception 'Nothing to change: the account already holds that role in that department' using errcode = '22023';
  end if;
  if p_role <> 'SystemAdmin' then
    perform public.assert_system_admin_floor(v_target);
  end if;

  if v_actor.role <> 'SuperAdmin'
     and (public.is_powerful_role(v_target.role) or public.is_powerful_role(p_role)) then
    begin
      insert into public.account_requests (tenant_id, user_id, user_name, action, from_role, to_role,
        from_silo, to_silo, reason, requested_by, requested_by_name)
      values (v_target.tenant_id, v_target.id, v_target.full_name, 'role', v_target.role, p_role,
        v_target.silo, v_silo, v_reason, v_actor.id, v_actor.full_name)
      returning * into v_req;
    exception when unique_violation then
      raise exception 'A change to this account is already waiting for approval' using errcode = '23505';
    end;
    perform public.notify_account_request(v_req, 'requested');
    return jsonb_build_object('status', 'pending', 'request_id', v_req.id);
  end if;

  perform public.stamp_account_change(v_reason, v_actor.id);
  update public.profiles set role = p_role, silo = v_silo where id = v_target.id;
  return jsonb_build_object('status', 'applied');
end $$;

-- Deactivate (p_active false) or reactivate (true) an account.
create or replace function public.set_account_active(
  p_user    uuid,
  p_active  boolean,
  p_reason  text,
  p_confirm text
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor  public.profiles;
  v_target public.profiles;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_req    public.account_requests;
begin
  select * into v_actor from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Not signed in' using errcode = '42501'; end if;

  select * into v_target from public.profiles
   where id = p_user and tenant_id = public.current_tenant()
   for update;
  if not found then raise exception 'No such account in your organisation' using errcode = 'P0002'; end if;

  -- The same ladder as a role change: may this actor manage this account?
  perform public.vet_account_change(v_actor, v_target, v_target.role, v_target.silo, v_reason, p_confirm);

  if p_active = (v_target.deactivated_at is null) then
    raise exception 'This account is already %', case when p_active then 'active' else 'deactivated' end
      using errcode = '22023';
  end if;
  if not p_active then
    perform public.assert_system_admin_floor(v_target);
    perform public.assert_no_open_incident(v_target);
  end if;

  if v_actor.role <> 'SuperAdmin' and public.is_powerful_role(v_target.role) then
    begin
      insert into public.account_requests (tenant_id, user_id, user_name, action, from_role, to_role,
        from_silo, to_silo, reason, requested_by, requested_by_name)
      values (v_target.tenant_id, v_target.id, v_target.full_name,
        case when p_active then 'reactivate' else 'deactivate' end,
        v_target.role, v_target.role, v_target.silo, v_target.silo,
        v_reason, v_actor.id, v_actor.full_name)
      returning * into v_req;
    exception when unique_violation then
      raise exception 'A change to this account is already waiting for approval' using errcode = '23505';
    end;
    perform public.notify_account_request(v_req, 'requested');
    return jsonb_build_object('status', 'pending', 'request_id', v_req.id);
  end if;

  perform public.stamp_account_change(v_reason, v_actor.id);
  perform public.apply_account_active(v_target.id, p_active, v_reason, v_actor.id);
  return jsonb_build_object('status', 'applied');
end $$;

-- The second SystemAdmin's decision.
create or replace function public.decide_account_request(
  p_request uuid,
  p_approve boolean,
  p_note    text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor  public.profiles;
  v_req    public.account_requests;
  v_target public.profiles;
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

  if v_req.requested_at < now() - interval '7 days' then
    update public.account_requests
       set status = 'expired', decided_at = now(), decision_note = 'Not decided within 7 days'
     where id = v_req.id;
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
    perform public.notify_account_request(v_req, 'rejected');
    return jsonb_build_object('status', 'rejected');
  end if;

  -- Approving: the account must still be as it was when the change was asked for.
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

-- The requester withdraws their own request.
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
  return jsonb_build_object('status', 'cancelled');
end $$;

revoke all on function public.change_account_role(uuid, public.user_role, text, text, public.silo) from public, anon;
revoke all on function public.set_account_active(uuid, boolean, text, text) from public, anon;
revoke all on function public.decide_account_request(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_account_request(uuid) from public, anon;
grant execute on function public.change_account_role(uuid, public.user_role, text, text, public.silo) to authenticated;
grant execute on function public.set_account_active(uuid, boolean, text, text) to authenticated;
grant execute on function public.decide_account_request(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_account_request(uuid) to authenticated;

-- ── 9. Prove it ─────────────────────────────────────────────────────────────

do $$
declare
  v_bad text;
begin
  -- A browser session cannot create or delete an account.
  select string_agg(policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'public' and tablename = 'profiles' and permissive = 'PERMISSIVE'
     and cmd in ('INSERT', 'DELETE', 'ALL');
  if v_bad is not null then
    raise exception 'profiles still lets sessions create or delete accounts through: % — nothing was changed', v_bad;
  end if;

  -- The rules are in place.
  select string_agg(t, ', ') into v_bad
    from unnest(array['guard_profile_write', 'keep_two_system_admins', 'record_account_change',
                      'sync_profile_to_token']) t
   where not exists (select 1 from pg_trigger where tgname = t and tgrelid = 'public.profiles'::regclass);
  if v_bad is not null then
    raise exception 'Missing trigger(s) on profiles: % — nothing was changed', v_bad;
  end if;

  -- Every table carrying tenant_id still has its wall (0046's rule).
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

  -- Every account's token names its tenant.
  select string_agg(p.id::text, ', ') into v_bad
    from public.profiles p join auth.users u on u.id = p.id
   where u.raw_app_meta_data ->> 'tenant_id' is distinct from p.tenant_id::text;
  if v_bad is not null then
    raise exception 'Sign-in token without its tenant for: % — nothing was changed', v_bad;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
