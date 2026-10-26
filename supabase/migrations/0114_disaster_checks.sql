-- ============================================================================
-- 0114 — The Disaster desk's checks on what is typed
-- ============================================================================
--
-- Run after 0113.
--
-- The desk's forms check what is typed as it is typed (apps/web/lib/
-- disaster-checks.ts). The database checks the same, so nothing made up gets
-- in whichever way it is sent: only the obvious rules, each refused with one
-- short sentence.
--
--   Phone numbers   South African (082 123 4567, +27 82 123 4567) or
--                   international (+44 …); not one digit over and over.
--   Wards           a number; eThekwini 1 to 111, elsewhere up to 120.
--                   "Ward 76" is kept as "76".
--   Names           letters, not numbers.
--   Ages            whole years, 0 to 120.
--   Email           name@place.domain.
--   Capacity        a hall holds 1 to 20 000 people (0: not known yet).
--   Figures         things (vehicles, tankers, roads) up to 1 000; people
--                   and homes up to 500 000.
--
-- A change is checked only on what it changes: an older record with a number
-- typed before these checks still saves when something else on it changes.
-- Blank always passes. Safe to re-run.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.disaster_casualties') is null then
    raise exception 'Run 0113_disaster_operations.sql first, then this one. Nothing was changed.';
  end if;
end $$;

-- ── The rules ──────────────────────────────────────────────────────────────

create or replace function public.desk_phone_ok(p text) returns boolean
language plpgsql immutable as $$
declare
  v     text := regexp_replace(coalesce(p, ''), '[\s().-]', '', 'g');
  local text;
begin
  if v = '' then return true; end if;
  local := coalesce(substring(v from '^0([1-9][0-9]{8})$'), substring(v from '^\+?27([1-9][0-9]{8})$'));
  if local is not null then return local !~ '^(.)\1+$'; end if;
  return v ~ '^\+[1-9][0-9]{7,14}$' and v !~ '^\+27';
end $$;

create or replace function public.desk_check_phone(p text) returns void
language plpgsql immutable as $$
begin
  if not public.desk_phone_ok(p) then
    raise exception 'Give a full number, like 082 123 4567.' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.desk_check_name(p text) returns void
language plpgsql immutable as $$
begin
  if coalesce(btrim(p), '') = '' then return; end if;
  if p ~ '[0-9]' then raise exception 'A name has no numbers in it.' using errcode = 'P0001'; end if;
  if length(regexp_replace(p, '[^[:alpha:]]', '', 'g')) < 2 then raise exception 'Write the name in full.' using errcode = 'P0001'; end if;
end $$;

/** "Ward 76", "076" or "76" → "76"; refused when it is not a ward of that municipality. */
create or replace function public.desk_ward(p text, p_municipality text) returns text
language plpgsql immutable as $$
declare
  n int;
begin
  if coalesce(btrim(p), '') = '' then return null; end if;
  if p !~* '^\s*(ward\s*)?[0-9]{1,3}\s*$' then raise exception 'Give the ward number, like 76.' using errcode = 'P0001'; end if;
  n := substring(p from '([0-9]{1,3})')::int;
  if n < 1 then raise exception 'Give the ward number, like 76.' using errcode = 'P0001'; end if;
  if coalesce(p_municipality, 'eThekwini Metro') = 'eThekwini Metro' and n > 111 then
    raise exception 'eThekwini has wards 1 to 111.' using errcode = 'P0001';
  end if;
  if n > 120 then raise exception 'Give the ward number, like 76.' using errcode = 'P0001'; end if;
  return n::text;
end $$;

/** The most a figure can be: things (vehicles, tankers, roads) 1 000; people and homes 500 000. */
create or replace function public.disaster_figure_max(p_key text) returns int
language sql immutable as $$
  select case when p_key in ('roads_closed', 'officers_deployed', 'appliances', 'centres_staffed', 'halls_opened', 'temporary_shelters',
                             'vehicles_sent', 'water_tankers', 'temporary_toilets', 'skips', 'unsafe_buildings')
              then 1000 else 500000 end
$$;

