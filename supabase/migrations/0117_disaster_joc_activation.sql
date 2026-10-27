-- ============================================================================
-- 0117 — Disaster: levels with their reasons, the JOC, and after the response
-- ============================================================================
--
-- Run after 0116.
--
-- Revision 2, sections 2, 4, 6, 9, 10 and 12:
--
--   1. Moving up a level needs at least one ticked trigger, kept on the
--      incident and in the log, so there is always a record of why
--      (disaster_level_changes). Silver records the EOC and its commander;
--      Bronze the FCP and its commander. Coming down needs a reason.
--      escalate_incident(); set_coordination_level() now goes through it.
--   2. Gold is the JOC, authorised only by a listed Disaster Management role
--      (the Principal Stand-by Officer; the Head, Deputy Head or a Senior
--      Manager of Disaster Management; the Duty Officer), with the reason.
--      Whether the person named is on today's duty roster is recorded, not
--      enforced: the JOC is never held up by a roster not yet filled in.
--   3. The checklists (set_incident_check()): the Silver checklist, the JOC's
--      activation (core team, DCM on stand-by, bulk SMS, PDMC) and its six
--      duties. JOC members (disaster_joc_members) and the JOC's daily
--      sessions (disaster_joc_sessions, kind Daily: log_joc_session()).
--   4. The incident's status for Disaster Management: Active, Stood down,
--      In recovery, Closed, and reopen (set_dm_status()). A stood-down
--      incident leaves the command board; closing with recovery tasks open
--      asks for the hand-over to be confirmed. The case itself still closes
--      the existing way (case review, 0061); this does not touch it.
--   5. The eight recovery tasks (set_recovery_task()) and the post-incident
--      review with its four sign-offs (disaster_reviews).
--   6. "In an informal settlement", for the IDP's fire figures (C73, C74).
--
-- Writes only through the functions here (SECURITY DEFINER, checked,
-- audited, on the call's timeline); nothing for anonymous users. Safe to re-run.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.disaster_joc_sessions') is null then
    raise exception 'Run 0116_disaster_warnings.sql first, then this one. Nothing was changed.';
  end if;
end $$;

-- ── 0. The lists ────────────────────────────────────────────────────────────

/** The triggers each level offers (revision 2, section 2). Bronze's first two are automatic. */
create or replace function public.disaster_level_triggers(p_level text) returns text[]
language sql immutable as $$
  select case p_level
    when 'Bronze' then array['b_emacc', 'b_sops', 'b_fcp']
    when 'Silver' then array['s_site_plan', 's_declared', 's_unified', 's_eoc']
    when 'Gold' then array['g_saws4', 'g_no_plan', 'g_strategic', 'g_many', 'g_exceeds', 'g_public', 'g_declare', 'g_event']
  end
$$;

create or replace function public.disaster_trigger_name(p text) returns text
language sql immutable as $$
  select case p
    when 'b_emacc' then 'Incident reported to EMACC'
    when 'b_sops' then 'EMACC dispatched designated services under its SOPs'
    when 'b_fcp' then 'More than one service on scene, coordinating through an FCP'
    when 's_site_plan' then 'Incident at a National Key Point or major hazard installation whose emergency plan opens an EOC'
    when 's_declared' then 'On-scene commander declares the incident is escalating or threatening to'
    when 's_unified' then 'Several agencies need a unified command at the site'
    when 's_eoc' then 'A joint EOC has been set up at or near the scene'
    when 'g_saws4' then 'SA Weather Service impact-based warning at Level 4 or higher'
    when 'g_no_plan' then 'Major incident or disaster at premises with no emergency plan or EOC'
    when 'g_strategic' then 'Strategic coordination of City resources is needed'
    when 'g_many' then 'Response needs several departments, units, clusters and external bodies'
    when 'g_exceeds' then 'Impact exceeds what those affected and responders can handle with their own resources'
    when 'g_public' then 'Public protective actions, warnings or mass evacuation are needed'
    when 'g_declare' then 'A local state of disaster may need to be declared'
    when 'g_event' then 'Pre-planned major event approved by Disaster Management'
  end
$$;

/** Who may authorise the JOC (revision 2, section 6; the 2012 plan). */
create or replace function public.joc_authoriser_roles() returns text[]
language sql immutable as $$
  select array['Principal Disaster Management Stand-by Officer', 'Head of Disaster Management', 'Deputy Head of Disaster Management',
               'Senior Manager: Disaster Management', 'Duty Officer']
$$;

/** The incident's checklists: Silver, the JOC's activation and the JOC's duties. */
create or replace function public.disaster_incident_checks() returns text[]
language sql immutable as $$
  select array['silver_emacc', 'silver_duty', 'silver_resources', 'silver_heads', 'silver_sitreps',
               'joc_core_team', 'joc_dcm', 'joc_bulk_sms', 'joc_pdmc',
               'duty_meet', 'duty_resources', 'duty_public', 'duty_pdmc', 'duty_declare', 'duty_report']
$$;

