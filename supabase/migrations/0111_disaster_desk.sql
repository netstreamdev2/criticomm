-- ============================================================================
-- 0111 — The Disaster desk: call-outs, updates and Criti's notes
-- ============================================================================
--
-- Run after 0110.
--
-- eThekwini Disaster Management has no field workers on the app: the whole
-- operation is run from the Disaster dispatch desk. The call taker logs the
-- call as usual and sends it to Disaster; the desk calls out the partners
-- (V4's mutual-aid list: Eskom KZN Control Center, Amanzimtoti Fire Station,
-- SASSA and the rest), keeps the timeline as the partners report back by
-- phone, radio or WhatsApp until they leave the scene, and files the
-- post-mortem, after which the case goes to case review as before.
--
--   1. Call-outs (disaster_callouts): one row per partner called out, with
--      how they were reached, and their progress: Called → On the way →
--      On scene → Left scene (or Stood down). disaster_call_out() and
--      set_callout_status() only. The first call-out dispatches Disaster's
--      part of the call; the first partner on scene puts it on scene, marked
--      as by the desk (0099), so the call's status follows as it always has.
--   2. Desk updates (disaster_desk_updates): what a partner or caller said,
--      when, how it came in (Call, Radio, WhatsApp, Other) and from whom.
--      log_disaster_update() only. Permanent: a correction is a new update.
--      Each goes on the call's own timeline too.
--   3. Criti's notes (disaster_ai_briefs): the AI's reading of the call,
--      saved so every dispatcher on the desk sees the same one and the
--      record shows what it advised and when. save_disaster_ai_brief() only.
--   4. The post-mortem from the desk: file_post_mortem() as 0075, and also
--      the Disaster desk files it itself once a partner has been called out.
--
-- Every function checks the caller works the Disaster desk, the call is in
-- their organisation and was sent to Disaster, and writes the audit log.
-- No table takes writes from a signed-in user directly; nothing for anon.
--
-- Safe to re-run.
-- ============================================================================

begin;

-- ── 0. Who works the Disaster desk ─────────────────────────────────────────

-- Disaster dispatch and command, the control room, organisation
-- administrators (can_direct_department, 0073), and Disaster Management's
-- own officers, who now work from the desk.
create or replace function public.works_disaster_desk() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.can_direct_department('EthekwiniDisaster')
      or exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.deactivated_at is null
                    and p.role = 'Disaster' and p.silo = 'EthekwiniDisaster')
$$;
revoke all on function public.works_disaster_desk() from public, anon;
grant execute on function public.works_disaster_desk() to authenticated;

-- The open call, locked, once the caller may work it from the Disaster desk.
create or replace function public.disaster_desk_incident(p_incident_id uuid)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v public.incidents;
begin
  if not public.works_disaster_desk() then
    raise exception 'Only the Disaster desk does this' using errcode = '42501';
  end if;
  select * into v from public.incidents
   where id = p_incident_id and tenant_id = public.current_tenant()
   for update;
  if not found then raise exception 'Incident % not found', p_incident_id using errcode = 'P0002'; end if;
  if not (v.silo = 'EthekwiniDisaster'
          or 'EthekwiniDisaster' = any (coalesce(v.dispatched_silos, '{}'))
          or 'EthekwiniDisaster' = any (coalesce(v.tagged_silos, '{}'))) then
    raise exception '% was not sent to Disaster Management', v.incident_number using errcode = 'P0001';
  end if;
  if v.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v.incident_number, lower(v.status::text) using errcode = 'P0001';
  end if;
  return v;
end $$;
revoke all on function public.disaster_desk_incident(uuid) from public, anon, authenticated;

-- ── 1. Call-outs ───────────────────────────────────────────────────────────

create table if not exists public.disaster_callouts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default public.current_tenant(),
  silo            public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  incident_id     uuid not null references public.incidents (id) on delete cascade,
  client_ref      uuid,
  partner_id      uuid references public.mutual_aid_partners (id) on delete set null,
  agency_name     text not null check (length(agency_name) between 1 and 200),
  resource_type   text check (resource_type is null or length(resource_type) <= 100),
  contact_number  text check (contact_number is null or length(contact_number) <= 60),
  radio_frequency text check (radio_frequency is null or length(radio_frequency) <= 60),
  how             text not null check (how in ('Call', 'Radio', 'WhatsApp', 'Other')),
  reason          text check (reason is null or length(reason) <= 500),
  suggested_by_ai boolean not null default false,
  status          text not null default 'Called'
                    check (status in ('Called', 'On the way', 'On scene', 'Left scene', 'Stood down')),
  eta_minutes     int check (eta_minutes is null or eta_minutes between 0 and 1440),
  called_at       timestamptz not null default now(),
  on_way_at       timestamptz,
  on_scene_at     timestamptz,
  left_at         timestamptz,
  called_by       uuid not null default auth.uid(),
  called_by_name  text,
  updated_at      timestamptz not null default now()
);
comment on table public.disaster_callouts is
  'Partners the Disaster desk called out to a call (0111), and their progress. disaster_call_out() and set_callout_status() only.';

