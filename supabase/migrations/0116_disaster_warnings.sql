-- ============================================================================
-- 0116 — Disaster: early warnings
-- ============================================================================
--
-- Run after 0115.
--
-- Revision 2, section 3: many incidents now start with a SA Weather Service
-- impact-based warning rather than a call. The desk records each warning and
-- takes it through the process:
--
--   W1  The warning: hazard, level 1 to 10, colour, validity, areas and the
--       expected impacts. It arrives by itself from SAWS's public warning
--       feed (the server reads it; ingest_saws_warning(), server only) or the
--       desk types it in from an email or PDF (record_disaster_warning()).
--       The colour matches the level (Yellow 1–4, Orange 5–8, Red 9–10)
--       unless the desk sets what the issued warning states.
--   W2  Checked with the FEWS team; Emergency Services, Water, Electricity
--       and SANRAL told; spread on every channel (WhatsApp groups, Facebook,
--       Instagram, YouTube, LinkedIn, radio, loud-hailing, SMS to all
--       councillors). Each step: who ticked it and when (set_warning_step()).
--   W3  At Level 4 or higher the JOC meets to check readiness; the outcome
--       is Monitor, Pre-position resources, Open halls or Respond
--       (hold_readiness_session(), in disaster_joc_sessions, which 0117 also
--       uses for the JOC's daily sessions on an incident).
--   X   Respond: an incident is logged from the warning and linked to it
--       (open_incident_from_warning()). Otherwise the warning ends by itself
--       when it expires, or the desk ends it (end_disaster_warning()).
--
-- The councillors (disaster_councillors): every ward councillor (and PR
-- councillors, with no ward) with a cellphone, for the warning SMS and,
-- from 0118, relief through the ward. Their numbers are personal: only the
-- Disaster desk and command read them.
--
-- Writes only through the functions here (SECURITY DEFINER, checked,
-- audited); nothing for anonymous users. Safe to re-run.
-- ============================================================================

begin;

do $$
begin
  if to_regprocedure('public.disaster_priority_risk(text)') is null then
    raise exception 'Run 0115_disaster_joc.sql first, then this one. Nothing was changed.';
  end if;
end $$;

-- ── 0. The lists ────────────────────────────────────────────────────────────

/** SAWS's colour for a level: Yellow 1–4, Orange 5–8, Red 9–10. */
create or replace function public.warning_colour_for(p_level int) returns text
language sql immutable as $$
  select case when p_level between 1 and 4 then 'Yellow' when p_level between 5 and 8 then 'Orange'
              when p_level between 9 and 10 then 'Red' end
$$;

/** The hazards SAWS issues impact-based warnings for (the desk's list). */
create or replace function public.warning_hazards() returns text[]
language sql immutable as $$
  select array['Disruptive rain', 'Severe thunderstorms', 'Damaging winds', 'Damaging waves', 'Storm surge',
               'Disruptive snow', 'Reduced visibility', 'Extremely high temperatures', 'Extremely cold temperatures',
               'Fire danger', 'Other']
$$;

/** W2: the checks and the channels, each ticked once done. */
create or replace function public.warning_steps() returns text[]
language sql immutable as $$
  select array['fews', 'emergency_services', 'water', 'electricity', 'sanral',
               'whatsapp', 'facebook', 'instagram', 'youtube', 'linkedin', 'radio', 'loudhailing', 'sms_councillors']
$$;

/** The step's name, for the record. */
create or replace function public.warning_step_name(p text) returns text
language sql immutable as $$
  select case p
    when 'fews' then 'Checked with the FEWS team'
    when 'emergency_services' then 'Emergency Services told'
    when 'water' then 'Water and Sanitation told'
    when 'electricity' then 'Electricity told'
    when 'sanral' then 'SANRAL told'
    when 'whatsapp' then 'WhatsApp groups'
    when 'facebook' then 'Facebook'
    when 'instagram' then 'Instagram'
    when 'youtube' then 'YouTube'
    when 'linkedin' then 'LinkedIn'
    when 'radio' then 'Radio'
    when 'loudhailing' then 'Loud-hailing and word of mouth'
    when 'sms_councillors' then 'SMS to all councillors'
  end
$$;

-- ── 1. The warnings ─────────────────────────────────────────────────────────

create table if not exists public.disaster_warnings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default public.current_tenant(),
  silo            public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  client_ref      uuid,
  source          text not null check (source in ('SA Weather Service feed', 'Typed in')),
  -- One warning however often SAWS re-issues it: the hazard and when it starts.
  saws_key        text check (saws_key is null or length(saws_key) <= 200),
  saws_files      text[] not null default '{}',
  hazard          text not null check (length(hazard) between 1 and 80),
  level           int not null check (level between 1 and 10),
  colour          text not null check (colour in ('Yellow', 'Orange', 'Red')),
  colour_by_desk  boolean not null default false,
  valid_from      timestamptz not null,
  valid_until     timestamptz not null,
  areas           text not null check (length(areas) between 1 and 2000),
  -- eThekwini's areas as SAWS draws them: [[[lat, lng], …], …].
  area_shapes     jsonb check (area_shapes is null or jsonb_typeof(area_shapes) = 'array'),
  impacts         text check (impacts is null or length(impacts) <= 4000),
  instructions    text check (instructions is null or length(instructions) <= 4000),
  issued_at       timestamptz,
  status          text not null default 'Active' check (status in ('Active', 'Ended', 'Cancelled')),
  ended_at        timestamptz,
  ended_reason    text check (ended_reason is null or length(ended_reason) <= 300),
  -- W2: step → { "at": time, "by": name }.
  steps           jsonb not null default '{}'::jsonb check (jsonb_typeof(steps) = 'object'),
  incident_id     uuid references public.incidents (id) on delete set null,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  created_by_name text,
  updated_at      timestamptz not null default now(),
  updated_by_name text,
  check (valid_until > valid_from)
);
comment on table public.disaster_warnings is
  'SA Weather Service impact-based warnings for eThekwini and how the desk took each through the process (0116). Written only by record_disaster_warning(), ingest_saws_warning() and the step functions.';