create or replace function public.desk_check_figures(p jsonb) returns void
language plpgsql immutable as $$
declare
  k text;
  v jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return; end if;
  for k, v in select key, value from jsonb_each(p) loop
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) or (v #>> '{}')::numeric < 0 then
      raise exception 'Use a whole number.' using errcode = 'P0001';
    end if;
    if (v #>> '{}')::numeric > public.disaster_figure_max(k) then
      raise exception 'More than % for %? Check the number.', to_char(public.disaster_figure_max(k), 'FM999G999'), replace(k, '_', ' ')
        using errcode = 'P0001';
    end if;
  end loop;
end $$;

-- ── On each table: only what changed ───────────────────────────────────────

create or replace function public.check_disaster_casualty() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' or new.phone is distinct from old.phone then perform public.desk_check_phone(new.phone); end if;
  if tg_op = 'INSERT' or new.name is distinct from old.name then perform public.desk_check_name(new.name); end if;
  if (tg_op = 'INSERT' or new.age is distinct from old.age) and coalesce(btrim(new.age), '') <> '' then
    if btrim(new.age) !~ '^[0-9]{1,3}$' or btrim(new.age)::int > 120 then
      raise exception 'Give the age in years, 0 to 120.' using errcode = 'P0001';
    end if;
    new.age := btrim(new.age);
  end if;
  return new;
end $$;
drop trigger if exists check_disaster_casualty on public.disaster_casualties;
create trigger check_disaster_casualty before insert or update on public.disaster_casualties
  for each row execute function public.check_disaster_casualty();

create or replace function public.check_disaster_line_report() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' or new.representative_phone is distinct from old.representative_phone then
    perform public.desk_check_phone(new.representative_phone);
  end if;
  if tg_op = 'INSERT' or new.representative_name is distinct from old.representative_name then
    perform public.desk_check_name(new.representative_name);
  end if;
  if tg_op = 'INSERT' or new.figures is distinct from old.figures then perform public.desk_check_figures(new.figures); end if;
  return new;
end $$;
drop trigger if exists check_disaster_line_report on public.disaster_line_reports;
create trigger check_disaster_line_report before insert or update on public.disaster_line_reports
  for each row execute function public.check_disaster_line_report();

create or replace function public.check_disaster_contact() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' or new.phone is distinct from old.phone then perform public.desk_check_phone(new.phone); end if;
  if tg_op = 'INSERT' or new.name is distinct from old.name then perform public.desk_check_name(new.name); end if;
  if (tg_op = 'INSERT' or new.email is distinct from old.email) and coalesce(btrim(new.email), '') <> ''
     and btrim(new.email) !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
    raise exception 'That email address is not complete.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists check_disaster_contact on public.disaster_department_contacts;
create trigger check_disaster_contact before insert or update on public.disaster_department_contacts
  for each row execute function public.check_disaster_contact();

create or replace function public.check_disaster_shelter() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' or new.ward is distinct from old.ward or new.municipality is distinct from old.municipality then
    new.ward := public.desk_ward(new.ward, new.municipality);
  end if;
  if (tg_op = 'INSERT' or new.capacity is distinct from old.capacity) and new.capacity > 20000 then
    raise exception 'A hall holds 1 to 20 000 people.' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' or new.key_holder_phone is distinct from old.key_holder_phone then perform public.desk_check_phone(new.key_holder_phone); end if;
  if tg_op = 'INSERT' or new.key_holder is distinct from old.key_holder then perform public.desk_check_name(new.key_holder); end if;
  return new;
end $$;
drop trigger if exists check_disaster_shelter on public.disaster_shelters;
create trigger check_disaster_shelter before insert or update on public.disaster_shelters
  for each row execute function public.check_disaster_shelter();

create or replace function public.check_disaster_call_facts() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' or new.ward is distinct from old.ward then
    new.ward := public.desk_ward(new.ward, coalesce(new.municipalities[1], 'eThekwini Metro'));
  end if;
  return new;
end $$;
drop trigger if exists check_disaster_call_facts on public.disaster_call_facts;
create trigger check_disaster_call_facts before insert or update on public.disaster_call_facts
  for each row execute function public.check_disaster_call_facts();

create or replace function public.check_disaster_desk_update() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  perform public.desk_check_figures(new.figures);
  return new;
end $$;
drop trigger if exists check_disaster_desk_update on public.disaster_desk_updates;
create trigger check_disaster_desk_update before insert on public.disaster_desk_updates
  for each row execute function public.check_disaster_desk_update();

-- The rules are for the tables' own triggers, not for anyone to call.
do $$
declare f text;
begin
  foreach f in array array['check_disaster_casualty()', 'check_disaster_line_report()', 'check_disaster_contact()',
                           'check_disaster_shelter()', 'check_disaster_call_facts()', 'check_disaster_desk_update()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ── Prove it ───────────────────────────────────────────────────────────────

do $$
begin
  if not public.desk_phone_ok('082 123 4567') or not public.desk_phone_ok('+27821234567') or not public.desk_phone_ok('(031) 361 0000')
     or not public.desk_phone_ok('+44 20 7946 0958') or not public.desk_phone_ok('') then
    raise exception 'A real number was refused: nothing was changed';
  end if;
  if public.desk_phone_ok('123') or public.desk_phone_ok('0000000000') or public.desk_phone_ok('1234567890') then
    raise exception 'A made-up number was let in: nothing was changed';
  end if;
  if public.desk_ward('Ward 076', 'eThekwini Metro') <> '76' then raise exception 'Ward numbers are not read: nothing was changed'; end if;
end $$;

commit;
