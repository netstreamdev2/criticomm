-- ============================================================================
-- 0046 — Who may grant what, and the walls between tenants
-- ============================================================================
--
-- Run after 0045.
--
-- The model this migration enforces in the database:
--
--   SuperAdmin    the platform owner. Everything a SystemAdmin can do, plus
--                 tenants, features, access rules, automations, and the only
--                 one who can grant or remove SuperAdmin.
--   SystemAdmin   runs one tenant: every department, every account in it,
--                 every role except SuperAdmin.
--   Admin         runs one department of one tenant: its field and
--                 supervisory accounts, never tenant-wide roles.
--   everyone      sees and touches only their own tenant.
--
-- An audit against that model found these gaps, fixed here:
--
--   1. CRITICAL. profiles_self_update had no column limits: any signed-in
--      user could set their own role to SuperAdmin from the browser, and
--      every database rule (role_in) would believe it. Supervisors and
--      department Admins could grant any role, SuperAdmin included, across
--      every department.
--   2. The web and the app read the role from the sign-in token, the database
--      from profiles, and nothing kept them in step: a role change in Admin
--      never reached the token. Profiles is now the one source, and the token
--      follows it.
--   3. current_silo() fell back to user_metadata, which users can write.
--   4. An officer could edit their own personnel row's department.
--   5. Stored files (incident photos, attachments, certificates, exports) had
--      no tenant wall. The paths start with the department name, which is the
--      same in every tenant.
--   6. log_incoming_call() answered a repeated client_ref with the matching
--      incident from any tenant.
--   7. A SystemAdmin could read the register of every tenant.
--   8. Automations are platform-wide, but any tenant's Admin could retune,
--      switch off or run them for every tenant.
--   9. Suspending a tenant did nothing: its users carried on as before.
--
-- Preview before running. Accounts whose profile role or department differs
-- from their sign-in token are listed here; step 1 sets the profile back to
-- the token (the token can only be written by the platform, so it is the
-- trustworthy side — a profile role nobody granted is exactly gap 1):
--
--   select p.full_name, p.role::text as profile_role, u.raw_app_meta_data ->> 'role' as token_role,
--          p.silo::text as profile_silo, u.raw_app_meta_data ->> 'silo' as token_silo
--     from public.profiles p join auth.users u on u.id = p.id
--    where p.role::text is distinct from u.raw_app_meta_data ->> 'role'
--       or p.silo::text is distinct from u.raw_app_meta_data ->> 'silo';
--
-- All-or-nothing. Safe to re-run.
-- ============================================================================

begin;

-- ── 1. One source of truth for role and department ──────────────────────────

-- Where the token holds a valid role or department, the profile takes it.
update public.profiles p
   set role = (u.raw_app_meta_data ->> 'role')::public.user_role
  from auth.users u
 where u.id = p.id
   and u.raw_app_meta_data ->> 'role' in (select e::text from unnest(enum_range(null::public.user_role)) e)
   and u.raw_app_meta_data ->> 'role' not in ('Officer', 'Metro', 'Chief', 'Operator', 'Responder', 'Security', 'Citizen')
   and p.role::text <> u.raw_app_meta_data ->> 'role';

update public.profiles p
   set silo = (u.raw_app_meta_data ->> 'silo')::public.silo
  from auth.users u
 where u.id = p.id
   and u.raw_app_meta_data ->> 'silo' in (select e::text from unnest(enum_range(null::public.silo)) e)
   and p.silo::text <> u.raw_app_meta_data ->> 'silo';

-- Where the token has none, it takes the profile's.
update auth.users u
   set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
         || jsonb_build_object('role', p.role::text, 'silo', p.silo::text)
  from public.profiles p
 where p.id = u.id
   and (coalesce(u.raw_app_meta_data ->> 'role', '') = ''
        or coalesce(u.raw_app_meta_data ->> 'silo', '') = '');

-- From now on the token follows the profile. Whoever changes a role or a
-- department — the Admin screen, a script, the SQL editor — changes both.
create or replace function public.sync_profile_to_token()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('role', new.role::text, 'silo', new.silo::text)
   where id = new.id
     and (raw_app_meta_data ->> 'role' is distinct from new.role::text
          or raw_app_meta_data ->> 'silo' is distinct from new.silo::text);
  return null;
end $$;
revoke all on function public.sync_profile_to_token() from public, anon, authenticated;

drop trigger if exists sync_profile_to_token on public.profiles;
create trigger sync_profile_to_token after insert or update of role, silo on public.profiles
  for each row execute function public.sync_profile_to_token();

-- ── 2. Who may grant what ───────────────────────────────────────────────────