create unique index if not exists disaster_warnings_saws on public.disaster_warnings (tenant_id, saws_key) where saws_key is not null;
create unique index if not exists disaster_warnings_ref on public.disaster_warnings (tenant_id, client_ref) where client_ref is not null;
create index if not exists disaster_warnings_until on public.disaster_warnings (tenant_id, valid_until desc);

/** What happened to a warning, in order: from SAWS, ticks, SMS, sessions, ended. */
create table if not exists public.disaster_warning_events (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default public.current_tenant(),
  silo       public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  warning_id uuid not null references public.disaster_warnings (id) on delete cascade,
  at         timestamptz not null default now(),
  by_name    text,
  text       text not null check (length(text) between 1 and 1000)
);
create index if not exists disaster_warning_events_warning on public.disaster_warning_events (warning_id, at);

/**
 * JOC sessions: a readiness session on a warning (W3, here), and the JOC's
 * daily sessions on an incident (0117).
 */
create table if not exists public.disaster_joc_sessions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default public.current_tenant(),
  silo            public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  client_ref      uuid,
  kind            text not null check (kind in ('Readiness', 'Daily')),
  warning_id      uuid references public.disaster_warnings (id) on delete cascade,
  incident_id     uuid references public.incidents (id) on delete cascade,
  held_at         timestamptz not null,
  attended        text check (attended is null or length(attended) <= 1000),
  outcome         text check (outcome is null or outcome in ('Monitor', 'Pre-position resources', 'Open halls', 'Respond')),
  notes           text check (notes is null or length(notes) <= 4000),
  created_at      timestamptz not null default now(),
  created_by      uuid,
  created_by_name text,
  check ((kind = 'Readiness' and warning_id is not null and outcome is not null) or (kind = 'Daily' and incident_id is not null))
);
create unique index if not exists disaster_joc_sessions_ref on public.disaster_joc_sessions (tenant_id, client_ref) where client_ref is not null;
create index if not exists disaster_joc_sessions_warning on public.disaster_joc_sessions (warning_id, held_at);
create index if not exists disaster_joc_sessions_incident on public.disaster_joc_sessions (incident_id, held_at);

/** Which SAWS files the server has read, so each is read once (server only). */
create table if not exists public.disaster_saws_files (
  tenant_id uuid not null,
  file      text not null check (length(file) between 1 and 200),
  seen_at   timestamptz not null default now(),
  touches   boolean not null,
  primary key (tenant_id, file)
);

/** When each outside feed was last read, and whether it answered. */
create table if not exists public.disaster_feed_state (
  tenant_id uuid not null,
  feed      text not null check (feed in ('saws')),
  synced_at timestamptz not null default now(),
  ok        boolean not null,
  detail    text check (detail is null or length(detail) <= 300),
  primary key (tenant_id, feed)
);

/** An incident logged from a warning keeps the link (W3 → step 3). */
alter table public.disaster_call_facts
  add column if not exists warning_id uuid references public.disaster_warnings (id) on delete set null;

-- ── 2. The councillors ──────────────────────────────────────────────────────

create table if not exists public.disaster_councillors (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default public.current_tenant(),
  silo            public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  ward            int check (ward is null or ward between 1 and 111),
  name            text not null check (length(name) between 2 and 160),
  phone           text check (phone is null or (length(phone) <= 30 and public.desk_phone_ok(phone))),
  email           text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  is_active       boolean not null default true,
  updated_at      timestamptz not null default now(),
  updated_by_name text
);
comment on table public.disaster_councillors is
  'Ward (and PR) councillors with their cellphones, for the warning SMS and relief through the ward (0116). Personal: the Disaster desk and command only. save_councillor(), import_councillors().';