create unique index if not exists disaster_callouts_client_ref
  on public.disaster_callouts (tenant_id, client_ref) where client_ref is not null;
-- A partner is called out once while still working the call.
create unique index if not exists disaster_callouts_open_partner
  on public.disaster_callouts (incident_id, partner_id)
  where partner_id is not null and status in ('Called', 'On the way', 'On scene');
create index if not exists disaster_callouts_incident on public.disaster_callouts (incident_id, called_at);

alter table public.disaster_callouts enable row level security;
drop policy if exists tenant_isolation on public.disaster_callouts;
create policy tenant_isolation on public.disaster_callouts as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
drop policy if exists disaster_callouts_read on public.disaster_callouts;
create policy disaster_callouts_read on public.disaster_callouts for select to authenticated
  using (silo = public.current_silo() or public.is_global() or public.works_disaster_desk()
         or public.can_work_incident(incident_id) or public.role_in('CaseManager', 'SystemController'));
revoke all on public.disaster_callouts from anon;
revoke insert, update, delete on public.disaster_callouts from authenticated;
grant select on public.disaster_callouts to authenticated;

create or replace function public.guard_disaster_callout() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  raise exception 'A call-out stays on record.' using errcode = 'P0001';
end $$;
drop trigger if exists guard_disaster_callout on public.disaster_callouts;
create trigger guard_disaster_callout before delete on public.disaster_callouts
  for each row execute function public.guard_disaster_callout();

/**
 * Call out a partner: from the directory (p_fields.partner_id) or by name
 * (agency_name). how: Call | Radio | WhatsApp | Other. Optional reason,
 * eta_minutes and suggested_by_ai. The same client reference, or the same
 * partner still working the call, returns the call-out already made.
 */
create or replace function public.disaster_call_out(p_incident_id uuid, p_client_ref uuid, p_fields jsonb)
returns public.disaster_callouts
language plpgsql security definer set search_path to 'public' as $$
declare
  f         jsonb := coalesce(p_fields, '{}'::jsonb);
  v         public.disaster_callouts;
  v_inc     public.incidents;
  v_partner public.mutual_aid_partners;
  v_pid     uuid;
  v_agency  text := nullif(left(btrim(coalesce(p_fields ->> 'agency_name', '')), 200), '');
  v_how     text := btrim(coalesce(p_fields ->> 'how', ''));
  v_reason  text := nullif(left(btrim(coalesce(p_fields ->> 'reason', '')), 500), '');
  v_eta     int;
  v_name    text;
  v_dept    public.incident_departments;
