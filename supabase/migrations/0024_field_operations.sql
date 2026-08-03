-- ============================================================================
-- 0024 — Field operations: offline-safe writes, honest timestamps, panic
-- ============================================================================
--
-- The responder app now queues work while it has no signal and delivers it when
-- it does (apps/mobile/lib/outbox.ts). That moves three problems into the
-- database, and adds one capability that only makes sense here.
--
-- (1) INCIDENT NUMBERS COLLIDE.
--     `log_incoming_call` builds the number as INC-<date>-<random 100..999>,
--     against `unique (silo, incident_number)`. That is 900 values per silo per
--     day, so by the birthday bound a silo has a ~50% chance of a collision at
--     35 calls in a day and is essentially certain past 80 — and a collision
--     surfaces as an exception thrown at a call-taker with a caller on the
--     line. eThekwini runs well past that daily. Replaced with a per-silo,
--     per-day counter that cannot collide.
--
-- (2) REPLAY MUST NOT DUPLICATE.
--     Delivery can be interrupted after the server committed but before the
--     phone recorded that it had. `incidents.client_ref` (unique) lets the
--     device name the row it is creating, so a retry returns the original
--     instead of creating a second incident for the same emergency.
--
-- (3) TIMESTAMPS MUST BE WHEN IT HAPPENED.
--     `update_responder_status` stamped `arrived_timestamp` with now(), which
--     for a queued update is when signal came back — potentially many minutes
--     after the crew actually arrived. Response-time KPIs, and any inquiry into
--     a bad outcome, are computed off exactly that column. It now accepts the
--     time the responder acted, with guards so the parameter cannot be used to
--     backdate arbitrarily.
--
-- (4) PANIC.
--     `raise_panic` is the officer-down path: one call from a phone creates a
--     Critical incident at the officer's position and interrupts every screen
--     in their own department and in the control room. SECURITY DEFINER
--     deliberately — a Firefighter or Paramedic holds no insert rights on
--     `alerts`, and must not need any to call for help.
-- ============================================================================

-- ── (1) Collision-free incident numbers ─────────────────────────────────────

create table if not exists public.incident_number_counters (
  silo      silo   not null,
  day       date   not null,
  last_seq  int    not null default 0,
  primary key (silo, day)
);

comment on table public.incident_number_counters is
  'Per-silo daily sequence behind next_incident_number(). One row per silo per day.';

-- Not user data: the counter is written by a SECURITY DEFINER function and read
-- by nobody. RLS on with no policy = deny all direct access, which is right.
alter table public.incident_number_counters enable row level security;

create or replace function public.next_incident_number(p_silo silo)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_day date := (now() at time zone 'Africa/Johannesburg')::date;
  v_seq int;
begin
  -- One statement, so concurrent call-takers serialise on the row lock rather
  -- than racing. INSERT ... ON CONFLICT DO UPDATE returns the post-increment
  -- value whether the row was new or existing.
  insert into public.incident_number_counters (silo, day, last_seq)
  values (p_silo, v_day, 1)
  on conflict (silo, day)
    do update set last_seq = public.incident_number_counters.last_seq + 1
  returning last_seq into v_seq;

  return 'INC-' || to_char(v_day, 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');
end $$;

comment on function public.next_incident_number(silo) is
  'Sequential, collision-free incident number: INC-YYYYMMDD-NNNN, per silo per day.';

revoke execute on function public.next_incident_number(silo) from public, anon;
grant execute on function public.next_incident_number(silo) to authenticated, service_role;

-- Seed today's counters past any numbers already in use, so the first call
-- after this migration cannot collide with historical or seeded data.
insert into public.incident_number_counters (silo, day, last_seq)
select
  i.silo,
  (now() at time zone 'Africa/Johannesburg')::date,
  coalesce(max((regexp_replace(i.incident_number, '^.*-', ''))::int), 0)
from public.incidents i
where i.incident_number ~ '^INC-\d{8}-\d+$'
  and substring(i.incident_number from 5 for 8)
      = to_char((now() at time zone 'Africa/Johannesburg')::date, 'YYYYMMDD')
group by i.silo
on conflict (silo, day) do update
  set last_seq = greatest(
    public.incident_number_counters.last_seq,
    excluded.last_seq
  );

-- Point intake at the counter. Body is otherwise the 0019 definition verbatim,
-- plus the client_ref passthrough from (2) below. The old arity is dropped for
-- the same PostgREST reason as update_responder_status: two overloads that both
-- match the call's named arguments resolve to neither.
drop function if exists public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text
);

