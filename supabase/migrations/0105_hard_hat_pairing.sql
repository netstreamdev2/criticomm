-- ============================================================================
-- 0105 — Pairing a hard hat: press its button, or the armoury issues it
-- ============================================================================
--
-- Run after 0101.
--
-- An officer picks up any radio and any hard hat. The radio they sign in on
-- books itself (0101). A hard hat has no keyboard and hardly a screen, so it
-- is paired to them one of two ways, neither needing anything typed:
--
--   * Press the button. At start of shift the radio asks "Press the talk
--     button on your hard hat". The hard hat whose button is pressed within
--     those 20 seconds is booked to that officer, and says so on its screen.
--     Two officers pairing in the same seconds in one department: nothing is
--     paired and both are asked to press again, one at a time.
--   * The armoury issues it. Whoever looks after the department's kit picks
--     the hard hat and the officer on the console (Hard hats & radios).
--
--   field_kit_pairings    each "press your hard hat" window
--   open_hat_pairing()    the officer opens one (their own, 20 seconds)
--   hard_hat_button()     a hard hat says its button was pressed: pairs it
--                         when exactly one window is open in its department
--   hat_pairing()         the radio asks how its window went
--   issue_field_kit()     the armoury books an item out to an officer
--
-- Bookings say how they were made: device, number, paired or issued.
-- Safe to re-run.
-- ============================================================================

-- ── 1. How a booking was made ──────────────────────────────────────────────

alter table public.field_kit_bookings drop constraint if exists field_kit_bookings_booked_how_check;
alter table public.field_kit_bookings add constraint field_kit_bookings_booked_how_check
  check (booked_how in ('device', 'number', 'paired', 'issued'));

-- ── 2. Booking an item to someone (inside the functions below only) ────────

/**
 * Books the item to the person: a booking still open for someone else is
 * taken over (and says by whom), the person's other item of the same kind
 * goes back, and the item is out. As book_field_kit (0101), for another
 * person. Not callable directly.
 */
create or replace function public.give_field_kit(p_kit public.field_kit, p_user uuid, p_how text, p_by_name text)
returns public.field_kit_bookings language plpgsql security definer set search_path to 'public' as $$
declare
  v_person public.personnel;
  v_name   text;
  v_open   public.field_kit_bookings;
  v_other  public.field_kit_bookings;
  v_row    public.field_kit_bookings;
begin
  select * into v_person from public.personnel where user_id = p_user and tenant_id = p_kit.tenant_id limit 1;
  v_name := coalesce(nullif(btrim(concat_ws(' ', v_person.rank, v_person.first_name, v_person.last_name)), ''),
                     (select full_name from public.profiles where id = p_user), 'Officer');

  select * into v_open from public.field_kit_bookings where kit_id = p_kit.id and returned_at is null for update;
  if v_open.id is not null and v_open.user_id = p_user then return v_open; end if;
  if v_open.id is not null then
    perform public.close_field_kit_booking(v_open, 'taken_over', format('Taken by %s', v_name), p_by_name);
  end if;
  for v_other in
    select b.* from public.field_kit_bookings b join public.field_kit k on k.id = b.kit_id
     where b.user_id = p_user and b.returned_at is null and k.kind = p_kit.kind and b.kit_id <> p_kit.id
  loop
    perform public.close_field_kit_booking(v_other, 'fine', format('Swapped for %s', p_kit.asset_no), p_by_name);
  end loop;

  insert into public.field_kit_bookings (tenant_id, silo, kit_id, user_id, personnel_id, name, booked_how)
  values (p_kit.tenant_id, p_kit.silo, p_kit.id, p_user, v_person.id, v_name, p_how)
  returning * into v_row;
  update public.field_kit set status = 'in_use', updated_at = now(), updated_by = auth.uid() where id = p_kit.id;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (p_kit.tenant_id, p_kit.silo, auth.uid(), p_by_name,
          case p_how when 'issued' then 'KitIssued' else 'KitBookedOut' end, 'field_kit', p_kit.id::text,
          format('%s %s to %s (%s)%s', public.field_kit_word(p_kit.kind), p_kit.asset_no, v_name,
                 case p_how when 'paired' then 'paired by pressing its button' when 'issued' then 'issued from the console' else p_how end,
                 coalesce(format(' · taken over from %s', v_open.name), '')));
  return v_row;
end $$;
revoke all on function public.give_field_kit(public.field_kit, uuid, text, text) from public, anon, authenticated;

-- ── 3. Press the button ────────────────────────────────────────────────────

create table if not exists public.field_kit_pairings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant(),
  silo        public.silo not null,
  user_id     uuid not null,
  name        text,
  opened_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  kit_id      uuid references public.field_kit(id) on delete set null,
  asset_no    text,
  paired_at   timestamptz,
  -- 'paired' | 'clash' (two officers at once) | 'expired'
  outcome     text check (outcome is null or outcome in ('paired', 'clash', 'expired'))
);
create index if not exists field_kit_pairings_open_idx on public.field_kit_pairings (tenant_id, silo, expires_at) where paired_at is null;

alter table public.field_kit_pairings enable row level security;
revoke all on public.field_kit_pairings from anon;
revoke insert, update, delete on public.field_kit_pairings from authenticated;
grant select on public.field_kit_pairings to authenticated;
drop policy if exists field_kit_pairings_read on public.field_kit_pairings;
create policy field_kit_pairings_read on public.field_kit_pairings for select to authenticated
  using (tenant_id = public.current_tenant() and user_id = auth.uid());