begin
  if p_client_ref is null then
    raise exception 'The call-out has no reference; try again' using errcode = '22023';
  end if;
  v_inc := public.disaster_desk_incident(p_incident_id);
  select * into v from public.disaster_callouts
   where tenant_id = v_inc.tenant_id and client_ref = p_client_ref;
  if found then return v; end if;

  if v_how not in ('Call', 'Radio', 'WhatsApp', 'Other') then
    raise exception 'Say how you reached them: call, radio, WhatsApp or other.' using errcode = 'P0001';
  end if;
  if coalesce(f ->> 'partner_id', '') ~ '^[0-9a-fA-F-]{36}$' then
    v_pid := (f ->> 'partner_id')::uuid;
    select * into v_partner from public.mutual_aid_partners
     where id = v_pid and tenant_id = v_inc.tenant_id and is_active;
    if not found then raise exception 'That partner is not in the directory.' using errcode = 'P0001'; end if;
    select * into v from public.disaster_callouts
     where incident_id = v_inc.id and partner_id = v_pid and status in ('Called', 'On the way', 'On scene');
    if found then return v; end if;
  elsif v_agency is null then
    raise exception 'Choose who you called out.' using errcode = 'P0001';
  end if;
  if coalesce(f ->> 'eta_minutes', '') <> '' then
    if (f ->> 'eta_minutes') !~ '^[0-9]{1,4}$' or (case when (f ->> 'eta_minutes') ~ '^[0-9]{1,4}$' then (f ->> 'eta_minutes')::int > 1440 end) then
      raise exception 'Arrival time is in minutes, up to a day.' using errcode = 'P0001';
    end if;
    v_eta := (f ->> 'eta_minutes')::int;
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.disaster_callouts (
    tenant_id, incident_id, client_ref, partner_id, agency_name, resource_type, contact_number, radio_frequency,
    how, reason, suggested_by_ai, eta_minutes, called_by, called_by_name
  ) values (
    v_inc.tenant_id, v_inc.id, p_client_ref, v_partner.id, coalesce(v_partner.agency_name, v_agency),
    coalesce(v_partner.resource_type, nullif(left(btrim(coalesce(f ->> 'resource_type', '')), 100), '')),
    coalesce(v_partner.contact_number, nullif(left(btrim(coalesce(f ->> 'contact_number', '')), 60), '')),
    v_partner.radio_frequency, v_how, v_reason,
    case when jsonb_typeof(f -> 'suggested_by_ai') = 'boolean' then (f ->> 'suggested_by_ai')::boolean else false end, v_eta,
    auth.uid(), v_name
  ) returning * into v;

  -- Disaster is on the call: its part is dispatched by the first call-out.
  if not ('EthekwiniDisaster' = any (coalesce(v_inc.dispatched_silos, '{}'))) and v_inc.silo <> 'EthekwiniDisaster' then
    update public.incidents set dispatched_silos = coalesce(dispatched_silos, '{}') || 'EthekwiniDisaster'::public.silo,
           updated_at = now()
     where id = v_inc.id returning * into v_inc;
  end if;
  perform public.ensure_incident_departments(v_inc);
  select * into v_dept from public.incident_departments
   where incident_id = v_inc.id and silo = 'EthekwiniDisaster' for update;
  if found and v_dept.status = 'Waiting' then
    update public.incident_departments
       set status = 'Dispatched', dispatched_at = now(), dispatched_by = auth.uid(), dispatched_by_name = v_name,
           updated_at = now()
     where id = v_dept.id;
    update public.incidents set dispatch_time = coalesce(dispatch_time, now()), updated_at = now() where id = v_inc.id;
  end if;
  v_inc := public.sync_incident_from_departments(v_inc.id);

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id,
    format('[CALL-OUT] %s called out by %s%s%s — %s',
      v.agency_name, lower(case v.how when 'Call' then 'phone' when 'Other' then 'other means' else v.how end),
      case when v.eta_minutes is not null then format(', expected in %s min', v.eta_minutes) else '' end,
      case when v.reason is not null then ': ' || v.reason else '' end,
      coalesce(v_name, 'the Disaster desk')),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_CALL_OUT',
    'disaster_callouts', v.id::text, format('%s · %s by %s%s', v_inc.incident_number, v.agency_name, v.how,
      case when v.suggested_by_ai then ' (suggested by Criti)' else '' end));

  return v;
end $$;
revoke all on function public.disaster_call_out(uuid, uuid, jsonb) from public, anon;
grant execute on function public.disaster_call_out(uuid, uuid, jsonb) to authenticated;

/**
 * A partner's progress, as they report it: On the way | On scene |
 * Left scene | Stood down. Optional how (it came in by), eta_minutes, note.
 * Forward only; the same status again is a no-op.
 */
create or replace function public.set_callout_status(p_callout_id uuid, p_status text, p_fields jsonb default '{}'::jsonb)
returns public.disaster_callouts
language plpgsql security definer set search_path to 'public' as $$
declare
  f      jsonb := coalesce(p_fields, '{}'::jsonb);
  v      public.disaster_callouts;
  v_inc  public.incidents;
  v_dept public.incident_departments;
  v_name text;
  v_how  text := nullif(btrim(coalesce(p_fields ->> 'how', '')), '');
  v_note text := nullif(left(btrim(coalesce(p_fields ->> 'note', '')), 500), '');
  v_rank int;
  v_eta  int;