create or replace function public.log_incoming_call(
  p_silo silo, p_caller_name text, p_caller_number text, p_call_description text,
  p_incident_type text, p_incident_severity incident_severity, p_location_address text,
  p_location_lat double precision, p_location_lng double precision,
  p_suburb text default null, p_city text default null, p_postal_code text default null,
  p_fire_incident_type text default null, p_medical_type text default null,
  p_disaster_type text default null, p_is_caller_patient boolean default null,
  p_patient_name text default null, p_number_of_victims integer default null,
  p_notes text default null, p_source text default 'Master',
  p_client_ref uuid default null
)
returns public.incidents
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_incident public.incidents;
  v_existing public.incidents;
  v_status   incident_status := case p_silo
                                  when 'EthekwiniDisaster' then 'Pending Analysis'::incident_status
                                  else 'Pending Dispatch'::incident_status
                                end;
begin
  perform public.require_role(
    'SystemAdmin','SuperAdmin','Admin','Operator','ControlRoom','IncidentLogger','System'
  );

  if p_client_ref is not null then
    select * into v_existing from public.incidents where client_ref = p_client_ref;
    if found then return v_existing; end if;
  end if;

  insert into public.incidents (
    silo, source, incident_number, client_ref,
    caller_name, caller_number, call_description, notes,
    incident_type, incident_severity, fire_incident_type, medical_type, disaster_type,
    location_address, suburb, city, postal_code, location_lat, location_lng,
    is_caller_patient, patient_name, number_of_victims,
    status, call_timestamp, incident_created_at,
    created_by
  ) values (
    p_silo, p_source, public.next_incident_number(p_silo), p_client_ref,
    p_caller_name, p_caller_number, p_call_description, p_notes,
    p_incident_type, p_incident_severity, p_fire_incident_type, p_medical_type, p_disaster_type,
    p_location_address, p_suburb, p_city, p_postal_code, p_location_lat, p_location_lng,
    p_is_caller_patient, p_patient_name, p_number_of_victims,
    v_status, now(), now(),
    auth.uid()
  )
  returning * into v_incident;

  insert into public.audit_logs (
    silo, user_id, user_name, department, action_type, entity_type, entity_id, details
  ) values (
    p_silo, auth.uid(), (select full_name from public.profiles where id = auth.uid()),
    p_silo::text, 'CREATE_INCIDENT', 'incidents', v_incident.id::text,
    format('Logged %s call from %s at %s', p_incident_type, p_caller_name, p_location_address)
  );

  return v_incident;
end $$;

revoke execute on function public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid
) from public, anon;
grant execute on function public.log_incoming_call(
  silo, text, text, text, text, incident_severity, text, double precision, double precision,
  text, text, text, text, text, text, boolean, text, integer, text, text, uuid
) to authenticated, service_role;

-- ── (2) Client-supplied idempotency key ─────────────────────────────────────

alter table public.incidents
  add column if not exists client_ref uuid;

comment on column public.incidents.client_ref is
  'Device-generated id for offline creation. Unique, so a replayed create returns the original row.';

create unique index if not exists incidents_client_ref_key
  on public.incidents (client_ref)
  where client_ref is not null;

-- ── (3) Status updates carry the time the responder acted ───────────────────

-- The 2-argument form has to go rather than being overloaded: PostgREST
-- resolves RPCs by argument name, and two candidates both matching
-- {p_incident_id, p_status} is ambiguous.
drop function if exists public.update_responder_status(uuid, incident_status);