/** The officer is about to press their hard hat's button: a 20-second window, their own. */
create or replace function public.open_hat_pairing()
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_person public.personnel;
  v_row    public.field_kit_pairings;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into v_person from public.personnel where user_id = auth.uid() and tenant_id = public.current_tenant() limit 1;
  if not found then raise exception 'No personnel record is linked to this account' using errcode = 'P0001'; end if;
  -- One window per officer: a new press of "Pair" replaces the last.
  update public.field_kit_pairings set expires_at = now(), outcome = 'expired'
   where user_id = auth.uid() and paired_at is null and expires_at > now();
  insert into public.field_kit_pairings (tenant_id, silo, user_id, name, expires_at)
  values (v_person.tenant_id, v_person.silo, auth.uid(),
          coalesce(nullif(btrim(concat_ws(' ', v_person.rank, v_person.first_name, v_person.last_name)), ''), 'Officer'),
          now() + interval '20 seconds')
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'expires_at', v_row.expires_at);
end $$;
revoke all on function public.open_hat_pairing() from public, anon;
grant execute on function public.open_hat_pairing() to authenticated;

/**
 * A hard hat's button was pressed (the app on it calls this with its Radio
 * ID). With exactly one pairing window open in its department, it is booked
 * to that officer. Two windows open: neither is paired (both officers are
 * asked to press again). None: nothing happens (a normal press).
 */
create or replace function public.hard_hat_button(p_device text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_kit    public.field_kit;
  v_count  integer;
  v_win    public.field_kit_pairings;
  v_by     text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into v_kit from public.field_kit
   where tenant_id = public.current_tenant() and device_id = upper(btrim(coalesce(p_device, '')))
     and kind = 'hard_hat' and status in ('available', 'in_use');
  if not found then return jsonb_build_object('paired', false); end if;

  perform pg_advisory_xact_lock(hashtextextended('hat-pairing:' || v_kit.tenant_id::text || ':' || v_kit.silo::text, 0));
  select count(*) into v_count from public.field_kit_pairings
   where tenant_id = v_kit.tenant_id and silo = v_kit.silo and paired_at is null and expires_at > now();
  if v_count = 0 then return jsonb_build_object('paired', false); end if;
  if v_count > 1 then
    update public.field_kit_pairings set expires_at = now(), outcome = 'clash'
     where tenant_id = v_kit.tenant_id and silo = v_kit.silo and paired_at is null and expires_at > now();
    return jsonb_build_object('paired', false, 'clash', true);
  end if;

  select * into v_win from public.field_kit_pairings
   where tenant_id = v_kit.tenant_id and silo = v_kit.silo and paired_at is null and expires_at > now()
   for update;
  select full_name into v_by from public.profiles where id = auth.uid();
  perform public.give_field_kit(v_kit, v_win.user_id, 'paired', coalesce(v_win.name, v_by));
  update public.field_kit_pairings
     set kit_id = v_kit.id, asset_no = v_kit.asset_no, paired_at = now(), outcome = 'paired'
   where id = v_win.id;
  return jsonb_build_object('paired', true, 'name', v_win.name, 'asset_no', v_kit.asset_no);
end $$;
revoke all on function public.hard_hat_button(text) from public, anon;
grant execute on function public.hard_hat_button(text) to authenticated;

/** How the officer's window went: waiting, paired (to which hard hat), clash or expired. */
create or replace function public.hat_pairing(p_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select jsonb_build_object(
      'state', case when p.paired_at is not null then 'paired'
                    when p.outcome = 'clash' then 'clash'
                    when p.expires_at <= now() then 'expired'
                    else 'waiting' end,
      'asset_no', p.asset_no)
      from public.field_kit_pairings p
     where p.id = p_id and p.user_id = auth.uid()
  ), jsonb_build_object('state', 'expired'))
$$;
revoke all on function public.hat_pairing(uuid) from public, anon;
grant execute on function public.hat_pairing(uuid) to authenticated;

-- ── 4. The armoury issues it ───────────────────────────────────────────────

/** Whoever looks after the department's kit books an item out to an officer. */
create or replace function public.issue_field_kit(p_kit_id uuid, p_personnel_id uuid)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_kit    public.field_kit;
  v_person public.personnel;
  v_by     text;
  v_row    public.field_kit_bookings;
begin
  select * into v_kit from public.field_kit where id = p_kit_id and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'Not found in the register' using errcode = 'P0002'; end if;
  if not public.can_manage_field_kit(v_kit.silo) then
    raise exception 'Only command and the armoury issue kit' using errcode = '42501';
  end if;
  if v_kit.status not in ('available', 'in_use') then
    raise exception '% % is not available', public.field_kit_word(v_kit.kind), v_kit.asset_no using errcode = '22023';
  end if;
  select * into v_person from public.personnel where id = p_personnel_id and tenant_id = v_kit.tenant_id;
  if not found or v_person.user_id is null then
    raise exception 'That officer has no sign-in to book it to' using errcode = '22023';
  end if;
  select full_name into v_by from public.profiles where id = auth.uid();
  v_row := public.give_field_kit(v_kit, v_person.user_id, 'issued', v_by);
  return jsonb_build_object('booking_id', v_row.id, 'asset_no', v_kit.asset_no, 'name', v_row.name);
end $$;
revoke all on function public.issue_field_kit(uuid, uuid) from public, anon;
grant execute on function public.issue_field_kit(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