create unique index if not exists disaster_councillors_ward on public.disaster_councillors (tenant_id, ward) where ward is not null and is_active;

-- ── 3. Who reads what ───────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['disaster_warnings', 'disaster_warning_events', 'disaster_joc_sessions', 'disaster_councillors',
                           'disaster_saws_files', 'disaster_feed_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated
      using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- Warnings and their record: everyone in Disaster, command and the desks that work with it.
do $$
declare t text;
begin
  foreach t in array array['disaster_warnings', 'disaster_warning_events', 'disaster_joc_sessions'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated
      using (silo = public.current_silo() or public.is_global() or public.works_disaster_desk())', t || '_read', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- When the warning feed was last read (no silo column): the desk and command.
drop policy if exists disaster_feed_state_read on public.disaster_feed_state;
create policy disaster_feed_state_read on public.disaster_feed_state for select to authenticated
  using (public.is_global() or public.works_disaster_desk());
grant select on public.disaster_feed_state to authenticated;

-- Councillors' numbers: the Disaster desk and command only.
drop policy if exists disaster_councillors_read on public.disaster_councillors;
create policy disaster_councillors_read on public.disaster_councillors for select to authenticated
  using (public.works_disaster_desk() or public.is_global());
grant select on public.disaster_councillors to authenticated;

-- The server's notes on the SAWS files: nobody signed in reads them.
revoke all on public.disaster_saws_files from authenticated;

-- ── 4. The desk's buttons ───────────────────────────────────────────────────

create or replace function public.desk_name() returns text
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select full_name from public.profiles where id = auth.uid()), 'the Disaster desk')
$$;
revoke all on function public.desk_name() from public, anon;
grant execute on function public.desk_name() to authenticated;

/** The warning, locked, once the caller works the Disaster desk. */
create or replace function public.desk_warning(p_warning_id uuid)
returns public.disaster_warnings language plpgsql security definer set search_path to 'public' as $$
declare
  v public.disaster_warnings;
begin
  if not public.works_disaster_desk() then raise exception 'Only the Disaster desk does this' using errcode = '42501'; end if;
  select * into v from public.disaster_warnings where id = p_warning_id and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'That warning is not there any more.' using errcode = 'P0002'; end if;
  return v;
end $$;
revoke all on function public.desk_warning(uuid) from public, anon, authenticated;

/** W1, typed in: a warning that came by email or PDF. A retry with the same reference returns the first. */
create or replace function public.record_disaster_warning(p_client_ref uuid, p_fields jsonb)
returns public.disaster_warnings
language plpgsql security definer set search_path to 'public' as $$
declare
  f        jsonb := coalesce(p_fields, '{}'::jsonb);
  v        public.disaster_warnings;
  v_hazard text := public.desk_text(f ->> 'hazard', 80);
  v_level  int := public.desk_whole(f ->> 'level', 'The level');
  v_colour text := nullif(btrim(coalesce(f ->> 'colour', '')), '');
  v_from   timestamptz := public.desk_time(f ->> 'valid_from', 'Valid from');
  v_until  timestamptz := public.desk_time(f ->> 'valid_until', 'Valid until');
  v_issued timestamptz := public.desk_time(f ->> 'issued_at', 'Issued at');
  v_areas  text := public.desk_text(f ->> 'areas', 2000);
  v_name   text;
begin
  if not public.works_disaster_desk() then raise exception 'Only the Disaster desk does this' using errcode = '42501'; end if;
  if p_client_ref is null then raise exception 'No reference; try again' using errcode = '22023'; end if;
  select * into v from public.disaster_warnings where tenant_id = public.current_tenant() and client_ref = p_client_ref;
  if found then return v; end if;

  if v_hazard is null or not v_hazard = any (public.warning_hazards()) then raise exception 'Choose the hazard from the list.' using errcode = 'P0001'; end if;
  if v_level not between 1 and 10 then raise exception 'The level is 1 to 10.' using errcode = 'P0001'; end if;
  if v_colour is not null and v_colour not in ('Yellow', 'Orange', 'Red') then raise exception 'Choose Yellow, Orange or Red.' using errcode = 'P0001'; end if;
  if v_from is null then v_from := now(); end if;
  if v_until is null then raise exception 'Say until when the warning is valid.' using errcode = 'P0001'; end if;
  if v_until <= v_from then raise exception 'Valid until must be after valid from.' using errcode = 'P0001'; end if;
  if v_until > v_from + interval '14 days' then raise exception 'A warning is valid for 14 days at most. Check the dates.' using errcode = 'P0001'; end if;
  if v_areas is null then raise exception 'Say which areas it covers.' using errcode = 'P0001'; end if;
  v_name := public.desk_name();

  insert into public.disaster_warnings (client_ref, source, hazard, level, colour, colour_by_desk, valid_from, valid_until, areas,
                                        impacts, instructions, issued_at, created_by, created_by_name, updated_by_name)
  values (p_client_ref, 'Typed in', v_hazard, v_level, coalesce(v_colour, public.warning_colour_for(v_level)), v_colour is not null,
          v_from, v_until, v_areas, public.desk_text(f ->> 'impacts', 4000), public.desk_text(f ->> 'instructions', 4000),
          v_issued, auth.uid(), v_name, v_name)
  returning * into v;

  insert into public.disaster_warning_events (tenant_id, warning_id, by_name, text)
  values (v.tenant_id, v.id, v_name, format('Recorded: %s %s, Level %s', v.colour, v.hazard, v.level));
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_WARNING_RECORDED', 'disaster_warnings',
          v.id::text, format('%s Level %s, %s to %s', v.hazard, v.level, v.valid_from, v.valid_until));
  return v;