create or replace function public.disaster_check_name(p text) returns text
language sql immutable as $$
  select case p
    when 'silver_emacc' then 'EMACC notified'
    when 'silver_duty' then 'Duty Officer and Principal Stand-by Officer informed'
    when 'silver_resources' then 'Resources assessed'
    when 'silver_heads' then 'Heads of departments on standby'
    when 'silver_sitreps' then 'Sitreps flowing'
    when 'joc_core_team' then 'Core team called in'
    when 'joc_dcm' then 'Deputy City Manager on stand-by informed'
    when 'joc_bulk_sms' then 'Bulk SMS sent with the reason'
    when 'joc_pdmc' then 'Provincial Disaster Management Centre told'
    when 'duty_meet' then 'Meeting daily on the damage and each department''s progress'
    when 'duty_resources' then 'Extra services, resources and mutual aid decided'
    when 'duty_public' then 'Public protective actions decided; warnings and advisories issued'
    when 'duty_pdmc' then 'Provincial Disaster Management Centre updated'
    when 'duty_declare' then 'Need for a local disaster declaration assessed'
    when 'duty_report' then 'Reported to the Portfolio Committee, EXCO and the PDMC'
  end
$$;

/** The eight recovery tasks (revision 2, section 9). */
create or replace function public.disaster_recovery_tasks() returns text[]
language sql immutable as $$
  select array['unsafe_buildings', 'services', 'debris', 'rehoused', 'risk_reduction', 'funding', 'social_relief', 'reported']
$$;

create or replace function public.disaster_recovery_name(p text) returns text
language sql immutable as $$
  select case p
    when 'unsafe_buildings' then 'Unsafe buildings identified'
    when 'services' then 'Essential services restored'
    when 'debris' then 'Debris and waste cleared'
    when 'rehoused' then 'Displaced people rehoused from reception centres'
    when 'risk_reduction' then 'Risk reduction applied in rebuilding'
    when 'funding' then 'Recovery funding arranged'
    when 'social_relief' then 'Social relief provided to affected households'
    when 'reported' then 'Rehabilitation progress reported to PDMC and NDMC'
  end
$$;

/** The review's four sign-offs (revision 2, section 10). */
create or replace function public.disaster_review_signoffs() returns text[]
language sql immutable as $$ select array['shared', 'pdmc_ndmc', 'forum', 'director'] $$;

-- ── 1. The incident's new facts ─────────────────────────────────────────────

alter table public.disaster_call_facts
  add column if not exists fcp_commander            text check (fcp_commander is null or length(fcp_commander) <= 160),
  add column if not exists eoc_commander            text check (eoc_commander is null or length(eoc_commander) <= 160),
  add column if not exists joc_authorised_by        text check (joc_authorised_by is null or length(joc_authorised_by) <= 160),
  add column if not exists joc_authoriser_role      text check (joc_authoriser_role is null or joc_authoriser_role = any (public.joc_authoriser_roles())),
  add column if not exists joc_authoriser_on_roster boolean,
  add column if not exists joc_reason               text check (joc_reason is null or length(joc_reason) <= 500),
  -- check → { "at": time, "by": name }
  add column if not exists checks                   jsonb not null default '{}'::jsonb check (jsonb_typeof(checks) = 'object'),
  add column if not exists dm_status                text not null default 'Active' check (dm_status in ('Active', 'Stood down', 'In recovery', 'Closed')),
  add column if not exists dm_status_at             timestamptz,
  add column if not exists dm_status_by             text,
  -- task → { "state": …, "note": …, "at": time, "by": name }
  add column if not exists recovery                 jsonb not null default '{}'::jsonb check (jsonb_typeof(recovery) = 'object'),
  add column if not exists informal_settlement      boolean not null default false;

create table if not exists public.disaster_level_changes (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null default public.current_tenant(),
  silo                 public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  incident_id          uuid not null references public.incidents (id) on delete cascade,
  at                   timestamptz not null default now(),
  from_level           text not null check (from_level in ('Bronze', 'Silver', 'Gold')),
  to_level             text not null check (to_level in ('Bronze', 'Silver', 'Gold')),
  triggers             text[] not null default '{}',
  reason               text check (reason is null or length(reason) <= 500),
  place                text check (place is null or length(place) <= 200),
  commander            text check (commander is null or length(commander) <= 160),
  authorised_by        text check (authorised_by is null or length(authorised_by) <= 160),
  authoriser_role      text,
  authoriser_on_roster boolean,
  by_name              text
);
create index if not exists disaster_level_changes_incident on public.disaster_level_changes (incident_id, at);

create table if not exists public.disaster_joc_members (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default public.current_tenant(),
  silo           public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  incident_id    uuid not null references public.incidents (id) on delete cascade,
  kind           text not null check (kind in ('Internal unit', 'External agency', 'Ward councillor')),
  name           text not null check (length(name) between 2 and 160),
  representative text check (representative is null or length(representative) <= 160),
  phone          text check (phone is null or (length(phone) <= 30 and public.desk_phone_ok(phone))),
  added_at       timestamptz not null default now(),
  added_by_name  text,
  left_at        timestamptz,
  unique (incident_id, kind, name)
);