begin
  select * into v from public.disaster_callouts where id = p_callout_id and tenant_id = public.current_tenant();
  if not found then raise exception 'Call-out not found' using errcode = 'P0002'; end if;
  v_inc := public.disaster_desk_incident(v.incident_id);
  select * into v from public.disaster_callouts where id = p_callout_id for update;

  if p_status not in ('On the way', 'On scene', 'Left scene', 'Stood down') then
    raise exception 'Choose On the way, On scene, Left scene or Stood down' using errcode = '22023';
  end if;
  if v_how is not null and v_how not in ('Call', 'Radio', 'WhatsApp', 'Other') then
    raise exception 'Say how it came in: call, radio, WhatsApp or other.' using errcode = 'P0001';
  end if;
  if v.status in ('Left scene', 'Stood down') then
    if v.status = p_status then return v; end if;
    raise exception '% has already %', v.agency_name,
      case v.status when 'Left scene' then 'left the scene' else 'been stood down' end using errcode = 'P0001';
  end if;
  v_rank := array_position(array['Called', 'On the way', 'On scene', 'Left scene'], p_status);
  if p_status <> 'Stood down' and v_rank <= array_position(array['Called', 'On the way', 'On scene', 'Left scene'], v.status) then
    return v;
  end if;
  if p_status = 'Left scene' and v.on_scene_at is null then
    raise exception 'Mark % on scene first, or stand them down.', v.agency_name using errcode = 'P0001';
  end if;
  if p_status = 'On the way' and coalesce(f ->> 'eta_minutes', '') <> '' then
    if (f ->> 'eta_minutes') !~ '^[0-9]{1,4}$' or (case when (f ->> 'eta_minutes') ~ '^[0-9]{1,4}$' then (f ->> 'eta_minutes')::int > 1440 end) then
      raise exception 'Arrival time is in minutes, up to a day.' using errcode = 'P0001';
    end if;
    v_eta := (f ->> 'eta_minutes')::int;
  end if;

  update public.disaster_callouts
     set status      = p_status,
         on_way_at   = case when p_status = 'On the way' then coalesce(on_way_at, now()) else on_way_at end,
         on_scene_at = case when p_status = 'On scene' then coalesce(on_scene_at, now()) else on_scene_at end,
         left_at     = case when p_status in ('Left scene', 'Stood down') then coalesce(left_at, now()) else left_at end,
         eta_minutes = coalesce(v_eta, eta_minutes),
         updated_at  = now()
   where id = v.id
  returning * into v;

  select full_name into v_name from public.profiles where id = auth.uid();

  -- The first partner on scene puts Disaster's part on scene, as the desk (0099).
  if p_status = 'On scene' then
    select * into v_dept from public.incident_departments
     where incident_id = v_inc.id and silo = 'EthekwiniDisaster' for update;
    if found and public.department_open(v_dept.status)
       and public.department_step_rank(v_dept.status) < public.department_step_rank('On Scene') then
      update public.incident_departments
         set status = 'On Scene', arrived_at = coalesce(arrived_at, now()), arrived_by = coalesce(arrived_by, 'desk'),
             updated_at = now()
       where id = v_dept.id;
      update public.incidents set arrived_timestamp = coalesce(arrived_timestamp, now()), updated_at = now()
       where id = v_inc.id;
      v_inc := public.sync_incident_from_departments(v_inc.id);
    end if;
  end if;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id,
    format('[PARTNER] %s: %s%s%s%s — %s', v.agency_name, lower(p_status),
      case when v_eta is not null then format(', about %s min away', v_eta) else '' end,
      case when v_how is not null then format(' (by %s)', lower(case v_how when 'Call' then 'phone' else v_how end)) else '' end,
      case when v_note is not null then ': ' || v_note else '' end,
      coalesce(v_name, 'the Disaster desk')),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_CALLOUT_STATUS',
    'disaster_callouts', v.id::text, format('%s · %s: %s', v_inc.incident_number, v.agency_name, p_status));

  return v;
end $$;
revoke all on function public.set_callout_status(uuid, text, jsonb) from public, anon;
grant execute on function public.set_callout_status(uuid, text, jsonb) to authenticated;

-- ── 2. Desk updates ────────────────────────────────────────────────────────

create table if not exists public.disaster_desk_updates (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default public.current_tenant(),
  silo           public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  incident_id    uuid not null references public.incidents (id) on delete cascade,
  client_ref     uuid,
  source         text not null check (source in ('Call', 'Radio', 'WhatsApp', 'Other')),
  from_name      text check (from_name is null or length(from_name) <= 200),
  callout_id     uuid references public.disaster_callouts (id) on delete set null,
  text           text not null check (length(text) between 1 and 2000),
  logged_by      uuid not null default auth.uid(),
  logged_by_name text,
  logged_at      timestamptz not null default now()
);
comment on table public.disaster_desk_updates is
  'What came in to the Disaster desk about a call (0111): when, how and from whom. log_disaster_update() only; permanent.';