-- Runs as the caller (not DEFINER), so current_user tells a browser session
-- ('authenticated') apart from the trusted writers: the SQL editor, the
-- service role, and SECURITY DEFINER functions such as the duty mirror, which
-- run as their owner.
create or replace function public.guard_profile_write()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_actor       public.user_role;
  v_actor_silo  public.silo;
  v_row         public.profiles := case when tg_op = 'DELETE' then old else new end;
  -- Roles that reach past one department. A department Admin never grants
  -- or removes them.
  c_tenant_wide constant text[] := array[
    'SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'System',
    'Dispatcher', 'ControlRoom', 'IncidentLogger', 'Viewer'
  ];
begin
  if current_user not in ('authenticated', 'anon') then
    return v_row;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id then
      raise exception 'An account cannot be moved to another tenant from here'
        using errcode = '42501';
    end if;
    if new.is_on_duty is distinct from old.is_on_duty
       or new.last_login is distinct from old.last_login
       or new.total_incidents is distinct from old.total_incidents
       or new.email is distinct from old.email then
      raise exception 'Duty state, sign-in time, totals and e-mail are kept by the system'
        using errcode = '42501';
    end if;
    -- Name, rank, station, contacts, call sign: ordinary profile details.
    if new.role = old.role and new.silo = old.silo
       and new.status is not distinct from old.status then
      return new;
    end if;
  end if;

  -- From here: a new account, a removed account, or a change of role,
  -- department or status.
  v_actor := public.app_role();
  select silo into v_actor_silo from public.profiles where id = auth.uid();

  if v_actor is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if v_row.id = auth.uid() then
    raise exception 'You cannot change your own role, department or account status — ask another administrator'
      using errcode = '42501';
  end if;

  if v_actor = 'SuperAdmin' then
    return v_row;
  end if;

  if v_actor = 'SystemAdmin' then
    if (tg_op <> 'DELETE' and new.role = 'SuperAdmin')
       or (tg_op <> 'INSERT' and old.role = 'SuperAdmin') then
      raise exception 'Only a SuperAdmin can grant, change or remove the SuperAdmin role'
        using errcode = '42501';
    end if;
    return v_row;
  end if;

  if v_actor = 'Admin' and tg_op = 'UPDATE' then
    if old.silo is distinct from v_actor_silo or new.silo is distinct from old.silo then
      raise exception 'A department administrator manages accounts in their own department only'
        using errcode = '42501';
    end if;
    if old.role::text = any (c_tenant_wide) or new.role::text = any (c_tenant_wide) then
      raise exception 'Only a SystemAdmin can grant or change the % role',
        case when new.role::text = any (c_tenant_wide) then new.role else old.role end
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Only an administrator can change a role, department or account status'
    using errcode = '42501';
end $$;
revoke all on function public.guard_profile_write() from public, anon, authenticated;

drop trigger if exists guard_profile_write on public.profiles;
create trigger guard_profile_write before insert or update or delete on public.profiles
  for each row execute function public.guard_profile_write();

-- The policies say WHICH rows; the trigger says WHICH changes.
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists profiles_admin_write on public.profiles;
drop policy if exists profiles_staff_update on public.profiles;
create policy profiles_staff_update on public.profiles for update to authenticated
  using (
    public.role_in('SystemAdmin', 'SuperAdmin')
    or (public.role_in('Admin', 'Supervisor') and silo = public.current_silo())
  )
  with check (
    public.role_in('SystemAdmin', 'SuperAdmin')
    or (public.role_in('Admin', 'Supervisor') and silo = public.current_silo())
  );

drop policy if exists profiles_admin_insert on public.profiles;
create policy profiles_admin_insert on public.profiles for insert to authenticated
  with check (public.role_in('SystemAdmin', 'SuperAdmin'));

drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using (public.role_in('SystemAdmin', 'SuperAdmin'));

-- An officer edits their own personnel row (location, contact) but never
-- which department or account it belongs to — that decides whose dispatches
-- reach them.
create or replace function public.guard_personnel_identity()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if old.user_id = auth.uid()
     and (new.silo is distinct from old.silo or new.user_id is distinct from old.user_id)
     and not public.role_in('SystemAdmin', 'SuperAdmin') then
    raise exception 'You cannot move your own personnel record to another department or account'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_personnel_identity() from public, anon, authenticated;

drop trigger if exists guard_personnel_identity on public.personnel;
create trigger guard_personnel_identity before update on public.personnel
  for each row execute function public.guard_personnel_identity();

-- ── 3. Department comes from the platform, never from the user ──────────────

