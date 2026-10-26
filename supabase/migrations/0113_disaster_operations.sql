-- ============================================================================
-- 0113 — Disaster operations from the desk
-- ============================================================================
--
-- Run after 0112.
--
-- The eThekwini Municipal Disaster Management Plan (rev. 7 Aug 2012) puts the
-- work of a disaster on the City's line functions, co-ordinated from the
-- Municipal Disaster Management Centre. This migration lets the Disaster desk
-- run that work and keep its record:
--
--   1. Open incident: the desk opens an incident itself (a report from the
--      field, a SAWS warning, a site emergency plan), numbered as EMACC's
--      calls are. open_disaster_incident().
--   2. The departments on an incident (disaster_line_reports): only those
--      the incident needs. Each has its DOC representative, its "role during
--      disaster operations" from the Plan (each duty Done, Under way or Not
--      needed), a few figures and a note, and is Not started, In progress or
--      Done. add_ / save_ / remove_line_function().
--   3. Department contacts (disaster_department_contacts): the Plan's staff
--      resources database, the Heads, Deputy Heads and Senior Managers who
--      represent their departments at the DOC, so picking one fills in the
--      name, post and number. save_department_contact().
--   4. Sitreps with figures: injured, dead, missing, people helped, people
--      evacuated, how they were moved and where to. log_disaster_update()
--      as 0111 with those added.
--   5. Casualties (disaster_casualties): injured, deceased and missing
--      people, all fields optional, a description where a person is not
--      identified. Personal information (POPIA): kept on the desk only, read
--      through list_disaster_casualties() by the Disaster desk and command,
--      the case manager and administrators, each read in the audit log.
--   6. Shelter supplies: food, drinking water, toilets, temporary toilets
--      and toiletries at each shelter opened for an incident, and where each
--      shelter is on the map. set_shelter_services(), set_shelter_position().
--   7. SMS: each message sent to a caller or a department's manager is kept
--      with the incident (disaster_sms, log_disaster_sms()).
--
-- Writes only through the functions here; no writes from a signed-in user
-- directly; nothing for anonymous users. Safe to re-run.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.disaster_call_facts') is null then
    raise exception 'Run 0112_disaster_doc.sql first, then this one. Nothing was changed.';
  end if;
end $$;

-- The line functions (packages/db/src/disaster-departments.ts).
create or replace function public.disaster_line_functions() returns text[]
language sql immutable as $$
  select array['disaster', 'emacc', 'metro', 'fire', 'health', 'safer', 'parks', 'housing', 'fleet', 'eta', 'water',
               'electricity', 'engineering', 'waste', 'security', 'communications', 'gipo', 'dpem', 'treasury']
$$;

/** A short bit of typed text, trimmed; null when blank. */
create or replace function public.desk_text(p_value text, p_max int) returns text
language sql immutable as $$ select nullif(left(btrim(coalesce(p_value, '')), p_max), '') $$;

-- ── 1. Open incident ───────────────────────────────────────────────────────

alter table public.disaster_call_facts
  add column if not exists reported_through text
    check (reported_through is null or reported_through in ('EMACC call', 'Field report', 'SA Weather Service warning',
                                                           'Site emergency plan (NKP or MHI)', 'Other')),
  add column if not exists ward text check (ward is null or length(ward) <= 40);

/**
 * The desk opens an incident: short title, hazard, severity, municipality,
 * ward, place (with its map position), how it was reported, the first report,
 * and who reported it if known. Numbered like every call; Bronze to start.
 * The same client reference returns the incident already opened.
 */
create or replace function public.open_disaster_incident(p_client_ref uuid, p_fields jsonb)
returns public.incidents
language plpgsql security definer set search_path to 'public' as $$
declare
  f          jsonb := coalesce(p_fields, '{}'::jsonb);
  v          public.incidents;
  v_title    text := public.desk_text(p_fields ->> 'short_title', 80);
  v_hazard   text := public.desk_text(p_fields ->> 'hazard', 80);
  v_sev      text := coalesce(public.desk_text(p_fields ->> 'severity', 20), 'Medium');
  v_muni     text := coalesce(public.desk_text(p_fields ->> 'municipality', 40), 'eThekwini Metro');
  v_ward     text := public.desk_text(p_fields ->> 'ward', 40);
  v_place    text := public.desk_text(p_fields ->> 'location_address', 200);
  v_through  text := coalesce(public.desk_text(p_fields ->> 'reported_through', 60), 'EMACC call');
  v_report   text := public.desk_text(p_fields ->> 'first_report', 2000);
  v_caller   text := public.desk_text(p_fields ->> 'caller_name', 100);
  v_number   text := public.desk_text(p_fields ->> 'caller_number', 30);
  v_lat      double precision;
  v_lng      double precision;
  v_name     text;
  v_affected int := public.desk_whole(p_fields ->> 'people_affected', 'People affected');
