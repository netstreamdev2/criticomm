-- ============================================================================
-- 0028 — Rate limiting
-- ============================================================================
--
-- Several API routes spend money or third-party quota per call: the assistant
-- (Groq/Gemini), geocoding, the TomTom/FR24/Kpler proxies, PDF rendering,
-- RealPTT. All of them are authenticated, so this is not about anonymous abuse
-- — it is about the two things that actually happen to a running service:
--
--   • A bug. A `useEffect` with the wrong dependency array fires the assistant
--     on every render and burns a month's model budget in an afternoon.
--   • A borrowed session. A console left unlocked in a control room is the
--     realistic insider threat, and the realistic damage is quota, not data.
--
-- Kept in Postgres rather than in the process for one reason: the web app is
-- deployed serverless, so in-memory counters are per-instance. Ten concurrent
-- lambdas means ten times the intended limit, which is not a limit. One table
-- and one function give every instance the same view.
--
-- The identity is taken from `auth.uid()` inside the function rather than from
-- a caller-supplied key. A route handler cannot then get it wrong, and a caller
-- cannot spend someone else's budget or reset their own — the table itself is
-- unreachable under RLS.
--
-- Fixed windows, not a sliding log. A sliding window is more accurate at the
-- boundary and costs a row per request to store; for "stop a runaway loop" the
-- extra accuracy buys nothing worth the write volume.
-- ============================================================================

create table if not exists public.rate_limit_buckets (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        int not null default 0
);

comment on table public.rate_limit_buckets is
  'Fixed-window request counters, keyed <bucket>:<user id>. Written only by rate_limit_hit().';

-- No policies: RLS on with none defined denies every direct read and write.
-- The SECURITY DEFINER function below is the only way in.
alter table public.rate_limit_buckets enable row level security;

/**
 * Count one request against a bucket and say whether it is allowed.
 *
 * Returns the decision plus what the caller needs to answer honestly: how many
 * requests remain, and when the window resets. A 429 with no reset time tells a
 * client nothing except to retry blindly.
 */
create or replace function public.rate_limit_hit(
  p_bucket         text,
  p_limit          int,
  p_window_seconds int
)
returns table (allowed boolean, remaining int, reset_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid := auth.uid();
  v_key    text;
  v_window interval := make_interval(secs => greatest(1, p_window_seconds));
  v_limit  int := greatest(1, p_limit);
  v_row    public.rate_limit_buckets;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_key := p_bucket || ':' || v_uid::text;

  -- One statement so concurrent requests serialise on the row lock rather than
  -- racing to read-modify-write. The CASE resets the window in the same
  -- operation that increments it, which is what makes this safe under
  -- concurrency: there is no moment where a stale window is visible.
  insert into public.rate_limit_buckets (key, window_start, count)
  values (v_key, now(), 1)
  on conflict (key) do update
    set window_start = case
                         when public.rate_limit_buckets.window_start < now() - v_window
                           then now()
                         else public.rate_limit_buckets.window_start
                       end,
        count        = case
                         when public.rate_limit_buckets.window_start < now() - v_window
                           then 1
                         else public.rate_limit_buckets.count + 1
                       end
  returning * into v_row;

  return query select
    v_row.count <= v_limit,
    greatest(0, v_limit - v_row.count),
    v_row.window_start + v_window;
end $$;

comment on function public.rate_limit_hit(text, int, int) is
  'Counts one request for the calling user against a named bucket. Identity comes from auth.uid(), never the caller.';

revoke execute on function public.rate_limit_hit(text, int, int) from public, anon;
grant execute on function public.rate_limit_hit(text, int, int) to authenticated, service_role;

-- Abandoned buckets (a user who stopped calling, a route that was retired)
-- would otherwise accumulate one row per user per bucket forever.
create index if not exists rate_limit_buckets_window_idx
  on public.rate_limit_buckets (window_start);

create or replace function public.automation_rate_limit_gc(p_config jsonb)
returns table (affected int, detail text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hours int := public.automation_cfg_int(p_config, 'stale_hours', 24);
  v_gone int;
begin
  with dead as (
    delete from public.rate_limit_buckets
     where window_start < now() - make_interval(hours => v_hours)
    returning 1
  ) select count(*)::int into v_gone from dead;

  return query select v_gone, format('Cleared %s stale rate-limit bucket(s)', v_gone);
end $$;

revoke execute on function public.automation_rate_limit_gc(jsonb) from public, anon, authenticated;
grant execute on function public.automation_rate_limit_gc(jsonb) to service_role;

-- Wire it into the existing engine (0025) rather than adding a second
-- scheduler. The dispatcher's CASE needs the new key.
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
        when 'sla_unassigned'      then select * into v_res from public.automation_sla_unassigned(r.config);
        when 'sla_no_arrival'      then select * into v_res from public.automation_sla_no_arrival(r.config);
        when 'stale_incidents'     then select * into v_res from public.automation_stale_incidents(r.config);
        when 'cert_expiry'         then select * into v_res from public.automation_cert_expiry(r.config);
        when 'duty_unacknowledged' then select * into v_res from public.automation_duty_unacknowledged(r.config);
        when 'daily_digest'        then select * into v_res from public.automation_daily_digest(r.config);
        when 'hygiene'             then select * into v_res from public.automation_hygiene(r.config);
        when 'rate_limit_gc'       then select * into v_res from public.automation_rate_limit_gc(r.config);
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

      update public.automation_rules
         set last_run_at = now(), last_status = 'error', last_detail = sqlerrm,
             updated_at = now()
       where key = r.key;

      rule_key := r.key; status := 'error'; affected := 0; detail := sqlerrm;
      return next;
    end;
  end loop;
end $$;

revoke execute on function public.run_automations(text) from public, anon, authenticated;
grant execute on function public.run_automations(text) to service_role;

insert into public.automation_rules (key, name, description, interval_minutes, config) values
  ('rate_limit_gc', 'Rate-limit housekeeping',
   'Clears rate-limit counters whose window closed long ago.',
   360, '{"stale_hours": 24}')
on conflict (key) do update
  set name = excluded.name, description = excluded.description;
