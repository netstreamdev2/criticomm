-- =====================================================================
-- Fix: tg_set_location_point() combined table+column checks in a single
-- IF expression (e.g. `tg_table_name='incidents' and new.location_lat...`).
-- PL/pgSQL resolves every column reference in an executed expression, so a
-- personnel/security insert errored with "record new has no field location_lat".
-- Nesting the column check inside a per-table branch means the column ref is
-- only in a statement that runs for the matching rowtype.
-- =====================================================================
create or replace function public.tg_set_location_point() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'incidents' then
    if new.location_lat is not null and new.location_lng is not null then
      new.location_point := st_setsrid(st_makepoint(new.location_lng, new.location_lat), 4326)::geography;
    end if;
  elsif tg_table_name in ('personnel', 'security_reports') then
    if new.latitude is not null and new.longitude is not null then
      new.location := st_setsrid(st_makepoint(new.longitude, new.latitude), 4326)::geography;
    end if;
  elsif tg_table_name in ('hydrants', 'cameras', 'crime_stats') then
    if new.latitude is not null and new.longitude is not null then
      new.location_point := st_setsrid(st_makepoint(new.longitude, new.latitude), 4326)::geography;
    end if;
  end if;
  return new;
end $$;