begin
  if not public.works_disaster_desk() then raise exception 'Only the Disaster desk does this' using errcode = '42501'; end if;
  if p_client_ref is null then raise exception 'No reference; try again' using errcode = '22023'; end if;
  select * into v from public.incidents where client_ref = p_client_ref and tenant_id = public.current_tenant();
  if found then return v; end if;

  if v_title is null then raise exception 'Give the incident a short title.' using errcode = 'P0001'; end if;
  if v_hazard is null or public.disaster_hazard_group(v_hazard) is null then
    raise exception 'Choose the hazard from the list.' using errcode = 'P0001';
  end if;
  if v_sev not in ('Low', 'Medium', 'High', 'Critical') then raise exception 'Choose the severity.' using errcode = 'P0001'; end if;
  if not v_muni = any (public.disaster_municipalities()) then raise exception 'Choose the municipality from the list.' using errcode = 'P0001'; end if;
  if v_place is null then raise exception 'Say where it is.' using errcode = 'P0001'; end if;
  if jsonb_typeof(f -> 'lat') <> 'number' or jsonb_typeof(f -> 'lng') <> 'number' then
    raise exception 'Place the incident on the map.' using errcode = 'P0001';
  end if;
  v_lat := (f ->> 'lat')::double precision;
  v_lng := (f ->> 'lng')::double precision;
  if v_lat not between -90 and 90 or v_lng not between -180 and 180 then
    raise exception 'Place the incident on the map.' using errcode = 'P0001';
  end if;
  if v_through not in ('EMACC call', 'Field report', 'SA Weather Service warning', 'Site emergency plan (NKP or MHI)', 'Other') then
    raise exception 'Say how it was reported.' using errcode = 'P0001';
  end if;
  if v_report is null then raise exception 'Write the first report: what has happened.' using errcode = 'P0001'; end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.incidents (
    silo, source, incident_number, client_ref, caller_name, caller_number, call_description,
    incident_type, incident_severity, disaster_type, location_address, suburb, city, location_lat, location_lng,
    number_of_victims, status, call_timestamp, incident_created_at, call_taken_by, created_by, tagged_silos, intake_complete
  ) values (
    'EthekwiniDisaster', 'Disaster desk', public.next_incident_number('EthekwiniDisaster', array['EthekwiniDisaster']::public.silo[]),
    p_client_ref, coalesce(v_caller, v_through), coalesce(v_number, ''), v_report,
    v_hazard, v_sev::public.incident_severity, v_hazard, v_place, public.desk_text(p_fields ->> 'suburb', 100),
    case when v_muni = 'eThekwini Metro' then 'Durban' else v_muni end, v_lat, v_lng,
    nullif(v_affected, 0), 'Pending Dispatch', now(), now(), v_name, auth.uid(), array['EthekwiniDisaster']::public.silo[], true
  ) returning * into v;

  insert into public.disaster_call_facts (incident_id, tenant_id, short_title, hazard, municipalities, reported_through, ward,
                                          updated_by, updated_by_name)
  values (v.id, v.tenant_id, v_title, v_hazard, array[v_muni], v_through, v_ward, auth.uid(), v_name)
  on conflict (incident_id) do update
    set short_title = excluded.short_title, hazard = excluded.hazard, municipalities = excluded.municipalities,
        reported_through = excluded.reported_through, ward = excluded.ward;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v.silo, v.id, format('[OPENED] %s: %s, %s. Reported through %s%s — %s', v_title, v_hazard, v_place, v_through,
    case when v_affected > 0 then format(', %s people affected', v_affected) else '' end, coalesce(v_name, 'the Disaster desk')),
    auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_INCIDENT_OPENED', 'incidents',
    v.id::text, format('%s · %s · %s', v.incident_number, v_title, v_hazard));
  return v;
end $$;
revoke all on function public.open_disaster_incident(uuid, jsonb) from public, anon;
grant execute on function public.open_disaster_incident(uuid, jsonb) to authenticated;

-- ── 2. The departments on an incident ──────────────────────────────────────

create table if not exists public.disaster_line_reports (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null default public.current_tenant(),
  silo                 public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  incident_id          uuid not null references public.incidents (id) on delete cascade,
  department           text not null check (department = any (public.disaster_line_functions())),
  status               text not null default 'Not started' check (status in ('Not started', 'In progress', 'Done')),
  representative_name  text check (representative_name is null or length(representative_name) <= 160),
  representative_post  text check (representative_post is null or length(representative_post) <= 120),
  representative_phone text check (representative_phone is null or length(representative_phone) <= 60),
  at_doc               boolean not null default false,
  duties               jsonb not null default '{}'::jsonb,
  figures              jsonb not null default '{}'::jsonb,
  notes                text check (notes is null or length(notes) <= 2000),
  added_at             timestamptz not null default now(),
  added_by_name        text,
  updated_at           timestamptz not null default now(),
  updated_by_name      text,
  done_at              timestamptz,
  unique (incident_id, department)
);
comment on table public.disaster_line_reports is
  'A line function''s part on a Disaster incident (0113): its DOC representative, its role from the Plan, figures, status.';

create or replace function public.add_line_function(p_incident_id uuid, p_department text)
returns public.disaster_line_reports
language plpgsql security definer set search_path to 'public' as $$
declare
  v      public.disaster_line_reports;
  v_inc  public.incidents;
  v_name text;
begin
  if not p_department = any (public.disaster_line_functions()) then
    raise exception 'Choose the department from the list.' using errcode = 'P0001';
  end if;
  v_inc := public.disaster_desk_incident(p_incident_id);
  select * into v from public.disaster_line_reports where incident_id = v_inc.id and department = p_department;
  if found then return v; end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.disaster_line_reports (tenant_id, incident_id, department, added_by_name, updated_by_name)
  values (v_inc.tenant_id, v_inc.id, p_department, v_name, v_name) returning * into v;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'LINE_FUNCTION_ADDED', 'disaster_line_reports',
    v.id::text, format('%s · %s', v_inc.incident_number, p_department));
  return v;
