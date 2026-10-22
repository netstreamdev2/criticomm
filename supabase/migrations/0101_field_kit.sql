-- ============================================================================
-- 0101 — Hard hats and radios: numbered, booked for the shift, handed back
-- ============================================================================
--
-- Run after 0100.
--
-- A department keeps hundreds of hard hats and radios (300 hard hats, about
-- 120 out on a given day). Each one gets a number written on it (HH-0001,
-- RD-0014) and, optionally, its serial and the Radio ID the HikTech app shows
-- when it runs on it (HT-XXXX-XXXX). Then:
--
--   * A radio or smart hard hat running the app knows which one it is: when
--     someone starts their shift on it, it is booked to them by itself
--     ("You are on radio RD-0014"). No typing.
--   * A plain hard hat is taken by its number at the start of the shift, or
--     "No hard hat today".
--   * One of each at a time: taking another hard hat hands the old one back.
--     Taking one still booked to someone else (they forgot to hand it back)
--     closes their booking and says so.
--   * At the end of the shift it is handed back: fine, damaged (goes for
--     repair, command told) or lost (command told).
--   * The console lists who has what, now and before.
--
-- This is the physical kit register. radio_devices (0082) stays the list of
-- platform accounts; the Radio Desk joins the two by the Radio ID.
--
--   field_kit               one row per hard hat or radio
--   field_kit_bookings      who had it, from when to when, how it came back
--   save_field_kit()        add or change one (command and admin)
--   add_field_kit_range()   add HH-0001 … HH-0300 in one go
--   retire_field_kit()      take one out of service (kept, never deleted)
--   book_field_kit()        the officer takes one (by number, or this device)
--   return_field_kit()      handed back (the officer, or command receiving it)
--   return_my_field_kit()   everything the officer holds, at the end of shift
--
-- Writes only through these functions; every change is audited.
-- Safe to re-run.
-- ============================================================================

-- ── 1. Who looks after it ──────────────────────────────────────────────────

create or replace function public.can_manage_field_kit(p_silo public.silo) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.can_manage_armoury(p_silo);
$$;
revoke all on function public.can_manage_field_kit(public.silo) from public, anon;
grant execute on function public.can_manage_field_kit(public.silo) to authenticated;

-- ── 2. The register ────────────────────────────────────────────────────────

