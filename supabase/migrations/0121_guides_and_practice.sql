-- ============================================================================
-- 0121 — Criti's tour and practice incidents
-- ============================================================================
--
-- Run after 0120.
--
--   1. Whether each person has taken a guided tour, or asked never to see it
--      again (user_guides), kept with their account so it holds on any PC:
--      someone who has done it, or said "Don't show this again", is never
--      asked again. set_guide_status() for one's own account only.
--   2. Practice incidents (disaster_practice_incidents): Criti walks a new
--      desk user through adding an incident, moving it up a level, logging
--      what came in, relief by ward and standing it down. They live in their
--      own table, only their owner sees them, and they never reach the desk,
--      the map, an alert, an SMS or a figure. Starting a new one clears the
--      person's older ones.
--
-- Writes only through the functions here (SECURITY DEFINER, checked,
-- audited); nothing for anonymous users. Safe to re-run.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.disaster_framework_status') is null then
    raise exception 'Run 0120_disaster_readiness.sql first, then this one. Nothing was changed.';
  end if;
end $$;

-- ── 1. Guides ───────────────────────────────────────────────────────────────

create table if not exists public.user_guides (
  user_id uuid not null references auth.users (id) on delete cascade,
  guide   text not null check (guide ~ '^[a-z0-9][a-z0-9.\-]{1,59}$'),
  status  text not null check (status in ('done', 'dismissed')),
  at      timestamptz not null default now(),
  primary key (user_id, guide)
);
comment on table public.user_guides is
  'Guided tours each person has taken or turned off for good (0121). Their own rows only; set_guide_status().';

alter table public.user_guides enable row level security;
drop policy if exists user_guides_own on public.user_guides;
create policy user_guides_own on public.user_guides for select to authenticated using (user_id = auth.uid());
revoke all on public.user_guides from anon;
revoke insert, update, delete on public.user_guides from authenticated;
grant select on public.user_guides to authenticated;

/** Mark a tour as taken ('done') or never to be offered again ('dismissed'), for the person signed in. */
create or replace function public.set_guide_status(p_guide text, p_status text)
returns public.user_guides
language plpgsql security definer set search_path to 'public' as $$
declare
  g public.user_guides;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_guide is null or p_guide !~ '^[a-z0-9][a-z0-9.\-]{1,59}$' then raise exception 'Unknown guide' using errcode = '22023'; end if;
  if p_status is null or p_status not in ('done', 'dismissed') then raise exception 'Unknown status' using errcode = '22023'; end if;
  insert into public.user_guides (user_id, guide, status) values (auth.uid(), p_guide, p_status)
  on conflict (user_id, guide) do update set status = excluded.status, at = now()
  returning * into g;
  return g;
end $$;
revoke all on function public.set_guide_status(text, text) from public, anon;
grant execute on function public.set_guide_status(text, text) to authenticated;

-- ── 2. Practice incidents ───────────────────────────────────────────────────