-- user_metadata is writable by its owner (auth.updateUser), so it can never
-- decide what a session may see.
create or replace function public.current_silo() returns silo language sql stable as $$
  select coalesce(
    (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'silo'),
    'Ethekwini'
  )::silo;
$$;

-- ── 4. Tenants: suspension is real, the register is the platform's ──────────

-- The founding tenant is where tenant-less sessions land; it cannot be
-- suspended, or the SuperAdmin's own desk would go dark.
alter table public.tenants drop constraint if exists tenants_founding_stays_active;
alter table public.tenants add constraint tenants_founding_stays_active
  check (slug <> 'ethekwini' or active);

-- A suspended (or deleted) tenant resolves to no tenant at all, so every
-- tenant wall closes: its users read nothing and write nothing until a
-- SuperAdmin reactivates it.
create or replace function public.current_tenant()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select t.id
    from public.tenants t
   where t.active
     and t.id = coalesce(
       nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid,
       (select f.id from public.tenants f where f.slug = 'ethekwini')
     );
$$;

-- Each tenant sees its own row; only the SuperAdmin sees the register.
drop policy if exists tenants_read on public.tenants;
create policy tenants_read on public.tenants for select
  using (id = public.current_tenant() or public.role_in('SuperAdmin'));

-- ── 5. Every tenant table walled, evaluated once per query ──────────────────

-- `(select current_tenant())` lets Postgres compute the tenant once per query
-- instead of once per row — the function now looks the tenant up. Any table
-- that carries tenant_id but missed its wall gets one.
do $$
declare
  v_tables text[];
  v_missing text[];
  t text;
begin
  select array_agg(distinct tablename) into v_tables
    from pg_policies where schemaname = 'public' and policyname = 'tenant_isolation';

  select array_agg(distinct c.table_name) into v_missing
    from information_schema.columns c
    join pg_tables pt on pt.schemaname = 'public' and pt.tablename = c.table_name
   where c.table_schema = 'public' and c.column_name = 'tenant_id'
     and not (c.table_name = any (coalesce(v_tables, '{}')));

  foreach t in array coalesce(v_tables, '{}') || coalesce(v_missing, '{}') loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I as restrictive for all to authenticated '
      || 'using (tenant_id = (select public.current_tenant())) '
      || 'with check (tenant_id = (select public.current_tenant()))',
      t
    );
  end loop;

  if v_missing is not null then
    raise notice 'Tenant wall added to: %', array_to_string(v_missing, ', ');
  end if;
end $$;

-- ── 6. Files: the record they belong to must be one you can see ─────────────

-- Paths are {department}/{incident id}/… and {department}/{personnel id}/…;
-- the department name repeats in every tenant, so it cannot be the wall. The
-- record can: these lookups run under the caller's own row security, so an
-- incident or person from another tenant is simply not found.
drop policy if exists tenant_isolation_files on storage.objects;
create policy tenant_isolation_files on storage.objects as restrictive for all to authenticated
  using (
    bucket_id not in ('incident-media', 'incident-attachments', 'pdf-exports', 'certifications')
    or (bucket_id in ('incident-media', 'incident-attachments', 'pdf-exports')
        and exists (select 1 from public.incidents i
                     where i.id::text = (storage.foldername(name))[2]))
    or (bucket_id = 'certifications'
        and exists (select 1 from public.personnel p
                     where p.id::text = (storage.foldername(name))[2]))
  )
  with check (
    bucket_id not in ('incident-media', 'incident-attachments', 'pdf-exports', 'certifications')
    or (bucket_id in ('incident-media', 'incident-attachments', 'pdf-exports')
        and exists (select 1 from public.incidents i
                     where i.id::text = (storage.foldername(name))[2]))
    or (bucket_id = 'certifications'
        and exists (select 1 from public.personnel p
                     where p.id::text = (storage.foldername(name))[2]))
  );

-- ── 7. Call intake: a repeated client_ref finds only this tenant's call ─────

create or replace function public.log_incoming_call(
  p_silo silo, p_caller_name text, p_caller_number text, p_call_description text,
  p_incident_type text, p_incident_severity incident_severity, p_location_address text,
  p_location_lat double precision, p_location_lng double precision,
  p_suburb text default null, p_city text default null, p_postal_code text default null,
  p_fire_incident_type text default null, p_medical_type text default null,
  p_disaster_type text default null, p_is_caller_patient boolean default null,
  p_patient_name text default null, p_number_of_victims integer default null,
  p_notes text default null, p_source text default 'Master',
  p_client_ref uuid default null,
  p_incident_category text default null,
  p_region text default null
)
returns public.incidents
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_incident public.incidents;
  v_existing public.incidents;
  v_taker    text;
  v_status   incident_status := case p_silo
                                  when 'EthekwiniDisaster' then 'Pending Analysis'::incident_status
                                  else 'Pending Dispatch'::incident_status
                                end;