end $$;
revoke all on function public.add_line_function(uuid, text) from public, anon;
grant execute on function public.add_line_function(uuid, text) to authenticated;

/** Take a department off an incident, only while nothing has been recorded for it. */
create or replace function public.remove_line_function(p_incident_id uuid, p_department text)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v      public.disaster_line_reports;
  v_inc  public.incidents;
  v_name text;
begin
  v_inc := public.disaster_desk_incident(p_incident_id);
  select * into v from public.disaster_line_reports where incident_id = v_inc.id and department = p_department for update;
  if not found then return; end if;
  if v.status <> 'Not started' then
    raise exception 'Something is recorded for this department. Mark its duties Not needed instead.' using errcode = 'P0001';
  end if;
  delete from public.disaster_line_reports where id = v.id;
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'LINE_FUNCTION_REMOVED', 'disaster_line_reports',
    v.id::text, format('%s · %s', v_inc.incident_number, p_department));
end $$;
revoke all on function public.remove_line_function(uuid, text) from public, anon;
grant execute on function public.remove_line_function(uuid, text) to authenticated;

/**
 * Save a department's part: representative (name, post, phone, at the DOC),
 * duties ({"0": "Done", "3": "Under way", "5": "Not needed"}, by their place
 * in the Plan's list), figures ({"roads_closed": 4}), notes, and whether it is
 * done. The status follows: Done when marked done, In progress once anything
 * is recorded.
 */
create or replace function public.save_line_report(p_incident_id uuid, p_department text, p_fields jsonb)
returns public.disaster_line_reports
language plpgsql security definer set search_path to 'public' as $$
declare
  f        jsonb := coalesce(p_fields, '{}'::jsonb);
  v        public.disaster_line_reports;
  v_inc    public.incidents;
  v_name   text;
  v_duties jsonb := '{}'::jsonb;
  v_figs   jsonb := '{}'::jsonb;
  v_k      text;
  v_val    text;
  v_done   boolean := jsonb_typeof(f -> 'done') = 'boolean' and (f ->> 'done')::boolean;
  v_was    text;
begin
  v_inc := public.disaster_desk_incident(p_incident_id);
  perform public.add_line_function(p_incident_id, p_department);
  select * into v from public.disaster_line_reports where incident_id = v_inc.id and department = p_department for update;
  v_was := v.status;
  if jsonb_typeof(f -> 'duties') = 'object' then
    for v_k, v_val in select key, value from jsonb_each_text(f -> 'duties') loop
      if v_k !~ '^[0-9]{1,2}$' then continue; end if;
      if v_val not in ('Done', 'Under way', 'Not needed') then
        raise exception 'Mark each duty Done, Under way or Not needed.' using errcode = 'P0001';
      end if;
      v_duties := v_duties || jsonb_build_object(v_k, v_val);
    end loop;
  else
    v_duties := v.duties;
  end if;
  if jsonb_typeof(f -> 'figures') = 'object' then
    for v_k, v_val in select key, value from jsonb_each_text(f -> 'figures') loop
      if v_k !~ '^[a-z_]{1,40}$' or coalesce(v_val, '') = '' then continue; end if;
      v_figs := v_figs || jsonb_build_object(v_k, public.desk_whole(v_val, 'Figures'));
    end loop;
  else
    v_figs := v.figures;
  end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  update public.disaster_line_reports
     set representative_name = case when f ? 'representative_name' then public.desk_text(f ->> 'representative_name', 160) else representative_name end,
         representative_post = case when f ? 'representative_post' then public.desk_text(f ->> 'representative_post', 120) else representative_post end,
         representative_phone = case when f ? 'representative_phone' then public.desk_text(f ->> 'representative_phone', 60) else representative_phone end,
         at_doc = case when jsonb_typeof(f -> 'at_doc') = 'boolean' then (f ->> 'at_doc')::boolean else at_doc end,
         duties = v_duties, figures = v_figs,
         notes = case when f ? 'notes' then public.desk_text(f ->> 'notes', 2000) else notes end,
         status = case when v_done then 'Done' else 'In progress' end,
         done_at = case when v_done then coalesce(done_at, now()) else null end,
         updated_at = now(), updated_by_name = v_name
   where id = v.id returning * into v;
  if v.status is distinct from v_was and v.status = 'Done' then
    insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
    values (v_inc.silo, v_inc.id, format('[DEPARTMENT] %s: report done%s — %s', p_department,
      case when v.representative_name is not null then format(' (%s)', v.representative_name) else '' end, coalesce(v_name, 'the Disaster desk')),
      auth.uid(), v_name);
  end if;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'LINE_REPORT_SAVED', 'disaster_line_reports',
    v.id::text, format('%s · %s · %s', v_inc.incident_number, p_department, v.status));
  return v;
end $$;
revoke all on function public.save_line_report(uuid, text, jsonb) from public, anon;
grant execute on function public.save_line_report(uuid, text, jsonb) to authenticated;

-- ── 3. Department contacts ─────────────────────────────────────────────────