create table if not exists public.disaster_reviews (
  incident_id     uuid primary key references public.incidents (id) on delete cascade,
  tenant_id       uuid not null default public.current_tenant(),
  silo            public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  review_date     date,
  lead_reviewer   text check (lead_reviewer is null or length(lead_reviewer) <= 160),
  what_happened   text check (what_happened is null or length(what_happened) <= 4000),
  what_worked     text check (what_worked is null or length(what_worked) <= 4000),
  to_improve      text check (to_improve is null or length(to_improve) <= 4000),
  lessons         text check (lessons is null or length(lessons) <= 4000),
  recommendations text check (recommendations is null or length(recommendations) <= 4000),
  -- sign-off → { "at": time, "by": name }
  signoffs        jsonb not null default '{}'::jsonb check (jsonb_typeof(signoffs) = 'object'),
  signed_off_at   timestamptz,
  updated_at      timestamptz not null default now(),
  updated_by_name text
);

do $$
declare t text;
begin
  foreach t in array array['disaster_level_changes', 'disaster_joc_members', 'disaster_reviews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated
      using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant())', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated
      using (silo = public.current_silo() or public.is_global() or public.works_disaster_desk() or public.can_work_incident(incident_id))', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ── 2. Guards ───────────────────────────────────────────────────────────────

/**
 * A Disaster incident for its review and recovery: like
 * disaster_desk_incident() (0111), but also once the case is closed, since
 * the review and recovery go on after.
 */
create or replace function public.disaster_record_incident(p_incident_id uuid)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v public.incidents;
begin
  if not public.works_disaster_desk() then raise exception 'Only the Disaster desk does this' using errcode = '42501'; end if;
  select * into v from public.incidents where id = p_incident_id and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'Incident % not found', p_incident_id using errcode = 'P0002'; end if;
  if not (v.silo = 'EthekwiniDisaster'
          or 'EthekwiniDisaster' = any (coalesce(v.dispatched_silos, '{}'))
          or 'EthekwiniDisaster' = any (coalesce(v.tagged_silos, '{}'))) then
    raise exception '% was not sent to Disaster Management', v.incident_number using errcode = 'P0001';
  end if;
  return v;
end $$;
revoke all on function public.disaster_record_incident(uuid) from public, anon, authenticated;

-- ── 3. Levels ───────────────────────────────────────────────────────────────

/**
 * Move the incident to Bronze, Silver or Gold. Up: at least one of the
 * level's triggers (p_fields.triggers), and for Silver the EOC and its
 * commander if known (place, commander); for Gold the authoriser's role from
 * the list, their name and the reason. Down: the reason. Only an Active
 * incident moves up; a stood-down one is reopened first.
 */
create or replace function public.escalate_incident(p_incident_id uuid, p_level text, p_fields jsonb)
returns public.disaster_call_facts
language plpgsql security definer set search_path to 'public' as $$
declare
  f        jsonb := coalesce(p_fields, '{}'::jsonb);
  v        public.disaster_call_facts;
  v_inc    public.incidents;
  v_name   text;
  v_was    text;
  v_up     boolean;
  v_trig   text[] := '{}';
  v_reason text := public.desk_text(f ->> 'reason', 500);
  v_place  text := public.desk_text(f ->> 'place', 200);
  v_cmd    text := public.desk_text(f ->> 'commander', 160);
  v_role   text := public.desk_text(f ->> 'authoriser_role', 80);
  v_auth   text := public.desk_text(f ->> 'authorised_by', 160);
  v_roster boolean;
  v_what   text;