begin
  perform public.require_role(
    'SystemAdmin','SuperAdmin','Admin','ControlRoom','IncidentLogger','System'
  );

  if p_client_ref is not null then
    select * into v_existing from public.incidents
     where client_ref = p_client_ref and tenant_id = public.current_tenant();
    if found then return v_existing; end if;
  end if;

  if p_location_lat is null or p_location_lng is null
     or (p_location_lat = 0 and p_location_lng = 0) then
    raise exception 'Place the incident on the map before logging the call';
  end if;

  -- Who took the call is a fact the server knows; never take it from a form.
  select full_name into v_taker from public.profiles where id = auth.uid();

  insert into public.incidents (
    silo, source, incident_number, client_ref,
    caller_name, caller_number, call_description, notes,
    incident_type, incident_category, incident_severity,
    fire_incident_type, medical_type, disaster_type,
    location_address, suburb, city, postal_code, region, location_lat, location_lng,
    is_caller_patient, patient_name, number_of_victims,
    status, call_timestamp, incident_created_at,
    call_taken_by, created_by
  ) values (
    p_silo, p_source, public.next_incident_number(p_silo), p_client_ref,
    p_caller_name, p_caller_number, p_call_description, p_notes,
    p_incident_type, nullif(trim(coalesce(p_incident_category, '')), ''), p_incident_severity,
    p_fire_incident_type, p_medical_type, p_disaster_type,
    p_location_address, p_suburb, p_city, p_postal_code,
    nullif(trim(coalesce(p_region, '')), ''), p_location_lat, p_location_lng,
    p_is_caller_patient, p_patient_name, p_number_of_victims,
    v_status, now(), now(),
    v_taker, auth.uid()
  )
  returning * into v_incident;

  insert into public.audit_logs (
    silo, user_id, user_name, department, action_type, entity_type, entity_id, details
  ) values (
    p_silo, auth.uid(), v_taker,
    p_silo::text, 'CREATE_INCIDENT', 'incidents', v_incident.id::text,
    format('Logged %s call from %s at %s', p_incident_type, p_caller_name, p_location_address)
  );

  return v_incident;
end $$;

revoke execute on function public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text
) from public, anon;
grant execute on function public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid, text, text
) to authenticated, service_role;

-- ── 8. Automations belong to the platform ───────────────────────────────────

-- One set of rules runs for every tenant, so only the platform owner tunes,
-- switches or fires them. Tenant admins still see them.
drop policy if exists automation_rules_write on public.automation_rules;
create policy automation_rules_write on public.automation_rules for update to authenticated
  using (public.role_in('SuperAdmin'))
  with check (public.role_in('SuperAdmin'));

create or replace function public.run_automation_now(p_key text)
returns table (rule_key text, status text, affected int, detail text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.require_role('SuperAdmin');
  if not exists (select 1 from public.automation_rules where key = p_key) then
    raise exception 'No automation rule "%"', p_key;
  end if;
  return query select * from public.run_automations(p_key);
end $$;

revoke execute on function public.run_automation_now(text) from public, anon;
grant execute on function public.run_automation_now(text) to authenticated, service_role;

-- ── 9. Prove it ─────────────────────────────────────────────────────────────

do $$
declare
  v_bad text;
begin
  -- Every public table has row security on (extension-owned tables such as
  -- PostGIS's spatial_ref_sys are reference data, not ours).
  select string_agg(t.tablename, ', ') into v_bad
    from pg_tables t
   where t.schemaname = 'public' and not t.rowsecurity
     and not exists (select 1 from pg_depend d
                      where d.objid = format('public.%I', t.tablename)::regclass
                        and d.deptype = 'e');
  if v_bad is not null then
    raise exception 'Row security is off on: % — nothing was changed', v_bad;
  end if;

  -- Every table carrying tenant_id has its wall.
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

  -- Profiles and tokens agree.
  select string_agg(p.id::text, ', ') into v_bad
    from public.profiles p join auth.users u on u.id = p.id
   where p.role::text is distinct from u.raw_app_meta_data ->> 'role'
      or p.silo::text is distinct from u.raw_app_meta_data ->> 'silo';
  if v_bad is not null then
    raise exception 'Profile and sign-in token disagree for: % — nothing was changed', v_bad;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- After running: everyone should sign out and back in once, so their token
-- carries the role and department the database now agrees on.
