-- ============================================================================
-- 0120 — Disaster: readiness, the Advisory Forum and the Framework
-- ============================================================================
--
-- Run after 0119.
--
-- Revision 2, sections 8, 11 and 13, and the Directorate's Framework:
--
--   1. The population the IDP's deaths per 100 000 (FD1.2) is counted
--      against (disaster_settings, set_disaster_population()).
--   2. When each department last reviewed its disaster plan
--      (disaster_department_plans): every department reviews its plan each
--      year; the readiness score counts those reviewed in the last 12 months.
--   3. The Advisory Forum's five task teams and their chairs
--      (disaster_task_teams): Community-Based Risk Assessment and Early
--      Warning; Major Hazard Installations off-site emergency; Social Relief;
--      Municipal Adaptation Planning; Post-Disaster Rehabilitation and
--      Reconstruction.
--   4. Meetings of the Advisory Forum and of its task teams
--      (disaster_forum_meetings); the Forum meets every quarter.
--   5. Where each Framework measure stands (disaster_framework_status): Not
--      started, In progress or Achieved, against a measure number like 2.1a.
--
-- The readiness score and the IDP figures are counted from these and the
-- incident records by the console (lib/disaster-readiness.ts). Writes only
-- through the functions here (SECURITY DEFINER, checked, audited); nothing
-- for anonymous users. Safe to re-run.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.disaster_past_events') is null then
    raise exception 'Run 0119_disaster_records.sql first, then this one. Nothing was changed.';
  end if;
end $$;

create or replace function public.disaster_task_team_keys() returns text[]
language sql immutable as $$ select array['early_warning', 'mhi', 'social_relief', 'adaptation', 'rehabilitation'] $$;

create table if not exists public.disaster_settings (
  tenant_id       uuid primary key default public.current_tenant(),
  silo            public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  population      int check (population is null or population between 1 and 20000000),
  population_note text check (population_note is null or length(population_note) <= 200),
  updated_at      timestamptz not null default now(),
  updated_by_name text
);

create table if not exists public.disaster_department_plans (
  tenant_id        uuid not null default public.current_tenant(),
  silo             public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  department       text not null check (department = any (public.disaster_line_functions())),
  plan_reviewed_on date,
  updated_at       timestamptz not null default now(),
  updated_by_name  text,
  primary key (tenant_id, department)
);

create table if not exists public.disaster_task_teams (
  tenant_id       uuid not null default public.current_tenant(),
  silo            public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  team            text not null check (team = any (public.disaster_task_team_keys())),
  chair           text check (chair is null or length(chair) between 2 and 160),
  chair_phone     text check (chair_phone is null or (length(chair_phone) <= 30 and public.desk_phone_ok(chair_phone))),
  updated_at      timestamptz not null default now(),
  updated_by_name text,
  primary key (tenant_id, team)
);

create table if not exists public.disaster_forum_meetings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default public.current_tenant(),
  silo            public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  client_ref      uuid,
  body            text not null check (body = 'forum' or body = any (public.disaster_task_team_keys())),
  held_on         date not null,
  attended        text check (attended is null or length(attended) <= 1000),
  notes           text check (notes is null or length(notes) <= 4000),
  created_at      timestamptz not null default now(),
  created_by_name text
);
create unique index if not exists disaster_forum_meetings_ref on public.disaster_forum_meetings (tenant_id, client_ref) where client_ref is not null;
create index if not exists disaster_forum_meetings_held on public.disaster_forum_meetings (tenant_id, held_on desc);

create table if not exists public.disaster_framework_status (
  tenant_id       uuid not null default public.current_tenant(),
  silo            public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  measure         text not null check (measure ~ '^[1-7]\.[0-9]{1,2}[a-z]$'),
  status          text not null check (status in ('Not started', 'In progress', 'Achieved')),
  note            text check (note is null or length(note) <= 500),
  updated_at      timestamptz not null default now(),
  updated_by_name text,
  primary key (tenant_id, measure)
);

do $$
declare t text;
begin
  foreach t in array array['disaster_settings', 'disaster_department_plans', 'disaster_task_teams', 'disaster_forum_meetings', 'disaster_framework_status'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated
      using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant())', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated
      using (silo = public.current_silo() or public.is_global() or public.works_disaster_desk())', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

/** The guard every function here shares: the Disaster desk only. Returns the person's name. */
create or replace function public.readiness_desk() returns text
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.works_disaster_desk() then raise exception 'Only the Disaster desk does this' using errcode = '42501'; end if;
  return public.desk_name();