begin
  if p_level is null or p_level not in ('Bronze', 'Silver', 'Gold') then raise exception 'Choose Bronze, Silver or Gold' using errcode = '22023'; end if;
  v_inc := public.disaster_desk_incident(p_incident_id);
  v := public.disaster_facts_for(v_inc);
  if v.level = p_level then return v; end if;
  v_was := v.level;
  v_up := public.coordination_rank(p_level) > public.coordination_rank(v_was);
  v_name := public.desk_name();

  if v_up then
    if v.dm_status <> 'Active' then raise exception 'Reopen the incident first.' using errcode = 'P0001'; end if;
    if jsonb_typeof(f -> 'triggers') = 'array' then
      select coalesce(array_agg(x order by array_position(public.disaster_level_triggers(p_level), x)), '{}') into v_trig
        from (select distinct x from jsonb_array_elements_text(f -> 'triggers') x where x = any (public.disaster_level_triggers(p_level))) s;
    end if;
    if cardinality(v_trig) = 0 then raise exception 'Tick at least one reason it moves up.' using errcode = 'P0001'; end if;
    if p_level = 'Gold' then
      if v_role is null or not v_role = any (public.joc_authoriser_roles()) then
        raise exception 'Say who authorised the JOC: one of the listed roles.' using errcode = 'P0001';
      end if;
      if v_auth is null then raise exception 'Give the name of the person who authorised it.' using errcode = 'P0001'; end if;
      perform public.desk_check_name(v_auth);
      if v_reason is null then raise exception 'Say why the JOC is activated.' using errcode = 'P0001'; end if;
      -- Recorded, not enforced: is the person named on duty now as stand-by officer or duty officer?
      v_roster := exists (select 1 from public.disaster_duty d
                           where d.tenant_id = v_inc.tenant_id and now() between d.starts_at and d.ends_at
                             and lower(btrim(d.name)) = lower(v_auth)
                             and d.duty in ('Principal Disaster Management Stand-by Officer', 'MDMC Duty Officer'));
    end if;
  elsif v_reason is null then
    raise exception 'Say why it comes down a level.' using errcode = 'P0001';
  end if;

  update public.disaster_call_facts
     set level = p_level,
         highest_level = case when public.coordination_rank(p_level) > public.coordination_rank(highest_level) then p_level else highest_level end,
         level_set_at = now(), level_set_by = v_name,
         eoc_location = case when v_up and p_level = 'Silver' and v_place is not null then v_place else eoc_location end,
         eoc_commander = case when v_up and p_level = 'Silver' and v_cmd is not null then v_cmd else eoc_commander end,
         doc_activated_at = case when p_level = 'Gold' then coalesce(doc_activated_at, now()) else doc_activated_at end,
         scg_convened_at = case when p_level = 'Gold' then coalesce(scg_convened_at, now()) else scg_convened_at end,
         joc_authorised_by = case when v_up and p_level = 'Gold' then v_auth else joc_authorised_by end,
         joc_authoriser_role = case when v_up and p_level = 'Gold' then v_role else joc_authoriser_role end,
         joc_authoriser_on_roster = case when v_up and p_level = 'Gold' then v_roster else joc_authoriser_on_roster end,
         joc_reason = case when v_up and p_level = 'Gold' then v_reason else joc_reason end,
         updated_at = now(), updated_by = auth.uid(), updated_by_name = v_name
   where incident_id = v_inc.id
  returning * into v;

  insert into public.disaster_level_changes (tenant_id, incident_id, from_level, to_level, triggers, reason, place, commander,
                                             authorised_by, authoriser_role, authoriser_on_roster, by_name)
  values (v_inc.tenant_id, v_inc.id, v_was, p_level, v_trig, v_reason, case when p_level = 'Silver' then v_place end, v_cmd,
          case when p_level = 'Gold' and v_up then v_auth end, case when p_level = 'Gold' and v_up then v_role end, v_roster, v_name);

  v_what := case p_level
    when 'Gold' then 'Gold (strategic): the JOC activated at the DOC'
    when 'Silver' then 'Silver (operations): joint EOC at or near the scene'
    else 'Bronze (tactical): services coordinate at the FCP' end;
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id,
    format('[LEVEL] %s %s%s%s%s — %s',
      case when v_up then 'Raised to' else 'Stood down to' end, v_what,
      case when cardinality(v_trig) > 0
        then '. Because: ' || (select string_agg(public.disaster_trigger_name(x), '; ') from unnest(v_trig) x) else '' end,
      case when v_up and p_level = 'Gold' then format('. Authorised by %s (%s)%s', v_auth, v_role,
        case when v_roster then '' else ', not on today''s duty roster' end) else '' end,
      case when v_reason is not null then '. ' || v_reason else '' end,
      v_name),
    auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'COORDINATION_LEVEL', 'incidents', v_inc.id::text,
          format('%s · %s → %s · %s', v_inc.incident_number, v_was, p_level, array_to_string(v_trig, ', ')));
  if v_up and p_level = 'Gold' then
    perform public.notify_incident_chain(v_inc, 'incident_update', format('%s: the JOC is activated', v_inc.incident_number),
      coalesce(v.short_title, v_inc.incident_type));
  end if;
  return v;
end $$;
revoke all on function public.escalate_incident(uuid, text, jsonb) from public, anon;
grant execute on function public.escalate_incident(uuid, text, jsonb) to authenticated;

/** As 0115, through escalate_incident(): up needs its reasons, down its note. */
create or replace function public.set_coordination_level(p_incident_id uuid, p_level text, p_note text default null)
returns public.disaster_call_facts
language plpgsql security definer set search_path to 'public' as $$
begin
  return public.escalate_incident(p_incident_id, p_level, jsonb_build_object('reason', p_note));
end $$;
revoke all on function public.set_coordination_level(uuid, text, text) from public, anon;
grant execute on function public.set_coordination_level(uuid, text, text) to authenticated;

/** The FCP and EOC, and who commands each. Keys left out are kept. */
create or replace function public.set_level_places(p_incident_id uuid, p_fields jsonb)
returns public.disaster_call_facts
language plpgsql security definer set search_path to 'public' as $$
declare
  f      jsonb := coalesce(p_fields, '{}'::jsonb);
  v      public.disaster_call_facts;
  v_inc  public.incidents;
  v_name text;