end $$;
revoke all on function public.record_disaster_warning(uuid, jsonb) from public, anon;
grant execute on function public.record_disaster_warning(uuid, jsonb) to authenticated;

/** W2: tick a check or a channel (who and when), or untick it. */
create or replace function public.set_warning_step(p_warning_id uuid, p_step text, p_done boolean)
returns public.disaster_warnings
language plpgsql security definer set search_path to 'public' as $$
declare
  v      public.disaster_warnings;
  v_name text;
begin
  if p_step is null or not p_step = any (public.warning_steps()) then raise exception 'Choose the step from the list' using errcode = '22023'; end if;
  v := public.desk_warning(p_warning_id);
  if coalesce(p_done, false) = (v.steps ? p_step) then return v; end if;
  v_name := public.desk_name();
  update public.disaster_warnings
     set steps = case when p_done then steps || jsonb_build_object(p_step, jsonb_build_object('at', now(), 'by', v_name))
                      else steps - p_step end,
         updated_at = now(), updated_by_name = v_name
   where id = v.id
  returning * into v;
  insert into public.disaster_warning_events (tenant_id, warning_id, by_name, text)
  values (v.tenant_id, v.id, v_name, case when p_done then public.warning_step_name(p_step) || ': done'
                                          else public.warning_step_name(p_step) || ': not done after all' end);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_WARNING_STEP', 'disaster_warnings',
          v.id::text, format('%s: %s', public.warning_step_name(p_step), case when p_done then 'done' else 'undone' end));
  return v;
end $$;
revoke all on function public.set_warning_step(uuid, text, boolean) from public, anon;
grant execute on function public.set_warning_step(uuid, text, boolean) to authenticated;

/** The colour the issued warning states; blank goes back to matching the level. */
create or replace function public.set_warning_colour(p_warning_id uuid, p_colour text)
returns public.disaster_warnings
language plpgsql security definer set search_path to 'public' as $$
declare
  v        public.disaster_warnings;
  v_colour text := nullif(btrim(coalesce(p_colour, '')), '');
  v_name   text;
begin
  if v_colour is not null and v_colour not in ('Yellow', 'Orange', 'Red') then raise exception 'Choose Yellow, Orange or Red.' using errcode = 'P0001'; end if;
  v := public.desk_warning(p_warning_id);
  v_name := public.desk_name();
  update public.disaster_warnings
     set colour = coalesce(v_colour, public.warning_colour_for(level)), colour_by_desk = v_colour is not null,
         updated_at = now(), updated_by_name = v_name
   where id = v.id
  returning * into v;
  insert into public.disaster_warning_events (tenant_id, warning_id, by_name, text)
  values (v.tenant_id, v.id, v_name, format('Colour set to %s%s', v.colour, case when v_colour is null then ' (matches the level)' else '' end));
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_WARNING_COLOUR', 'disaster_warnings', v.id::text, v.colour);
  return v;
end $$;
revoke all on function public.set_warning_colour(uuid, text) from public, anon;
grant execute on function public.set_warning_colour(uuid, text) to authenticated;

/** The desk ends a warning before it expires (SAWS lifted it, or it was a mistake). */
create or replace function public.end_disaster_warning(p_warning_id uuid, p_reason text)
returns public.disaster_warnings
language plpgsql security definer set search_path to 'public' as $$
declare
  v        public.disaster_warnings;
  v_reason text := public.desk_text(p_reason, 300);
  v_name   text;
begin
  v := public.desk_warning(p_warning_id);
  if v.status <> 'Active' then return v; end if;
  if v_reason is null then raise exception 'Say why it ends.' using errcode = 'P0001'; end if;
  v_name := public.desk_name();
  update public.disaster_warnings
     set status = 'Ended', ended_at = now(), ended_reason = v_reason, updated_at = now(), updated_by_name = v_name
   where id = v.id
  returning * into v;
  insert into public.disaster_warning_events (tenant_id, warning_id, by_name, text) values (v.tenant_id, v.id, v_name, 'Ended: ' || v_reason);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_WARNING_ENDED', 'disaster_warnings', v.id::text, v_reason);
  return v;