create table if not exists public.field_kit (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default public.current_tenant(),
  silo          public.silo not null,
  kind          text not null check (kind in ('hard_hat', 'radio')),
  -- The number written on it: letters, digits and dashes, upper case.
  asset_no      text not null check (asset_no ~ '^[A-Z0-9][A-Z0-9-]{0,23}$'),
  serial        text check (serial is null or length(serial) between 1 and 60),
  -- The Radio ID the HikTech app shows when it runs on this device.
  device_id     text check (device_id is null or device_id ~ '^HT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
  model         text check (model is null or length(model) <= 60),
  status        text not null default 'available'
                check (status in ('available', 'in_use', 'repair', 'lost', 'retired')),
  status_note   text check (status_note is null or length(status_note) <= 300),
  notes         text check (notes is null or length(notes) <= 500),
  retired_at    timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
create unique index if not exists field_kit_number_uq on public.field_kit (tenant_id, kind, asset_no);
create unique index if not exists field_kit_serial_uq on public.field_kit (tenant_id, kind, upper(serial)) where serial is not null;
create unique index if not exists field_kit_device_uq on public.field_kit (tenant_id, device_id) where device_id is not null;
create index if not exists field_kit_silo_idx on public.field_kit (tenant_id, silo, kind, status);

create table if not exists public.field_kit_bookings (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default public.current_tenant(),
  silo             public.silo not null,
  kit_id           uuid not null references public.field_kit(id) on delete cascade,
  user_id          uuid not null,
  personnel_id     uuid references public.personnel(id) on delete set null,
  name             text,
  -- 'device': booked by itself when the shift started on it; 'number': taken by its number.
  booked_how       text not null default 'number' check (booked_how in ('device', 'number')),
  booked_at        timestamptz not null default now(),
  returned_at      timestamptz,
  returned_by      uuid,
  returned_by_name text,
  -- fine | damaged | lost | taken_over (someone else took it while it was still booked)
  return_condition text check (return_condition is null or return_condition in ('fine', 'damaged', 'lost', 'taken_over')),
  return_note      text check (return_note is null or length(return_note) <= 300)
);
-- One open booking per item.
create unique index if not exists field_kit_bookings_open_uq on public.field_kit_bookings (kit_id) where returned_at is null;
create index if not exists field_kit_bookings_user_idx on public.field_kit_bookings (user_id, booked_at desc);
create index if not exists field_kit_bookings_kit_idx on public.field_kit_bookings (kit_id, booked_at desc);

alter table public.field_kit enable row level security;
alter table public.field_kit_bookings enable row level security;
revoke all on public.field_kit, public.field_kit_bookings from anon;
revoke insert, update, delete on public.field_kit, public.field_kit_bookings from authenticated;
grant select on public.field_kit, public.field_kit_bookings to authenticated;

-- The register: everyone in the department (an officer picks a hard hat from
-- it); the roles that see every department see all of it.
drop policy if exists field_kit_read on public.field_kit;
create policy field_kit_read on public.field_kit for select to authenticated
  using (tenant_id = public.current_tenant() and (silo = public.current_silo() or public.is_global()));

-- Bookings: your own; who looks after the department's kit; dispatch and the
-- control room (the Radio Desk says whose radio it is).
drop policy if exists field_kit_bookings_read on public.field_kit_bookings;
create policy field_kit_bookings_read on public.field_kit_bookings for select to authenticated
  using (tenant_id = public.current_tenant() and (
    user_id = auth.uid()
    or public.can_manage_field_kit(silo)
    or (public.role_in('Dispatcher', 'ControlRoom') and (silo = public.current_silo() or public.is_global()))
  ));

do $$ begin
  alter publication supabase_realtime add table public.field_kit_bookings;
exception when duplicate_object then null; when undefined_object then null;
end $$;

/** "hh 14" → "HH-14": upper case, spaces to dashes, nothing else. */
create or replace function public.field_kit_number(p text) returns text
language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(upper(btrim(coalesce(p, ''))), '\s+', '-', 'g'), '[^A-Z0-9-]', '', 'g'), '')
$$;

create or replace function public.field_kit_word(p_kind text) returns text
language sql immutable as $$
  select case p_kind when 'hard_hat' then 'Hard hat' when 'radio' then 'Radio' else 'Kit' end
$$;

-- ── 3. Looking after the register ──────────────────────────────────────────

/** Adds (no id) or changes one hard hat or radio. */
create or replace function public.save_field_kit(p jsonb)
returns public.field_kit language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid := public.current_tenant();
  v_id     uuid := nullif(p ->> 'id', '')::uuid;
  v_kind   text := p ->> 'kind';
  v_no     text := public.field_kit_number(p ->> 'asset_no');
  v_serial text := nullif(btrim(coalesce(p ->> 'serial', '')), '');
  v_device text := nullif(upper(btrim(coalesce(p ->> 'device_id', ''))), '');
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
    insert into public.field_kit (tenant_id, silo, kind, asset_no, serial, device_id, model, status, notes, created_by, updated_by)
    values (v_tenant, v_silo, v_kind, v_no, v_serial, v_device, nullif(btrim(coalesce(p ->> 'model', '')), ''), v_status,
            nullif(btrim(coalesce(p ->> 'notes', '')), ''), auth.uid(), auth.uid())
    returning * into v_row;
  else
    update public.field_kit set
      silo = v_silo, kind = v_kind, asset_no = v_no, serial = v_serial, device_id = v_device,
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

/** Adds a numbered run in one go: prefix HH, 1 to 300, 4 digits → HH-0001 … HH-0300. Numbers already there are skipped. */
create or replace function public.add_field_kit_range(
  p_kind text, p_prefix text, p_from integer, p_to integer, p_digits integer, p_silo public.silo, p_model text default null
) returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid := public.current_tenant();
  v_prefix text := public.field_kit_number(p_prefix);
  v_digits integer := least(greatest(coalesce(p_digits, 4), 1), 6);
  v_added  integer;
  v_name   text;
