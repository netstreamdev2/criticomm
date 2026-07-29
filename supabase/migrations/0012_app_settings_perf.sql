-- =====================================================================
-- CRITICOM V5 — 0012
--   app_settings   typed operational tuning, editable without a deploy
--   indexes        covering the dispatch board's hot queries
-- =====================================================================

-- ── APP SETTINGS ─────────────────────────────────────────────────────
-- One row per knob. The catalogue of valid keys, their types, bounds and
-- defaults lives in code (packages/api/src/settings) so the app never trusts
-- a raw row blindly; this table only stores overrides an admin has made.
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Everyone signed in reads them (they drive UI behaviour on every screen);
-- only the admin tier writes.
create policy app_settings_read on public.app_settings for select
  using (auth.role() = 'authenticated');

create policy app_settings_write on public.app_settings for all
  using (public.role_in('Admin','SystemAdmin','SuperAdmin'))
  with check (public.role_in('Admin','SystemAdmin','SuperAdmin'));

-- Settings changes should reach open screens without a reload.
alter publication supabase_realtime add table public.app_settings;

-- ── PERFORMANCE ──────────────────────────────────────────────────────
-- The ops board reads: recent activity (updated_at), the live board without a
-- silo filter (global dispatchers), today's closures, and ten-day volume.
create index if not exists incidents_updated_at_idx
  on public.incidents (updated_at desc);
create index if not exists incidents_status_idx
  on public.incidents (status);
create index if not exists incidents_created_at_idx
  on public.incidents (incident_created_at desc);
create index if not exists incidents_closed_at_idx
  on public.incidents (closed_at desc)
  where closed_at is not null;
