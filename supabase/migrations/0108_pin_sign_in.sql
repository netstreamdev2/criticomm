-- ============================================================================
-- 0108 — Sign in with a PIN on a registered device
-- ============================================================================
--
-- Run after 0107.
--
-- Officers share radios and use whichever one is free, and a radio has no
-- fingerprint reader. So on a device the station has registered, an officer
-- picks their name (or types their badge number) and enters a 6-digit PIN.
--
--   * A PIN only works on a registered device. A supervisor (or an
--     administrator) registers it once, on the device itself. The server
--     makes the device's key; the database keeps only its hash.
--   * The PIN is the officer's own, the same on every registered device.
--     They choose it after signing in once with their password. The database
--     keeps only a keyed hash made by the server; it never sees the PIN.
--   * Five wrong PINs lock that officer's PIN (not the device) until a
--     supervisor unlocks it. A forgotten PIN is reset by a supervisor; the
--     officer then chooses a new one after signing in with their password.
--   * Passwords keep working everywhere. The PIN is added, not swapped in.
--   * Offline, a device lets back in the officers who signed in on it with
--     their PIN in the last shift (the phone checks the PIN). Every sign-in
--     made on a registered device ends at the server after 14 hours, when
--     the device is removed, and when that officer's PIN is reset — so a lost
--     radio cannot stay signed in.
--
--   sign_in_devices                 the registered devices
--   sign_in_pins                    each officer's PIN hash and wrong tries
--   sign_in_device_sessions         sign-ins made on a registered device
--   register_sign_in_device()       a supervisor registers this device (via the server)
--   remove_sign_in_device()         a lost or retired device stops working at once
--   sign_in_pin_lookup()            server only: is this device and this officer good to try
--   sign_in_pin_attempt()           server only: check a PIN, count wrong tries, lock at five
--   set_sign_in_pin()               server only: the officer's new PIN (password checked first)
--   reset_sign_in_pin()             a supervisor clears a forgotten PIN
--   unlock_sign_in_pin()            a supervisor unlocks after five wrong tries
--   sign_in_pin_board()             who has a PIN, who is locked (the console)
--   my_sign_in_pin()                does the signed-in officer have a PIN
--   record_sign_in_device_session() the phone notes its sign-in was made on a registered device
--   end_stale_sign_in_sessions()    ends device sign-ins older than 14 hours (every 15 minutes)
--
-- No table is written directly; every change goes through these functions
-- and is audited. Safe to re-run.
-- ============================================================================

-- ── 1. Who looks after it ──────────────────────────────────────────────────

-- The same people who look after the department's radios (0051, 0101). A
-- device with no department (registered by a tenant-wide administrator) is
-- looked after by the tenant-wide administrators only.
create or replace function public.can_manage_sign_in(p_silo public.silo) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.can_manage_armoury(p_silo);
$$;
revoke all on function public.can_manage_sign_in(public.silo) from public, anon;
grant execute on function public.can_manage_sign_in(public.silo) to authenticated;

-- ── 2. The tables ──────────────────────────────────────────────────────────

