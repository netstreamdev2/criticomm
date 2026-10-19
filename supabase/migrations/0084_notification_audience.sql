-- ============================================================================
-- 0084 — Notifications: who each one is for, and who may send one
-- ============================================================================
--
-- Run after 0083.
--
-- Until now a notification (public.alerts) went either to one person or to a
-- whole department, and every organisation-wide role (dispatch, the control
-- room, the viewer, the call logger, system roles) also read every
-- department's broadcasts. Any of a long list of roles could write a
-- notification straight into the table, with any wording, to anyone.
--
-- Now each notification names its audience, and only that audience reads it:
--
--   person        one person: "Patricia".
--   people        a named few: "Patricia and Stephen". Each has their own
--                 read and acknowledgement.
--   role          the holders of some roles in one department: "Metro Police
--                 admins". With all_departments, in every department: "every
--                 captain".
--   department    everyone in one department: "Metro Police".
--   organisation  everyone in the organisation.
--
-- A notification withdrawn by its sender disappears for everyone. Every
-- notification stays inside its organisation (0030).
--
-- Writing:
--   * The emergency and operational ones (dispatch, SOS, case review,
--     schedules, account requests, Criti broadcasts…) are raised by the
--     database's own functions, as before. Their wording and pop-ups do not
--     change. An insert that does not say whom it is for is read as before:
--     a person when it names one, else their department.
--   * People send through send_notification(), which checks who may reach
--     whom (below). Direct writes to the table are no longer allowed.
--   * A person's own read receipts only, and only for notifications they can
--     see.
--
-- Who may send:
--   to a person       anyone signed in, to someone in their organisation.
--   to people, a role or a department
--                     the administrators, command (captain, fire chief,
--                     supervisor) and the dispatch desks: their own
--                     department. The organisation's administrators, the
--                     system controller and the central control room: any
--                     department.
--   to the organisation, or a role in every department
--                     SuperAdmin, SystemAdmin, SystemController.
-- A person's notification is never an emergency pop-up: no blocking modal,
-- no Critical, links only inside HikTech. Every send is audited.
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. Whom a notification is for ──────────────────────────────────────────

alter table public.alerts
  add column if not exists audience        text,
  add column if not exists target_users    uuid[],
  add column if not exists target_roles    public.user_role[],
  add column if not exists all_departments boolean not null default false,
  add column if not exists withdrawn_at    timestamptz,
  add column if not exists withdrawn_by    uuid;

-- What was there before: a person when it names one, else their department.
update public.alerts
   set audience = case when target_user_id is not null then 'person' else 'department' end
 where audience is null;

/** The database's own inserts name no audience: read as before. */
create or replace function public.alerts_fill_audience() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.audience is null then
    new.audience := case
      when new.target_user_id is not null then 'person'
      when new.target_users is not null then 'people'
      when new.target_roles is not null then 'role'
      else 'department' end;
  end if;
  return new;
end $$;
drop trigger if exists alerts_fill_audience on public.alerts;
create trigger alerts_fill_audience before insert on public.alerts
  for each row execute function public.alerts_fill_audience();

alter table public.alerts alter column audience set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'alerts_audience_check') then
    alter table public.alerts add constraint alerts_audience_check check (
      (audience = 'person' and target_user_id is not null)
      or (audience = 'people' and target_users is not null and cardinality(target_users) between 1 and 50)
      or (audience = 'role' and target_roles is not null and cardinality(target_roles) between 1 and 12)
      or (audience in ('department', 'organisation') and target_user_id is null)
    );
  end if;
end $$;

create index if not exists alerts_people_idx on public.alerts using gin (target_users);
create index if not exists alerts_audience_idx on public.alerts (tenant_id, audience, created_at desc);

-- ── 2. Who reads it: its audience, nobody else ─────────────────────────────

/** Is this notification for the signed-in person. Used by the read rule. */
create or replace function public.alert_is_for_me(
  p_audience text, p_silo public.silo, p_target uuid, p_users uuid[], p_roles public.user_role[], p_all boolean
) returns boolean language sql stable security definer set search_path to 'public' as $$
  select case p_audience
    when 'person' then p_target = auth.uid()
    when 'people' then auth.uid() = any (p_users)
    when 'role' then exists (
      select 1 from public.profiles pr
       where pr.id = auth.uid() and pr.deactivated_at is null
         and pr.role = any (p_roles)
         and (p_all or pr.silo = p_silo))
    when 'department' then public.current_silo() = p_silo
    when 'organisation' then auth.uid() is not null
    else false end
$$;
revoke all on function public.alert_is_for_me(text, public.silo, uuid, uuid[], public.user_role[], boolean) from public, anon;
grant execute on function public.alert_is_for_me(text, public.silo, uuid, uuid[], public.user_role[], boolean) to authenticated, service_role;

drop policy if exists alerts_read on public.alerts;
create policy alerts_read on public.alerts for select to authenticated
  using (
    withdrawn_at is null
    and public.alert_is_for_me(audience, silo, target_user_id, target_users, target_roles, all_departments)
  );