end $$;
revoke all on function public.end_disaster_warning(uuid, text) from public, anon;
grant execute on function public.end_disaster_warning(uuid, text) to authenticated;

/** W3: the JOC's readiness session on a warning, and its outcome. */
create or replace function public.hold_readiness_session(p_warning_id uuid, p_client_ref uuid, p_fields jsonb)
returns public.disaster_joc_sessions
language plpgsql security definer set search_path to 'public' as $$
declare
  f         jsonb := coalesce(p_fields, '{}'::jsonb);
  v         public.disaster_warnings;
  s         public.disaster_joc_sessions;
  v_outcome text := nullif(btrim(coalesce(f ->> 'outcome', '')), '');
  v_held    timestamptz := coalesce(public.desk_time(f ->> 'held_at', 'When it was held'), now());
  v_name    text;
begin
  if p_client_ref is null then raise exception 'No reference; try again' using errcode = '22023'; end if;
  v := public.desk_warning(p_warning_id);
  select * into s from public.disaster_joc_sessions where tenant_id = v.tenant_id and client_ref = p_client_ref;
  if found then return s; end if;
  if v_outcome is null or v_outcome not in ('Monitor', 'Pre-position resources', 'Open halls', 'Respond') then
    raise exception 'Choose what the JOC decided.' using errcode = 'P0001';
  end if;
  if v_held > now() + interval '10 minutes' then raise exception 'The session cannot be in the future.' using errcode = 'P0001'; end if;
  v_name := public.desk_name();
  insert into public.disaster_joc_sessions (tenant_id, client_ref, kind, warning_id, held_at, attended, outcome, notes, created_by, created_by_name)
  values (v.tenant_id, p_client_ref, 'Readiness', v.id, v_held, public.desk_text(f ->> 'attended', 1000), v_outcome,
          public.desk_text(f ->> 'notes', 4000), auth.uid(), v_name)
  returning * into s;
  insert into public.disaster_warning_events (tenant_id, warning_id, by_name, text)
  values (v.tenant_id, v.id, v_name, 'JOC readiness session: ' || v_outcome);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'JOC_READINESS_SESSION', 'disaster_warnings', v.id::text, v_outcome);
  return s;
end $$;
revoke all on function public.hold_readiness_session(uuid, uuid, jsonb) from public, anon;
grant execute on function public.hold_readiness_session(uuid, uuid, jsonb) to authenticated;

/**
 * X → step 3: log an incident from the warning. The fields are those of
 * open_disaster_incident() (0113); it is reported through the warning, and
 * the two are linked both ways.
 */
create or replace function public.open_incident_from_warning(p_warning_id uuid, p_client_ref uuid, p_fields jsonb)
returns public.incidents
language plpgsql security definer set search_path to 'public' as $$
declare
  v      public.disaster_warnings;
  inc    public.incidents;
  v_name text;
begin
  v := public.desk_warning(p_warning_id);
  inc := public.open_disaster_incident(p_client_ref,
    coalesce(p_fields, '{}'::jsonb) || jsonb_build_object('reported_through', 'SA Weather Service warning'));
  v_name := public.desk_name();
  update public.disaster_call_facts set warning_id = v.id where incident_id = inc.id and warning_id is null;
  if v.incident_id is null then
    update public.disaster_warnings set incident_id = inc.id, updated_at = now(), updated_by_name = v_name where id = v.id;
  end if;
  if not exists (select 1 from public.disaster_warning_events e where e.warning_id = v.id and e.text = 'Incident logged: ' || inc.incident_number) then
    insert into public.disaster_warning_events (tenant_id, warning_id, by_name, text)
    values (v.tenant_id, v.id, v_name, 'Incident logged: ' || inc.incident_number);
    insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
    values (inc.silo, inc.id, format('[WARNING] Logged from the %s %s warning, Level %s — %s', v.colour, v.hazard, v.level, v_name),
            auth.uid(), v_name);
  end if;
  return inc;
end $$;
revoke all on function public.open_incident_from_warning(uuid, uuid, jsonb) from public, anon;
grant execute on function public.open_incident_from_warning(uuid, uuid, jsonb) to authenticated;

/** The councillor SMS was sent (by the server, through BulkSMS): ticked and on the record. */
create or replace function public.log_warning_sms(p_warning_id uuid, p_sent int, p_failed int, p_body text)
returns public.disaster_warnings
language plpgsql security definer set search_path to 'public' as $$
declare
  v      public.disaster_warnings;
  v_name text;
