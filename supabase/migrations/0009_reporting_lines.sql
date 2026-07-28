-- =====================================================================
-- REPORTING_LINES — manual "reports to" overrides for the department
-- hierarchy. A member (a login user or an operational staff record) can be
-- pinned to report to a specific manager; members without a row fall back to
-- the inferred tier-based chain. manager_* null ⇒ pinned to the top of chain.
-- =====================================================================
create table if not exists public.reporting_lines (
  id            uuid primary key default uuid_generate_v4(),
  silo          silo not null,
  member_kind   text not null,          -- 'user' | 'staff'
  member_id     uuid not null,
  manager_kind  text,                   -- 'user' | 'staff' | null (null ⇒ top of chain)
  manager_id    uuid,
  updated_by    text,
  updated_at    timestamptz not null default now(),
  unique (member_kind, member_id)
);
create index if not exists reporting_lines_silo_idx on public.reporting_lines (silo);

alter table public.reporting_lines enable row level security;

create policy reporting_lines_read on public.reporting_lines for select
  using (silo = public.current_silo() or public.is_global());

create policy reporting_lines_write on public.reporting_lines for all
  using (public.role_in('Supervisor','Captain','FireChief','Chief','SystemAdmin','SuperAdmin','Admin')
         and (silo = public.current_silo() or public.is_global()))
  with check (public.role_in('Supervisor','Captain','FireChief','Chief','SystemAdmin','SuperAdmin','Admin')
              and (silo = public.current_silo() or public.is_global()));