create or replace function public.update_responder_status(
  p_incident_id uuid,
  p_status      incident_status,
  p_occurred_at timestamptz default null
)
returns public.incidents
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_incident public.incidents;
  v_name     text := coalesce((select full_name from public.profiles where id = auth.uid()), 'Responder');
  v_at       timestamptz;
  v_queued   boolean;
begin
  perform public.require_role(
    'Responder','Firefighter','Paramedic','Officer','Constable','Sergeant','Captain',
    'Chief','FireChief','Supervisor','Dispatcher','ControlRoom','Operator',
    'Admin','SystemAdmin','SuperAdmin','System'
  );

  -- A device clock is not trusted, only tolerated. The supplied time is
  -- accepted when it is in the past and within a shift's length of now;
  -- anything else (a future time, a clock a day out) falls back to now().
  -- Bounding it this way keeps an honest offline timestamp without opening a
  -- path to backdating an arrival at will.
  v_at := case
    when p_occurred_at is null then now()
    when p_occurred_at > now() then now()
    when p_occurred_at < now() - interval '12 hours' then now()
    else p_occurred_at
  end;

  v_queued := p_occurred_at is not null and v_at < now() - interval '30 seconds';

  update public.incidents
     set status              = p_status,
         acceptance          = case when p_status = 'En Route' then true else acceptance end,
         arrived_timestamp   = case
                                 when p_status in ('Arrived','On Scene') and arrived_timestamp is null
                                   then v_at
                                 else arrived_timestamp
                               end,
         responding_officer  = coalesce(responding_officer, v_name),
         unit_status         = p_status::text,
         updated_at          = now()
   where id = p_incident_id
  returning * into v_incident;

  if not found then raise exception 'Incident % not found', p_incident_id; end if;

  -- The timeline says so explicitly when an update was recorded late. Someone
  -- reading the case file a year later must be able to tell a slow response
  -- from a slow network.
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name, timestamp)
  values (
    v_incident.silo,
    v_incident.id,
    case
      when v_queued then format('[STATUS] %s (recorded offline, delivered %s later)',
                                p_status::text,
                                to_char(now() - v_at, 'HH24:MI:SS'))
      else format('[STATUS] %s', p_status::text)
    end,
    auth.uid(), v_name, v_at
  );

  return v_incident;
end $$;

comment on function public.update_responder_status(uuid, incident_status, timestamptz) is
  'Responder status change. p_occurred_at carries the real time for updates queued offline; bounded to the last 12 hours and never in the future.';

revoke execute on function public.update_responder_status(uuid, incident_status, timestamptz) from public, anon;
grant execute on function public.update_responder_status(uuid, incident_status, timestamptz) to authenticated, service_role;

-- ── (4) Officer-down ────────────────────────────────────────────────────────