begin
  if p_kind is null or p_kind not in ('hard_hat', 'radio') then raise exception 'Choose hard hat or radio' using errcode = '22023'; end if;
  if p_silo is null then raise exception 'Choose the department' using errcode = '22023'; end if;
  if not public.can_manage_field_kit(p_silo) then
    raise exception 'Only command and administrators look after the register' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from < 0 or p_to < p_from then
    raise exception 'Enter the first and last number' using errcode = '22023';
  end if;
  if p_to - p_from >= 1000 then raise exception 'Add at most 1,000 at a time' using errcode = '22023'; end if;
  if length(coalesce(v_prefix, '')) > 12 then raise exception 'The prefix is too long' using errcode = '22023'; end if;

  with made as (
    insert into public.field_kit (tenant_id, silo, kind, asset_no, model, created_by, updated_by)
    select v_tenant, p_silo, p_kind,
           coalesce(v_prefix || '-', '') || lpad(n::text, v_digits, '0'),
           nullif(btrim(coalesce(p_model, '')), ''), auth.uid(), auth.uid()
      from generate_series(p_from, p_to) n
    on conflict (tenant_id, kind, asset_no) do nothing
    returning 1
  )
  select count(*) into v_added from made;

  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_tenant, p_silo, auth.uid(), v_name, 'KitAdded', 'field_kit', null,
          format('%s added: %s to %s (%s new)', public.field_kit_word(p_kind),
                 coalesce(v_prefix || '-', '') || lpad(p_from::text, v_digits, '0'),
                 coalesce(v_prefix || '-', '') || lpad(p_to::text, v_digits, '0'), v_added));
  return v_added;
end $$;
revoke all on function public.add_field_kit_range(text, text, integer, integer, integer, public.silo, text) from public, anon;
grant execute on function public.add_field_kit_range(text, text, integer, integer, integer, public.silo, text) to authenticated;

/** Out of service for good. Kept, with its history; never deleted. */
create or replace function public.retire_field_kit(p_id uuid, p_reason text)
returns public.field_kit language plpgsql security definer set search_path to 'public' as $$
declare
  v_row  public.field_kit;
  v_name text;
begin
  select * into v_row from public.field_kit where id = p_id and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'Not found in the register' using errcode = 'P0002'; end if;
  if not public.can_manage_field_kit(v_row.silo) then
    raise exception 'Only command and administrators look after the register' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Say why it is taken out of service' using errcode = '22023'; end if;
  if v_row.status = 'in_use' then
    raise exception '% % is out with someone. Receive it back first', public.field_kit_word(v_row.kind), v_row.asset_no using errcode = '22023';
  end if;
  update public.field_kit
     set status = 'retired', retired_at = now(), status_note = left(btrim(p_reason), 300), updated_at = now(), updated_by = auth.uid()
   where id = p_id returning * into v_row;
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_row.tenant_id, v_row.silo, auth.uid(), v_name, 'KitRetired', 'field_kit', v_row.id::text,
          format('%s %s taken out of service: %s', public.field_kit_word(v_row.kind), v_row.asset_no, left(btrim(p_reason), 200)));
  return v_row;
end $$;
revoke all on function public.retire_field_kit(uuid, text) from public, anon;
grant execute on function public.retire_field_kit(uuid, text) to authenticated;

-- ── 4. Booking out and handing back ────────────────────────────────────────