begin
  if p_sent is null or p_sent < 0 or p_failed is null or p_failed < 0 then raise exception 'Counts are whole numbers' using errcode = '22023'; end if;
  v := public.desk_warning(p_warning_id);
  v_name := public.desk_name();
  if p_sent > 0 and not v.steps ? 'sms_councillors' then
    update public.disaster_warnings
       set steps = steps || jsonb_build_object('sms_councillors', jsonb_build_object('at', now(), 'by', v_name)),
           updated_at = now(), updated_by_name = v_name
     where id = v.id
    returning * into v;
  end if;
  insert into public.disaster_warning_events (tenant_id, warning_id, by_name, text)
  values (v.tenant_id, v.id, v_name, format('SMS to councillors: %s sent%s', p_sent, case when p_failed > 0 then format(', %s did not go', p_failed) else '' end));
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_WARNING_SMS', 'disaster_warnings', v.id::text,
          format('%s sent, %s failed: %s', p_sent, p_failed, left(coalesce(p_body, ''), 200)));
  return v;
end $$;
revoke all on function public.log_warning_sms(uuid, int, int, text) from public, anon;
grant execute on function public.log_warning_sms(uuid, int, int, text) to authenticated;

-- ── 5. The councillors' list ────────────────────────────────────────────────

/** Add (p_id null) or change a councillor. Ward blank for a PR councillor. */
create or replace function public.save_councillor(p_id uuid, p_fields jsonb)
returns public.disaster_councillors
language plpgsql security definer set search_path to 'public' as $$
declare
  f      jsonb := coalesce(p_fields, '{}'::jsonb);
  v      public.disaster_councillors;
  v_ward int := public.desk_ward(f ->> 'ward', 'eThekwini Metro')::int;
  v_nm   text := public.desk_text(f ->> 'name', 160);
  v_ph   text := public.desk_text(f ->> 'phone', 30);
  v_em   text := lower(public.desk_text(f ->> 'email', 200));
  v_on   boolean := coalesce((f ->> 'is_active')::boolean, true);
  v_name text;
begin
  if not public.works_disaster_desk() then raise exception 'Only the Disaster desk does this' using errcode = '42501'; end if;
  if v_nm is null then raise exception 'Give the councillor''s name.' using errcode = 'P0001'; end if;
  perform public.desk_check_name(v_nm);
  perform public.desk_check_phone(v_ph);
  if v_em is not null and v_em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Give an email like name@durban.gov.za.' using errcode = 'P0001'; end if;
  if v_on and v_ward is not null and exists (select 1 from public.disaster_councillors c
      where c.tenant_id = public.current_tenant() and c.ward = v_ward and c.is_active and c.id is distinct from p_id) then
    raise exception 'Ward % already has a councillor. Change that one instead.', v_ward using errcode = 'P0001';
  end if;
  v_name := public.desk_name();
  if p_id is null then
    insert into public.disaster_councillors (ward, name, phone, email, is_active, updated_by_name)
    values (v_ward, v_nm, v_ph, v_em, v_on, v_name) returning * into v;
  else
    update public.disaster_councillors
       set ward = v_ward, name = v_nm, phone = v_ph, email = v_em, is_active = v_on, updated_at = now(), updated_by_name = v_name
     where id = p_id and tenant_id = public.current_tenant()
    returning * into v;
    if not found then raise exception 'That councillor is not there any more.' using errcode = 'P0002'; end if;
  end if;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'COUNCILLOR_SAVED', 'disaster_councillors', v.id::text,
          format('%s, %s%s', v.name, coalesce('ward ' || v.ward, 'PR'), case when v.is_active then '' else ' (off the list)' end));
  return v;
end $$;
revoke all on function public.save_councillor(uuid, jsonb) from public, anon;
grant execute on function public.save_councillor(uuid, jsonb) to authenticated;

/**
 * A spreadsheet of councillors: [{ward, name, phone, email}, …]. A ward
 * already listed gets the new name and number; the rest are added. Rows
 * that fail a check are skipped and counted. Returns { added, changed, skipped }.
 */
