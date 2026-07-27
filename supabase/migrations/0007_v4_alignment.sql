-- =====================================================================
-- Criticom V5 — alignment with V4 (2026-07 feature drop)
--   • Operator attribution on incidents (per-user performance KPIs)
--   • Personnel service/force numbers
--   • Roster vehicle/sector/endorsement fields for the DCP duty sheet
--   • command_records  — flexible admin-config store (categories, leave/shift
--                        types, saved report templates)  [AdminConfigController]
--   • endorsements     — standing member endorsements    [RosterViewController]
--   • performance_kpis / performance_plans / performance_scores
--                        — annual 1-July appraisal cycle  [PerformanceController]
-- =====================================================================

-- ── Operator attribution (OperationalKpiService pivots on these) ──────
alter table public.incidents add column if not exists call_taken_by     text;
alter table public.incidents add column if not exists dispatched_by      text;
alter table public.incidents add column if not exists incident_category  text;  -- parent group of incident_type
alter table public.incidents add column if not exists region             text;  -- Central / North / South / West
create index if not exists incidents_call_taken_by_idx on public.incidents (call_taken_by);
create index if not exists incidents_dispatched_by_idx on public.incidents (dispatched_by);
create index if not exists incidents_region_idx        on public.incidents (silo, region);

-- ── Personnel identifiers used on the duty sheet ─────────────────────
alter table public.personnel add column if not exists service_number text;
alter table public.personnel add column if not exists force_number   text;

-- ── Roster duty-sheet allocation fields ──────────────────────────────
alter table public.rosters add column if not exists call_sign            text;
alter table public.rosters add column if not exists shift_group_code     text;
alter table public.rosters add column if not exists special_instructions text;
alter table public.rosters add column if not exists vehicle              text;
alter table public.rosters add column if not exists sector               text;
alter table public.rosters add column if not exists status               text not null default 'Present';

