-- ============================================================================
-- 0110 — PIN sign-in, simpler for officers
-- ============================================================================
--
-- Run after 0109.
--
-- Officers are not technical, and the phone's way to the web server changes
-- with the Wi-Fi. So, still secure, but simpler:
--
--   * The database keeps and checks the hashes itself: the PIN with bcrypt,
--     a device's key with SHA-256. No secret lives on the web server any
--     more, so moving servers never breaks a PIN or a registered device.
--   * Choosing or changing a PIN goes straight to the database from the
--     phone — no web server needed. It is proven by the current PIN, or the
--     password (a forgotten PIN), or by having signed in with the password in
--     the last 30 minutes (straight after signing in, nothing more is asked).
--     Wrong PINs count toward the same five-try lock; tries are also limited
--     to five every 15 minutes, so a password cannot be guessed here.
--   * Registering a device goes straight to the database too; it makes the
--     device's key and hands it back once.
--   * The PIN rules are the obvious ones only: six digits, not one digit six
--     times, not 123456 or 654321.
--
-- What was set up before this cannot be checked any more (it was hashed on
-- the web server): devices registered before it are removed (register them
-- again) and PINs chosen before it are cleared (choose them again). Signing
-- in with a PIN still goes through the web server, which alone may start a
-- sign-in; without it the phone signs back in offline, as before.
--
-- Safe to re-run.
-- ============================================================================

-- bcrypt. On Supabase pgcrypto lives in "extensions"; the functions below
-- look there as well as in public.
do $$
begin
  create extension if not exists pgcrypto with schema extensions;
exception when others then
  raise notice 'pgcrypto: %', sqlerrm;
end $$;

-- ── 1. Rules ───────────────────────────────────────────────────────────────