create or replace function public.import_councillors(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  r         jsonb;
  v_added   int := 0;
  v_changed int := 0;
  v_skipped int := 0;
  v_id      uuid;
  v_ward    int;
  v_name    text;
begin
  if not public.works_disaster_desk() then raise exception 'Only the Disaster desk does this' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'No rows to add' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'At most 500 councillors at a time.' using errcode = 'P0001'; end if;
  v_name := public.desk_name();
  for r in select value from jsonb_array_elements(p_rows) loop
    begin
      v_ward := public.desk_ward(r ->> 'ward', 'eThekwini Metro')::int;
      select id into v_id from public.disaster_councillors
       where tenant_id = public.current_tenant() and is_active
         and ((v_ward is not null and ward = v_ward)
              or (v_ward is null and ward is null and lower(name) = lower(btrim(coalesce(r ->> 'name', '')))));
      perform public.save_councillor(v_id, jsonb_build_object('ward', r ->> 'ward', 'name', r ->> 'name', 'phone', r ->> 'phone',
                                                              'email', r ->> 'email', 'is_active', true));
      if v_id is null then v_added := v_added + 1; else v_changed := v_changed + 1; end if;
    exception when others then
      v_skipped := v_skipped + 1;
    end;
  end loop;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (public.current_tenant(), 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'COUNCILLORS_IMPORTED', 'disaster_councillors', null,
          format('%s added, %s changed, %s skipped', v_added, v_changed, v_skipped));
  return jsonb_build_object('added', v_added, 'changed', v_changed, 'skipped', v_skipped);
end $$;
revoke all on function public.import_councillors(jsonb) from public, anon;
grant execute on function public.import_councillors(jsonb) to authenticated;

-- ── 6. The SAWS feed (the server only) ──────────────────────────────────────

/**
 * One SAWS warning file, read by the server from SAWS's public feed and
 * already cut down to eThekwini. Fields: key (hazard and onset), file,
 * msg_type (Alert, Update or Cancel), touches (does it include eThekwini),
 * hazard, level, valid_from, valid_until, areas, area_shapes, impacts,
 * instructions, issued_at. The same warning re-issued updates it in place;
 * a Cancel cancels it; a re-issue without eThekwini ends it for eThekwini.
 * Each file is read once. For the service role only.
 */
create or replace function public.ingest_saws_warning(p_tenant uuid, p_fields jsonb)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  f        jsonb := coalesce(p_fields, '{}'::jsonb);
  v        public.disaster_warnings;
  v_key    text := left(btrim(coalesce(f ->> 'key', '')), 200);
  v_file   text := left(btrim(coalesce(f ->> 'file', '')), 200);
  v_type   text := coalesce(f ->> 'msg_type', 'Alert');
  v_touch  boolean := coalesce((f ->> 'touches')::boolean, false);
  v_level  int;
  v_from   timestamptz;
  v_until  timestamptz;
  v_was    int;
  v_said   text;
begin
  if p_tenant is null or v_key = '' or v_file = '' then raise exception 'A SAWS warning needs a tenant, a key and a file' using errcode = '22023'; end if;
  insert into public.disaster_saws_files (tenant_id, file, touches) values (p_tenant, v_file, v_touch)
  on conflict (tenant_id, file) do nothing;
  if not found then
    return (select id from public.disaster_warnings where tenant_id = p_tenant and saws_key = v_key);
  end if;

  select * into v from public.disaster_warnings where tenant_id = p_tenant and saws_key = v_key for update;

  if v_type = 'Cancel' or not v_touch then
    if v.id is null or v.status <> 'Active' then return v.id; end if;
    v_said := case when v_type = 'Cancel' then 'Cancelled by the SA Weather Service'
                   else 'The SA Weather Service no longer includes eThekwini' end;
    update public.disaster_warnings
       set status = case when v_type = 'Cancel' then 'Cancelled' else 'Ended' end, ended_at = now(), ended_reason = v_said,
           saws_files = saws_files || v_file, updated_at = now(), updated_by_name = 'SA Weather Service'
     where id = v.id;
    insert into public.disaster_warning_events (tenant_id, warning_id, by_name, text) values (p_tenant, v.id, 'SA Weather Service', v_said);
    insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
    values (p_tenant, 'EthekwiniDisaster', null, 'SA Weather Service', 'EthekwiniDisaster', 'SAWS_WARNING_ENDED', 'disaster_warnings', v.id::text, v_said);
    return v.id;
  end if;

  v_level := (f ->> 'level')::int;
  v_from := (f ->> 'valid_from')::timestamptz;
  v_until := (f ->> 'valid_until')::timestamptz;
  if v_level is null or v_level not between 1 and 10 then raise exception 'A SAWS warning has a level 1 to 10' using errcode = '22023'; end if;
  if v_from is null or v_until is null or v_until <= v_from then raise exception 'A SAWS warning needs its validity' using errcode = '22023'; end if;

  if v.id is null then
    insert into public.disaster_warnings (tenant_id, source, saws_key, saws_files, hazard, level, colour, valid_from, valid_until, areas,
                                          area_shapes, impacts, instructions, issued_at, created_by_name, updated_by_name)
    values (p_tenant, 'SA Weather Service feed', v_key, array[v_file], left(coalesce(nullif(btrim(f ->> 'hazard'), ''), 'Other'), 80),
            v_level, public.warning_colour_for(v_level), v_from, v_until, left(coalesce(nullif(btrim(f ->> 'areas'), ''), 'eThekwini'), 2000),
            case when jsonb_typeof(f -> 'area_shapes') = 'array' then f -> 'area_shapes' end,
            left(nullif(btrim(f ->> 'impacts'), ''), 4000), left(nullif(btrim(f ->> 'instructions'), ''), 4000),
            (f ->> 'issued_at')::timestamptz, 'SA Weather Service', 'SA Weather Service')
    returning * into v;
    insert into public.disaster_warning_events (tenant_id, warning_id, by_name, text)
    values (p_tenant, v.id, 'SA Weather Service', format('Issued: %s %s, Level %s', v.colour, v.hazard, v.level));
    insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
    values (p_tenant, 'EthekwiniDisaster', null, 'SA Weather Service', 'EthekwiniDisaster', 'SAWS_WARNING_RECEIVED', 'disaster_warnings', v.id::text,
            format('%s Level %s · %s', v.hazard, v.level, v_file));
    return v.id;
  end if;

  v_was := v.level;
  update public.disaster_warnings
     set level = v_level,
         colour = case when colour_by_desk then colour else public.warning_colour_for(v_level) end,
         valid_from = v_from, valid_until = v_until,
         areas = left(coalesce(nullif(btrim(f ->> 'areas'), ''), areas), 2000),
         area_shapes = case when jsonb_typeof(f -> 'area_shapes') = 'array' then f -> 'area_shapes' else area_shapes end,
         impacts = coalesce(left(nullif(btrim(f ->> 'impacts'), ''), 4000), impacts),
         instructions = coalesce(left(nullif(btrim(f ->> 'instructions'), ''), 4000), instructions),
         issued_at = coalesce((f ->> 'issued_at')::timestamptz, issued_at),
         -- SAWS putting eThekwini back on a warning it had left brings it back.
         status = case when status = 'Ended' and ended_reason = 'The SA Weather Service no longer includes eThekwini' then 'Active' else status end,
         ended_at = case when status = 'Ended' and ended_reason = 'The SA Weather Service no longer includes eThekwini' then null else ended_at end,
         ended_reason = case when status = 'Ended' and ended_reason = 'The SA Weather Service no longer includes eThekwini' then null else ended_reason end,
         saws_files = saws_files || v_file, updated_at = now(), updated_by_name = 'SA Weather Service'
   where id = v.id
  returning * into v;
  insert into public.disaster_warning_events (tenant_id, warning_id, by_name, text)
  values (p_tenant, v.id, 'SA Weather Service',
          case when v_level <> v_was then format('Updated: Level %s to Level %s', v_was, v_level) else 'Updated by the SA Weather Service' end);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (p_tenant, 'EthekwiniDisaster', null, 'SA Weather Service', 'EthekwiniDisaster', 'SAWS_WARNING_UPDATED', 'disaster_warnings', v.id::text,
          format('Level %s → %s · %s', v_was, v_level, v_file));
  return v.id;
end $$;
revoke all on function public.ingest_saws_warning(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_saws_warning(uuid, jsonb) to service_role;

/** The server notes when it last read a feed and whether it answered. Service role only. */
create or replace function public.note_feed_sync(p_tenant uuid, p_feed text, p_ok boolean, p_detail text)
returns void
language sql security definer set search_path to 'public' as $$
  insert into public.disaster_feed_state (tenant_id, feed, synced_at, ok, detail)
  values (p_tenant, p_feed, now(), p_ok, left(p_detail, 300))
  on conflict (tenant_id, feed) do update set synced_at = excluded.synced_at, ok = excluded.ok, detail = excluded.detail
$$;
revoke all on function public.note_feed_sync(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.note_feed_sync(uuid, text, boolean, text) to service_role;

-- ── Prove it ────────────────────────────────────────────────────────────────

do $$
declare f text;
begin
  if public.warning_colour_for(4) <> 'Yellow' or public.warning_colour_for(5) <> 'Orange' or public.warning_colour_for(9) <> 'Red' then
    raise exception '0116: the colours do not follow the levels';
  end if;
  foreach f in array array['record_disaster_warning(uuid, jsonb)', 'set_warning_step(uuid, text, boolean)', 'set_warning_colour(uuid, text)',
                           'end_disaster_warning(uuid, text)', 'hold_readiness_session(uuid, uuid, jsonb)',
                           'open_incident_from_warning(uuid, uuid, jsonb)', 'log_warning_sms(uuid, int, int, text)',
                           'save_councillor(uuid, jsonb)', 'import_councillors(jsonb)', 'ingest_saws_warning(uuid, jsonb)',
                           'note_feed_sync(uuid, text, boolean, text)'] loop
    if has_function_privilege('anon', 'public.' || f, 'execute') then raise exception '0116: anonymous users can run %', f; end if;
  end loop;
  if has_function_privilege('authenticated', 'public.ingest_saws_warning(uuid, jsonb)', 'execute') then
    raise exception '0116: a signed-in user could pass off a warning as from SAWS';
  end if;
  if has_table_privilege('authenticated', 'public.disaster_warnings', 'insert') or has_table_privilege('authenticated', 'public.disaster_councillors', 'update') then
    raise exception '0116: signed-in users can write the tables directly';
  end if;
end $$;

commit;