create table if not exists public.disaster_practice_incidents (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null check (length(title) between 1 and 80),
  hazard      text not null check (public.disaster_hazard_group(hazard) is not null),
  severity    text not null check (severity in ('Low', 'Medium', 'High', 'Critical')),
  place       text check (place is null or length(place) <= 200),
  ward        int check (ward is null or ward between 1 and 111),
  first_report text check (first_report is null or length(first_report) <= 2000),
  level       text not null default 'Bronze' check (level in ('Bronze', 'Silver', 'Gold')),
  status      text not null default 'Active' check (status in ('Active', 'Stood down')),
  -- What was practised, in order: [{ "step": …, "at": time, … }]
  steps       jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
comment on table public.disaster_practice_incidents is
  'Practice incidents from Criti''s walk-through (0121): the owner''s only, never on the desk, the map or in any figure.';
create index if not exists disaster_practice_owner on public.disaster_practice_incidents (user_id, created_at desc);

alter table public.disaster_practice_incidents enable row level security;
drop policy if exists tenant_isolation on public.disaster_practice_incidents;
create policy tenant_isolation on public.disaster_practice_incidents as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
drop policy if exists disaster_practice_own on public.disaster_practice_incidents;
create policy disaster_practice_own on public.disaster_practice_incidents for select to authenticated using (user_id = auth.uid());
revoke all on public.disaster_practice_incidents from anon;
revoke insert, update, delete on public.disaster_practice_incidents from authenticated;
grant select on public.disaster_practice_incidents to authenticated;

/** Start a practice incident; the person's older practice incidents go. */
create or replace function public.start_practice_incident(p_fields jsonb)
returns public.disaster_practice_incidents
language plpgsql security definer set search_path to 'public' as $$
declare
  f      jsonb := coalesce(p_fields, '{}'::jsonb);
  p      public.disaster_practice_incidents;
  v_haz  text := public.desk_text(f ->> 'hazard', 80);
  v_sev  text := coalesce(public.desk_text(f ->> 'severity', 20), 'Medium');
  v_ward int := public.desk_ward(f ->> 'ward', 'eThekwini Metro')::int;
begin
  if auth.uid() is null or not public.works_disaster_desk() then raise exception 'Only the Disaster desk practises here' using errcode = '42501'; end if;
  if public.desk_text(f ->> 'title', 80) is null then raise exception 'Give the incident a short title.' using errcode = 'P0001'; end if;
  if v_haz is null or public.disaster_hazard_group(v_haz) is null then raise exception 'Choose the hazard from the list.' using errcode = 'P0001'; end if;
  if v_sev not in ('Low', 'Medium', 'High', 'Critical') then raise exception 'Choose the severity.' using errcode = 'P0001'; end if;
  delete from public.disaster_practice_incidents where user_id = auth.uid();
  insert into public.disaster_practice_incidents (user_id, title, hazard, severity, place, ward, first_report, steps)
  values (auth.uid(), public.desk_text(f ->> 'title', 80), v_haz, v_sev, public.desk_text(f ->> 'place', 200), v_ward,
          public.desk_text(f ->> 'first_report', 2000), jsonb_build_array(jsonb_build_object('step', 'added', 'at', now())))
  returning * into p;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (p.tenant_id, 'EthekwiniDisaster', auth.uid(), public.desk_name(), 'EthekwiniDisaster', 'PRACTICE_STARTED', 'disaster_practice_incidents', p.id::text, p.title);
  return p;
end $$;
revoke all on function public.start_practice_incident(jsonb) from public, anon;
grant execute on function public.start_practice_incident(jsonb) to authenticated;

/**
 * One practised step on one's own practice incident: 'escalate' (to,
 * triggers: at least one of the level's), 'update' (text), 'relief' (ward,
 * people) or 'stand_down' (reason). The same rules as the real desk, said
 * the same way, so the practice teaches them.
 */
create or replace function public.practice_step(p_id uuid, p_step text, p_fields jsonb)
returns public.disaster_practice_incidents
language plpgsql security definer set search_path to 'public' as $$
declare
  f      jsonb := coalesce(p_fields, '{}'::jsonb);
  p      public.disaster_practice_incidents;
  v_to   text;
  v_trig text[];
  v_text text;
  v_ward int;
  v_ppl  int;
begin
  select * into p from public.disaster_practice_incidents where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception 'That practice incident is not there any more. Start again.' using errcode = 'P0002'; end if;
  if p.status <> 'Active' then raise exception 'This practice incident is already stood down.' using errcode = 'P0001'; end if;
  case p_step
    when 'escalate' then
      v_to := coalesce(f ->> 'to', '');
      if v_to not in ('Silver', 'Gold') or public.coordination_rank(v_to) <= public.coordination_rank(p.level) then
        raise exception 'Choose a higher level.' using errcode = 'P0001';
      end if;
      select coalesce(array_agg(x), '{}') into v_trig from jsonb_array_elements_text(coalesce(f -> 'triggers', '[]'::jsonb)) x
       where x = any (public.disaster_level_triggers(v_to));
      if cardinality(v_trig) = 0 then raise exception 'Tick at least one reason it moves up.' using errcode = 'P0001'; end if;
      update public.disaster_practice_incidents set level = v_to,
        steps = steps || jsonb_build_array(jsonb_build_object('step', 'escalate', 'to', v_to, 'triggers', to_jsonb(v_trig), 'at', now()))
       where id = p.id returning * into p;
    when 'update' then
      v_text := public.desk_text(f ->> 'text', 2000);
      if v_text is null then raise exception 'Write what came in.' using errcode = 'P0001'; end if;
      update public.disaster_practice_incidents set steps = steps || jsonb_build_array(jsonb_build_object('step', 'update', 'text', v_text, 'at', now()))
       where id = p.id returning * into p;
    when 'relief' then
      v_ward := public.desk_ward(f ->> 'ward', 'eThekwini Metro')::int;
      v_ppl := public.desk_whole(f ->> 'people', 'People helped');
      if v_ward is null then raise exception 'Give the ward number, like 76.' using errcode = 'P0001'; end if;
      if v_ppl < 1 then raise exception 'Give the number of people helped.' using errcode = 'P0001'; end if;
      update public.disaster_practice_incidents set steps = steps || jsonb_build_array(jsonb_build_object('step', 'relief', 'ward', v_ward, 'people', v_ppl, 'at', now()))
       where id = p.id returning * into p;
    when 'stand_down' then
      v_text := public.desk_text(f ->> 'reason', 500);
      if v_text is null then raise exception 'Say why.' using errcode = 'P0001'; end if;
      update public.disaster_practice_incidents set status = 'Stood down', finished_at = now(),
        steps = steps || jsonb_build_array(jsonb_build_object('step', 'stand_down', 'reason', v_text, 'at', now()))
       where id = p.id returning * into p;
    else
      raise exception 'Unknown step' using errcode = '22023';
  end case;
  return p;
end $$;
revoke all on function public.practice_step(uuid, text, jsonb) from public, anon;
grant execute on function public.practice_step(uuid, text, jsonb) to authenticated;

-- ── Prove it ────────────────────────────────────────────────────────────────

do $$
begin
  if has_function_privilege('anon', 'public.set_guide_status(text, text)', 'execute')
     or has_function_privilege('anon', 'public.start_practice_incident(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.practice_step(uuid, text, jsonb)', 'execute') then
    raise exception '0121: anonymous users can run a guide or practice function';
  end if;
  if has_table_privilege('authenticated', 'public.user_guides', 'insert') or has_table_privilege('authenticated', 'public.disaster_practice_incidents', 'update') then
    raise exception '0121: signed-in users can write the tables directly';
  end if;
end $$;

commit;
