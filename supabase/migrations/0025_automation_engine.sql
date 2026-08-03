-- ============================================================================
-- 0025 — Automation engine
-- ============================================================================
--
-- Everything the platform does today happens because a person did it. That is
-- correct for dispatching and wrong for noticing: a call sitting unassigned for
-- twenty minutes, a paramedic's licence lapsing next week, a duty nobody
-- acknowledged. Those are all knowable from data already in the database, and
-- all currently depend on somebody happening to look.
--
-- Shape of the engine:
--
--   `automation_rules`  one row per rule. Enabled flag, an interval, and a
--                       jsonb `config` holding its thresholds — so a service
--                       changes "escalate after 10 minutes" to 15 without a
--                       deploy, and each department can differ.
--   `automation_runs`   an append-only log. Automations act on live operational
--                       data and raise alerts that pull crews around; when one
--                       misfires, "what did it do and when" has to be
--                       answerable without reading code.
--   `automation_events` the anti-spam ledger. Every action is keyed by
--                       (rule, entity, bucket) with a unique index, so a rule
--                       that runs every five minutes alerts once per escalation
--                       tier rather than every five minutes forever. This is
--                       the single most important table here: an alerting
--                       system that cries wolf is worse than none, because
--                       people stop reading it.
--
-- `run_automations()` is the only entry point. It walks the enabled rules whose
-- interval has elapsed, runs each in its own exception block — one failing rule
-- must not stop the rest — and records the outcome. A single pg_cron job calls
-- it; adding a rule never means touching the schedule.
--
-- Every rule function is SECURITY DEFINER and revoked from anon/authenticated:
-- they write alerts across departments, which no signed-in user may do
-- directly. They are called by cron (service role) or by an admin through
-- `run_automation_now()`, which does check the caller's role.
-- ============================================================================

-- ── Registry ────────────────────────────────────────────────────────────────

create table if not exists public.automation_rules (
  key              text primary key,
  name             text not null,
  description      text not null,
  enabled          boolean not null default true,
  /** Minimum minutes between runs. The dispatcher ticks more often than this. */
  interval_minutes int not null default 5 check (interval_minutes between 1 and 10080),
  /** Rule-specific thresholds. Shape is documented on each rule below. */
  config           jsonb not null default '{}'::jsonb,
  last_run_at      timestamptz,
  last_status      text,
  last_detail      text,
  updated_at       timestamptz not null default now()
);

comment on table public.automation_rules is
  'One row per background rule. Thresholds live in config so operations tunes them without a deploy.';

create table if not exists public.automation_runs (
  id          bigserial primary key,
  rule_key    text not null references public.automation_rules (key) on delete cascade,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running',   -- running | ok | error | skipped
  affected    int not null default 0,
  detail      text,
  /** Who asked. null = the scheduler. */
  triggered_by uuid
);

create index if not exists automation_runs_rule_idx
  on public.automation_runs (rule_key, started_at desc);

comment on table public.automation_runs is
  'Append-only log of automation executions. Retained 90 days by the hygiene rule.';

create table if not exists public.automation_events (
  id         bigserial primary key,
  rule_key   text not null,
  /** The thing acted on — incident, certification, roster row, silo. */
  entity_id  text not null,
  /** Which step of the rule fired: an escalation tier, a warning window, a date. */
  bucket     text not null,
  created_at timestamptz not null default now()
);

-- The whole point: one action per (rule, entity, bucket), ever.
create unique index if not exists automation_events_once_idx
  on public.automation_events (rule_key, entity_id, bucket);

create index if not exists automation_events_age_idx
  on public.automation_events (created_at);

comment on table public.automation_events is
  'Idempotency ledger. Stops a rule that runs every few minutes from re-alerting on the same thing.';

-- These are operational internals, not user data. RLS on with policies only for
-- reading, so the admin console can show the rules and the run log; all writing
-- goes through the SECURITY DEFINER functions below.
alter table public.automation_rules   enable row level security;
alter table public.automation_runs    enable row level security;
alter table public.automation_events  enable row level security;

drop policy if exists automation_rules_read on public.automation_rules;
create policy automation_rules_read on public.automation_rules for select
  using (public.role_in('SystemAdmin','SuperAdmin','Admin','Supervisor','ControlRoom','Operator'));