/** A device key's hash, as kept. The key is 256 random bits, so a plain hash is enough. */
create or replace function public.sign_in_key_hash(p_key text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex')
$$;

/** What is wrong with a PIN, or null. Mirrors pinProblem() in packages/db/src/sign-in-pin.ts. */
create or replace function public.sign_in_pin_problem(p_pin text) returns text
language sql immutable as $$
  select case
    when coalesce(p_pin, '') !~ '^[0-9]{6}$' then 'Your PIN is 6 digits.'
    when p_pin ~ '^([0-9])\1{5}$' then 'Choose a PIN that is not one digit six times.'
    when p_pin in ('012345', '123456', '234567', '345678', '456789', '987654', '876543', '765432', '654321', '543210')
      then 'Choose a PIN that is not 123456 or 654321.'
  end
$$;

-- ── 2. What was set up before ──────────────────────────────────────────────

alter table public.sign_in_devices add column if not exists key_kind text;
do $$
declare
  v_id uuid;
begin
  for v_id in
    update public.sign_in_devices
       set key_kind = 'server',
           removed_at = coalesce(removed_at, now()),
           removed_reason = coalesce(removed_reason, 'Register it again: PIN sign-in was updated (0110)')
     where key_kind is null
    returning id
  loop
    perform public.end_sign_in_sessions(v_id, null);
  end loop;
end $$;
alter table public.sign_in_devices alter column key_kind set default 'database';
alter table public.sign_in_devices alter column key_kind set not null;

delete from public.sign_in_pins where pin_hash !~ '^\$2';
alter table public.sign_in_pins drop constraint if exists sign_in_pins_pin_hash_check;
alter table public.sign_in_pins add constraint sign_in_pins_pin_hash_check check (pin_hash ~ '^\$2[abxy]?\$');

-- The web server's versions, replaced by the ones below.
drop function if exists public.register_sign_in_device(text, text, text);
drop function if exists public.set_sign_in_pin(uuid, text);
drop function if exists public.sign_in_pin_attempt(uuid, text, uuid, text);
drop function if exists public.sign_in_pin_lookup(uuid, text, uuid, text);
drop function if exists public.sign_in_device_officers(uuid, text);

-- ── 3. Registering a device ────────────────────────────────────────────────

/**
 * A supervisor registers the device they hold, straight from the phone. The
 * database makes the key, keeps its hash and hands the key back once.
 * Registering a device again ends its old registration and its sign-ins.
 */
create or replace function public.register_sign_in_device(p_label text, p_radio_id text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  v_tenant uuid := public.current_tenant();
  v_global boolean := public.role_in('SystemAdmin', 'SuperAdmin', 'SystemController');
  v_silo   public.silo;
  v_label  text := nullif(btrim(coalesce(p_label, '')), '');
  v_radio  text := nullif(upper(btrim(coalesce(p_radio_id, ''))), '');
  v_key    text;
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

  -- 256 bits from the server's strong random source (gen_random_uuid), hashed together.
  v_key := encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex');

  select full_name into v_name from public.profiles where id = auth.uid();
  for v_old in
    select id from public.sign_in_devices
     where tenant_id = v_tenant and radio_id = v_radio and removed_at is null and v_radio is not null
  loop
    update public.sign_in_devices
       set removed_at = now(), removed_by = auth.uid(), removed_reason = 'Registered again'
     where id = v_old.id;
    perform public.end_sign_in_sessions(v_old.id, null);
  end loop;

  insert into public.sign_in_devices (tenant_id, silo, label, radio_id, secret_hash, registered_by, registered_by_name, key_kind)
  values (v_tenant, v_silo, v_label, v_radio, public.sign_in_key_hash(v_key), auth.uid(), v_name, 'database')
  returning * into v_row;

  perform public.sign_in_audit(v_tenant, coalesce(v_silo, public.current_silo()), auth.uid(), v_name,
    'SignInDeviceRegistered', 'sign_in_device', v_row.id::text,
    format('Registered %s for PIN sign-in%s', v_row.label, coalesce(' · ' || v_row.radio_id, '')));
  return jsonb_build_object('id', v_row.id, 'label', v_row.label, 'silo', v_row.silo, 'radio_id', v_row.radio_id, 'key', v_key);
end $$;
revoke all on function public.register_sign_in_device(text, text) from public, anon;
grant execute on function public.register_sign_in_device(text, text) to authenticated;

-- ── 4. Signing in with a PIN (the web server only) ─────────────────────────

/** As in 0108, with the device's key itself (hashed here). States: ok, device, unknown, inactive, elsewhere, no_pin, locked. */
create or replace function public.sign_in_pin_lookup(p_device uuid, p_device_key text, p_user uuid, p_badge text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
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
  if not found or v_dev.removed_at is not null or v_dev.secret_hash is distinct from public.sign_in_key_hash(p_device_key) then
    return jsonb_build_object('state', 'device');
  end if;

  if p_user is not null then
    select p.id, p.full_name, p.silo::text as silo, p.role::text as role, p.deactivated_at into v_prof
      from public.profiles p where p.id = p_user and p.tenant_id = v_dev.tenant_id;
    if not found then return jsonb_build_object('state', 'unknown'); end if;
  else
    if v_badge = '' then return jsonb_build_object('state', 'unknown'); end if;
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

/** One PIN try, checked against its bcrypt hash. Right: the sign-in email. Wrong: counted; the fifth locks. */
create or replace function public.sign_in_pin_attempt(p_device uuid, p_device_key text, p_user uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
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
  v_look := public.sign_in_pin_lookup(p_device, p_device_key, p_user, null);
  if v_look ->> 'state' <> 'ok' then return v_look; end if;

  -- One try at a time per officer, so tries made together cannot pass five.
  select * into v_pin from public.sign_in_pins where user_id = p_user for update;
  if v_pin.locked_at is not null then return v_look || jsonb_build_object('state', 'locked'); end if;
  select * into v_dev from public.sign_in_devices where id = p_device;
  select p.full_name, p.silo into v_prof from public.profiles p where p.id = p_user;

  if coalesce(p_pin, '') ~ '^[0-9]{6}$' and crypt(p_pin, v_pin.pin_hash) = v_pin.pin_hash then
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

/** The names a registered device lists (0109), for its own key. */
create or replace function public.sign_in_device_officers(p_device uuid, p_device_key text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare
  v_dev public.sign_in_devices;
begin
  select * into v_dev from public.sign_in_devices where id = p_device;
  if not found or v_dev.removed_at is not null or v_dev.secret_hash is distinct from public.sign_in_key_hash(p_device_key) then
    return jsonb_build_object('state', 'device');
  end if;
  return jsonb_build_object('state', 'ok', 'officers', coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', o.id, 'full_name', o.full_name, 'badge_number', o.badge_number, 'silo', o.silo)
           order by o.silo, o.full_name)
      from (
        select p.id, p.full_name, p.badge_number, p.silo
          from public.profiles p
          join public.sign_in_pins s on s.user_id = p.id
         where p.tenant_id = v_dev.tenant_id
           and p.deactivated_at is null
           and (v_dev.silo is null or p.silo = v_dev.silo or public.sign_in_any_department(p.role::text))
         order by p.silo, p.full_name
         limit 3000
      ) o
  ), '[]'::jsonb));
end $$;
revoke all on function public.sign_in_device_officers(uuid, text) from public, anon, authenticated;
grant execute on function public.sign_in_device_officers(uuid, text) to service_role;

-- ── 5. Choosing or changing a PIN, straight from the phone ─────────────────

/**
 * The signed-in officer's new PIN. Proven by the current PIN, by the
 * password, or by a password sign-in in the last 30 minutes. Returns
 * {ok: true}, or {ok: false, state}: proof (say the current PIN or the
 * password), wrong_pin, wrong_password, locked, busy. A PIN that breaks the
 * rules is refused with the rule.
 */
create or replace function public.set_my_sign_in_pin(p_pin text, p_current_pin text default null, p_password text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  v_uid     uuid := auth.uid();
  v_prof    record;
  v_problem text := public.sign_in_pin_problem(p_pin);
  v_pin     public.sign_in_pins;
  v_had     boolean;
  v_how     text;
  v_failed  integer;
  v_max     integer := public.sign_in_pin_max_tries();
  v_fresh   boolean;
begin
  if v_uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select p.tenant_id, p.silo, p.full_name, p.deactivated_at into v_prof from public.profiles p where p.id = v_uid;
  if not found then raise exception 'No account' using errcode = 'P0002'; end if;
  if v_prof.deactivated_at is not null then raise exception 'This account has been deactivated' using errcode = '42501'; end if;
  if v_problem is not null then raise exception '%', v_problem using errcode = '22023'; end if;

  select * into v_pin from public.sign_in_pins where user_id = v_uid for update;
  v_had := found;

  -- Proof given: limited, so neither a PIN nor a password can be guessed here.
  if p_current_pin is not null or p_password is not null then
    if not coalesce((select allowed from public.rate_limit_hit_key('pin-change:' || v_uid, 5, 900)), true) then
      return jsonb_build_object('ok', false, 'state', 'busy');
    end if;
  end if;

  if p_current_pin is not null and v_had and v_pin.locked_at is null
     and p_current_pin ~ '^[0-9]{6}$' and crypt(p_current_pin, v_pin.pin_hash) = v_pin.pin_hash then
    v_how := 'with their current PIN';
  elsif p_password is not null and exists (
    select 1 from auth.users u
     where u.id = v_uid and u.encrypted_password is not null and u.encrypted_password <> ''
       and crypt(p_password, u.encrypted_password) = u.encrypted_password
  ) then
    v_how := 'with their password';
  else
    -- Signed in with the password in the last 30 minutes: nothing more to ask.
    begin
      v_fresh := exists (
        select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
         where a ->> 'method' = 'password'
           and (a ->> 'timestamp')::bigint > extract(epoch from now() - interval '30 minutes'));
    exception when others then
      v_fresh := false;
    end;
    if v_fresh and p_current_pin is null and p_password is null then
      v_how := 'just after signing in with their password';
    end if;
  end if;

  if v_how is null then
    if p_current_pin is null and p_password is null then
      return jsonb_build_object('ok', false, 'state', 'proof', 'has_pin', v_had);
    end if;
    if p_current_pin is not null and v_had then
      if v_pin.locked_at is not null then return jsonb_build_object('ok', false, 'state', 'locked'); end if;
      -- A wrong current PIN counts toward the same lock as signing in.
      v_failed := v_pin.failed_count + 1;
      update public.sign_in_pins
         set failed_count = v_failed, locked_at = case when v_failed >= v_max then now() else null end
       where user_id = v_uid;
      return jsonb_build_object('ok', false, 'state', case when v_failed >= v_max then 'locked' else 'wrong_pin' end,
        'tries_left', greatest(0, v_max - v_failed));
    end if;
    return jsonb_build_object('ok', false, 'state', case when p_password is not null then 'wrong_password' else 'wrong_pin' end);
  end if;

  insert into public.sign_in_pins (user_id, tenant_id, pin_hash, set_at, failed_count, locked_at)
  values (v_uid, v_prof.tenant_id, crypt(p_pin, gen_salt('bf', 8)), now(), 0, null)
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash, tenant_id = excluded.tenant_id, set_at = now(), failed_count = 0, locked_at = null;
  perform public.sign_in_audit(v_prof.tenant_id, v_prof.silo, v_uid, v_prof.full_name,
    case when v_had then 'PinChanged' else 'PinSet' end, 'sign_in_pin', v_uid::text,
    format('%s their sign-in PIN %s', case when v_had then 'Changed' else 'Chose' end, v_how));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.set_my_sign_in_pin(text, text, text) from public, anon;
grant execute on function public.set_my_sign_in_pin(text, text, text) to authenticated;

notify pgrst, 'reload schema';
