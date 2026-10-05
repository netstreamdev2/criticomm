-- ============================================================================
-- 0052 — Hydrants from eThekwini Water & Sanitation's register
--
-- scripts/load-hydrants.mjs loads EWS hydrant points (GeoJSON) into the fire
-- service's hydrant register for the live map.
--
-- 1. last_inspected becomes optional. The water register carries no fire
--    inspection history, and an import must not show every hydrant as
--    "inspected today": a crew would trust that date. Hydrants added by hand
--    keep the old default (now()); imported ones say "not yet inspected".
-- 2. source_ref holds the register's own id (e.g. "EWS:2035224"), unique per
--    tenant, so loading the register again — or the full register later —
--    updates the same rows instead of duplicating them. Rows entered by hand
--    have no source_ref; NULLs never collide.
-- ============================================================================

alter table public.hydrants alter column last_inspected drop not null;

alter table public.hydrants add column if not exists source_ref text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hydrants_source_ref_key'
  ) then
    alter table public.hydrants
      add constraint hydrants_source_ref_key unique (tenant_id, source_ref);
  end if;
end $$;

comment on column public.hydrants.last_inspected is
  'Last fire-service inspection. NULL for hydrants imported from the water register and not yet inspected.';
comment on column public.hydrants.source_ref is
  'Id in the register the hydrant was imported from, e.g. EWS:2035224. NULL for hydrants entered by hand.';