drop policy if exists automation_runs_read on public.automation_runs;
create policy automation_runs_read on public.automation_runs for select
  using (public.role_in('SystemAdmin','SuperAdmin','Admin','Supervisor','ControlRoom','Operator'));

drop policy if exists automation_rules_write on public.automation_rules;
create policy automation_rules_write on public.automation_rules for update
  using (public.role_in('SystemAdmin','SuperAdmin','Admin'))
  with check (public.role_in('SystemAdmin','SuperAdmin','Admin'));

-- ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Claim an action. Returns true the first time this (rule, entity, bucket) is
 * seen and false forever after — so callers read as:
 *
 *     if public.automation_claim('sla_unassigned', inc.id::text, 'critical') then
 *       ... raise the alert ...
 *     end if;
 */
create or replace function public.automation_claim(
  p_rule text, p_entity text, p_bucket text
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.automation_events (rule_key, entity_id, bucket)
  values (p_rule, p_entity, p_bucket);
  return true;
exception when unique_violation then
  return false;
end $$;

/** Config value with a fallback, so a malformed or partial config still runs. */
create or replace function public.automation_cfg_int(
  p_config jsonb, p_key text, p_default int
) returns int
language sql
immutable
as $$
  select coalesce(nullif(p_config ->> p_key, '')::int, p_default);
$$;

/**
 * Raise an alert from an automation.
 *
 * Separate from the app's `raiseAlert` because these have no `auth.uid()` —
 * they are the system speaking. `created_by_name` says so explicitly, so an
 * operator can always tell an automatic escalation from a colleague's.
 */
create or replace function public.automation_alert(
  p_silo        silo,
  p_title       text,
  p_body        text,
  p_severity    text default 'Medium',
  p_incident_id uuid default null,
  p_target_user uuid default null,
  p_link        text default null,
  p_presentation text default 'toast',
  p_expires_hours int default 24
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id uuid;
begin
  insert into public.alerts (
    silo, target_user_id, kind, severity, title, body, incident_id, link,
    presentation, requires_ack, created_by, created_by_name, expires_at
  ) values (
    p_silo, p_target_user, 'system', p_severity, p_title, p_body, p_incident_id, p_link,
    p_presentation, p_presentation = 'modal', null, 'Criticom automation',
    now() + make_interval(hours => p_expires_hours)
  )
  returning id into v_id;
  return v_id;
end $$;

-- ── Rule: unassigned calls are ageing ───────────────────────────────────────
-- config: { "warn_minutes": 10, "critical_minutes": 20 }
create or replace function public.automation_sla_unassigned(p_config jsonb)
returns table (affected int, detail text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_warn int := public.automation_cfg_int(p_config, 'warn_minutes', 10);
  v_crit int := public.automation_cfg_int(p_config, 'critical_minutes', 20);
  v_count int := 0;
  v_worst int := 0;
  r record;
  v_bucket text;
  v_age int;
begin
  for r in
    select i.id, i.silo, i.incident_number, i.incident_type, i.incident_severity,
           i.location_address, i.call_timestamp
      from public.incidents i
     where i.status in ('New','Pending','Pending Dispatch','Pending Analysis')
       and i.call_timestamp < now() - make_interval(mins => v_warn)
     order by i.call_timestamp
     limit 200
  loop
    v_age := floor(extract(epoch from (now() - r.call_timestamp)) / 60);
    v_bucket := case when v_age >= v_crit then 'critical' else 'warn' end;

    if public.automation_claim('sla_unassigned', r.id::text, v_bucket) then
      -- To the owning department and to the control room: the department has
      -- the crews, the control room owns the queue, and at the critical tier
      -- somebody senior needs to know it got that far.
      perform public.automation_alert(
        r.silo,
        format('Unassigned %s min — %s', v_age, r.incident_number),
        format('%s · %s · %s', r.incident_type, r.incident_severity, r.location_address),
        case when v_bucket = 'critical' then 'Critical' else 'High' end,
        r.id, null, '/dispatch/assign/' || r.id::text,
        case when v_bucket = 'critical' then 'modal' else 'toast' end,
        6
      );
      if r.silo <> 'Ethekwini' then
        perform public.automation_alert(
          'Ethekwini',
          format('Unassigned %s min — %s (%s)', v_age, r.incident_number, r.silo),
          format('%s · %s', r.incident_type, r.location_address),
          case when v_bucket = 'critical' then 'Critical' else 'High' end,
          r.id, null, '/dispatch/assign/' || r.id::text, 'toast', 6
        );
      end if;
      v_count := v_count + 1;
      v_worst := greatest(v_worst, v_age);
    end if;
  end loop;

  return query select v_count,
    case when v_count = 0 then 'No newly-breached calls'
    else format('%s call(s) escalated, oldest %s min', v_count, v_worst) end;
end $$;

-- ── Rule: dispatched but nobody has arrived ─────────────────────────────────
-- config: { "minutes": 30 }
create or replace function public.automation_sla_no_arrival(p_config jsonb)
returns table (affected int, detail text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_after int := public.automation_cfg_int(p_config, 'minutes', 30);
  v_count int := 0;
  r record;
begin
  for r in
    select i.id, i.silo, i.incident_number, i.incident_type, i.location_address,
           coalesce(i.dispatch_time, i.call_timestamp) as from_time
      from public.incidents i
     where i.status in ('Dispatched','En Route')
       and i.arrived_timestamp is null
       and coalesce(i.dispatch_time, i.call_timestamp) < now() - make_interval(mins => v_after)
     order by from_time
     limit 200
  loop
    if public.automation_claim('sla_no_arrival', r.id::text, 'overdue') then
      perform public.automation_alert(
        r.silo,
        format('No arrival after %s min — %s', v_after, r.incident_number),
        format('%s · %s. Confirm the crew is en route.', r.incident_type, r.location_address),
        'High', r.id, null, '/incidents/' || r.id::text, 'toast', 6
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return query select v_count,
    case when v_count = 0 then 'All dispatched calls progressing'
    else format('%s call(s) with no arrival past %s min', v_count, v_after) end;
end $$;

-- ── Rule: an open incident has gone quiet ───────────────────────────────────
-- config: { "hours": 4 }
create or replace function public.automation_stale_incidents(p_config jsonb)
returns table (affected int, detail text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hours int := public.automation_cfg_int(p_config, 'hours', 4);
  v_count int := 0;
  r record;
begin
  for r in
    select i.id, i.silo, i.incident_number, i.incident_type, i.status,
           greatest(
             coalesce(i.updated_at, i.incident_created_at),
             coalesce((select max(u.timestamp) from public.incident_updates u
                        where u.incident_id = i.id), i.incident_created_at)
           ) as last_touch
      from public.incidents i
     where i.status in ('En Route','Arrived','On Scene','Transporting','Active')
     order by i.incident_created_at
     limit 300
  loop
    continue when r.last_touch >= now() - make_interval(hours => v_hours);

    -- Bucketed by day so a genuinely long incident (a flood, a major fire)
    -- produces one nudge a day rather than one every four hours forever.
    if public.automation_claim('stale_incidents', r.id::text,
                               to_char(now() at time zone 'Africa/Johannesburg', 'YYYY-MM-DD')) then
      perform public.automation_alert(
        r.silo,
        format('No update in %s h — %s', v_hours, r.incident_number),
        format('%s, still %s. Ask the crew for a situation report or close it.',
               r.incident_type, r.status),
        'Medium', r.id, null, '/incidents/' || r.id::text, 'toast', 12
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return query select v_count,
    case when v_count = 0 then 'No stale incidents'
    else format('%s incident(s) with no update in %s h', v_count, v_hours) end;
end $$;

-- ── Rule: certifications about to lapse ─────────────────────────────────────
-- config: { "windows": "30,7,1" }  (days before expiry to warn at)
create or replace function public.automation_cert_expiry(p_config jsonb)
returns table (affected int, detail text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_windows int[] := coalesce(
    (select array_agg(trim(w)::int) from unnest(string_to_array(
       coalesce(nullif(p_config ->> 'windows', ''), '30,7,1'), ',')) w),
    array[30, 7, 1]
  );
  v_count int := 0;
  v_window int;
  r record;
begin
  foreach v_window in array v_windows loop
    for r in
      select c.id, c.silo, c.name, c.expiry_date,
             p.first_name, p.last_name, p.user_id
        from public.certifications c
        join public.personnel p on p.id = c.personnel_id
       where c.expiry_date between current_date and current_date + v_window
       limit 500
    loop
      if public.automation_claim('cert_expiry', r.id::text, v_window::text) then
        -- To the member, because it is their licence to fix …
        if r.user_id is not null then
          perform public.automation_alert(
            r.silo,
            format('%s expires %s', r.name, to_char(r.expiry_date, 'DD Mon')),
            format('Your %s lapses in %s day(s). Renewal has to be recorded before it does.',
                   r.name, (r.expiry_date - current_date)),
            case when v_window <= 7 then 'High' else 'Medium' end,
            null, r.user_id, '/profile/my-hr', 'toast', 72
          );
        end if;
        -- … and to the department, because rostering someone unqualified is
        -- the department's problem before it is theirs.
        perform public.automation_alert(
          r.silo,
          format('Certification lapsing — %s %s', r.first_name, r.last_name),
          format('%s expires %s (%s day(s)).', r.name,
                 to_char(r.expiry_date, 'DD Mon YYYY'), (r.expiry_date - current_date)),
          case when v_window <= 7 then 'High' else 'Low' end,
          null, null, '/hr', 'toast', 72
        );
        v_count := v_count + 1;
      end if;
    end loop;
  end loop;

  return query select v_count,
    case when v_count = 0 then 'No certifications entering a warning window'
    else format('%s certification warning(s) raised', v_count) end;
end $$;

-- ── Rule: a published duty nobody has acknowledged ──────────────────────────
-- config: { "lead_hours": 12 }
create or replace function public.automation_duty_unacknowledged(p_config jsonb)
returns table (affected int, detail text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lead int := public.automation_cfg_int(p_config, 'lead_hours', 12);
  v_count int := 0;
  r record;
begin
  for r in
    select ro.id, ro.silo, ro.user_id, ro.user_name, ro.post, ro.station,
           ro.start_at, ro.duty_date, ro.call_sign
      from public.rosters ro
     where ro.published
       and ro.acknowledged_at is null
       and ro.user_id is not null
       and ro.start_at is not null
       and ro.start_at between now() and now() + make_interval(hours => v_lead)
     limit 300
  loop
    if public.automation_claim('duty_unacknowledged', r.id::text, 'reminder') then
      perform public.automation_alert(
        r.silo,
        'Confirm your next duty',
        format('%s at %s, %s. Open My Schedule and acknowledge it.',
               coalesce(r.post, 'Duty'),
               to_char(r.start_at at time zone 'Africa/Johannesburg', 'HH24:MI on DD Mon'),
               coalesce(r.station, 'station TBC')),
        'Medium', null, r.user_id, '/roster/mine', 'toast', 24
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return query select v_count,
    case when v_count = 0 then 'All imminent duties acknowledged'
    else format('%s unacknowledged duty reminder(s)', v_count) end;
end $$;

-- ── Rule: the morning digest ────────────────────────────────────────────────
-- config: { "hour": 6 }  (local hour to send, Africa/Johannesburg)
create or replace function public.automation_daily_digest(p_config jsonb)
returns table (affected int, detail text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hour int := public.automation_cfg_int(p_config, 'hour', 6);
  v_local timestamptz := now() at time zone 'Africa/Johannesburg';
  v_today date := v_local::date;
  v_from timestamptz := (v_today - 1)::timestamp at time zone 'Africa/Johannesburg';
  v_to   timestamptz := v_today::timestamp at time zone 'Africa/Johannesburg';
  v_count int := 0;
  r record;
begin
  -- Only inside the sending hour. The dispatcher may tick many times within it;
  -- the claim below is what makes it once per silo per day.
  if extract(hour from v_local) <> v_hour then
    return query select 0, format('Outside the digest hour (%s:00)', v_hour);
    return;
  end if;

  for r in
    select i.silo,
           count(*)::int                                                as total,
           count(*) filter (where i.incident_severity = 'Critical')::int as critical,
           count(*) filter (where i.status in ('Closed','Resolved'))::int as closed,
           avg(extract(epoch from (i.arrived_timestamp - i.call_timestamp)) / 60.0)
             filter (where i.arrived_timestamp is not null)              as avg_response
      from public.incidents i
     where i.call_timestamp >= v_from and i.call_timestamp < v_to
     group by i.silo
  loop
    if public.automation_claim('daily_digest', r.silo::text, v_today::text) then
      perform public.automation_alert(
        r.silo,
        format('Yesterday: %s calls, %s closed', r.total, r.closed),
        format('%s Critical. Average response %s. Closure rate %s%%.',
               r.critical,
               case when r.avg_response is null then 'not recorded'
                    else round(r.avg_response)::text || ' min' end,
               case when r.total = 0 then '0'
                    else round((r.closed::numeric / r.total) * 100)::text end),
        'Low', null, null, '/analytics', 'toast', 12
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return query select v_count,
    case when v_count = 0 then 'Digest already sent, or no calls yesterday'
    else format('Digest sent to %s department(s)', v_count) end;
end $$;

-- ── Rule: housekeeping ──────────────────────────────────────────────────────
-- config: { "alert_days": 30, "run_days": 90, "event_days": 60 }
create or replace function public.automation_hygiene(p_config jsonb)
returns table (affected int, detail text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_alert_days int := public.automation_cfg_int(p_config, 'alert_days', 30);
  v_run_days   int := public.automation_cfg_int(p_config, 'run_days', 90);
  v_event_days int := public.automation_cfg_int(p_config, 'event_days', 60);
  v_alerts int; v_runs int; v_events int;
begin
  -- Alerts are a notification channel, not a record: the incident, its
  -- timeline and the audit log are what survive. Expired ones past the window
  -- are noise in every query that touches the table.
  with gone as (
    delete from public.alerts
     where created_at < now() - make_interval(days => v_alert_days)
       and (expires_at is null or expires_at < now())
    returning 1
  ) select count(*)::int into v_alerts from gone;

  with gone as (
    delete from public.automation_runs
     where started_at < now() - make_interval(days => v_run_days)
    returning 1
  ) select count(*)::int into v_runs from gone;

  -- Events older than this can never suppress anything: their entities are
  -- long closed. Keeping them would grow the ledger without bound.
  with gone as (
    delete from public.automation_events
     where created_at < now() - make_interval(days => v_event_days)
    returning 1
  ) select count(*)::int into v_events from gone;

  return query select (v_alerts + v_runs + v_events),
    format('Pruned %s alert(s), %s run(s), %s event(s)', v_alerts, v_runs, v_events);
end $$;

-- ── Dispatcher ──────────────────────────────────────────────────────────────

/**
 * Run every enabled rule whose interval has elapsed.
 *
 * Each rule runs inside its own exception block. A rule that throws — a schema
 * change it did not expect, a bad config value — records an error against
 * itself and the loop continues. The alternative is one broken rule silently
 * stopping SLA escalation, which is exactly the failure that must not happen
 * quietly.
 */
create or replace function public.run_automations(p_force_key text default null)
returns table (rule_key text, status text, affected int, detail text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r        record;
  v_run_id bigint;
  v_res    record;
begin
  for r in
    select * from public.automation_rules
     where (p_force_key is not null and key = p_force_key)
        or (p_force_key is null
            and enabled
            and (last_run_at is null
                 or last_run_at < now() - make_interval(mins => interval_minutes)))
     order by key
  loop
    insert into public.automation_runs (rule_key, triggered_by)
    values (r.key, auth.uid())
    returning id into v_run_id;

    begin
      case r.key
        when 'sla_unassigned'        then select * into v_res from public.automation_sla_unassigned(r.config);
        when 'sla_no_arrival'        then select * into v_res from public.automation_sla_no_arrival(r.config);
        when 'stale_incidents'       then select * into v_res from public.automation_stale_incidents(r.config);
        when 'cert_expiry'           then select * into v_res from public.automation_cert_expiry(r.config);
        when 'duty_unacknowledged'   then select * into v_res from public.automation_duty_unacknowledged(r.config);
        when 'daily_digest'          then select * into v_res from public.automation_daily_digest(r.config);
        when 'hygiene'               then select * into v_res from public.automation_hygiene(r.config);
        else
          raise exception 'Unknown automation rule "%"', r.key;
      end case;

      update public.automation_runs
         set finished_at = now(), status = 'ok',
             affected = v_res.affected, detail = v_res.detail
       where id = v_run_id;

      update public.automation_rules
         set last_run_at = now(), last_status = 'ok', last_detail = v_res.detail,
             updated_at = now()
       where key = r.key;

      rule_key := r.key; status := 'ok';
      affected := v_res.affected; detail := v_res.detail;
      return next;

    exception when others then
      update public.automation_runs
         set finished_at = now(), status = 'error', detail = sqlerrm
       where id = v_run_id;

      -- last_run_at still advances: a rule that throws every time must not
      -- retry on every tick and bury the log in identical failures.
      update public.automation_rules
         set last_run_at = now(), last_status = 'error', last_detail = sqlerrm,
             updated_at = now()
       where key = r.key;

      rule_key := r.key; status := 'error'; affected := 0; detail := sqlerrm;
      return next;
    end;
  end loop;
end $$;

comment on function public.run_automations(text) is
  'Scheduler entry point. Runs due rules, or one named rule regardless of its interval.';

revoke execute on function public.run_automations(text) from public, anon, authenticated;
grant execute on function public.run_automations(text) to service_role;

/** Admin "Run now" — same engine, with an authorisation check. */
create or replace function public.run_automation_now(p_key text)
returns table (rule_key text, status text, affected int, detail text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.require_role('SystemAdmin','SuperAdmin','Admin');
  if not exists (select 1 from public.automation_rules where key = p_key) then
    raise exception 'No automation rule "%"', p_key;
  end if;
  return query select * from public.run_automations(p_key);
end $$;

revoke execute on function public.run_automation_now(text) from public, anon;
grant execute on function public.run_automation_now(text) to authenticated, service_role;

-- Lock the rule functions down: they are called by the dispatcher, never
-- directly by a session.
do $$
declare fn text;
begin
  foreach fn in array array[
    'automation_sla_unassigned','automation_sla_no_arrival','automation_stale_incidents',
    'automation_cert_expiry','automation_duty_unacknowledged','automation_daily_digest',
    'automation_hygiene'
  ] loop
    execute format('revoke execute on function public.%I(jsonb) from public, anon, authenticated', fn);
    execute format('grant execute on function public.%I(jsonb) to service_role', fn);
  end loop;
end $$;

revoke execute on function public.automation_claim(text, text, text) from public, anon, authenticated;
revoke execute on function public.automation_alert(silo, text, text, text, uuid, uuid, text, text, int)
  from public, anon, authenticated;

-- ── Seed ────────────────────────────────────────────────────────────────────

insert into public.automation_rules (key, name, description, interval_minutes, config) values
  ('sla_unassigned', 'Unassigned call escalation',
   'Escalates calls still waiting for a department. Warns at the first threshold, interrupts at the second.',
   5, '{"warn_minutes": 10, "critical_minutes": 20}'),

  ('sla_no_arrival', 'No arrival recorded',
   'Flags calls dispatched some time ago where no crew has recorded arriving.',
   10, '{"minutes": 30}'),

  ('stale_incidents', 'Open incident gone quiet',
   'Nudges the department when an active incident has had no update for a while. At most one nudge a day per incident.',
   30, '{"hours": 4}'),

  ('cert_expiry', 'Certification expiry warnings',
   'Warns the member and their department as a certification approaches its expiry date.',
   720, '{"windows": "30,7,1"}'),

  ('duty_unacknowledged', 'Unacknowledged duty reminder',
   'Reminds members who have not confirmed a published duty starting soon.',
   60, '{"lead_hours": 12}'),

  ('daily_digest', 'Morning digest',
   'One summary per department each morning: volume, criticals, closure rate and average response.',
   30, '{"hour": 6}'),

  ('hygiene', 'Housekeeping',
   'Prunes expired alerts, old run logs and spent idempotency records.',
   1440, '{"alert_days": 30, "run_days": 90, "event_days": 60}')
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description;