/** Closes a booking: the item is free again, or goes for repair, or is lost (command told). */
create or replace function public.close_field_kit_booking(
  p_booking public.field_kit_bookings, p_condition text, p_note text, p_by_name text
) returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_kit public.field_kit;
begin
  update public.field_kit_bookings
     set returned_at = now(), returned_by = auth.uid(), returned_by_name = p_by_name,
         return_condition = p_condition, return_note = nullif(left(btrim(coalesce(p_note, '')), 300), '')
   where id = p_booking.id and returned_at is null;
  if p_condition = 'taken_over' then return; end if;
  update public.field_kit
     set status = case p_condition when 'damaged' then 'repair' when 'lost' then 'lost' else 'available' end,
         status_note = case when p_condition in ('damaged', 'lost') then nullif(left(btrim(coalesce(p_note, '')), 300), '') else status_note end,
         updated_at = now(), updated_by = auth.uid()
   where id = p_booking.kit_id
  returning * into v_kit;
  if p_condition in ('damaged', 'lost') then
    perform public.notify_command(v_kit.tenant_id, v_kit.silo,
      format('%s %s %s', public.field_kit_word(v_kit.kind), v_kit.asset_no, case p_condition when 'lost' then 'reported lost' else 'handed back damaged' end),
      format('%s%s', coalesce(p_booking.name, 'An officer'), coalesce(': ' || nullif(btrim(coalesce(p_note, '')), ''), '')),
      'High', '/admin/kit');
  end if;
end $$;
revoke all on function public.close_field_kit_booking(public.field_kit_bookings, text, text, text) from public, anon, authenticated;

/**
 * The officer takes a hard hat or radio for the shift: by this device's Radio
 * ID (the app on a registered radio or smart hard hat), by the item's id, or
 * by the number on it. One of each kind at a time; an item still booked to
 * someone else is taken over and that is noted. Booking what you already
 * hold changes nothing.
 */
create or replace function public.book_field_kit(
  p_kind text default null, p_asset_no text default null, p_kit_id uuid default null, p_device_id text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant  uuid := public.current_tenant();
  v_person  public.personnel;
  v_kit     public.field_kit;
  v_open    public.field_kit_bookings;
  v_mine    public.field_kit_bookings;
  v_name    text;
  v_how     text := 'number';
  v_device  text := nullif(upper(btrim(coalesce(p_device_id, ''))), '');
  v_took    text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into v_person from public.personnel where user_id = auth.uid() and tenant_id = v_tenant limit 1;
  if not found then raise exception 'No personnel record is linked to this account' using errcode = 'P0001'; end if;
  v_name := coalesce(nullif(btrim(concat_ws(' ', v_person.rank, v_person.first_name, v_person.last_name)), ''),
                     (select full_name from public.profiles where id = auth.uid()));

  if p_kit_id is not null then
    select * into v_kit from public.field_kit where id = p_kit_id and tenant_id = v_tenant for update;
  elsif v_device is not null then
    select * into v_kit from public.field_kit where device_id = v_device and tenant_id = v_tenant for update;
    -- An unregistered device books nothing: not an error, the phone just is not kit.
    if not found then return jsonb_build_object('booked', false); end if;
    v_how := 'device';
  else
    if p_kind is null or p_kind not in ('hard_hat', 'radio') then raise exception 'Choose hard hat or radio' using errcode = '22023'; end if;
    select * into v_kit from public.field_kit
     where tenant_id = v_tenant and kind = p_kind and asset_no = public.field_kit_number(p_asset_no)
       and (silo = v_person.silo or public.is_global())
     order by (silo = v_person.silo) desc
     limit 1
     for update;
  end if;
  if v_kit.id is null then
    raise exception 'There is no % % in the register. Check the number on it', lower(public.field_kit_word(coalesce(p_kind, 'kit'))), coalesce(public.field_kit_number(p_asset_no), '')
      using errcode = 'P0002';
  end if;
  if v_kit.silo <> v_person.silo and not public.is_global() then
    raise exception '% % belongs to another department', public.field_kit_word(v_kit.kind), v_kit.asset_no using errcode = '42501';
  end if;
  if v_kit.status in ('retired', 'repair', 'lost') then
    raise exception '% % is % and cannot be booked out', public.field_kit_word(v_kit.kind), v_kit.asset_no,
      case v_kit.status when 'retired' then 'out of service' when 'repair' then 'in for repair' else 'reported lost' end
      using errcode = '22023';
  end if;

  -- Already mine: nothing changes.
  select * into v_open from public.field_kit_bookings where kit_id = v_kit.id and returned_at is null for update;
  if v_open.id is not null and v_open.user_id = auth.uid() then
    return jsonb_build_object('booked', true, 'booking_id', v_open.id, 'kit_id', v_kit.id, 'kind', v_kit.kind,
                              'asset_no', v_kit.asset_no, 'booked_at', v_open.booked_at, 'already', true);
  end if;

  -- Still booked to someone else: they forgot to hand it back. Taken over, noted.
  if v_open.id is not null then
    perform public.close_field_kit_booking(v_open, 'taken_over', format('Taken by %s', v_name), v_name);
    v_took := v_open.name;
  end if;

  -- One of each kind: the one held before goes back.
  for v_mine in
    select b.* from public.field_kit_bookings b join public.field_kit k on k.id = b.kit_id
     where b.user_id = auth.uid() and b.returned_at is null and k.kind = v_kit.kind and b.kit_id <> v_kit.id
  loop
    perform public.close_field_kit_booking(v_mine, 'fine', format('Swapped for %s', v_kit.asset_no), v_name);
  end loop;

  insert into public.field_kit_bookings (tenant_id, silo, kit_id, user_id, personnel_id, name, booked_how)
  values (v_tenant, v_kit.silo, v_kit.id, auth.uid(), v_person.id, v_name, v_how)
  returning * into v_mine;
  update public.field_kit set status = 'in_use', updated_at = now(), updated_by = auth.uid() where id = v_kit.id;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_tenant, v_kit.silo, auth.uid(), v_name, 'KitBookedOut', 'field_kit', v_kit.id::text,
          format('%s %s booked out%s%s', public.field_kit_word(v_kit.kind), v_kit.asset_no,
                 case when v_how = 'device' then ' (started the shift on it)' else '' end,
                 coalesce(format(' · taken over from %s', v_took), '')));

  return jsonb_build_object('booked', true, 'booking_id', v_mine.id, 'kit_id', v_kit.id, 'kind', v_kit.kind,
                            'asset_no', v_kit.asset_no, 'booked_at', v_mine.booked_at, 'taken_from', v_took);