create unique index if not exists disaster_desk_updates_client_ref
  on public.disaster_desk_updates (tenant_id, client_ref) where client_ref is not null;
create index if not exists disaster_desk_updates_incident on public.disaster_desk_updates (incident_id, logged_at);

alter table public.disaster_desk_updates enable row level security;
drop policy if exists tenant_isolation on public.disaster_desk_updates;
create policy tenant_isolation on public.disaster_desk_updates as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
drop policy if exists disaster_desk_updates_read on public.disaster_desk_updates;
create policy disaster_desk_updates_read on public.disaster_desk_updates for select to authenticated
  using (silo = public.current_silo() or public.is_global() or public.works_disaster_desk()
         or public.can_work_incident(incident_id) or public.role_in('CaseManager', 'SystemController'));
revoke all on public.disaster_desk_updates from anon;
revoke insert, update, delete on public.disaster_desk_updates from authenticated;
grant select on public.disaster_desk_updates to authenticated;

create or replace function public.guard_disaster_desk_update() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  raise exception 'A logged update cannot be changed or deleted. Log a new one.' using errcode = 'P0001';
end $$;
drop trigger if exists guard_disaster_desk_update on public.disaster_desk_updates;
create trigger guard_disaster_desk_update before update or delete on public.disaster_desk_updates
  for each row execute function public.guard_disaster_desk_update();

/**
 * Log what came in: source (Call | Radio | WhatsApp | Other), text, and who
 * it came from: a partner called out (callout_id) or a name (from_name).
 * The same client reference returns the update already logged.
 */
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
  if v_text is null then raise exception 'Write what they said.' using errcode = 'P0001'; end if;
  if length(v_text) > 2000 then raise exception 'Keep an update under 2000 characters.' using errcode = 'P0001'; end if;
  if coalesce(f ->> 'callout_id', '') ~ '^[0-9a-fA-F-]{36}$' then
    select * into v_call from public.disaster_callouts
     where id = (f ->> 'callout_id')::uuid and incident_id = v_inc.id;
    if not found then raise exception 'That partner was not called out to this call.' using errcode = 'P0001'; end if;
    v_from := v_call.agency_name;
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.disaster_desk_updates (tenant_id, incident_id, client_ref, source, from_name, callout_id, text, logged_by, logged_by_name)
  values (v_inc.tenant_id, v_inc.id, p_client_ref, v_source, v_from, v_call.id, v_text, auth.uid(), v_name)
  returning * into v;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id,
    format('[UPDATE · %s%s] %s — logged by %s', v.source, case when v.from_name is not null then ' · ' || v.from_name else '' end,
      v.text, coalesce(v_name, 'the Disaster desk')),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'DISASTER_UPDATE',
    'disaster_desk_updates', v.id::text, format('%s · by %s%s', v_inc.incident_number, v.source,
      case when v.from_name is not null then ' from ' || v.from_name else '' end));

  return v;
end $$;
revoke all on function public.log_disaster_update(uuid, uuid, jsonb) from public, anon;
grant execute on function public.log_disaster_update(uuid, uuid, jsonb) to authenticated;

-- ── 3. Criti's notes ───────────────────────────────────────────────────────

create table if not exists public.disaster_ai_briefs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant(),
  silo        public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  provider    text check (provider is null or length(provider) <= 40),
  -- What it read: the count of updates and call-outs when it was asked.
  read_marker text check (read_marker is null or length(read_marker) <= 200),
  brief       jsonb not null check (jsonb_typeof(brief) = 'object' and length(brief::text) <= 30000),
  asked_by    uuid not null default auth.uid(),
  created_at  timestamptz not null default now()
);
comment on table public.disaster_ai_briefs is
  'Criti''s reading of a Disaster call (0111): summary, who to call out, what is missed. Advice only; save_disaster_ai_brief() only.';
create index if not exists disaster_ai_briefs_incident on public.disaster_ai_briefs (incident_id, created_at desc);

alter table public.disaster_ai_briefs enable row level security;
drop policy if exists tenant_isolation on public.disaster_ai_briefs;
create policy tenant_isolation on public.disaster_ai_briefs as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
drop policy if exists disaster_ai_briefs_read on public.disaster_ai_briefs;
create policy disaster_ai_briefs_read on public.disaster_ai_briefs for select to authenticated
  using (silo = public.current_silo() or public.is_global() or public.works_disaster_desk()
         or public.role_in('CaseManager', 'SystemController'));