create table if not exists public.disaster_department_contacts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant(),
  silo        public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  department  text not null check (department = any (public.disaster_line_functions())),
  name        text not null check (length(name) between 1 and 160),
  post        text check (post is null or length(post) <= 120),
  phone       text check (phone is null or length(phone) <= 60),
  email       text check (email is null or length(email) <= 160),
  doc_rep     boolean not null default false,
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by_name text
);
comment on table public.disaster_department_contacts is
  'The Plan''s staff resources database (0113): Heads, Deputy Heads and Senior Managers who represent their departments at the DOC.';
create index if not exists disaster_department_contacts_dept on public.disaster_department_contacts (tenant_id, department) where is_active;

create or replace function public.save_department_contact(p_id uuid, p_fields jsonb)
returns public.disaster_department_contacts
language plpgsql security definer set search_path to 'public' as $$
declare
  f      jsonb := coalesce(p_fields, '{}'::jsonb);
  v      public.disaster_department_contacts;
  v_dept text := btrim(coalesce(p_fields ->> 'department', ''));
  v_nm   text := public.desk_text(p_fields ->> 'name', 160);
  v_who  text;
begin
  if not public.works_disaster_desk() then raise exception 'Only the Disaster desk does this' using errcode = '42501'; end if;
  if not v_dept = any (public.disaster_line_functions()) then raise exception 'Choose the department from the list.' using errcode = 'P0001'; end if;
  if v_nm is null then raise exception 'Give the person''s name.' using errcode = 'P0001'; end if;
  select full_name into v_who from public.profiles where id = auth.uid();
  if p_id is null then
    insert into public.disaster_department_contacts (tenant_id, department, name) values (public.current_tenant(), v_dept, v_nm) returning * into v;
  else
    select * into v from public.disaster_department_contacts where id = p_id and tenant_id = public.current_tenant() for update;
    if not found then raise exception 'Contact not found' using errcode = 'P0002'; end if;
  end if;
  update public.disaster_department_contacts
     set department = v_dept, name = v_nm, post = public.desk_text(f ->> 'post', 120), phone = public.desk_text(f ->> 'phone', 60),
         email = public.desk_text(f ->> 'email', 160),
         doc_rep = case when jsonb_typeof(f -> 'doc_rep') = 'boolean' then (f ->> 'doc_rep')::boolean else doc_rep end,
         is_active = case when jsonb_typeof(f -> 'is_active') = 'boolean' then (f ->> 'is_active')::boolean else is_active end,
         updated_at = now(), updated_by_name = v_who
   where id = v.id returning * into v;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v.tenant_id, 'EthekwiniDisaster', auth.uid(), v_who, 'EthekwiniDisaster', 'DEPARTMENT_CONTACT_SAVED', 'disaster_department_contacts',
    v.id::text, format('%s · %s · %s', v.department, v.name, coalesce(v.post, '')));
  return v;
end $$;
revoke all on function public.save_department_contact(uuid, jsonb) from public, anon;
grant execute on function public.save_department_contact(uuid, jsonb) to authenticated;

-- ── 4. Sitreps with figures ────────────────────────────────────────────────

alter table public.disaster_desk_updates
  add column if not exists figures  jsonb not null default '{}'::jsonb,
  add column if not exists moved_by text check (moved_by is null or moved_by in
    ('On foot', 'City Fleet bus', 'Municipal vehicle', 'Ambulance', 'Boat', 'Helicopter', 'Own transport', 'Other')),
  add column if not exists moved_to text check (moved_to is null or length(moved_to) <= 200);

/** The sitrep's figures: each a whole number, the total so far as reported. */
create or replace function public.desk_figures(p jsonb) returns jsonb
language plpgsql immutable as $$
declare
  k text;
  v jsonb := '{}'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return v; end if;
  foreach k in array array['injured', 'dead', 'missing', 'people_helped', 'people_evacuated', 'people_affected',
                           'households_affected', 'homes_destroyed', 'homes_damaged'] loop
    if coalesce(p ->> k, '') <> '' then v := v || jsonb_build_object(k, public.desk_whole(p ->> k, 'Figures')); end if;
  end loop;
  return v;
end $$;

-- As 0111, with the changes marked "0113": the figures, how people were moved and where to.
create or replace function public.log_disaster_update(p_incident_id uuid, p_client_ref uuid, p_fields jsonb)
returns public.disaster_desk_updates
language plpgsql security definer set search_path to 'public' as $$
declare
  f        jsonb := coalesce(p_fields, '{}'::jsonb);
  v        public.disaster_desk_updates;
  v_inc    public.incidents;
  v_call   public.disaster_callouts;
  v_source text := btrim(coalesce(p_fields ->> 'source', ''));
  v_text   text := nullif(btrim(coalesce(p_fields ->> 'text', '')), '');
  v_from   text := nullif(left(btrim(coalesce(p_fields ->> 'from_name', '')), 200), '');
  v_figs   jsonb := public.desk_figures(p_fields -> 'figures');
  v_by     text := public.desk_text(p_fields ->> 'moved_by', 40);
  v_to     text := public.desk_text(p_fields ->> 'moved_to', 200);
  v_said   text;
  v_name   text;