begin
  v_inc := public.disaster_desk_incident(p_incident_id);
  v := public.disaster_facts_for(v_inc);
  v_name := public.desk_name();
  update public.disaster_call_facts
     set fcp_location = case when f ? 'fcp_location' then public.desk_text(f ->> 'fcp_location', 200) else fcp_location end,
         fcp_commander = case when f ? 'fcp_commander' then public.desk_text(f ->> 'fcp_commander', 160) else fcp_commander end,
         eoc_location = case when f ? 'eoc_location' then public.desk_text(f ->> 'eoc_location', 200) else eoc_location end,
         eoc_commander = case when f ? 'eoc_commander' then public.desk_text(f ->> 'eoc_commander', 160) else eoc_commander end,
         updated_at = now(), updated_by = auth.uid(), updated_by_name = v_name
   where incident_id = v_inc.id
  returning * into v;
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id, format('[DETAILS] FCP %s%s; EOC %s%s — %s',
    coalesce(v.fcp_location, '—'), coalesce(' (' || v.fcp_commander || ')', ''),
    coalesce(v.eoc_location, '—'), coalesce(' (' || v.eoc_commander || ')', ''), v_name), auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_LEVEL_PLACES', 'incidents', v_inc.id::text, v_inc.incident_number);
  return v;
end $$;
revoke all on function public.set_level_places(uuid, jsonb) from public, anon;
grant execute on function public.set_level_places(uuid, jsonb) to authenticated;

/** Tick or untick a check on the Silver checklist, the JOC's activation or its duties. */
create or replace function public.set_incident_check(p_incident_id uuid, p_key text, p_done boolean)
returns public.disaster_call_facts
language plpgsql security definer set search_path to 'public' as $$
declare
  v      public.disaster_call_facts;
  v_inc  public.incidents;
  v_name text;
begin
  if p_key is null or not p_key = any (public.disaster_incident_checks()) then raise exception 'Choose the check from the list' using errcode = '22023'; end if;
  v_inc := public.disaster_desk_incident(p_incident_id);
  v := public.disaster_facts_for(v_inc);
  if coalesce(p_done, false) = (v.checks ? p_key) then return v; end if;
  v_name := public.desk_name();
  update public.disaster_call_facts
     set checks = case when p_done then checks || jsonb_build_object(p_key, jsonb_build_object('at', now(), 'by', v_name)) else checks - p_key end,
         updated_at = now(), updated_by = auth.uid(), updated_by_name = v_name
   where incident_id = v_inc.id
  returning * into v;
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id, format('[CHECK] %s: %s — %s', public.disaster_check_name(p_key),
    case when p_done then 'done' else 'not done after all' end, v_name), auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_CHECK', 'incidents', v_inc.id::text,
          format('%s · %s: %s', v_inc.incident_number, p_key, case when p_done then 'done' else 'undone' end));
  return v;
end $$;
revoke all on function public.set_incident_check(uuid, text, boolean) from public, anon;
grant execute on function public.set_incident_check(uuid, text, boolean) to authenticated;

/** Tick "in an informal settlement" (IDP C73 and C74). */
create or replace function public.set_informal_settlement(p_incident_id uuid, p_on boolean)
returns public.disaster_call_facts
language plpgsql security definer set search_path to 'public' as $$
declare
  v      public.disaster_call_facts;
  v_inc  public.incidents;
  v_name text;
begin
  v_inc := public.disaster_desk_incident(p_incident_id);
  v := public.disaster_facts_for(v_inc);
  if v.informal_settlement = coalesce(p_on, false) then return v; end if;
  v_name := public.desk_name();
  update public.disaster_call_facts set informal_settlement = coalesce(p_on, false), updated_at = now(), updated_by = auth.uid(), updated_by_name = v_name
   where incident_id = v_inc.id returning * into v;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_INFORMAL_SETTLEMENT', 'incidents', v_inc.id::text,
          format('%s · %s', v_inc.incident_number, case when v.informal_settlement then 'in an informal settlement' else 'not in an informal settlement' end));
  return v;
end $$;
revoke all on function public.set_informal_settlement(uuid, boolean) from public, anon;
grant execute on function public.set_informal_settlement(uuid, boolean) to authenticated;

-- ── 4. The JOC ──────────────────────────────────────────────────────────────

/** Add a unit, agency or ward councillor to the JOC (again: their contact is updated). */
create or replace function public.add_joc_member(p_incident_id uuid, p_fields jsonb)
returns public.disaster_joc_members
language plpgsql security definer set search_path to 'public' as $$
declare
  f      jsonb := coalesce(p_fields, '{}'::jsonb);
  m      public.disaster_joc_members;
  v_inc  public.incidents;
  v_kind text := coalesce(f ->> 'kind', '');
  v_nm   text := public.desk_text(f ->> 'name', 160);
  v_rep  text := public.desk_text(f ->> 'representative', 160);
  v_ph   text := public.desk_text(f ->> 'phone', 30);
  v_name text;