end $$;
revoke all on function public.book_field_kit(text, text, uuid, text) from public, anon;
grant execute on function public.book_field_kit(text, text, uuid, text) to authenticated;

/** Handed back: by the officer who has it, or received by command. */
create or replace function public.return_field_kit(p_booking_id uuid, p_condition text default 'fine', p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_b    public.field_kit_bookings;
  v_kit  public.field_kit;
  v_name text;
begin
  select * into v_b from public.field_kit_bookings where id = p_booking_id and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  if v_b.returned_at is not null then
    return jsonb_build_object('returned', true, 'already', true);
  end if;
  if v_b.user_id <> auth.uid() and not public.can_manage_field_kit(v_b.silo) then
    raise exception 'Only the person who has it, or command, hands it back' using errcode = '42501';
  end if;
  if coalesce(p_condition, 'fine') not in ('fine', 'damaged', 'lost') then
    raise exception 'Choose fine, damaged or lost' using errcode = '22023';
  end if;
  if p_condition in ('damaged', 'lost') and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Say what happened' using errcode = '22023';
  end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  perform public.close_field_kit_booking(v_b, coalesce(p_condition, 'fine'), p_note, v_name);
  select * into v_kit from public.field_kit where id = v_b.kit_id;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_b.tenant_id, v_b.silo, auth.uid(), v_name, 'KitReturned', 'field_kit', v_b.kit_id::text,
          format('%s %s handed back by %s: %s', public.field_kit_word(v_kit.kind), v_kit.asset_no, coalesce(v_b.name, 'officer'), coalesce(p_condition, 'fine')));
  return jsonb_build_object('returned', true, 'asset_no', v_kit.asset_no, 'kind', v_kit.kind);
end $$;
revoke all on function public.return_field_kit(uuid, text, text) from public, anon;
grant execute on function public.return_field_kit(uuid, text, text) to authenticated;

/** End of shift: everything the officer holds goes back, fine. Returns how many. */
create or replace function public.return_my_field_kit()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_b record;
  v_n integer := 0;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  for v_b in select id from public.field_kit_bookings where user_id = auth.uid() and returned_at is null loop
    perform public.return_field_kit(v_b.id, 'fine', 'End of shift');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.return_my_field_kit() from public, anon;
grant execute on function public.return_my_field_kit() to authenticated;

notify pgrst, 'reload schema';