create table if not exists public.sign_in_devices (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  -- The department whose officers sign in on it; null: every department.
  silo               public.silo,
  label              text not null check (length(label) between 1 and 60),
  -- The Radio ID the HikTech app shows on this device (0087).
  radio_id           text check (radio_id is null or radio_id ~ '^HT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
  -- Keyed hash of the device's key; the key itself is only on the device.
  secret_hash        text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  registered_by      uuid not null,
  registered_by_name text,
  registered_at      timestamptz not null default now(),
  last_used_at       timestamptz,
  last_used_by       uuid,
  removed_at         timestamptz,
  removed_by         uuid,
  removed_reason     text check (removed_reason is null or length(removed_reason) <= 300)
);
create unique index if not exists sign_in_devices_secret_uq on public.sign_in_devices (secret_hash);
-- One live registration per device.
create unique index if not exists sign_in_devices_radio_uq on public.sign_in_devices (tenant_id, radio_id)
  where removed_at is null and radio_id is not null;
create index if not exists sign_in_devices_tenant_idx on public.sign_in_devices (tenant_id, registered_at desc);

create table if not exists public.sign_in_pins (
  user_id      uuid primary key,
  tenant_id    uuid not null,
  -- Keyed hash of the PIN, made by the server; the PIN itself is never stored.
  pin_hash     text not null check (pin_hash ~ '^[0-9a-f]{64}$'),
  set_at       timestamptz not null default now(),
  failed_count integer not null default 0 check (failed_count >= 0),
  locked_at    timestamptz,
  last_used_at timestamptz
);

create table if not exists public.sign_in_device_sessions (
  -- auth.sessions.id, from the sign-in's own token.
  session_id uuid primary key,
  device_id  uuid not null references public.sign_in_devices(id) on delete cascade,
  user_id    uuid not null,
  started_at timestamptz not null default now()
);
create index if not exists sign_in_device_sessions_device_idx on public.sign_in_device_sessions (device_id);
create index if not exists sign_in_device_sessions_user_idx on public.sign_in_device_sessions (user_id);
create index if not exists sign_in_device_sessions_started_idx on public.sign_in_device_sessions (started_at);

alter table public.sign_in_devices enable row level security;
alter table public.sign_in_pins enable row level security;
alter table public.sign_in_device_sessions enable row level security;
revoke all on public.sign_in_devices, public.sign_in_pins, public.sign_in_device_sessions from anon, authenticated;
-- The console lists the devices; the PIN table is read only through sign_in_pin_board().
grant select on public.sign_in_devices to authenticated;

drop policy if exists sign_in_devices_read on public.sign_in_devices;
create policy sign_in_devices_read on public.sign_in_devices for select to authenticated
  using (tenant_id = public.current_tenant() and public.can_manage_sign_in(silo));

-- ── 3. Rules shared by the functions ───────────────────────────────────────

/** Wrong PINs before the PIN locks. Mirrors PIN_MAX_TRIES in packages/db/src/sign-in-pin.ts. */
create or replace function public.sign_in_pin_max_tries() returns integer
language sql immutable as $$ select 5 $$;

/** How long a sign-in made on a registered device lasts at the server. */
create or replace function public.sign_in_device_session_life() returns interval
language sql immutable as $$ select interval '14 hours' $$;

/** The roles that may sign in on a device of any department. */
create or replace function public.sign_in_any_department(p_role text) returns boolean
language sql immutable as $$ select p_role in ('SystemAdmin', 'SuperAdmin', 'SystemController') $$;

/** Ends sign-ins made on registered devices, at the server: they cannot be renewed after this. */
create or replace function public.end_sign_in_sessions(p_device uuid, p_user uuid) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(session_id), '{}') into v_ids
    from public.sign_in_device_sessions
   where (p_device is null or device_id = p_device) and (p_user is null or user_id = p_user);
  if p_device is null and p_user is null then return 0; end if;
  begin
    delete from auth.sessions where id = any (v_ids);
  exception when others then
    raise notice 'Could not end the device sign-ins: %', sqlerrm;
  end;
  delete from public.sign_in_device_sessions where session_id = any (v_ids);
  return coalesce(array_length(v_ids, 1), 0);
end $$;
revoke all on function public.end_sign_in_sessions(uuid, uuid) from public, anon, authenticated;

/** Device sign-ins older than 14 hours end. Every 15 minutes, and before each PIN check. */
create or replace function public.end_stale_sign_in_sessions() returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(session_id), '{}') into v_ids
    from public.sign_in_device_sessions
   where started_at < now() - public.sign_in_device_session_life();
  if coalesce(array_length(v_ids, 1), 0) = 0 then return 0; end if;
  begin
    delete from auth.sessions where id = any (v_ids);
  exception when others then
    raise notice 'Could not end the old device sign-ins: %', sqlerrm;
  end;
  delete from public.sign_in_device_sessions where session_id = any (v_ids);
  return array_length(v_ids, 1);
end $$;
revoke all on function public.end_stale_sign_in_sessions() from public, anon, authenticated;
grant execute on function public.end_stale_sign_in_sessions() to service_role;

create or replace function public.sign_in_audit(
  p_tenant uuid, p_silo public.silo, p_user uuid, p_name text, p_action text, p_entity text, p_id text, p_details text
) returns void language sql security definer set search_path to 'public' as $$
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (p_tenant, coalesce(p_silo, 'Ethekwini'), p_user, p_name, p_action, p_entity, p_id, p_details);
$$;
revoke all on function public.sign_in_audit(uuid, public.silo, uuid, text, text, text, text, text) from public, anon, authenticated;

-- ── 4. Registering and removing devices ────────────────────────────────────