begin
  if p_client_ref is null then
    raise exception 'The update has no reference; try again' using errcode = '22023';
  end if;
  v_inc := public.disaster_desk_incident(p_incident_id);
  select * into v from public.disaster_desk_updates
   where tenant_id = v_inc.tenant_id and client_ref = p_client_ref;
  if found then return v; end if;

  if v_source not in ('Call', 'Radio', 'WhatsApp', 'Other') then
    raise exception 'Say how it came in: call, radio, WhatsApp or other.' using errcode = 'P0001';
  end if;
  -- 0113: figures alone are a sitrep too.
  if v_text is null and v_figs = '{}'::jsonb and v_to is null then raise exception 'Write what they said.' using errcode = 'P0001'; end if;
  if length(v_text) > 2000 then raise exception 'Keep an update under 2000 characters.' using errcode = 'P0001'; end if;
  if v_by is not null and v_by not in ('On foot', 'City Fleet bus', 'Municipal vehicle', 'Ambulance', 'Boat', 'Helicopter', 'Own transport', 'Other') then
    raise exception 'Choose how people were moved from the list.' using errcode = 'P0001';
  end if;
  if coalesce(f ->> 'callout_id', '') ~ '^[0-9a-fA-F-]{36}$' then
    select * into v_call from public.disaster_callouts
     where id = (f ->> 'callout_id')::uuid and incident_id = v_inc.id;
    if not found then raise exception 'That partner was not called out to this call.' using errcode = 'P0001'; end if;
    v_from := v_call.agency_name;
  end if;
  select string_agg(format('%s %s', value, replace(key, '_', ' ')), ', ' order by key) into v_said from jsonb_each_text(v_figs);
  v_text := coalesce(v_text, concat_ws('. ', v_said, case when v_to is not null then 'Moved to ' || v_to end));

  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.disaster_desk_updates (tenant_id, incident_id, client_ref, source, from_name, callout_id, text, figures,
                                            moved_by, moved_to, logged_by, logged_by_name)
  values (v_inc.tenant_id, v_inc.id, p_client_ref, v_source, v_from, v_call.id, v_text, v_figs, v_by, v_to, auth.uid(), v_name)
  returning * into v;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id,
    format('[UPDATE · %s%s] %s%s%s — logged by %s', v.source, case when v.from_name is not null then ' · ' || v.from_name else '' end,
      v.text, case when v_said is not null and v.text <> v_said then ' (' || v_said || ')' else '' end,
      case when v_to is not null then format(' · moved %sto %s', case when v_by is not null then lower(v_by) || ' ' else '' end, v_to) else '' end,
      coalesce(v_name, 'the Disaster desk')),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_UPDATE',
    'disaster_desk_updates', v.id::text, format('%s · by %s%s', v_inc.incident_number, v.source,
      case when v.from_name is not null then ' from ' || v.from_name else '' end));

  return v;
end $$;
revoke all on function public.log_disaster_update(uuid, uuid, jsonb) from public, anon;
grant execute on function public.log_disaster_update(uuid, uuid, jsonb) to authenticated;

-- ── 5. Casualties ──────────────────────────────────────────────────────────

create table if not exists public.disaster_casualties (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default public.current_tenant(),
  silo          public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  incident_id   uuid not null references public.incidents (id) on delete cascade,
  client_ref    uuid,
  kind          text not null check (kind in ('Injured', 'Deceased', 'Missing')),
  name          text check (name is null or length(name) <= 160),
  phone         text check (phone is null or length(phone) <= 60),
  address       text check (address is null or length(address) <= 300),
  gender        text check (gender is null or gender in ('Female', 'Male', 'Unknown')),
  age           text check (age is null or length(age) <= 30),
  description   text check (description is null or length(description) <= 1000),
  condition     text check (condition is null or length(condition) <= 300),
  taken_to      text check (taken_to is null or length(taken_to) <= 200),
  notes         text check (notes is null or length(notes) <= 1000),
  recorded_by   uuid not null default auth.uid(),
  recorded_by_name text,
  recorded_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by_name text
);
comment on table public.disaster_casualties is
  'Injured, deceased and missing people on a Disaster incident (0113). Personal information: read only through list_disaster_casualties(), which audits each read.';
create unique index if not exists disaster_casualties_client_ref on public.disaster_casualties (tenant_id, client_ref) where client_ref is not null;
create index if not exists disaster_casualties_incident on public.disaster_casualties (incident_id, recorded_at);

/** Who may see casualties' personal details: the Disaster desk and command, case review, administrators. */
create or replace function public.may_see_casualties() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.works_disaster_desk() or public.role_in('CaseManager', 'SystemController', 'SystemAdmin', 'SuperAdmin')
$$;
revoke all on function public.may_see_casualties() from public, anon;
grant execute on function public.may_see_casualties() to authenticated;

