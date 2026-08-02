-- ============================================================================
-- 0021 — Saved report definitions + duty allocation
-- ============================================================================
--
-- Two additions:
--
-- (1) report_definitions — a saved, re-runnable report. The definition itself
--     is jsonb (dataset, columns, filters, grouping, metrics, chart), because
--     the shape is owned by the registry in packages/api/src/reporting and
--     changes there should not need a migration here. Nothing in the jsonb is
--     ever treated as SQL: the query builder validates every field key against
--     that registry before use.
--
-- (2) Duty allocation columns on `rosters`. The table already carried station,
--     vehicle, sector and call sign; what it lacked was the day itself, the
--     post, and a draft/publish boundary — so a supervisor could not build
--     tomorrow's allocation without staff seeing a half-finished board.
--
-- Write policies follow 0019/0020: role-gated, and using can_write_global()
-- rather than is_global() so read-only roles cannot write.
-- ============================================================================

-- ── Saved reports ───────────────────────────────────────────────────────────

create table if not exists public.report_definitions (
  id            uuid primary key default gen_random_uuid(),
  silo          public.silo not null default 'Ethekwini',
  name          text not null,
  description   text,
  dataset       text not null,
  definition    jsonb not null default '{}'::jsonb,
  chart         jsonb,
  -- private: author only · department: the author's silo · global: everyone
  visibility    text not null default 'private'
                check (visibility in ('private', 'department', 'global')),
  created_by    uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint report_definitions_name_not_blank check (length(trim(name)) > 0)
);

create index if not exists report_definitions_owner_idx on public.report_definitions (created_by, updated_at desc);
create index if not exists report_definitions_shared_idx on public.report_definitions (visibility, silo, updated_at desc);

alter table public.report_definitions enable row level security;

-- Readable if you wrote it, or it was shared to your department, or globally.
drop policy if exists report_definitions_read on public.report_definitions;
create policy report_definitions_read on public.report_definitions for select
  using (
    created_by = auth.uid()
    or visibility = 'global'
    or (visibility = 'department' and (silo = public.current_silo() or public.is_global()))
  );

-- Anyone who works here may build reports; a read-only Viewer may not save.
drop policy if exists report_definitions_insert on public.report_definitions;
create policy report_definitions_insert on public.report_definitions for insert
  with check (created_by = auth.uid() and not public.role_in('Viewer'));

-- Only the author may change or delete their report — except admins, who must
-- be able to remove one that is wrong or inappropriate.
drop policy if exists report_definitions_update on public.report_definitions;
create policy report_definitions_update on public.report_definitions for update
  using (created_by = auth.uid() or public.role_in('SystemAdmin','SuperAdmin','Admin'))
  with check (created_by = auth.uid() or public.role_in('SystemAdmin','SuperAdmin','Admin'));

drop policy if exists report_definitions_delete on public.report_definitions;
create policy report_definitions_delete on public.report_definitions for delete
  using (created_by = auth.uid() or public.role_in('SystemAdmin','SuperAdmin','Admin'));

drop trigger if exists report_definitions_touch on public.report_definitions;
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger report_definitions_touch before update on public.report_definitions
  for each row execute function public.touch_updated_at();

-- ── Duty allocation ─────────────────────────────────────────────────────────

alter table public.rosters
  add column if not exists duty_date       date,
  add column if not exists start_at        timestamptz,
  add column if not exists end_at          timestamptz,
  add column if not exists post            text,
  add column if not exists published       boolean not null default true,
  add column if not exists published_at    timestamptz,
  add column if not exists acknowledged_at timestamptz;

comment on column public.rosters.published is
  'Draft allocations are invisible to the member until published. Existing rows default to true so nothing already issued disappears.';
comment on column public.rosters.acknowledged_at is
  'Set when the member confirms they have seen the allocation — the accountability half of issuing a duty.';

-- Backfill the day from the linked shift where we can, so existing rows appear
-- on the board rather than in an "undated" bucket.
update public.rosters r
   set duty_date = (s.start_time at time zone 'Africa/Johannesburg')::date,
       start_at  = coalesce(r.start_at, s.start_time),
       end_at    = coalesce(r.end_at, s.end_time)
  from public.shifts s
 where r.shift_id = s.id and r.duty_date is null;

-- Anything with no shift falls back to the day it was created.
update public.rosters
   set duty_date = (created_at at time zone 'Africa/Johannesburg')::date
 where duty_date is null;

create index if not exists rosters_duty_date_idx on public.rosters (duty_date desc, silo);
create index if not exists rosters_user_duty_idx on public.rosters (user_id, duty_date desc);
create index if not exists rosters_published_idx on public.rosters (silo, published, duty_date desc);

-- A member may acknowledge their own published allocation. Supervisors keep
-- full write via the existing rosters_supervisor_all policy.
drop policy if exists rosters_self_acknowledge on public.rosters;
create policy rosters_self_acknowledge on public.rosters for update
  using (user_id = auth.uid() and published)
  with check (user_id = auth.uid() and published);