begin
  if v_kind not in ('Internal unit', 'External agency', 'Ward councillor') then raise exception 'Choose a unit, an agency or a councillor' using errcode = '22023'; end if;
  v_inc := public.disaster_desk_incident(p_incident_id);
  if v_nm is null or length(v_nm) < 2 then raise exception 'Say which unit, agency or councillor.' using errcode = 'P0001'; end if;
  perform public.desk_check_name(v_rep);
  perform public.desk_check_phone(v_ph);
  v_name := public.desk_name();
  insert into public.disaster_joc_members (tenant_id, incident_id, kind, name, representative, phone, added_by_name)
  values (v_inc.tenant_id, v_inc.id, v_kind, v_nm, v_rep, v_ph, v_name)
  on conflict (incident_id, kind, name) do update
    set representative = coalesce(excluded.representative, disaster_joc_members.representative),
        phone = coalesce(excluded.phone, disaster_joc_members.phone), left_at = null
  returning * into m;
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id, format('[JOC] %s joins the JOC%s — %s', m.name, coalesce(': ' || m.representative, ''), v_name), auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'JOC_MEMBER', 'incidents', v_inc.id::text,
          format('%s · %s %s', v_inc.incident_number, m.kind, m.name));
  return m;
end $$;
revoke all on function public.add_joc_member(uuid, jsonb) from public, anon;
grant execute on function public.add_joc_member(uuid, jsonb) to authenticated;

create or replace function public.remove_joc_member(p_member_id uuid)
returns public.disaster_joc_members
language plpgsql security definer set search_path to 'public' as $$
declare
  m      public.disaster_joc_members;
  v_inc  public.incidents;
  v_name text;
begin
  select * into m from public.disaster_joc_members where id = p_member_id and tenant_id = public.current_tenant();
  if not found then raise exception 'That member is not there any more.' using errcode = 'P0002'; end if;
  v_inc := public.disaster_desk_incident(m.incident_id);
  if m.left_at is not null then return m; end if;
  v_name := public.desk_name();
  update public.disaster_joc_members set left_at = now() where id = m.id returning * into m;
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id, format('[JOC] %s leaves the JOC — %s', m.name, v_name), auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'JOC_MEMBER_LEFT', 'incidents', v_inc.id::text,
          format('%s · %s', v_inc.incident_number, m.name));
  return m;
end $$;
revoke all on function public.remove_joc_member(uuid) from public, anon;
grant execute on function public.remove_joc_member(uuid) to authenticated;

/** A JOC session on the incident: the damage and each department's progress. */
create or replace function public.log_joc_session(p_incident_id uuid, p_client_ref uuid, p_fields jsonb)
returns public.disaster_joc_sessions
language plpgsql security definer set search_path to 'public' as $$
declare
  f      jsonb := coalesce(p_fields, '{}'::jsonb);
  s      public.disaster_joc_sessions;
  v_inc  public.incidents;
  v_held timestamptz := coalesce(public.desk_time(f ->> 'held_at', 'When it was held'), now());
  v_note text := public.desk_text(f ->> 'notes', 4000);
  v_name text;
begin
  if p_client_ref is null then raise exception 'No reference; try again' using errcode = '22023'; end if;
  v_inc := public.disaster_desk_incident(p_incident_id);
  select * into s from public.disaster_joc_sessions where tenant_id = v_inc.tenant_id and client_ref = p_client_ref;
  if found then return s; end if;
  if v_note is null then raise exception 'Write what the JOC heard and decided.' using errcode = 'P0001'; end if;
  if v_held > now() + interval '10 minutes' then raise exception 'The session cannot be in the future.' using errcode = 'P0001'; end if;
  v_name := public.desk_name();
  insert into public.disaster_joc_sessions (tenant_id, client_ref, kind, incident_id, held_at, attended, notes, created_by, created_by_name)
  values (v_inc.tenant_id, p_client_ref, 'Daily', v_inc.id, v_held, public.desk_text(f ->> 'attended', 1000), v_note, auth.uid(), v_name)
  returning * into s;
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id, format('[JOC] Session at %s: %s — %s', to_char(v_held at time zone 'Africa/Johannesburg', 'DD Mon HH24:MI'), v_note, v_name),
          auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'JOC_SESSION', 'incidents', v_inc.id::text, v_inc.incident_number);
  return s;
end $$;
revoke all on function public.log_joc_session(uuid, uuid, jsonb) from public, anon;
grant execute on function public.log_joc_session(uuid, uuid, jsonb) to authenticated;

-- ── 5. After the response ───────────────────────────────────────────────────

/**
 * Active → Stood down or Closed; Stood down → In recovery, Closed or Active;
 * In recovery → Closed or Active; Closed → Active (reopen, at its last
 * level). A reason each time (p_fields.reason), and who decided
 * (p_fields.decided_by) if not the desk. Closing from recovery with tasks
 * still open needs p_fields.handover = true: the work is handed over on
 * purpose.
 */
create or replace function public.set_dm_status(p_incident_id uuid, p_status text, p_fields jsonb)
returns public.disaster_call_facts
language plpgsql security definer set search_path to 'public' as $$
declare
  f        jsonb := coalesce(p_fields, '{}'::jsonb);
  v        public.disaster_call_facts;
  v_inc    public.incidents;
  v_was    text;
  v_reason text := public.desk_text(f ->> 'reason', 500);
  v_by     text := public.desk_text(f ->> 'decided_by', 160);
  v_open   int;
  v_name   text;