-- Nobody writes the table directly: the database's functions and send_notification() do.
drop policy if exists alerts_write on public.alerts;
drop policy if exists alerts_update on public.alerts;
revoke insert, update, delete on public.alerts from anon, authenticated;
grant select on public.alerts to authenticated;

-- The V4-era department fan-out: unused since 0073, and it wrote as the caller.
revoke execute on function public.raise_dispatch_alerts(uuid, public.silo[], text) from public, anon, authenticated;

-- Read receipts: your own, for what you can see.
drop policy if exists alert_reads_own on public.alert_reads;
create policy alert_reads_own on public.alert_reads for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.alerts a where a.id = alert_id));

-- ── 3. Sending ─────────────────────────────────────────────────────────────

/** May send to people, a role or a department; whether to any department. */
create or replace function public.notification_reach()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'groups', public.role_in('SuperAdmin', 'SystemAdmin', 'SystemController', 'Admin', 'Supervisor',
                             'Captain', 'FireChief', 'Dispatcher', 'ControlRoom'),
    'anyDepartment', public.role_in('SuperAdmin', 'SystemAdmin', 'SystemController')
                     or (public.role_in('ControlRoom', 'Dispatcher') and public.current_silo() = 'Ethekwini'),
    'organisation', public.role_in('SuperAdmin', 'SystemAdmin', 'SystemController'),
    'silo', public.current_silo())
  where auth.uid() is not null
$$;
revoke all on function public.notification_reach() from public, anon;
grant execute on function public.notification_reach() to authenticated, service_role;

/**
 * Send a notification. p_audience: person | people | role | department |
 * organisation. Never an emergency pop-up: a quiet notification, Low to High,
 * its link inside HikTech. Audited. Returns the notification.
 */
create or replace function public.send_notification(
  p_audience        text,
  p_title           text,
  p_body            text default null,
  p_link            text default null,
  p_severity        text default 'Low',
  p_user            uuid default null,
  p_users           uuid[] default null,
  p_roles           public.user_role[] default null,
  p_silo            public.silo default null,
  p_all_departments boolean default false,
  p_kind            text default 'info'
) returns public.alerts language plpgsql security definer set search_path to 'public' as $$
declare
  v_me      public.profiles;
  v_reach   jsonb := public.notification_reach();
  v_tenant  uuid := public.current_tenant();
  v_title   text := nullif(btrim(coalesce(p_title, '')), '');
  v_body    text := nullif(btrim(coalesce(p_body, '')), '');
  v_link    text := nullif(btrim(coalesce(p_link, '')), '');
  v_users   uuid[];
  v_silo    public.silo;
  v_row     public.alerts;
  v_who     text;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if not found or v_me.deactivated_at is not null or v_tenant is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_audience is null or p_audience not in ('person', 'people', 'role', 'department', 'organisation') then
    raise exception 'Choose who it is for' using errcode = '22023';
  end if;
  if v_title is null then raise exception 'Write a title' using errcode = '22023'; end if;
  if length(v_title) > 140 then raise exception 'Keep the title under 140 characters' using errcode = '22023'; end if;
  if length(coalesce(v_body, '')) > 1000 then raise exception 'Keep the message under 1000 characters' using errcode = '22023'; end if;
  -- Inside HikTech only: a notification is never a way to send someone elsewhere.
  if v_link is not null and (v_link !~ '^/[A-Za-z0-9/_?=&%.#-]*$' or v_link ~ '^//') then
    raise exception 'A link goes to a page inside HikTech' using errcode = '22023';
  end if;
  if coalesce(p_severity, 'Low') not in ('Low', 'Medium', 'High') then
    raise exception 'Choose Low, Medium or High' using errcode = '22023';
  end if;
  if coalesce(p_kind, 'info') not in ('info', 'broadcast', 'mail', 'task') then
    raise exception 'That kind of notification is raised by HikTech itself' using errcode = '22023';
  end if;

  v_silo := coalesce(p_silo, v_me.silo);
  if p_audience = 'person' then
    if p_user is null or not exists (select 1 from public.profiles where id = p_user and tenant_id = v_tenant and deactivated_at is null) then
      raise exception 'That person is not in your organisation' using errcode = 'P0002';
    end if;
    select silo into v_silo from public.profiles where id = p_user;
  else
    if not coalesce((v_reach ->> 'groups')::boolean, false) then
      raise exception 'You may send to one person at a time' using errcode = '42501';
    end if;
    if p_audience = 'organisation' or (p_audience = 'role' and coalesce(p_all_departments, false)) then
      if not coalesce((v_reach ->> 'organisation')::boolean, false) then
        raise exception 'Only the organisation''s administrators send to everyone' using errcode = '42501';
      end if;
    elsif v_silo <> v_me.silo and not coalesce((v_reach ->> 'anyDepartment')::boolean, false) then
      raise exception 'You may send to your own department only' using errcode = '42501';
    end if;
    if p_audience = 'people' then
      select coalesce(array_agg(distinct u), '{}') into v_users from unnest(coalesce(p_users, '{}')) u;
      if cardinality(v_users) = 0 or cardinality(v_users) > 50 then
        raise exception 'Choose between 1 and 50 people' using errcode = '22023';
      end if;
      if exists (select 1 from unnest(v_users) u
                  where not exists (select 1 from public.profiles pr where pr.id = u and pr.tenant_id = v_tenant and pr.deactivated_at is null)) then
        raise exception 'Everyone chosen must be in your organisation' using errcode = 'P0002';
      end if;
      -- Outside the organisation's administrators, people in your own department only.
      if not coalesce((v_reach ->> 'anyDepartment')::boolean, false)
         and exists (select 1 from public.profiles pr where pr.id = any (v_users) and pr.silo <> v_me.silo) then
        raise exception 'You may send to people in your own department only' using errcode = '42501';
      end if;
    end if;
    if p_audience = 'role' and (p_roles is null or cardinality(p_roles) = 0) then
      raise exception 'Choose the roles' using errcode = '22023';
    end if;
  end if;

  insert into public.alerts (
    tenant_id, silo, audience, target_user_id, target_users, target_roles, all_departments,
    kind, severity, title, body, link, presentation, requires_ack, created_by, created_by_name
  ) values (
    v_tenant, v_silo, p_audience,
    case when p_audience = 'person' then p_user end,
    case when p_audience = 'people' then v_users end,
    case when p_audience = 'role' then p_roles end,
    p_audience = 'role' and coalesce(p_all_departments, false),
    coalesce(p_kind, 'info'), coalesce(p_severity, 'Low'), v_title, v_body, v_link,
    'toast', false, auth.uid(), v_me.full_name
  ) returning * into v_row;

  v_who := case p_audience
    when 'person' then (select coalesce(full_name, 'a person') from public.profiles where id = p_user)
    when 'people' then format('%s people', cardinality(v_users))
    when 'role' then format('%s%s', array_to_string(p_roles::text[], ', '), case when v_row.all_departments then ' (every department)' else format(' (%s)', v_silo) end)
    when 'department' then v_silo::text
    else 'the organisation' end;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_tenant, v_me.silo, auth.uid(), v_me.full_name, 'NotificationSent', 'alert', v_row.id::text,
          left(format('To %s: %s', v_who, v_title), 300));
  return v_row;
