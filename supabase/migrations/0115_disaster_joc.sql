-- ============================================================================
-- 0115 — Disaster: the JOC and the top ten risks
-- ============================================================================
--
-- Run after 0114.
--
-- The Directorate's current process (Disaster incident management,
-- revision 2, October 2026) in place of the 2012 Plan's words where they
-- changed:
--
--   1. Gold is the Joint Operations Centre (JOC), activated at the Disaster
--      Operations Centre (DOC). The Strategic Co-ordination Group (SCG) is no
--      longer named; the monthly SCG duty chair is the JOC duty chair (the
--      table keeps its name, disaster_scg_chairs).
--   2. The DOC Commander on the duty roster is the JOC Commander. Rows that
--      say "DOC Commander" are renamed, each in the audit log.
--   3. eThekwini's top ten priority risks (IDP 2026/27) lead the hazard list.
--      The 2012 names they replace stay valid, so older records keep what
--      they say; disaster_priority_risk() counts them towards their risk.
--
-- Writes only through the functions here (SECURITY DEFINER, checked,
-- audited, on the call's timeline). Safe to re-run.
-- ============================================================================

begin;

do $$
begin
  if to_regprocedure('public.desk_phone_ok(text)') is null then
    raise exception 'Run 0114_disaster_checks.sql first, then this one. Nothing was changed.';
  end if;
end $$;

-- ── 1. The hazards: the top ten first ───────────────────────────────────────

create or replace function public.disaster_hazard_group(p text) returns text
language sql immutable as $$
  select case
    when p in ('Civil unrest and crime', 'Severe storms', 'Floods', 'Human disease', 'Fires in formal and informal settlements',
               'Critical infrastructure failure (water, electricity)', 'Hazardous materials fire or explosion (storage)',
               'Storm surge', 'Hazardous materials spill or release (transport)', 'Landslides')
      then 'Top ten priority risks'
    when p in ('Cyclone, hurricane or tornado', 'Storm tide', 'Severe storm', 'Wildfire', 'Extreme temperature', 'Drought', 'Flood')
      then 'Natural: meteorological'
    when p in ('Earthquake', 'Landslip or debris flow', 'Erosion', 'Tsunami', 'Major sinkhole')
      then 'Natural: geological'
    when p in ('Epidemic human disease', 'Animal disease', 'Insect or vermin plague', 'Food and crop disease', 'Emerging catastrophic disease')
      then 'Natural: biological'
    when p in ('Civil disturbance or riot', 'Terrorist attack', 'Arson', 'Sabotage of essential services', 'Shooting or massacre',
               'IT virus or systems compromise')
      then 'Non-natural: human caused'
    when p in ('Structural collapse', 'Failure of critical infrastructure or services', 'Hazardous materials accident',
               'Industrial accident', 'Nuclear power accident', 'Dam failure', 'Aeronautical or space', 'Structure or informal settlement fire',
               'Major transport accident')
      then 'Non-natural: technological'
    when p = 'Other' then 'Other'
  end
$$;

/** The top ten risk a hazard counts towards (the IDP figures), or null. */
create or replace function public.disaster_priority_risk(p text) returns text
language sql immutable as $$
  select case
    when public.disaster_hazard_group(p) = 'Top ten priority risks' then p
    when p = 'Flood' then 'Floods'
    when p = 'Severe storm' then 'Severe storms'
    when p = 'Storm tide' then 'Storm surge'
    when p = 'Landslip or debris flow' then 'Landslides'
    when p = 'Epidemic human disease' then 'Human disease'
    when p = 'Civil disturbance or riot' then 'Civil unrest and crime'
    when p = 'Structure or informal settlement fire' then 'Fires in formal and informal settlements'
    when p = 'Failure of critical infrastructure or services' then 'Critical infrastructure failure (water, electricity)'
  end
$$;

-- ── 2. The duty roster: the JOC Commander ───────────────────────────────────

create or replace function public.disaster_duties() returns text[]
language sql immutable as $$
  select array['Principal Disaster Management Stand-by Officer', 'MDMC Duty Officer', 'JOC Commander',
               'Disaster Management Officer', 'Stand-by Incident Logger', 'EMACC Operator', 'CCTV Operator']
$$;

with renamed as (
  update public.disaster_duty set duty = 'JOC Commander' where duty = 'DOC Commander'
  returning id, tenant_id, name
)
insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
select tenant_id, 'EthekwiniDisaster', null, 'Update 0115', 'EthekwiniDisaster', 'DISASTER_DUTY_RENAMED', 'disaster_duty', id::text,
       format('%s: DOC Commander is now called JOC Commander', name)
  from renamed;

comment on table public.disaster_scg_chairs is
  'The JOC duty chair for each calendar month: the City Manager or a Deputy City Manager on stand-by (0112; the SCG chair until 0115).';

-- ── 3. Gold activates the JOC ───────────────────────────────────────────────

/**
 * Bronze, Silver or Gold (revision 2, section 1). Gold activates the JOC at
 * the DOC; it is on the timeline, in the audit and told to the call's chain.
 * Lowering the level is allowed and said as such. As 0112 with the JOC's
 * words; doc_activated_at and scg_convened_at keep their names and now mean
 * "JOC activated" and "JOC convened".
 */
create or replace function public.set_coordination_level(p_incident_id uuid, p_level text, p_note text default null)
returns public.disaster_call_facts
language plpgsql security definer set search_path to 'public' as $$
declare
  v      public.disaster_call_facts;
  v_inc  public.incidents;
  v_name text;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
  v_was  text;
  v_what text;
begin
  if p_level not in ('Bronze', 'Silver', 'Gold') then
    raise exception 'Choose Bronze, Silver or Gold' using errcode = '22023';
  end if;
  v_inc := public.disaster_desk_incident(p_incident_id);
  v := public.disaster_facts_for(v_inc);
  if v.level = p_level then return v; end if;
  v_was := v.level;
  select full_name into v_name from public.profiles where id = auth.uid();

  update public.disaster_call_facts
     set level = p_level,
         highest_level = case when public.coordination_rank(p_level) > public.coordination_rank(highest_level) then p_level else highest_level end,
         level_set_at = now(), level_set_by = v_name,
         doc_activated_at = case when p_level = 'Gold' then coalesce(doc_activated_at, now()) else doc_activated_at end,
         scg_convened_at = case when p_level = 'Gold' then coalesce(scg_convened_at, now()) else scg_convened_at end,
         updated_at = now(), updated_by = auth.uid(), updated_by_name = v_name
   where incident_id = v_inc.id
  returning * into v;

  v_what := case p_level
    when 'Gold' then 'Gold (strategic): the JOC activated at the DOC'
    when 'Silver' then 'Silver (operations): joint EOC at or near the scene'
    else 'Bronze (tactical): services coordinate at the FCP' end;
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id,
    format('[LEVEL] %s %s%s — %s',
      case when public.coordination_rank(p_level) > public.coordination_rank(v_was) then 'Raised to' else 'Stood down to' end,
      v_what, case when v_note is not null then ': ' || v_note else '' end, coalesce(v_name, 'the Disaster desk')),
    auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'COORDINATION_LEVEL',
    'incidents', v_inc.id::text, format('%s · %s → %s', v_inc.incident_number, v_was, p_level));
  if p_level = 'Gold' then
    perform public.notify_incident_chain(v_inc, 'incident_update',
      format('%s: the JOC is activated', v_inc.incident_number),
      coalesce(v.short_title, v_inc.incident_type));
  end if;
  return v;