end $$;
revoke all on function public.readiness_desk() from public, anon, authenticated;

create or replace function public.set_disaster_population(p_population int, p_note text)
returns public.disaster_settings
language plpgsql security definer set search_path to 'public' as $$
declare
  s      public.disaster_settings;
  v_name text := public.readiness_desk();
begin
  if p_population is null or p_population not between 1 and 20000000 then raise exception 'Give the population as a whole number.' using errcode = 'P0001'; end if;
  insert into public.disaster_settings (tenant_id, population, population_note, updated_by_name)
  values (public.current_tenant(), p_population, public.desk_text(p_note, 200), v_name)
  on conflict (tenant_id) do update set population = excluded.population, population_note = excluded.population_note,
    updated_at = now(), updated_by_name = excluded.updated_by_name
  returning * into s;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (s.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_POPULATION', 'disaster_settings', null,
          format('%s (%s)', s.population, coalesce(s.population_note, 'no source given')));
  return s;
end $$;
revoke all on function public.set_disaster_population(int, text) from public, anon;
grant execute on function public.set_disaster_population(int, text) to authenticated;

/** When a department last reviewed its plan; blank clears it. */
create or replace function public.set_department_plan_review(p_department text, p_reviewed_on text)
returns public.disaster_department_plans
language plpgsql security definer set search_path to 'public' as $$
declare
  d      public.disaster_department_plans;
  v_name text := public.readiness_desk();
  v_on   date;
begin
  if p_department is null or not p_department = any (public.disaster_line_functions()) then raise exception 'Choose the department from the list' using errcode = '22023'; end if;
  if coalesce(btrim(p_reviewed_on), '') <> '' then
    if btrim(p_reviewed_on) !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'The date is YYYY-MM-DD.' using errcode = 'P0001'; end if;
    v_on := btrim(p_reviewed_on)::date;
    if v_on > current_date + 1 then raise exception 'The review date cannot be in the future.' using errcode = 'P0001'; end if;
  end if;
  insert into public.disaster_department_plans (tenant_id, department, plan_reviewed_on, updated_by_name)
  values (public.current_tenant(), p_department, v_on, v_name)
  on conflict (tenant_id, department) do update set plan_reviewed_on = excluded.plan_reviewed_on, updated_at = now(), updated_by_name = excluded.updated_by_name
  returning * into d;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (d.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DEPARTMENT_PLAN_REVIEW', 'disaster_department_plans', p_department,
          coalesce(d.plan_reviewed_on::text, 'cleared'));
  return d;
end $$;
revoke all on function public.set_department_plan_review(text, text) from public, anon;
grant execute on function public.set_department_plan_review(text, text) to authenticated;

/** A task team's chair; a blank name leaves the team without one. */
create or replace function public.set_task_team_chair(p_team text, p_chair text, p_phone text)
returns public.disaster_task_teams
language plpgsql security definer set search_path to 'public' as $$
declare
  tt     public.disaster_task_teams;
  v_name text := public.readiness_desk();
  v_ch   text := public.desk_text(p_chair, 160);
  v_ph   text := public.desk_text(p_phone, 30);
begin
  if p_team is null or not p_team = any (public.disaster_task_team_keys()) then raise exception 'Choose the task team from the list' using errcode = '22023'; end if;
  perform public.desk_check_name(v_ch);
  perform public.desk_check_phone(v_ph);
  insert into public.disaster_task_teams (tenant_id, team, chair, chair_phone, updated_by_name)
  values (public.current_tenant(), p_team, v_ch, v_ph, v_name)
  on conflict (tenant_id, team) do update set chair = excluded.chair, chair_phone = excluded.chair_phone, updated_at = now(), updated_by_name = excluded.updated_by_name
  returning * into tt;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (tt.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'TASK_TEAM_CHAIR', 'disaster_task_teams', p_team, coalesce(tt.chair, 'no chair'));
  return tt;
end $$;
revoke all on function public.set_task_team_chair(text, text, text) from public, anon;
grant execute on function public.set_task_team_chair(text, text, text) to authenticated;