end $$;
revoke all on function public.send_notification(text, text, text, text, text, uuid, uuid[], public.user_role[], public.silo, boolean, text) from public, anon;
grant execute on function public.send_notification(text, text, text, text, text, uuid, uuid[], public.user_role[], public.silo, boolean, text) to authenticated;

/** Take a notification back: its sender, or the organisation's administrators. Audited. */
create or replace function public.withdraw_notification(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_row  public.alerts;
  v_name text;
begin
  select * into v_row from public.alerts where id = p_id and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'Notification not found' using errcode = 'P0002'; end if;
  if not (v_row.created_by = auth.uid() or public.role_in('SuperAdmin', 'SystemAdmin')) then
    raise exception 'Only the sender takes a notification back' using errcode = '42501';
  end if;
  if v_row.kind not in ('info', 'broadcast', 'mail', 'task') then
    raise exception 'HikTech''s own notifications stay on the record' using errcode = '42501';
  end if;
  if v_row.withdrawn_at is not null then return; end if;
  update public.alerts set withdrawn_at = now(), withdrawn_by = auth.uid() where id = p_id;
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_row.tenant_id, v_row.silo, auth.uid(), v_name, 'NotificationWithdrawn', 'alert', p_id::text, left(v_row.title, 300));
end $$;
revoke all on function public.withdraw_notification(uuid) from public, anon;
grant execute on function public.withdraw_notification(uuid) to authenticated;

/** What I sent (to take one back, or see it reached people): the last 50. */
create or replace function public.my_sent_notifications()
returns setof public.alerts language sql stable security definer set search_path to 'public' as $$
  select * from public.alerts
   where created_by = auth.uid() and tenant_id = public.current_tenant()
     and kind in ('info', 'broadcast', 'mail', 'task')
   order by created_at desc limit 50
$$;
revoke all on function public.my_sent_notifications() from public, anon;
grant execute on function public.my_sent_notifications() to authenticated;

/** For System Status: how many notifications the organisation raised since a moment. Administrators only. */
create or replace function public.notification_activity(p_since timestamptz)
returns integer language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.require_role('SuperAdmin', 'SystemAdmin', 'SystemController', 'Admin');
  return (select count(*)::int from public.alerts
           where tenant_id = public.current_tenant() and created_at >= p_since
             and (not public.role_in('Admin') or silo = public.current_silo()));
end $$;
revoke all on function public.notification_activity(timestamptz) from public, anon;
grant execute on function public.notification_activity(timestamptz) to authenticated;

notify pgrst, 'reload schema';