/**
 * A supervisor registers the device they are holding. The web server makes
 * the device key and passes its hash; this runs with the supervisor's own
 * sign-in, so the database decides whether they may. Registering a device
 * again ends its old registration and the sign-ins made on it.
 */
create or replace function public.register_sign_in_device(p_label text, p_radio_id text, p_secret_hash text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid := public.current_tenant();
  v_global boolean := public.role_in('SystemAdmin', 'SuperAdmin', 'SystemController');
  v_silo   public.silo;
  v_label  text := nullif(btrim(coalesce(p_label, '')), '');
  v_radio  text := nullif(upper(btrim(coalesce(p_radio_id, ''))), '');
  v_name   text;
  v_old    record;
  v_row    public.sign_in_devices;
begin
  if auth.uid() is null or v_tenant is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  v_silo := case when v_global then null else public.current_silo() end;
  if not public.can_manage_sign_in(v_silo) then
    raise exception 'Only a supervisor or an administrator registers a device for PIN sign-in' using errcode = '42501';
  end if;
  if v_label is null or length(v_label) > 60 then
    raise exception 'Give the device a name, such as the number written on the radio' using errcode = '22023';
  end if;
  if v_radio is not null and v_radio !~ '^HT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$' then
    raise exception 'The Radio ID looks like HT-XXXX-XXXX, as the app shows it' using errcode = '22023';
  end if;
  if coalesce(p_secret_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'The device key is not valid' using errcode = '22023';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  for v_old in
    select id, label from public.sign_in_devices
     where tenant_id = v_tenant and radio_id = v_radio and removed_at is null and v_radio is not null
  loop
    update public.sign_in_devices
       set removed_at = now(), removed_by = auth.uid(), removed_reason = 'Registered again'
     where id = v_old.id;
    perform public.end_sign_in_sessions(v_old.id, null);
  end loop;

  insert into public.sign_in_devices (tenant_id, silo, label, radio_id, secret_hash, registered_by, registered_by_name)
  values (v_tenant, v_silo, v_label, v_radio, p_secret_hash, auth.uid(), v_name)
  returning * into v_row;

  perform public.sign_in_audit(v_tenant, coalesce(v_silo, public.current_silo()), auth.uid(), v_name,
    'SignInDeviceRegistered', 'sign_in_device', v_row.id::text,
    format('Registered %s for PIN sign-in%s', v_row.label, coalesce(' · ' || v_row.radio_id, '')));
  return jsonb_build_object('id', v_row.id, 'label', v_row.label, 'silo', v_row.silo, 'radio_id', v_row.radio_id);
end $$;
revoke all on function public.register_sign_in_device(text, text, text) from public, anon;
grant execute on function public.register_sign_in_device(text, text, text) to authenticated;

/** A lost or retired device stops working at once, and every sign-in made on it ends. */
create or replace function public.remove_sign_in_device(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_row  public.sign_in_devices;
  v_name text;
  v_ended integer;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into v_row from public.sign_in_devices where id = p_id and tenant_id = public.current_tenant();
  if not found then raise exception 'That device is not registered' using errcode = 'P0002'; end if;
  if not public.can_manage_sign_in(v_row.silo) then
    raise exception 'Only a supervisor or an administrator removes a device' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why it is removed, such as lost or retired' using errcode = '22023';
  end if;
  if v_row.removed_at is not null then return; end if;

  update public.sign_in_devices
     set removed_at = now(), removed_by = auth.uid(), removed_reason = left(btrim(p_reason), 300)
   where id = p_id;
  v_ended := public.end_sign_in_sessions(p_id, null);
  select full_name into v_name from public.profiles where id = auth.uid();
  perform public.sign_in_audit(v_row.tenant_id, coalesce(v_row.silo, public.current_silo()), auth.uid(), v_name,
    'SignInDeviceRemoved', 'sign_in_device', v_row.id::text,
    format('Removed %s: %s · %s sign-in(s) ended', v_row.label, btrim(p_reason), v_ended));
end $$;
revoke all on function public.remove_sign_in_device(uuid, text) from public, anon;
grant execute on function public.remove_sign_in_device(uuid, text) to authenticated;

-- ── 5. Signing in with a PIN (the web server only) ─────────────────────────

/**
 * Before a PIN is checked: the device is registered and its key matches, and
 * the officer (by id, from the device's list, or by badge number) is active,
 * of the device's department, and has a PIN that is not locked. States:
 * ok, device, unknown, inactive, elsewhere, no_pin, locked.
 */
create or replace function public.sign_in_pin_lookup(p_device uuid, p_device_hash text, p_user uuid, p_badge text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_dev   public.sign_in_devices;
  v_prof  record;
  v_badge text := public.normalise_badge(p_badge);
  v_count integer;
  v_pin   public.sign_in_pins;
  v_who   jsonb;
begin
  perform public.end_stale_sign_in_sessions();
  select * into v_dev from public.sign_in_devices where id = p_device;
  if not found or v_dev.removed_at is not null or v_dev.secret_hash is distinct from p_device_hash then
    return jsonb_build_object('state', 'device');
  end if;

  if p_user is not null then
    select p.id, p.full_name, p.silo::text as silo, p.role::text as role, p.deactivated_at into v_prof
      from public.profiles p where p.id = p_user and p.tenant_id = v_dev.tenant_id;
    if not found then return jsonb_build_object('state', 'unknown'); end if;
  else
    if v_badge = '' then return jsonb_build_object('state', 'unknown'); end if;
    -- The badge on the account, else on the staff record linked to it. Two
    -- accounts with one badge is refused rather than guessed.
    select count(distinct p.id) into v_count
      from public.profiles p
      left join public.personnel pe on pe.user_id = p.id
     where p.tenant_id = v_dev.tenant_id
       and (public.normalise_badge(p.badge_number) = v_badge or public.normalise_badge(pe.badge_number) = v_badge);
    if v_count <> 1 then return jsonb_build_object('state', 'unknown'); end if;
    select p.id, p.full_name, p.silo::text as silo, p.role::text as role, p.deactivated_at into v_prof
      from public.profiles p
      left join public.personnel pe on pe.user_id = p.id
     where p.tenant_id = v_dev.tenant_id
       and (public.normalise_badge(p.badge_number) = v_badge or public.normalise_badge(pe.badge_number) = v_badge)
     limit 1;
  end if;

  v_who := jsonb_build_object('user_id', v_prof.id, 'full_name', v_prof.full_name);
  if v_prof.deactivated_at is not null then return v_who || jsonb_build_object('state', 'inactive'); end if;
  if v_dev.silo is not null and v_prof.silo <> v_dev.silo::text and not public.sign_in_any_department(v_prof.role) then
    return v_who || jsonb_build_object('state', 'elsewhere');
  end if;
  select * into v_pin from public.sign_in_pins where user_id = v_prof.id;
  if not found then return v_who || jsonb_build_object('state', 'no_pin'); end if;
  if v_pin.locked_at is not null then return v_who || jsonb_build_object('state', 'locked'); end if;
  return v_who || jsonb_build_object('state', 'ok', 'tries_left', public.sign_in_pin_max_tries() - v_pin.failed_count);
end $$;
revoke all on function public.sign_in_pin_lookup(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.sign_in_pin_lookup(uuid, text, uuid, text) to service_role;

/**
 * One PIN try, after sign_in_pin_lookup() (checked again here). Right: the
 * wrong tries go back to nought and the sign-in email is returned, for the
 * server to make a one-time sign-in. Wrong: counted; the fifth locks the PIN.
 * States: ok, wrong, locked, and lookup's.
 */
create or replace function public.sign_in_pin_attempt(p_device uuid, p_device_hash text, p_user uuid, p_pin_hash text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_look   jsonb;
  v_pin    public.sign_in_pins;
  v_dev    public.sign_in_devices;
  v_prof   record;
  v_email  text;
  v_failed integer;
  v_max    integer := public.sign_in_pin_max_tries();
begin
  if p_user is null then return jsonb_build_object('state', 'unknown'); end if;
  v_look := public.sign_in_pin_lookup(p_device, p_device_hash, p_user, null);
  if v_look ->> 'state' <> 'ok' then return v_look; end if;
  if coalesce(p_pin_hash, '') !~ '^[0-9a-f]{64}$' then return v_look || jsonb_build_object('state', 'wrong'); end if;

  -- One try at a time per officer, so tries made together cannot pass five.
  select * into v_pin from public.sign_in_pins where user_id = p_user for update;
  if v_pin.locked_at is not null then return v_look || jsonb_build_object('state', 'locked'); end if;
  select * into v_dev from public.sign_in_devices where id = p_device;
  select p.full_name, p.silo into v_prof from public.profiles p where p.id = p_user;

  if v_pin.pin_hash = p_pin_hash then
    select email into v_email from auth.users where id = p_user;
    if v_email is null then return v_look || jsonb_build_object('state', 'unknown'); end if;
    update public.sign_in_pins set failed_count = 0, last_used_at = now() where user_id = p_user;
    update public.sign_in_devices set last_used_at = now(), last_used_by = p_user where id = p_device;
    perform public.sign_in_audit(v_dev.tenant_id, v_prof.silo, p_user, v_prof.full_name,
      'PinSignIn', 'sign_in_device', v_dev.id::text, format('Signed in with a PIN on %s', v_dev.label));
    return v_look || jsonb_build_object('state', 'ok', 'email', v_email);
  end if;

  v_failed := v_pin.failed_count + 1;
  update public.sign_in_pins
     set failed_count = v_failed, locked_at = case when v_failed >= v_max then now() else null end
   where user_id = p_user;
  perform public.sign_in_audit(v_dev.tenant_id, v_prof.silo, p_user, v_prof.full_name,
    case when v_failed >= v_max then 'PinLocked' else 'PinSignInFailed' end, 'sign_in_device', v_dev.id::text,
    case when v_failed >= v_max
      then format('PIN locked after %s wrong tries on %s', v_max, v_dev.label)
      else format('Wrong PIN on %s (%s of %s)', v_dev.label, v_failed, v_max) end);
  return v_look || jsonb_build_object(
    'state', case when v_failed >= v_max then 'locked' else 'wrong' end,
    'tries_left', greatest(0, v_max - v_failed));
end $$;
revoke all on function public.sign_in_pin_attempt(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.sign_in_pin_attempt(uuid, text, uuid, text) to service_role;

-- ── 6. Choosing, resetting and unlocking a PIN ─────────────────────────────

/**
 * The officer's new PIN. Server only: the server checks their password and
 * the PIN rules first, then passes the keyed hash. Clears any lock.
 */
create or replace function public.set_sign_in_pin(p_user uuid, p_pin_hash text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_prof record;
  v_had  boolean;
begin
  select p.tenant_id, p.silo, p.full_name, p.deactivated_at into v_prof from public.profiles p where p.id = p_user;
  if not found then raise exception 'No account' using errcode = 'P0002'; end if;
  if v_prof.deactivated_at is not null then raise exception 'This account has been deactivated' using errcode = '42501'; end if;
  if coalesce(p_pin_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'The PIN is not valid' using errcode = '22023'; end if;
  v_had := exists (select 1 from public.sign_in_pins where user_id = p_user);
  insert into public.sign_in_pins (user_id, tenant_id, pin_hash, set_at, failed_count, locked_at)
  values (p_user, v_prof.tenant_id, p_pin_hash, now(), 0, null)
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash, tenant_id = excluded.tenant_id, set_at = now(), failed_count = 0, locked_at = null;
  perform public.sign_in_audit(v_prof.tenant_id, v_prof.silo, p_user, v_prof.full_name,
    case when v_had then 'PinChanged' else 'PinSet' end, 'sign_in_pin', p_user::text,
    case when v_had then 'Changed their sign-in PIN' else 'Chose a sign-in PIN' end);
end $$;
revoke all on function public.set_sign_in_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.set_sign_in_pin(uuid, text) to service_role;

/** A forgotten PIN: cleared, and the officer's device sign-ins end. They choose a new one after signing in with their password. */
create or replace function public.reset_sign_in_pin(p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_target record;
  v_name   text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select p.tenant_id, p.silo, p.full_name into v_target from public.profiles p
   where p.id = p_user and p.tenant_id = public.current_tenant();
  if not found then raise exception 'No such officer' using errcode = 'P0002'; end if;
  if not public.can_manage_sign_in(v_target.silo) then
    raise exception 'Only a supervisor or an administrator resets a PIN' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why the PIN is reset' using errcode = '22023';
  end if;
  delete from public.sign_in_pins where user_id = p_user;
  perform public.end_sign_in_sessions(null, p_user);
  select full_name into v_name from public.profiles where id = auth.uid();
  perform public.sign_in_audit(v_target.tenant_id, v_target.silo, auth.uid(), v_name, 'PinReset', 'sign_in_pin', p_user::text,
    format('Reset the sign-in PIN of %s: %s', coalesce(v_target.full_name, 'an officer'), left(btrim(p_reason), 200)));
end $$;
revoke all on function public.reset_sign_in_pin(uuid, text) from public, anon;
grant execute on function public.reset_sign_in_pin(uuid, text) to authenticated;

/** Five wrong tries locked the PIN: a supervisor who knows it is them unlocks it. */
create or replace function public.unlock_sign_in_pin(p_user uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_target record;
  v_name   text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select p.tenant_id, p.silo, p.full_name into v_target from public.profiles p
   where p.id = p_user and p.tenant_id = public.current_tenant();
  if not found then raise exception 'No such officer' using errcode = 'P0002'; end if;
  if not public.can_manage_sign_in(v_target.silo) then
    raise exception 'Only a supervisor or an administrator unlocks a PIN' using errcode = '42501';
  end if;
  update public.sign_in_pins set failed_count = 0, locked_at = null where user_id = p_user;
  if not found then raise exception 'This officer has no PIN yet' using errcode = 'P0002'; end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  perform public.sign_in_audit(v_target.tenant_id, v_target.silo, auth.uid(), v_name, 'PinUnlocked', 'sign_in_pin', p_user::text,
    format('Unlocked the sign-in PIN of %s', coalesce(v_target.full_name, 'an officer')));
end $$;
revoke all on function public.unlock_sign_in_pin(uuid) from public, anon;
grant execute on function public.unlock_sign_in_pin(uuid) to authenticated;

-- ── 7. Reading ─────────────────────────────────────────────────────────────

/** The console: every active officer this person looks after, with their PIN's state. Never the hash. */
create or replace function public.sign_in_pin_board()
returns table (
  user_id uuid, full_name text, badge_number text, silo public.silo, role text,
  has_pin boolean, set_at timestamptz, failed_count integer, locked_at timestamptz, last_used_at timestamptz
) language sql stable security definer set search_path to 'public' as $$
  select p.id, p.full_name, p.badge_number, p.silo, p.role::text,
         s.user_id is not null, s.set_at, coalesce(s.failed_count, 0), s.locked_at, s.last_used_at
    from public.profiles p
    left join public.sign_in_pins s on s.user_id = p.id
   where p.tenant_id = public.current_tenant()
     and p.deactivated_at is null
     and public.can_manage_sign_in(p.silo)
   order by p.full_name nulls last
   limit 5000;
$$;
revoke all on function public.sign_in_pin_board() from public, anon;
grant execute on function public.sign_in_pin_board() to authenticated;

/** Whether the signed-in officer has a PIN, and whether it is locked. */
create or replace function public.my_sign_in_pin()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'has_pin', s.user_id is not null,
    'locked', s.locked_at is not null,
    'set_at', s.set_at)
    from (select auth.uid() as uid) me
    left join public.sign_in_pins s on s.user_id = me.uid
   where me.uid is not null;
$$;
revoke all on function public.my_sign_in_pin() from public, anon;
grant execute on function public.my_sign_in_pin() to authenticated;

/**
 * The phone notes that its sign-in was made on a registered device, so the
 * server can end it after 14 hours or when the device is removed. Only the
 * caller's own current sign-in, and only on a live device of their tenant.
 */
create or replace function public.record_sign_in_device_session(p_device uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_session uuid;
begin
  if auth.uid() is null then return; end if;
  begin
    v_session := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    return;
  end;
  if v_session is null then return; end if;
  if not exists (
    select 1 from public.sign_in_devices
     where id = p_device and removed_at is null and tenant_id = public.current_tenant()
  ) then return; end if;
  insert into public.sign_in_device_sessions (session_id, device_id, user_id)
  values (v_session, p_device, auth.uid())
  on conflict (session_id) do nothing;
end $$;
revoke all on function public.record_sign_in_device_session(uuid) from public, anon;
grant execute on function public.record_sign_in_device_session(uuid) to authenticated;

-- ── 8. Ending old device sign-ins every 15 minutes ─────────────────────────

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%). Old device sign-ins still end at every PIN sign-in; or call public.end_stale_sign_in_sessions() from an external scheduler.', sqlerrm;
    return;
  end;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not present. Call public.end_stale_sign_in_sessions() from an external scheduler.';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'criticom-sign-in-sessions';
  perform cron.schedule('criticom-sign-in-sessions', '*/15 * * * *', $job$ select public.end_stale_sign_in_sessions(); $job$);
  raise notice 'Scheduled criticom-sign-in-sessions every 15 minutes.';
end $$;

notify pgrst, 'reload schema';