create or replace function public.raise_panic(
  p_lat         double precision default null,
  p_lng         double precision default null,
  p_accuracy    double precision default null,
  p_note        text default null,
  p_client_ref  uuid default null,
  p_occurred_at timestamptz default null
)
returns public.incidents
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_incident public.incidents;
  v_existing public.incidents;
  v_silo     silo;
  v_name     text;
  v_phone    text;
  v_unit     text;
  v_at       timestamptz;
  v_silos    silo[];
  v_target   silo;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Deliberately no require_role(). Every account holder may call for help;
  -- gating an emergency on a role matrix is how someone dies over a
  -- provisioning mistake.

  if p_client_ref is not null then
    select * into v_existing from public.incidents where client_ref = p_client_ref;
    if found then
      -- A replayed panic from the outbox. Return the original rather than
      -- raising a second emergency for the same event.
      return v_existing;
    end if;
  end if;

  select coalesce(pr.silo, 'Ethekwini'::silo),
         coalesce(pr.full_name, 'Unknown officer'),
         pr.contact_number
    into v_silo, v_name, v_phone
    from public.profiles pr
   where pr.id = auth.uid();

  if v_silo is null then v_silo := 'Ethekwini'; end if;
  if v_name is null then v_name := 'Unknown officer'; end if;

  select a.unit_number into v_unit
    from public.personnel p
    join public.apparatus a on a.id = p.assigned_apparatus_id
   where p.user_id = auth.uid()
   limit 1;

  v_at := case
    when p_occurred_at is null then now()
    when p_occurred_at > now() then now()
    when p_occurred_at < now() - interval '12 hours' then now()
    else p_occurred_at
  end;

  insert into public.incidents (
    silo, source, incident_number, client_ref,
    caller_name, caller_number, call_description,
    incident_type, incident_severity,
    location_address, location_lat, location_lng,
    status, call_timestamp, incident_created_at,
    responding_officer, created_by, notes
  ) values (
    v_silo,
    'Responder-Panic',
    public.next_incident_number(v_silo),
    p_client_ref,
    v_name,
    coalesce(v_phone, 'Unknown'),
    format(
      'OFFICER REQUIRES IMMEDIATE ASSISTANCE. %s%s',
      case when v_unit is not null then 'Unit ' || v_unit || '. ' else '' end,
      coalesce(nullif(p_note, ''), 'No further detail — assume the worst until contact is made.')
    ),
    'Officer Emergency',
    'Critical',
    -- The position, not a street name: a panic is dispatched off coordinates.
    case
      when p_lat is not null and p_lng is not null
        then format('Officer position %s, %s%s',
                    round(p_lat::numeric, 5), round(p_lng::numeric, 5),
                    case when p_accuracy is not null
                      then format(' (±%sm)', round(p_accuracy::numeric)) else '' end)
      else 'POSITION UNKNOWN — last known location required from dispatch'
    end,
    -- 0,0 is in the Gulf of Guinea and would put a marker in the ocean. Using
    -- the eThekwini city centre keeps the incident on the operational map,
    -- while the address text above says plainly that the position is unknown.
    coalesce(p_lat, -29.8587),
    coalesce(p_lng, 31.0218),
    'Dispatched',
    v_at, v_at,
    v_name,
    auth.uid(),
    case when p_lat is null then 'GPS unavailable on the reporting device.' else null end
  )
  returning * into v_incident;

  -- Interrupt the officer's own department and the control room. Duplicates
  -- are the point: whoever is at a screen must see it.
  v_silos := array(select distinct unnest(array[v_silo, 'Ethekwini'::silo]));

  foreach v_target in array v_silos loop
    insert into public.alerts (
      silo, kind, severity, title, body, incident_id,
      link, presentation, requires_ack, created_by, created_by_name
    ) values (
      v_target,
      'assignment',
      'Critical',
      format('OFFICER EMERGENCY — %s', v_name),
      format('%s · %s',
             v_incident.location_address,
             case when v_unit is not null then 'Unit ' || v_unit else 'No unit assigned' end),
      v_incident.id,
      '/incidents/' || v_incident.id::text,
      'modal',
      true,
      auth.uid(),
      v_name
    );
  end loop;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name, timestamp)
  values (v_silo, v_incident.id, '[PANIC] Emergency raised from the responder app.',
          auth.uid(), v_name, v_at);

  insert into public.audit_logs (
    silo, user_id, user_name, department, action_type, entity_type, entity_id, details
  ) values (
    v_silo, auth.uid(), v_name, v_silo::text, 'PANIC_RAISED', 'incidents', v_incident.id::text,
    format('Panic raised by %s at %s', v_name, v_incident.location_address)
  );

  return v_incident;
end $$;

comment on function public.raise_panic(double precision, double precision, double precision, text, uuid, timestamptz) is
  'Officer-down. Creates a Critical incident at the caller position and raises a blocking alert to their department and the control room. No role gate by design.';

revoke execute on function public.raise_panic(double precision, double precision, double precision, text, uuid, timestamptz) from public, anon;
grant execute on function public.raise_panic(double precision, double precision, double precision, text, uuid, timestamptz) to authenticated, service_role;

-- Dispatch boards filter on this to surface live panics ahead of everything else.
create index if not exists incidents_panic_idx
  on public.incidents (status, incident_created_at desc)
  where source = 'Responder-Panic';
