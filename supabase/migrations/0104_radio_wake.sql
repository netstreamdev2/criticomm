-- ============================================================================
-- 0104 — Wake a radio or hard hat by SMS
-- ============================================================================
--
-- Run after 0101.
--
-- A hard hat left alone can fall into the device's deep sleep: no network,
-- the app frozen, the Radio Desk shows it Off. A text message still gets
-- through. The app (build of 23 October 2026) opens itself when a text saying
-- HIKTECH WAKE arrives, on a radio or hard hat that is on duty.
--
--   field_kit.sim_number   the SIM in the device, on the register
--   save_field_kit()       as 0101, and keeps the SIM number
--   radio_wake_target()    the desk's "Wake by SMS": checks who may, at most
--                          once a minute per device, audits it, and returns
--                          the number for the server to text
--
-- Safe to re-run.
-- ============================================================================

alter table public.field_kit add column if not exists sim_number text
  check (sim_number is null or sim_number ~ '^\+?[0-9]{9,15}$');
comment on column public.field_kit.sim_number is 'The SIM in the device, for waking it by SMS (0104).';

-- ── The register keeps the SIM number ──────────────────────────────────────
-- As 0101, with the changes marked 0104.
create or replace function public.save_field_kit(p jsonb)
returns public.field_kit language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid := public.current_tenant();
  v_id     uuid := nullif(p ->> 'id', '')::uuid;
  v_kind   text := p ->> 'kind';
  v_no     text := public.field_kit_number(p ->> 'asset_no');
  v_serial text := nullif(btrim(coalesce(p ->> 'serial', '')), '');
  v_device text := nullif(upper(btrim(coalesce(p ->> 'device_id', ''))), '');
  -- 0104: the SIM's number, for waking it by SMS. Digits and a leading +.
  v_sim    text := nullif(regexp_replace(coalesce(p ->> 'sim_number', ''), '[^0-9+]', '', 'g'), '');
  v_silo   public.silo := nullif(p ->> 'silo', '')::public.silo;
  v_status text := coalesce(nullif(p ->> 'status', ''), 'available');
  v_old    public.field_kit;
  v_row    public.field_kit;
  v_name   text;
begin
  if v_tenant is null then raise exception 'No organisation for this account' using errcode = '42501'; end if;
  if v_kind is null or v_kind not in ('hard_hat', 'radio') then
    raise exception 'Choose hard hat or radio' using errcode = '22023';
  end if;
  if v_no is null then raise exception 'Enter the number written on it' using errcode = '22023'; end if;
  if v_no !~ '^[A-Z0-9][A-Z0-9-]{0,23}$' then raise exception 'The number is letters, digits and dashes, up to 24' using errcode = '22023'; end if;
  if v_silo is null then raise exception 'Choose the department' using errcode = '22023'; end if;
  if v_device is not null and v_device !~ '^HT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$' then
    raise exception 'The Radio ID looks like HT-XXXX-XXXX, as the app shows it' using errcode = '22023';
  end if;
  if not public.can_manage_field_kit(v_silo) then
    raise exception 'Only command and administrators look after the register' using errcode = '42501';
  end if;
  if v_sim is not null and v_sim !~ '^\+?[0-9]{9,15}$' then
    raise exception 'The SIM number is 10 digits (or +27 and 9 digits)' using errcode = '22023';
  end if;

  if v_id is not null then
    select * into v_old from public.field_kit where id = v_id and tenant_id = v_tenant for update;
    if not found then raise exception 'Not found in the register' using errcode = 'P0002'; end if;
    if not public.can_manage_field_kit(v_old.silo) then
      raise exception 'Only command and administrators look after the register' using errcode = '42501';
    end if;
    -- Out with someone: custody moves only by booking and handing back.
    if v_old.status = 'in_use' then v_status := 'in_use'; end if;
  end if;
  if v_status not in ('available', 'repair', 'lost', 'in_use') then
    raise exception 'Choose available, in repair or lost' using errcode = '22023';
  end if;
  if v_status = 'in_use' and (v_old.id is null or v_old.status <> 'in_use') then v_status := 'available'; end if;

  if exists (select 1 from public.field_kit where tenant_id = v_tenant and kind = v_kind and asset_no = v_no and id is distinct from v_id) then
    raise exception '% % is already in the register', public.field_kit_word(v_kind), v_no using errcode = '23505';
  end if;
  if v_serial is not null and exists (select 1 from public.field_kit where tenant_id = v_tenant and kind = v_kind
                                         and upper(serial) = upper(v_serial) and id is distinct from v_id) then
    raise exception 'Serial % is already in the register', v_serial using errcode = '23505';
  end if;
  if v_device is not null and exists (select 1 from public.field_kit where tenant_id = v_tenant and device_id = v_device and id is distinct from v_id) then
    raise exception 'Radio ID % is already on another item', v_device using errcode = '23505';
  end if;

  if v_id is null then
    insert into public.field_kit (tenant_id, silo, kind, asset_no, serial, device_id, sim_number, model, status, notes, created_by, updated_by)
    values (v_tenant, v_silo, v_kind, v_no, v_serial, v_device, v_sim, nullif(btrim(coalesce(p ->> 'model', '')), ''), v_status,
            nullif(btrim(coalesce(p ->> 'notes', '')), ''), auth.uid(), auth.uid())
    returning * into v_row;
  else
    update public.field_kit set
      silo = v_silo, kind = v_kind, asset_no = v_no, serial = v_serial, device_id = v_device, sim_number = v_sim,
      model = nullif(btrim(coalesce(p ->> 'model', '')), ''), status = v_status,
      status_note = case when v_status <> v_old.status then nullif(btrim(coalesce(p ->> 'status_note', '')), '') else status_note end,
      notes = nullif(btrim(coalesce(p ->> 'notes', '')), ''), updated_at = now(), updated_by = auth.uid()
    where id = v_id
    returning * into v_row;
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_tenant, v_row.silo, auth.uid(), v_name, case when v_id is null then 'KitAdded' else 'KitChanged' end,
          'field_kit', v_row.id::text,
          format('%s %s%s%s', public.field_kit_word(v_row.kind), v_row.asset_no,
                 case when v_row.serial is not null then ' · serial ' || v_row.serial else '' end,
                 case when v_old.id is not null and v_old.status <> v_row.status then format(' · %s → %s', v_old.status, v_row.status) else '' end));
  return v_row;