-- ─────────────────────────────────────────────────────────────────────
-- COMMAND_RECORDS — admin-configurable operational lists (soft delete)
-- module: IncidentCategory | LeaveType | ShiftType | ReportTemplate
-- For IncidentCategory: detail1 = parent group (null ⇒ this row IS a group);
--                       detail2 = newline-separated extra form prompts.
-- For ReportTemplate:   detail1 = owner user id; detail2 = JSON filter payload.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.command_records (
  id          uuid primary key default uuid_generate_v4(),
  silo        silo not null default 'Ethekwini',
  module      text not null,
  code        text,
  name        text,
  detail1     text,
  detail2     text,
  detail3     text,
  status      text not null default 'Active',
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists command_records_module_idx on public.command_records (module, status);

-- ─────────────────────────────────────────────────────────────────────
-- ENDORSEMENTS — standing member endorsements (court, special event, …)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.endorsements (
  id            uuid primary key default uuid_generate_v4(),
  silo          silo not null,
  user_id       uuid references auth.users(id) on delete set null,
  employee_name text,
  badge_number  text,
  type          text not null,     -- Court Attendance | Special Event | Special Instruction | Restriction
  details       text,
  start_date    date not null,
  end_date      date,              -- null ⇒ open-ended
  is_active     boolean not null default true,
  created_by    text,
  created_at    timestamptz not null default now()
);
create index if not exists endorsements_silo_idx on public.endorsements (silo, is_active, start_date);
create index if not exists endorsements_user_idx on public.endorsements (user_id);

-- ─────────────────────────────────────────────────────────────────────
-- PERFORMANCE — annual 1-July appraisal cycle
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.performance_kpis (
  id           uuid primary key default uuid_generate_v4(),
  silo         silo not null default 'Ethekwini',
  cycle_year   int not null,
  department   text,                     -- null/'' ⇒ every department in this silo
  title        text not null,
  description  text,
  weight       int not null default 0,   -- relative % weight
  is_active    boolean not null default true,
  created_by   text,
  created_at   timestamptz not null default now()
);
create index if not exists performance_kpis_cycle_idx on public.performance_kpis (silo, cycle_year, is_active);

create table if not exists public.performance_plans (
  id            uuid primary key default uuid_generate_v4(),
  silo          silo not null,
  user_id       uuid references auth.users(id) on delete cascade,
  employee_name text,
  badge_number  text,
  department    text,
  cycle_year    int not null,
  -- Active → MidYearSubmitted → MidYearApproved → FinalSubmitted → Completed
  status        text not null default 'Active',
  created_at    timestamptz not null default now(),
  unique (user_id, cycle_year)
);
create index if not exists performance_plans_cycle_idx on public.performance_plans (silo, cycle_year);

create table if not exists public.performance_scores (
  id          uuid primary key default uuid_generate_v4(),
  silo        silo not null,
  plan_id     uuid not null references public.performance_plans(id) on delete cascade,
  kpi_id      uuid references public.performance_kpis(id) on delete set null,
  kpi_title   text,                       -- denormalised for historical readability
  stage       text not null,              -- MidYear | Final
  score       int not null default 0,     -- 1–5
  comments    text,
  evidence    text,
  scored_by   text,
  scored_at   timestamptz not null default now(),
  approved    boolean not null default false,
  approved_by text,
  approved_at timestamptz
);
create index if not exists performance_scores_plan_idx on public.performance_scores (plan_id, stage);

-- ─────────────────────────────────────────────────────────────────────
-- updated_at not tracked on these (append/soft-delete semantics like V4).
-- RLS
-- ─────────────────────────────────────────────────────────────────────
alter table public.command_records   enable row level security;
alter table public.endorsements      enable row level security;
alter table public.performance_kpis  enable row level security;
alter table public.performance_plans enable row level security;
alter table public.performance_scores enable row level security;

-- command_records — any signed-in user reads active config; admins write.
create policy command_records_read on public.command_records for select using (true);
create policy command_records_admin_all on public.command_records for all
  using (public.role_in('SystemAdmin','SuperAdmin','Admin'))
  with check (public.role_in('SystemAdmin','SuperAdmin','Admin'));
-- Saved report templates: any dispatch/analyst user may create/manage their own.
create policy command_records_template_write on public.command_records for all
  using (module = 'ReportTemplate' and detail1 = auth.uid()::text)
  with check (module = 'ReportTemplate' and detail1 = auth.uid()::text);

-- endorsements — silo-scoped read; supervisors/admins write.
create policy endorsements_read on public.endorsements for select
  using (silo = public.current_silo() or public.is_global() or user_id = auth.uid());
create policy endorsements_supervisor_all on public.endorsements for all
  using (public.role_in('Supervisor','Captain','FireChief','Chief','SystemAdmin','SuperAdmin','Admin') and (silo = public.current_silo() or public.is_global()))
  with check (public.role_in('Supervisor','Captain','FireChief','Chief','SystemAdmin','SuperAdmin','Admin') and (silo = public.current_silo() or public.is_global()));

-- performance_kpis — read silo/global; admins + supervisors manage.
create policy performance_kpis_read on public.performance_kpis for select
  using (silo = public.current_silo() or public.is_global());
create policy performance_kpis_admin_all on public.performance_kpis for all
  using (public.role_in('Supervisor','SystemAdmin','SuperAdmin','Admin','System') and (silo = public.current_silo() or public.is_global()))
  with check (public.role_in('Supervisor','SystemAdmin','SuperAdmin','Admin','System') and (silo = public.current_silo() or public.is_global()));

-- performance_plans — a member reads their own; supervisors read/manage the silo.
create policy performance_plans_self_read on public.performance_plans for select
  using (user_id = auth.uid() or silo = public.current_silo() and public.role_in('Supervisor','SystemAdmin','SuperAdmin','Admin','System') or public.is_global());
create policy performance_plans_supervisor_all on public.performance_plans for all
  using (public.role_in('Supervisor','SystemAdmin','SuperAdmin','Admin','System') and (silo = public.current_silo() or public.is_global()))
  with check (public.role_in('Supervisor','SystemAdmin','SuperAdmin','Admin','System') and (silo = public.current_silo() or public.is_global()));

-- performance_scores — visible with the plan; supervisors write/approve.
create policy performance_scores_read on public.performance_scores for select
  using (
    silo = public.current_silo() or public.is_global()
    or exists (select 1 from public.performance_plans p where p.id = plan_id and p.user_id = auth.uid())
  );
create policy performance_scores_supervisor_all on public.performance_scores for all
  using (public.role_in('Supervisor','SystemAdmin','SuperAdmin','Admin','System') and (silo = public.current_silo() or public.is_global()))
  with check (public.role_in('Supervisor','SystemAdmin','SuperAdmin','Admin','System') and (silo = public.current_silo() or public.is_global()));

-- ─────────────────────────────────────────────────────────────────────
-- Realtime + default config seed
-- ─────────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.endorsements;

-- Default configurable lists (ConfigSeeder parity). Idempotent by (module,name).
create unique index if not exists command_records_module_name_key
  on public.command_records (module, coalesce(detail1,''), name);

insert into public.command_records (module, name, detail1, code, status) values
  -- Incident category groups
  ('IncidentCategory', 'Crime',            null, '10', 'Active'),
  ('IncidentCategory', 'Traffic',          null, '20', 'Active'),
  ('IncidentCategory', 'Fire',             null, '30', 'Active'),
  ('IncidentCategory', 'Medical',          null, '40', 'Active'),
  ('IncidentCategory', 'Public Order',     null, '50', 'Active'),
  ('IncidentCategory', 'Disaster',         null, '60', 'Active'),
  -- Sub-categories (detail1 = parent group)
  ('IncidentCategory', 'Assault',              'Crime',        '10-1', 'Active'),
  ('IncidentCategory', 'Robbery',              'Crime',        '10-2', 'Active'),
  ('IncidentCategory', 'Burglary',             'Crime',        '10-3', 'Active'),
  ('IncidentCategory', 'Motor Vehicle Accident','Traffic',     '20-1', 'Active'),
  ('IncidentCategory', 'Traffic Violation',    'Traffic',      '20-2', 'Active'),
  ('IncidentCategory', 'Structure Fire',       'Fire',         '30-1', 'Active'),
  ('IncidentCategory', 'Veld/Wildland Fire',   'Fire',         '30-2', 'Active'),
  ('IncidentCategory', 'Cardiac',              'Medical',      '40-1', 'Active'),
  ('IncidentCategory', 'Trauma',               'Medical',      '40-2', 'Active'),
  ('IncidentCategory', 'Protest',              'Public Order', '50-1', 'Active'),
  ('IncidentCategory', 'Flooding',             'Disaster',     '60-1', 'Active'),
  -- Leave types
  ('LeaveType', 'Annual',                 null, null, 'Active'),
  ('LeaveType', 'Sick',                   null, null, 'Active'),
  ('LeaveType', 'Family Responsibility',  null, null, 'Active'),
  ('LeaveType', 'Study',                  null, null, 'Active'),
  ('LeaveType', 'Maternity/Paternity',    null, null, 'Active'),
  ('LeaveType', 'Unpaid',                 null, null, 'Active'),
  ('LeaveType', 'Special',                null, null, 'Active'),
  -- Shift types
  ('ShiftType', 'Day (07:00–19:00)',      null, null, 'Active'),
  ('ShiftType', 'Night (19:00–07:00)',    null, null, 'Active'),
  ('ShiftType', 'Morning (06:00–14:00)',  null, null, 'Active'),
  ('ShiftType', 'Afternoon (14:00–22:00)',null, null, 'Active'),
  ('ShiftType', 'Standby',                null, null, 'Active')
on conflict (module, coalesce(detail1,''), name) do nothing;

-- Default performance KPIs for the current cycle (PerformanceSeeder parity).
insert into public.performance_kpis (cycle_year, department, title, description, weight, is_active)
select
  case when extract(month from now()) >= 7 then extract(year from now())::int
       else extract(year from now())::int - 1 end,
  null, k.title, k.descr, k.weight, true
from (values
  ('Operational Delivery',   'Incidents handled to standard and closed within target times', 30),
  ('Response Time',          'Average dispatch-to-arrival within the departmental SLA',       20),
  ('Report Quality',         'Accuracy and completeness of reports and evidence',             15),
  ('Conduct & Discipline',   'Adherence to code of conduct and standing orders',              15),
  ('Teamwork & Development', 'Collaboration, mentoring and personal development',             10),
  ('Community Engagement',   'Public-facing conduct and community-safety contribution',       10)
) as k(title, descr, weight)
where not exists (
  select 1 from public.performance_kpis pk
  where pk.title = k.title
    and pk.cycle_year = case when extract(month from now()) >= 7 then extract(year from now())::int
                             else extract(year from now())::int - 1 end
);