begin
  if p_status is null or p_status not in ('Active', 'Stood down', 'In recovery', 'Closed') then raise exception 'Choose the status' using errcode = '22023'; end if;
  v_inc := public.disaster_record_incident(p_incident_id);
  v := public.disaster_facts_for(v_inc);
  v_was := v.dm_status;
  if v_was = p_status then return v; end if;
  if not ((v_was = 'Active' and p_status in ('Stood down', 'Closed'))
       or (v_was = 'Stood down' and p_status in ('In recovery', 'Closed', 'Active'))
       or (v_was = 'In recovery' and p_status in ('Closed', 'Active'))
       or (v_was = 'Closed' and p_status = 'Active')) then
    raise exception 'An incident that is % cannot go to % directly.', lower(v_was), lower(p_status) using errcode = 'P0001';
  end if;
  if v_reason is null then raise exception 'Say why.' using errcode = 'P0001'; end if;
  perform public.desk_check_name(v_by);
  if p_status = 'Closed' and v_was = 'In recovery' then
    select count(*) into v_open from unnest(public.disaster_recovery_tasks()) k
     where coalesce(v.recovery -> k ->> 'state', 'Not started') not in ('Done', 'Handed over');
    if v_open > 0 and coalesce((f ->> 'handover')::boolean, false) is not true then
      raise exception '% recovery task(s) still open. Confirm they are handed over to the departments.', v_open using errcode = 'P0001';
    end if;
  end if;
  v_name := public.desk_name();
  update public.disaster_call_facts
     set dm_status = p_status, dm_status_at = now(), dm_status_by = coalesce(v_by, v_name),
         updated_at = now(), updated_by = auth.uid(), updated_by_name = v_name
   where incident_id = v_inc.id
  returning * into v;
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id, format('[STATUS] %s: %s%s — %s',
    case when p_status = 'Active' and v_was <> 'Active' then format('Reopened at %s', v.level) else p_status end,
    v_reason, coalesce(' (decided by ' || v_by || ')', ''), v_name), auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_STATUS', 'incidents', v_inc.id::text,
          format('%s · %s → %s · %s', v_inc.incident_number, v_was, p_status, v_reason));
  return v;
end $$;
revoke all on function public.set_dm_status(uuid, text, jsonb) from public, anon;
grant execute on function public.set_dm_status(uuid, text, jsonb) to authenticated;

/** A recovery task: Not started, In progress, Done or Handed over, with a note. */
create or replace function public.set_recovery_task(p_incident_id uuid, p_task text, p_state text, p_note text default null)
returns public.disaster_call_facts
language plpgsql security definer set search_path to 'public' as $$
declare
  v      public.disaster_call_facts;
  v_inc  public.incidents;
  v_note text := public.desk_text(p_note, 500);
  v_name text;
begin
  if p_task is null or not p_task = any (public.disaster_recovery_tasks()) then raise exception 'Choose the task from the list' using errcode = '22023'; end if;
  if p_state is null or p_state not in ('Not started', 'In progress', 'Done', 'Handed over') then raise exception 'Choose how far it is' using errcode = '22023'; end if;
  v_inc := public.disaster_record_incident(p_incident_id);
  v := public.disaster_facts_for(v_inc);
  v_name := public.desk_name();
  update public.disaster_call_facts
     set recovery = recovery || jsonb_build_object(p_task, jsonb_build_object('state', p_state, 'note', v_note, 'at', now(), 'by', v_name)),
         updated_at = now(), updated_by = auth.uid(), updated_by_name = v_name
   where incident_id = v_inc.id
  returning * into v;
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id, format('[RECOVERY] %s: %s%s — %s', public.disaster_recovery_name(p_task), p_state, coalesce('. ' || v_note, ''), v_name),
          auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_RECOVERY', 'incidents', v_inc.id::text,
          format('%s · %s: %s', v_inc.incident_number, p_task, p_state));
  return v;
end $$;
revoke all on function public.set_recovery_task(uuid, text, text, text) from public, anon;
grant execute on function public.set_recovery_task(uuid, text, text, text) to authenticated;

/** The post-incident review's words. Keys left out are kept. */
create or replace function public.save_disaster_review(p_incident_id uuid, p_fields jsonb)
returns public.disaster_reviews
language plpgsql security definer set search_path to 'public' as $$
declare
  f      jsonb := coalesce(p_fields, '{}'::jsonb);
  r      public.disaster_reviews;
  v_inc  public.incidents;
  v_date date;
  v_name text;
