-- ============================================================================
-- 0119 — Disaster: past events from the records
-- ============================================================================
--
-- Run after 0118.
--
-- Real past disasters in eThekwini, kept apart from live calls so they never
-- raise an alert, start a timer or count as open (disaster_past_events):
--
--   * the SA Weather Service's record of weather disasters in eThekwini
--     (the Caelum list to the end of 2024, published by the NDMC), each with
--     its date, place, ward and the deaths and damage recorded;
--   * the major events in the Director's briefing of 1 December 2025: the
--     2017 and 2019 floods, Covid-19, the 2021 unrest and the April 2022
--     floods, with their costs and the 2022 impact figures.
--
-- They fill the ward and hazard profiles, the past years of the IDP figures
-- and the records page. The desk loads them with one press; loading again
-- updates the same rows (import_past_events()). Writes only through that
-- guarded function; nothing for anonymous users. Safe to re-run.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.disaster_ward_relief') is null then
    raise exception 'Run 0118_disaster_relief.sql first, then this one. Nothing was changed.';
  end if;
end $$;

create table if not exists public.disaster_past_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default public.current_tenant(),
  silo             public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  source           text not null check (source in ('SA Weather Service records', 'Director''s briefing, 1 December 2025')),
  -- The source's own reference, so loading again updates the same row.
  source_ref       text not null check (length(source_ref) between 1 and 120),
  year             int not null check (year between 1600 and 2100),
  occurred_on      date,
  event            text not null check (length(event) between 1 and 200),
  category         text check (category is null or length(category) <= 120),
  priority_risk    text check (priority_risk is null or public.disaster_hazard_group(priority_risk) = 'Top ten priority risks'),
  place            text check (place is null or length(place) <= 200),
  ward             int check (ward is null or ward between 1 and 111),
  lat              double precision check (lat is null or lat between -90 and 90),
  lng              double precision check (lng is null or lng between -180 and 180),
  deaths           int check (deaths is null or deaths between 0 and 100000),
  injured          int check (injured is null or injured between 0 and 1000000),
  missing          int check (missing is null or missing between 0 and 100000),
  homes            int check (homes is null or homes between 0 and 1000000),
  affected         int check (affected is null or affected between 0 and 10000000),
  displaced        int check (displaced is null or displaced between 0 and 10000000),
  cost             text check (cost is null or length(cost) <= 200),
  notes            text check (notes is null or length(notes) <= 2000),
  imported_at      timestamptz not null default now(),
  imported_by_name text,
  unique (tenant_id, source, source_ref)
);
comment on table public.disaster_past_events is
  'Real past disasters in eThekwini from the records (0119), kept apart from live calls. import_past_events() only.';
create index if not exists disaster_past_events_year on public.disaster_past_events (tenant_id, year desc);
create index if not exists disaster_past_events_ward on public.disaster_past_events (tenant_id, ward);

alter table public.disaster_past_events enable row level security;
drop policy if exists tenant_isolation on public.disaster_past_events;
create policy tenant_isolation on public.disaster_past_events as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
drop policy if exists disaster_past_events_read on public.disaster_past_events;
create policy disaster_past_events_read on public.disaster_past_events for select to authenticated
  using (silo = public.current_silo() or public.is_global() or public.works_disaster_desk());
revoke all on public.disaster_past_events from anon;
revoke insert, update, delete on public.disaster_past_events from authenticated;
grant select on public.disaster_past_events to authenticated;

/** A whole number from the records, or null; never refused (old records are untidy). */
create or replace function public.record_count(p jsonb, p_key text, p_max int) returns int
language sql immutable as $$
  select case when coalesce(p ->> p_key, '') ~ '^\s*[0-9]{1,9}\s*$' and btrim(p ->> p_key)::bigint <= p_max then btrim(p ->> p_key)::int end
$$;

/**
 * Load past events from one source: [{source_ref, year, occurred_on, event,
 * category, priority_risk, place, ward, lat, lng, deaths, injured, missing,
 * homes, affected, displaced, cost, notes}, …]. A row already loaded from
 * that source is updated; a row that fails its checks is skipped and
 * counted. Returns { loaded, skipped }.
 */