end $$;
revoke all on function public.set_coordination_level(uuid, text, text) from public, anon;
grant execute on function public.set_coordination_level(uuid, text, text) to authenticated;

comment on table public.disaster_call_facts is
  'A Disaster call (0112, 0115): short title, hazard, municipalities, Bronze/Silver/Gold (Gold: the JOC at the DOC). set_disaster_call() and set_coordination_level() only.';

-- ── Prove it ────────────────────────────────────────────────────────────────

do $$
begin
  if public.disaster_hazard_group('Floods') <> 'Top ten priority risks' then raise exception '0115: Floods is not a top ten risk'; end if;
  if public.disaster_hazard_group('Flood') is null then raise exception '0115: the 2012 name Flood stopped being valid'; end if;
  if public.disaster_priority_risk('Storm tide') <> 'Storm surge' then raise exception '0115: Storm tide does not count as Storm surge'; end if;
  if public.disaster_priority_risk('Hazardous materials accident') is not null then raise exception '0115: an unclear hazmat was given a risk'; end if;
  if not 'JOC Commander' = any (public.disaster_duties()) then raise exception '0115: no JOC Commander'; end if;
  if exists (select 1 from public.disaster_duty where duty = 'DOC Commander') then raise exception '0115: a DOC Commander is left'; end if;
  if has_function_privilege('anon', 'public.set_coordination_level(uuid, text, text)', 'execute') then
    raise exception '0115: anonymous users can change a level';
  end if;
end $$;

commit;