begin
  v_inc := public.disaster_record_incident(p_incident_id);
  if coalesce(f ->> 'review_date', '') <> '' then
    if f ->> 'review_date' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'The date is YYYY-MM-DD.' using errcode = 'P0001'; end if;
    v_date := (f ->> 'review_date')::date;
    if v_date > current_date + 1 then raise exception 'The review date cannot be in the future.' using errcode = 'P0001'; end if;
  end if;
  if f ? 'lead_reviewer' then perform public.desk_check_name(f ->> 'lead_reviewer'); end if;
  v_name := public.desk_name();
  insert into public.disaster_reviews (incident_id, tenant_id, updated_by_name) values (v_inc.id, v_inc.tenant_id, v_name)
  on conflict (incident_id) do nothing;
  update public.disaster_reviews
     set review_date = case when f ? 'review_date' then v_date else review_date end,
         lead_reviewer = case when f ? 'lead_reviewer' then public.desk_text(f ->> 'lead_reviewer', 160) else lead_reviewer end,
         what_happened = case when f ? 'what_happened' then public.desk_text(f ->> 'what_happened', 4000) else what_happened end,
         what_worked = case when f ? 'what_worked' then public.desk_text(f ->> 'what_worked', 4000) else what_worked end,
         to_improve = case when f ? 'to_improve' then public.desk_text(f ->> 'to_improve', 4000) else to_improve end,
         lessons = case when f ? 'lessons' then public.desk_text(f ->> 'lessons', 4000) else lessons end,
         recommendations = case when f ? 'recommendations' then public.desk_text(f ->> 'recommendations', 4000) else recommendations end,
         updated_at = now(), updated_by_name = v_name
   where incident_id = v_inc.id
  returning * into r;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_REVIEW', 'incidents', v_inc.id::text, v_inc.incident_number);
  return r;
end $$;
revoke all on function public.save_disaster_review(uuid, jsonb) from public, anon;
grant execute on function public.save_disaster_review(uuid, jsonb) to authenticated;

/** A sign-off on the review. With all four, the review is signed off and leaves the panel. */
create or replace function public.sign_disaster_review(p_incident_id uuid, p_key text, p_done boolean)
returns public.disaster_reviews
language plpgsql security definer set search_path to 'public' as $$
declare
  r      public.disaster_reviews;
  v_inc  public.incidents;
  v_name text;
begin
  if p_key is null or not p_key = any (public.disaster_review_signoffs()) then raise exception 'Choose the sign-off from the list' using errcode = '22023'; end if;
  v_inc := public.disaster_record_incident(p_incident_id);
  select * into r from public.disaster_reviews where incident_id = v_inc.id for update;
  if not found or r.what_happened is null or r.lead_reviewer is null then
    raise exception 'Write the review first: the lead reviewer and what happened.' using errcode = 'P0001';
  end if;
  if coalesce(p_done, false) = (r.signoffs ? p_key) then return r; end if;
  v_name := public.desk_name();
  update public.disaster_reviews
     set signoffs = case when p_done then signoffs || jsonb_build_object(p_key, jsonb_build_object('at', now(), 'by', v_name)) else signoffs - p_key end,
         updated_at = now(), updated_by_name = v_name
   where incident_id = v_inc.id
  returning * into r;
  update public.disaster_reviews
     set signed_off_at = case when (select bool_and(r.signoffs ? k) from unnest(public.disaster_review_signoffs()) k) then coalesce(signed_off_at, now()) end
   where incident_id = v_inc.id
  returning * into r;
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id, format('[REVIEW] %s: %s%s — %s', p_key, case when p_done then 'signed' else 'unsigned' end,
    case when r.signed_off_at is not null then '. The review is signed off' else '' end, v_name), auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_REVIEW_SIGNOFF', 'incidents', v_inc.id::text,
          format('%s · %s: %s', v_inc.incident_number, p_key, case when p_done then 'signed' else 'unsigned' end));
  return r;
end $$;
revoke all on function public.sign_disaster_review(uuid, text, boolean) from public, anon;
grant execute on function public.sign_disaster_review(uuid, text, boolean) to authenticated;

-- ── Prove it ────────────────────────────────────────────────────────────────

do $$
declare f text;
begin
  if cardinality(public.disaster_level_triggers('Gold')) <> 8 or cardinality(public.disaster_level_triggers('Silver')) <> 4 then
    raise exception '0117: the triggers are not the process''s';
  end if;
  if cardinality(public.disaster_recovery_tasks()) <> 8 then raise exception '0117: eight recovery tasks'; end if;
  foreach f in array array['escalate_incident(uuid, text, jsonb)', 'set_level_places(uuid, jsonb)', 'set_incident_check(uuid, text, boolean)',
                           'set_informal_settlement(uuid, boolean)', 'add_joc_member(uuid, jsonb)', 'remove_joc_member(uuid)',
                           'log_joc_session(uuid, uuid, jsonb)', 'set_dm_status(uuid, text, jsonb)', 'set_recovery_task(uuid, text, text, text)',
                           'save_disaster_review(uuid, jsonb)', 'sign_disaster_review(uuid, text, boolean)'] loop
    if has_function_privilege('anon', 'public.' || f, 'execute') then raise exception '0117: anonymous users can run %', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.disaster_reviews', 'update') or has_table_privilege('authenticated', 'public.disaster_joc_members', 'insert') then
    raise exception '0117: signed-in users can write the tables directly';
  end if;
end $$;

commit;