create or replace function public.desk_casualty_fields(p jsonb, v public.disaster_casualties)
returns public.disaster_casualties language plpgsql immutable as $$
begin
  if p ? 'kind' then v.kind := btrim(coalesce(p ->> 'kind', '')); end if;
  if p ? 'name' then v.name := public.desk_text(p ->> 'name', 160); end if;
  if p ? 'phone' then v.phone := public.desk_text(p ->> 'phone', 60); end if;
  if p ? 'address' then v.address := public.desk_text(p ->> 'address', 300); end if;
  if p ? 'gender' then v.gender := public.desk_text(p ->> 'gender', 20); end if;
  if p ? 'age' then v.age := public.desk_text(p ->> 'age', 30); end if;
  if p ? 'description' then v.description := public.desk_text(p ->> 'description', 1000); end if;
  if p ? 'condition' then v.condition := public.desk_text(p ->> 'condition', 300); end if;
  if p ? 'taken_to' then v.taken_to := public.desk_text(p ->> 'taken_to', 200); end if;
  if p ? 'notes' then v.notes := public.desk_text(p ->> 'notes', 1000); end if;
  if v.kind not in ('Injured', 'Deceased', 'Missing') then raise exception 'Choose injured, deceased or missing.' using errcode = 'P0001'; end if;
  if v.gender is not null and v.gender not in ('Female', 'Male', 'Unknown') then raise exception 'Choose female, male or unknown.' using errcode = 'P0001'; end if;
  return v;
end $$;

/** Record a person injured, deceased or missing. Everything but the kind is optional. */
create or replace function public.record_disaster_casualty(p_incident_id uuid, p_client_ref uuid, p_fields jsonb)
returns public.disaster_casualties
language plpgsql security definer set search_path to 'public' as $$
declare
  v      public.disaster_casualties;
  v_inc  public.incidents;
  v_name text;
begin
  if p_client_ref is null then raise exception 'No reference; try again' using errcode = '22023'; end if;
  v_inc := public.disaster_desk_incident(p_incident_id);
  select * into v from public.disaster_casualties where tenant_id = v_inc.tenant_id and client_ref = p_client_ref;
  if found then return v; end if;
  v := public.desk_casualty_fields(coalesce(p_fields, '{}'::jsonb), v);
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.disaster_casualties (tenant_id, incident_id, client_ref, kind, name, phone, address, gender, age, description,
    condition, taken_to, notes, recorded_by, recorded_by_name, updated_by_name)
  values (v_inc.tenant_id, v_inc.id, p_client_ref, v.kind, v.name, v.phone, v.address, v.gender, v.age, v.description,
    v.condition, v.taken_to, v.notes, auth.uid(), v_name, v_name)
  returning * into v;
  -- The timeline says only that someone was recorded, never who.
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id, format('[CASUALTY] One person recorded as %s — %s', lower(v.kind), coalesce(v_name, 'the Disaster desk')),
          auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'CASUALTY_RECORDED', 'disaster_casualties',
    v.id::text, format('%s · %s', v_inc.incident_number, v.kind));
  return v;
end $$;
revoke all on function public.record_disaster_casualty(uuid, uuid, jsonb) from public, anon;
grant execute on function public.record_disaster_casualty(uuid, uuid, jsonb) to authenticated;

/** Correct a casualty record (a person identified, taken to hospital, found). */
create or replace function public.update_disaster_casualty(p_id uuid, p_fields jsonb)
returns public.disaster_casualties
language plpgsql security definer set search_path to 'public' as $$
declare
  v      public.disaster_casualties;
  v_was  text;
  v_inc  public.incidents;
  v_name text;
begin
  select * into v from public.disaster_casualties where id = p_id and tenant_id = public.current_tenant();
  if not found then raise exception 'Record not found' using errcode = 'P0002'; end if;
  v_inc := public.disaster_desk_incident(v.incident_id);
  select * into v from public.disaster_casualties where id = p_id for update;
  v_was := v.kind;
  v := public.desk_casualty_fields(coalesce(p_fields, '{}'::jsonb), v);
  select full_name into v_name from public.profiles where id = auth.uid();
  update public.disaster_casualties
     set kind = v.kind, name = v.name, phone = v.phone, address = v.address, gender = v.gender, age = v.age,
         description = v.description, condition = v.condition, taken_to = v.taken_to, notes = v.notes,
         updated_at = now(), updated_by_name = v_name
   where id = v.id returning * into v;
  if v.kind <> v_was then
    insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
    values (v_inc.silo, v_inc.id, format('[CASUALTY] One person now recorded as %s (was %s) — %s', lower(v.kind), lower(v_was),
      coalesce(v_name, 'the Disaster desk')), auth.uid(), v_name);
  end if;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'CASUALTY_UPDATED', 'disaster_casualties',
    v.id::text, format('%s · %s', v_inc.incident_number, v.kind));
  return v;
end $$;
revoke all on function public.update_disaster_casualty(uuid, jsonb) from public, anon;
grant execute on function public.update_disaster_casualty(uuid, jsonb) to authenticated;

/** The casualties on an incident, for those who may see them; each read is in the audit log. */
create or replace function public.list_disaster_casualties(p_incident_id uuid)
returns setof public.disaster_casualties
language plpgsql security definer set search_path to 'public' as $$
declare
  v_inc  public.incidents;
  v_name text;
begin
  if not public.may_see_casualties() then
    raise exception 'Casualty details are kept for the Disaster desk and command' using errcode = '42501';
  end if;
  select * into v_inc from public.incidents where id = p_incident_id and tenant_id = public.current_tenant();
  if not found then raise exception 'Incident not found' using errcode = 'P0002'; end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  -- One line per person, incident and ten minutes: a refreshing screen does not flood the log.
  if not exists (select 1 from public.audit_logs a
                  where a.action_type = 'CASUALTIES_VIEWED' and a.user_id = auth.uid() and a.entity_id = v_inc.id::text
                    and a.timestamp > now() - interval '10 minutes') then
    insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
    values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'CASUALTIES_VIEWED', 'incidents',
      v_inc.id::text, v_inc.incident_number);
  end if;
  return query select * from public.disaster_casualties c where c.incident_id = v_inc.id order by c.recorded_at;