revoke all on public.disaster_ai_briefs from anon;
revoke insert, update, delete on public.disaster_ai_briefs from authenticated;
grant select on public.disaster_ai_briefs to authenticated;

create or replace function public.save_disaster_ai_brief(p_incident_id uuid, p_provider text, p_read_marker text, p_brief jsonb)
returns public.disaster_ai_briefs
language plpgsql security definer set search_path to 'public' as $$
declare
  v     public.disaster_ai_briefs;
  v_inc public.incidents;
begin
  v_inc := public.disaster_desk_incident(p_incident_id);
  if p_brief is null or jsonb_typeof(p_brief) <> 'object' or length(p_brief::text) > 30000 then
    raise exception 'Criti''s note is not in the expected shape' using errcode = '22023';
  end if;
  -- A busy desk asks often; one note a minute per reading is enough.
  select * into v from public.disaster_ai_briefs
   where incident_id = v_inc.id and read_marker is not distinct from left(p_read_marker, 200)
     and created_at > now() - interval '1 minute'
   order by created_at desc limit 1;
  if found then return v; end if;
  -- Old notes are kept for the record, but only the last 200 per call.
  delete from public.disaster_ai_briefs
   where id in (select id from public.disaster_ai_briefs where incident_id = v_inc.id
                 order by created_at desc offset 199);
  insert into public.disaster_ai_briefs (tenant_id, incident_id, provider, read_marker, brief, asked_by)
  values (v_inc.tenant_id, v_inc.id, left(p_provider, 40), left(p_read_marker, 200), p_brief, auth.uid())
  returning * into v;
  return v;
end $$;
revoke all on function public.save_disaster_ai_brief(uuid, text, text, jsonb) from public, anon;
grant execute on function public.save_disaster_ai_brief(uuid, text, text, jsonb) to authenticated;

-- ── 4. The post-mortem from the desk ───────────────────────────────────────

-- As 0075, with the changes marked "0111": the Disaster desk files the
-- post-mortem itself once it has called a partner out, from the console.
create or replace function public.file_post_mortem(p_incident_id uuid, p_fields jsonb)
returns public.post_mortem_reports
language plpgsql security definer set search_path to 'public' as $$
declare
  f          jsonb := coalesce(p_fields, '{}'::jsonb);
  v_radio    uuid;
  v_incident public.incidents;
  v_person   public.personnel;
  v_report   public.post_mortem_reports;
  v_name     text;
  v_officer  text := nullif(trim(coalesce(f ->> 'reporting_officer', '')), '');
  v_cause    text := nullif(trim(coalesce(f ->> 'root_cause', '')), '');
  v_lessons  text := nullif(trim(coalesce(f ->> 'lessons_learned', '')), '');
  v_start    timestamptz;
  v_end      timestamptz;
  v_command  boolean := public.role_in('Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin');
  -- 0111: the Disaster desk, which runs the whole operation.
  v_desk     boolean := public.works_disaster_desk();
  v_count    text;
  v_timeline jsonb;
  v_now      timestamptz := now();