/** A meeting of the Advisory Forum ('forum') or of a task team. A retry with the same reference returns the first. */
create or replace function public.record_forum_meeting(p_client_ref uuid, p_fields jsonb)
returns public.disaster_forum_meetings
language plpgsql security definer set search_path to 'public' as $$
declare
  f      jsonb := coalesce(p_fields, '{}'::jsonb);
  m      public.disaster_forum_meetings;
  v_name text := public.readiness_desk();
  v_body text := coalesce(f ->> 'body', '');
  v_on   date;
begin
  if p_client_ref is null then raise exception 'No reference; try again' using errcode = '22023'; end if;
  select * into m from public.disaster_forum_meetings where tenant_id = public.current_tenant() and client_ref = p_client_ref;
  if found then return m; end if;
  if not (v_body = 'forum' or v_body = any (public.disaster_task_team_keys())) then raise exception 'Say which body met' using errcode = '22023'; end if;
  if coalesce(f ->> 'held_on', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Give the date it met.' using errcode = 'P0001'; end if;
  v_on := (f ->> 'held_on')::date;
  if v_on > current_date + 1 then raise exception 'The meeting cannot be in the future.' using errcode = 'P0001'; end if;
  insert into public.disaster_forum_meetings (tenant_id, client_ref, body, held_on, attended, notes, created_by_name)
  values (public.current_tenant(), p_client_ref, v_body, v_on, public.desk_text(f ->> 'attended', 1000), public.desk_text(f ->> 'notes', 4000), v_name)
  returning * into m;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (m.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'FORUM_MEETING', 'disaster_forum_meetings', m.id::text,
          format('%s on %s', m.body, m.held_on));
  return m;
end $$;
revoke all on function public.record_forum_meeting(uuid, jsonb) from public, anon;
grant execute on function public.record_forum_meeting(uuid, jsonb) to authenticated;

/** A meeting recorded by mistake. */
create or replace function public.remove_forum_meeting(p_id uuid)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  m      public.disaster_forum_meetings;
  v_name text := public.readiness_desk();
begin
  delete from public.disaster_forum_meetings where id = p_id and tenant_id = public.current_tenant() returning * into m;
  if m.id is null then return; end if;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (m.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'FORUM_MEETING_REMOVED', 'disaster_forum_meetings', m.id::text,
          format('%s on %s', m.body, m.held_on));
end $$;
revoke all on function public.remove_forum_meeting(uuid) from public, anon;
grant execute on function public.remove_forum_meeting(uuid) to authenticated;

/** Where a Framework measure stands. */
create or replace function public.set_framework_status(p_measure text, p_status text, p_note text default null)
returns public.disaster_framework_status
language plpgsql security definer set search_path to 'public' as $$
declare
  s      public.disaster_framework_status;
  v_name text := public.readiness_desk();
begin
  if p_measure is null or p_measure !~ '^[1-7]\.[0-9]{1,2}[a-z]$' then raise exception 'Choose the measure from the list' using errcode = '22023'; end if;
  if p_status is null or p_status not in ('Not started', 'In progress', 'Achieved') then raise exception 'Choose Not started, In progress or Achieved' using errcode = '22023'; end if;
  insert into public.disaster_framework_status (tenant_id, measure, status, note, updated_by_name)
  values (public.current_tenant(), p_measure, p_status, public.desk_text(p_note, 500), v_name)
  on conflict (tenant_id, measure) do update set status = excluded.status, note = coalesce(excluded.note, disaster_framework_status.note),
    updated_at = now(), updated_by_name = excluded.updated_by_name
  returning * into s;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (s.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'FRAMEWORK_STATUS', 'disaster_framework_status', p_measure, s.status);
  return s;
end $$;
revoke all on function public.set_framework_status(text, text, text) from public, anon;
grant execute on function public.set_framework_status(text, text, text) to authenticated;

-- ── Prove it ────────────────────────────────────────────────────────────────

do $$
declare f text;
begin
  foreach f in array array['set_disaster_population(int, text)', 'set_department_plan_review(text, text)', 'set_task_team_chair(text, text, text)',
                           'record_forum_meeting(uuid, jsonb)', 'remove_forum_meeting(uuid)', 'set_framework_status(text, text, text)'] loop
    if has_function_privilege('anon', 'public.' || f, 'execute') then raise exception '0120: anonymous users can run %', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.disaster_framework_status', 'insert') or has_table_privilege('authenticated', 'public.disaster_settings', 'update') then
    raise exception '0120: signed-in users can write the tables directly';
  end if;
  if cardinality(public.disaster_task_team_keys()) <> 5 then raise exception '0120: five task teams'; end if;
end $$;

commit;