end $$;
revoke all on function public.save_field_kit(jsonb) from public, anon;
grant execute on function public.save_field_kit(jsonb) to authenticated;

-- ── Who may wake a device ──────────────────────────────────────────────────

/**
 * The desk wakes a radio or hard hat: the number to text, or an error saying
 * why not. Dispatch, the control room and command of the device's
 * department (everyone's, for those who see every department). Once a
 * minute per device at most; every wake is on the audit trail.
 */
create or replace function public.radio_wake_target(p_device text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_device text := upper(btrim(coalesce(p_device, '')));
  v_kit    public.field_kit;
  v_name   text;
  v_last   timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into v_kit from public.field_kit
   where tenant_id = public.current_tenant() and device_id = v_device and status <> 'retired';
  if not found then
    raise exception 'This device is not on the register with its Radio ID' using errcode = 'P0002';
  end if;
  if not (public.role_in('SuperAdmin', 'SystemAdmin', 'SystemController', 'System')
          or (public.role_in('Dispatcher', 'ControlRoom', 'Operator', 'Supervisor', 'Captain', 'FireChief', 'Admin')
              and (v_kit.silo = public.current_silo() or public.is_global()))) then
    raise exception 'Only the desk and command of its department may wake it' using errcode = '42501';
  end if;
  if v_kit.sim_number is null then
    raise exception '% has no SIM number on the register', v_kit.asset_no using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('radio-wake:' || v_kit.id::text, 0));
  select max("timestamp") into v_last from public.audit_logs
   where tenant_id = v_kit.tenant_id and action_type = 'RadioWakeSent' and entity_id = v_kit.id::text;
  if v_last > now() - interval '1 minute' then
    raise exception 'Woken a moment ago: give it a minute' using errcode = '22023';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_kit.tenant_id, v_kit.silo, auth.uid(), v_name, 'RadioWakeSent', 'field_kit', v_kit.id::text,
          format('%s %s woken by SMS', public.field_kit_word(v_kit.kind), v_kit.asset_no));
  return jsonb_build_object('number', v_kit.sim_number, 'asset_no', v_kit.asset_no, 'kind', v_kit.kind);
end $$;
revoke all on function public.radio_wake_target(text) from public, anon;
grant execute on function public.radio_wake_target(text) to authenticated;

notify pgrst, 'reload schema';