end $$;
revoke all on function public.list_disaster_casualties(uuid) from public, anon;
grant execute on function public.list_disaster_casualties(uuid) to authenticated;

/** The counts anyone working the incident may see. */
create or replace function public.disaster_casualty_counts(p_incident_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'injured', count(*) filter (where kind = 'Injured'),
    'deceased', count(*) filter (where kind = 'Deceased'),
    'missing', count(*) filter (where kind = 'Missing'))
  from public.disaster_casualties c
  where c.incident_id = p_incident_id and c.tenant_id = public.current_tenant()
$$;
revoke all on function public.disaster_casualty_counts(uuid) from public, anon;
grant execute on function public.disaster_casualty_counts(uuid) to authenticated;

-- ── 6. Shelter supplies and positions ──────────────────────────────────────

alter table public.disaster_shelter_openings
  add column if not exists food        text check (food is null or food in ('Enough', 'Running low', 'None')),
  add column if not exists toiletries  text check (toiletries is null or toiletries in ('Enough', 'Running low', 'None')),
  add column if not exists water       text check (water is null or water in ('Mains', 'Water tanker', 'Bottled', 'None')),
  add column if not exists toilets     int not null default 0 check (toilets between 0 and 10000),
  add column if not exists temporary_toilets int not null default 0 check (temporary_toilets between 0 and 10000),
  add column if not exists services_at timestamptz;
alter table public.disaster_shelters
  add column if not exists lat double precision,
  add column if not exists lng double precision;

create or replace function public.set_shelter_services(p_opening_id uuid, p_fields jsonb)
returns public.disaster_shelter_openings
language plpgsql security definer set search_path to 'public' as $$
declare
  f      jsonb := coalesce(p_fields, '{}'::jsonb);
  v      public.disaster_shelter_openings;
  v_inc  public.incidents;
  v_hall public.disaster_shelters;
  v_name text;
begin
  select * into v from public.disaster_shelter_openings where id = p_opening_id and tenant_id = public.current_tenant();
  if not found then raise exception 'Shelter not found' using errcode = 'P0002'; end if;
  v_inc := public.disaster_desk_incident(v.incident_id);
  if v.closed_at is not null then raise exception 'This shelter is closed for the incident.' using errcode = 'P0001'; end if;
  if coalesce(f ->> 'food', '') not in ('', 'Enough', 'Running low', 'None')
     or coalesce(f ->> 'toiletries', '') not in ('', 'Enough', 'Running low', 'None') then
    raise exception 'Say enough, running low or none.' using errcode = 'P0001';
  end if;
  if coalesce(f ->> 'water', '') not in ('', 'Mains', 'Water tanker', 'Bottled', 'None') then
    raise exception 'Choose where the drinking water comes from.' using errcode = 'P0001';
  end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  update public.disaster_shelter_openings
     set food = case when f ? 'food' then nullif(f ->> 'food', '') else food end,
         toiletries = case when f ? 'toiletries' then nullif(f ->> 'toiletries', '') else toiletries end,
         water = case when f ? 'water' then nullif(f ->> 'water', '') else water end,
         toilets = case when f ? 'toilets' then public.desk_whole(f ->> 'toilets', 'Toilets') else toilets end,
         temporary_toilets = case when f ? 'temporary_toilets' then public.desk_whole(f ->> 'temporary_toilets', 'Temporary toilets') else temporary_toilets end,
         services_at = now()
   where id = v.id returning * into v;
  select * into v_hall from public.disaster_shelters where id = v.shelter_id;
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id, format('[SHELTER] %s supplies: food %s, drinking water %s, toilets %s, temporary toilets %s, toiletries %s — %s',
    v_hall.name, lower(coalesce(v.food, 'not said')), lower(coalesce(v.water, 'not said')), v.toilets, v.temporary_toilets,
    lower(coalesce(v.toiletries, 'not said')), coalesce(v_name, 'the Disaster desk')), auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'SHELTER_SUPPLIES', 'disaster_shelter_openings',
    v.id::text, format('%s · %s', v_inc.incident_number, v_hall.name));
  return v;
end $$;
revoke all on function public.set_shelter_services(uuid, jsonb) from public, anon;
grant execute on function public.set_shelter_services(uuid, jsonb) to authenticated;

/** Where a shelter is, from its address on the map. */
create or replace function public.set_shelter_position(p_id uuid, p_lat double precision, p_lng double precision)
returns public.disaster_shelters
language plpgsql security definer set search_path to 'public' as $$
declare
  v public.disaster_shelters;
begin
  if not public.works_disaster_desk() then raise exception 'Only the Disaster desk does this' using errcode = '42501'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng is null or p_lng not between -180 and 180) then
    raise exception 'That is not a place on the map.' using errcode = '22023';
  end if;
  update public.disaster_shelters set lat = p_lat, lng = case when p_lat is null then null else p_lng end
   where id = p_id and tenant_id = public.current_tenant() returning * into v;
  if not found then raise exception 'Shelter not found' using errcode = 'P0002'; end if;
  return v;