begin
  perform public.require_role('Disaster', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin',
    'Dispatcher', 'ControlRoom', 'Operator', 'SystemController', 'System', 'Chief', 'FireChief', 'Captain');
  -- 0075: or the desk, filing for a Disaster officer who radioed it in (radio_filer() checks).
  -- 0111: or the Disaster desk itself.
  if public.current_silo() is distinct from 'EthekwiniDisaster' and nullif(f ->> 'radioed_by', '') is null and not v_desk then
    raise exception 'Only Disaster Management files a post-mortem' using errcode = '42501';
  end if;

  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;
  -- 0073: the call as EthekwiniDisaster sees it — its own lead, status and report.
  v_incident := public.incident_for_department(v_incident, 'EthekwiniDisaster');
  -- 0111: the desk says what is missing, rather than that it is not Disaster's.
  if v_desk and not v_command and nullif(f ->> 'radioed_by', '') is null
     and v_incident.accepted_by is distinct from auth.uid() and v_incident.report_filed_at is null
     and not exists (select 1 from public.disaster_callouts c where c.incident_id = p_incident_id) then
    raise exception 'Call a partner out to % before filing its post-mortem', v_incident.incident_number using errcode = 'P0001';
  end if;
  if not (v_incident.silo = 'EthekwiniDisaster' or 'EthekwiniDisaster' = any(coalesce(v_incident.dispatched_silos, '{}'))) then
    raise exception '% is not a Disaster Management incident', v_incident.incident_number using errcode = 'P0001';
  end if;

  -- Replay of a report already filed (offline retry): return it unchanged.
  if v_incident.report_filed_at is not null then
    select * into v_report from public.post_mortem_reports
    where incident_id = p_incident_id and report_number is not null order by report_filed_at limit 1;
    if found then return v_report; end if;
    raise exception '% is already closed', v_incident.incident_number using errcode = 'P0001';
  end if;
  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text) using errcode = 'P0001';
  end if;

  -- 0111: the desk that called partners out files for the operation it ran.
  v_desk := v_desk and nullif(f ->> 'radioed_by', '') is null
            and exists (select 1 from public.disaster_callouts c where c.incident_id = p_incident_id);

  -- The officer leading the incident files from the scene; command may close
  -- out a deployed incident from the console, as V4's desk did.
  -- 0075: the desk files for a crew that radioed it in; radio_filer() says who may.
  v_radio := case when v_desk then null
                  else public.radio_filer(p_incident_id, 'EthekwiniDisaster', f, v_incident.accepted_by) end;
  if (v_command or v_desk) and v_radio is null then
    if v_incident.status not in ('Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting', 'Active') then
      raise exception 'Deploy resources to % before filing its post-mortem', v_incident.incident_number using errcode = 'P0001';
    end if;
  else
    if v_radio is null and v_incident.accepted_by is distinct from auth.uid() then
      raise exception 'Only the officer leading % files its post-mortem', v_incident.incident_number using errcode = 'P0001';
    end if;
    if v_incident.status not in ('Arrived', 'On Scene', 'Transporting') then
      raise exception 'Mark yourself on scene before filing the post-mortem for %', v_incident.incident_number using errcode = 'P0001';
    end if;
  end if;

  -- What the report must say (V4's After-Action Report).
  if coalesce(f ->> 'start_time', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T]([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Start Time must be a date and time (YYYY-MM-DD HH:MM).' using errcode = 'P0001';
  end if;
  if coalesce(f ->> 'end_time', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T]([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Resolved Time must be a date and time (YYYY-MM-DD HH:MM).' using errcode = 'P0001';
  end if;
  v_start := (replace(f ->> 'start_time', 'T', ' ') || ':00')::timestamp at time zone 'Africa/Johannesburg';
  v_end   := (replace(f ->> 'end_time', 'T', ' ') || ':00')::timestamp at time zone 'Africa/Johannesburg';
  if v_end < v_start then raise exception 'Resolved Time cannot be before Start Time.' using errcode = 'P0001'; end if;
  if v_end > v_now + interval '5 minutes' then raise exception 'Resolved Time cannot be in the future.' using errcode = 'P0001'; end if;
  foreach v_count in array array['injuries', 'fatalities', 'displaced_people'] loop
    if coalesce(f ->> v_count, '0') !~ '^[0-9]{1,6}$' then
      raise exception 'Counts must be whole numbers.' using errcode = 'P0001';
    end if;
  end loop;
  if v_cause is null then raise exception 'Root Cause Analysis is required.' using errcode = 'P0001'; end if;
  if v_lessons is null then raise exception 'Lessons Learned / Recommendations is required.' using errcode = 'P0001'; end if;
  if v_officer is null then raise exception 'Reporting Officer Name is required.' using errcode = 'P0001'; end if;
  if length(v_cause) > 4000 or length(v_lessons) > 4000 then
    raise exception 'Keep each answer under 4000 characters.' using errcode = 'P0001';
  end if;

  -- 0075: the member who radioed it in, when the desk files.
  select * into v_person from public.personnel
  where user_id = coalesce(v_radio, auth.uid()) and tenant_id = public.current_tenant();
  select full_name into v_name from public.profiles where id = auth.uid();

  -- V4's timeline snapshot: the incident's own history and the deployment's
  -- periodic updates, oldest first. (0111: desk updates and call-outs are on
  -- the incident's history already.)
  select coalesce(jsonb_agg(e order by e ->> 'timestamp'), '[]'::jsonb) into v_timeline from (
    select jsonb_build_object('timestamp', to_char(u.timestamp at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI'),
                              'text', u.message) as e
      from public.incident_updates u where u.incident_id = p_incident_id
    union all
    -- Console updates carry an ISO instant; V4's carried SA wall-clock text.
    select jsonb_build_object('timestamp',
             case when coalesce(x ->> 'timestamp', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                  then to_char((x ->> 'timestamp')::timestamptz at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI')
                  else coalesce(x ->> 'timestamp', '') end,
             'text', coalesce(x ->> 'text', ''))
      from public.disaster_logs d, jsonb_array_elements(coalesce(d.updates, '[]'::jsonb)) x
     where d.incident_id = p_incident_id
  ) s;

  insert into public.post_mortem_reports (
    tenant_id, silo, incident_id, incident_number, report_number, filed_by,
    incident_type, location, start_time, end_time, total_duration_hours,
    injuries, fatalities, displaced_people, root_cause, lessons_learned,
    timeline_snapshot, reporting_officer, report_filed_at
  ) values (
    v_incident.tenant_id, 'EthekwiniDisaster', v_incident.id, v_incident.incident_number,
    'PM-' || v_incident.incident_number, auth.uid(),
    coalesce(nullif(trim(coalesce(v_incident.disaster_type, '')), ''), v_incident.incident_type),
    v_incident.location_address, v_start, v_end,
    round((extract(epoch from (v_end - v_start)) / 3600)::numeric, 2),
    (f ->> 'injuries')::int, (f ->> 'fatalities')::int, (f ->> 'displaced_people')::int,
    v_cause, v_lessons, v_timeline, v_officer, v_now
  ) returning * into v_report;

  -- 0111: partners still on the call are stood down with it.
  update public.disaster_callouts
     set status = 'Left scene', left_at = coalesce(left_at, v_now), updated_at = v_now
   where incident_id = p_incident_id and status = 'On scene';
  update public.disaster_callouts
     set status = 'Stood down', left_at = coalesce(left_at, v_now), updated_at = v_now
   where incident_id = p_incident_id and status in ('Called', 'On the way');

  -- 0073: the report finishes EthekwiniDisaster's part; the call is resolved once every department has finished.
  v_incident := public.finish_department_by_report(p_incident_id, 'EthekwiniDisaster', v_now);

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[REPORT] Post-mortem %s filed by %s (%s injured, %s fatalities, %s displaced)',
      v_report.report_number, v_officer, v_report.injuries, v_report.fatalities, v_report.displaced_people),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'REPORT_FILED', 'incidents',
    v_incident.id::text, format('Post-mortem %s filed for %s%s', v_report.report_number, v_incident.incident_number,
      case when v_desk then ' from the Disaster desk' else '' end));

  perform public.notify_incident_chain(
    v_incident, case when v_incident.status = 'Resolved' then 'resolved' else 'report_filed' end,
    format('%s: post-mortem filed by %s', v_incident.incident_number, v_officer),
    format('%s · %s displaced', v_report.incident_type, v_report.displaced_people)
  );

  -- 0075: filed from the desk, as radioed in: on record as such.
  if v_radio is not null then perform public.note_radio_filing(p_incident_id, 'EthekwiniDisaster', v_radio); end if;

  return v_report;
end $$;
revoke all on function public.file_post_mortem(uuid, jsonb) from public, anon;
grant execute on function public.file_post_mortem(uuid, jsonb) to authenticated;

-- ── 5. Prove it ────────────────────────────────────────────────────────────

do $$
declare
  v_bad text;
begin
  select string_agg(t, ', ') into v_bad
    from unnest(array['disaster_callouts', 'disaster_desk_updates', 'disaster_ai_briefs']) t
   where not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t
                      and p.policyname = 'tenant_isolation' and p.permissive = 'RESTRICTIVE');
  if v_bad is not null then raise exception 'No tenant wall on: % — nothing was changed', v_bad; end if;
  select string_agg(tablename || '.' || policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'public' and tablename in ('disaster_callouts', 'disaster_desk_updates', 'disaster_ai_briefs')
     and permissive = 'PERMISSIVE' and cmd <> 'SELECT';
  if v_bad is not null then raise exception 'Write policies found on %: nothing was changed', v_bad; end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('disaster_call_out', 'set_callout_status', 'log_disaster_update', 'save_disaster_ai_brief',
                       'disaster_desk_incident', 'file_post_mortem')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then raise exception 'Anonymous users could run: % — nothing was changed', v_bad; end if;
end $$;

commit;

notify pgrst, 'reload schema';