create or replace function public.import_past_events(p_source text, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  r         jsonb;
  v_loaded  int := 0;
  v_skipped int := 0;
  v_name    text;
  v_risk    text;
begin
  if not public.works_disaster_desk() then raise exception 'Only the Disaster desk does this' using errcode = '42501'; end if;
  if p_source not in ('SA Weather Service records', 'Director''s briefing, 1 December 2025') then
    raise exception 'Choose the source from the list' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'No rows to load' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'At most 5 000 events at a time.' using errcode = 'P0001'; end if;
  v_name := public.desk_name();
  for r in select value from jsonb_array_elements(p_rows) loop
    begin
      v_risk := nullif(btrim(coalesce(r ->> 'priority_risk', '')), '');
      if v_risk is not null and public.disaster_hazard_group(v_risk) is distinct from 'Top ten priority risks' then v_risk := null; end if;
      insert into public.disaster_past_events (source, source_ref, year, occurred_on, event, category, priority_risk, place, ward, lat, lng,
                                               deaths, injured, missing, homes, affected, displaced, cost, notes, imported_by_name)
      values (p_source, left(btrim(r ->> 'source_ref'), 120), (r ->> 'year')::int,
              case when coalesce(r ->> 'occurred_on', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r ->> 'occurred_on')::date end,
              left(btrim(r ->> 'event'), 200), nullif(left(btrim(coalesce(r ->> 'category', '')), 120), ''), v_risk,
              nullif(left(btrim(coalesce(r ->> 'place', '')), 200), ''),
              case when coalesce(r ->> 'ward', '') ~ '^\d{1,3}$' and (r ->> 'ward')::int between 1 and 111 then (r ->> 'ward')::int end,
              case when jsonb_typeof(r -> 'lat') = 'number' then (r ->> 'lat')::double precision end,
              case when jsonb_typeof(r -> 'lng') = 'number' then (r ->> 'lng')::double precision end,
              public.record_count(r, 'deaths', 100000), public.record_count(r, 'injured', 1000000), public.record_count(r, 'missing', 100000),
              public.record_count(r, 'homes', 1000000), public.record_count(r, 'affected', 10000000), public.record_count(r, 'displaced', 10000000),
              nullif(left(btrim(coalesce(r ->> 'cost', '')), 200), ''), nullif(left(btrim(coalesce(r ->> 'notes', '')), 2000), ''), v_name)
      on conflict (tenant_id, source, source_ref) do update
        set year = excluded.year, occurred_on = excluded.occurred_on, event = excluded.event, category = excluded.category,
            priority_risk = excluded.priority_risk, place = excluded.place, ward = excluded.ward, lat = excluded.lat, lng = excluded.lng,
            deaths = excluded.deaths, injured = excluded.injured, missing = excluded.missing, homes = excluded.homes,
            affected = excluded.affected, displaced = excluded.displaced, cost = excluded.cost, notes = excluded.notes,
            imported_at = now(), imported_by_name = excluded.imported_by_name;
      v_loaded := v_loaded + 1;
    exception when others then
      v_skipped := v_skipped + 1;
    end;
  end loop;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (public.current_tenant(), 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'PAST_EVENTS_LOADED', 'disaster_past_events', null,
          format('%s: %s loaded, %s skipped', p_source, v_loaded, v_skipped));
  return jsonb_build_object('loaded', v_loaded, 'skipped', v_skipped);
end $$;
revoke all on function public.import_past_events(text, jsonb) from public, anon;
grant execute on function public.import_past_events(text, jsonb) to authenticated;

-- ── Prove it ────────────────────────────────────────────────────────────────

do $$
begin
  if has_function_privilege('anon', 'public.import_past_events(text, jsonb)', 'execute') then raise exception '0119: anonymous users can load records'; end if;
  if has_table_privilege('authenticated', 'public.disaster_past_events', 'insert') then raise exception '0119: signed-in users can write the records directly'; end if;
  if public.record_count('{"d":" 12 "}', 'd', 100) <> 12 or public.record_count('{"d":"x"}', 'd', 100) is not null then
    raise exception '0119: record_count';
  end if;
end $$;

commit;