end $$;
revoke all on function public.set_shelter_position(uuid, double precision, double precision) from public, anon;
grant execute on function public.set_shelter_position(uuid, double precision, double precision) to authenticated;

-- ── 7. SMS ─────────────────────────────────────────────────────────────────

create table if not exists public.disaster_sms (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant(),
  silo        public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  to_name     text check (to_name is null or length(to_name) <= 160),
  to_number   text not null check (length(to_number) between 3 and 30),
  body        text not null check (length(body) between 1 and 640),
  status      text not null check (status in ('Sent', 'Failed', 'Not set up')),
  detail      text check (detail is null or length(detail) <= 300),
  sent_by     uuid not null default auth.uid(),
  sent_by_name text,
  sent_at     timestamptz not null default now()
);
comment on table public.disaster_sms is 'SMS sent from the Disaster desk about an incident (0113), and whether it went.';
create index if not exists disaster_sms_incident on public.disaster_sms (incident_id, sent_at);

/** Keep an SMS the desk sent (or tried to). At most 60 an hour per incident. */
create or replace function public.log_disaster_sms(p_incident_id uuid, p_fields jsonb)
returns public.disaster_sms
language plpgsql security definer set search_path to 'public' as $$
declare
  f      jsonb := coalesce(p_fields, '{}'::jsonb);
  v      public.disaster_sms;
  v_inc  public.incidents;
  v_name text;
  v_st   text := btrim(coalesce(p_fields ->> 'status', ''));
begin
  v_inc := public.disaster_desk_incident(p_incident_id);
  if v_st not in ('Sent', 'Failed', 'Not set up') then raise exception 'Unknown SMS status' using errcode = '22023'; end if;
  if (select count(*) from public.disaster_sms s where s.incident_id = v_inc.id and s.sent_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many SMS on this incident in the last hour. Call instead.' using errcode = 'P0001';
  end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.disaster_sms (tenant_id, incident_id, to_name, to_number, body, status, detail, sent_by, sent_by_name)
  values (v_inc.tenant_id, v_inc.id, public.desk_text(f ->> 'to_name', 160), left(btrim(coalesce(f ->> 'to_number', '')), 30),
          left(btrim(coalesce(f ->> 'body', '')), 640), v_st, public.desk_text(f ->> 'detail', 300), auth.uid(), v_name)
  returning * into v;
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id, format('[SMS] %s to %s: %s — %s', case v_st when 'Sent' then 'Sent' else 'Not sent' end,
    coalesce(v.to_name, v.to_number), v.body, coalesce(v_name, 'the Disaster desk')), auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_SMS', 'disaster_sms',
    v.id::text, format('%s · %s · %s', v_inc.incident_number, coalesce(v.to_name, v.to_number), v_st));
  return v;
end $$;
revoke all on function public.log_disaster_sms(uuid, jsonb) from public, anon;
grant execute on function public.log_disaster_sms(uuid, jsonb) to authenticated;

-- ── Walls: tenant, who reads, no direct writes ─────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['disaster_line_reports', 'disaster_department_contacts', 'disaster_sms'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to authenticated
      using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant())', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated
      using (silo = public.current_silo() or public.is_global() or public.works_disaster_desk()
             or public.role_in(''CaseManager'', ''SystemController''))', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Casualties: no reads from the table at all; list_disaster_casualties() only.
alter table public.disaster_casualties enable row level security;
drop policy if exists tenant_isolation on public.disaster_casualties;
create policy tenant_isolation on public.disaster_casualties as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
revoke all on public.disaster_casualties from anon, authenticated;

create or replace function public.guard_disaster_sms() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  raise exception 'A sent SMS stays on record.' using errcode = 'P0001';
end $$;
drop trigger if exists guard_disaster_sms on public.disaster_sms;
create trigger guard_disaster_sms before update or delete on public.disaster_sms
  for each row execute function public.guard_disaster_sms();

-- ── Prove it ───────────────────────────────────────────────────────────────

do $$
declare
  v_bad text;
  v_tables text[] := array['disaster_line_reports', 'disaster_department_contacts', 'disaster_sms', 'disaster_casualties'];
begin
  select string_agg(t, ', ') into v_bad from unnest(v_tables) t
   where not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t
                      and p.policyname = 'tenant_isolation' and p.permissive = 'RESTRICTIVE');
  if v_bad is not null then raise exception 'No tenant wall on: % — nothing was changed', v_bad; end if;
  select string_agg(tablename || '.' || policyname, ', ') into v_bad from pg_policies
   where schemaname = 'public' and tablename = any (v_tables) and permissive = 'PERMISSIVE' and cmd <> 'SELECT';
  if v_bad is not null then raise exception 'Write policies found on %: nothing was changed', v_bad; end if;
  if has_table_privilege('authenticated', 'public.disaster_casualties', 'select') then
    raise exception 'Casualties are readable directly: nothing was changed';
  end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('open_disaster_incident', 'add_line_function', 'remove_line_function', 'save_line_report', 'save_department_contact',
                       'log_disaster_update', 'record_disaster_casualty', 'update_disaster_casualty', 'list_disaster_casualties',
                       'disaster_casualty_counts', 'set_shelter_services', 'set_shelter_position', 'log_disaster_sms', 'may_see_casualties')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then raise exception 'Anonymous users could run: % — nothing was changed', v_bad; end if;
end $$;

commit;

notify pgrst, 'reload schema';
