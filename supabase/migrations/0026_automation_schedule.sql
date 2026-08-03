-- ============================================================================
-- 0026 — Schedule the automation engine
-- ============================================================================
--
-- 0025 built the engine and left it inert. This starts the clock.
--
-- One cron job, every five minutes, calling `run_automations()`. Per-rule
-- cadence is the rule's own `interval_minutes`, so adding or retiming a rule is
-- an UPDATE, never a schedule change — and there is exactly one job to reason
-- about when something misfires at 03:00.
--
-- Five minutes is chosen against the tightest rule: unassigned-call escalation
-- warns at ten. A tick at half the shortest threshold bounds the lateness of an
-- escalation at five minutes, which is inside the tolerance of a
-- ten-minute SLA. Going faster would buy nothing and cost a query pass.
--
-- The whole thing is wrapped in an exception block on purpose. `pg_cron` is
-- available on this platform but is not guaranteed on every environment this
-- schema gets applied to — a local `supabase start`, a reviewer's throwaway
-- project, a self-hosted instance. A migration that hard-fails there would
-- block every later migration over a scheduler, so instead it degrades to a
-- clear notice: the engine is installed and callable, it simply is not being
-- ticked yet. `select public.run_automations();` from anything with a clock
-- (an external scheduler, a CI job, a person) is a complete substitute.
-- ============================================================================

do $$
declare
  v_has_cron boolean;
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron could not be enabled (%). Automations are installed but not scheduled — '
                 'call public.run_automations() from an external scheduler.', sqlerrm;
    return;
  end;

  select exists (select 1 from pg_extension where extname = 'pg_cron') into v_has_cron;
  if not v_has_cron then
    raise notice 'pg_cron is not present. Automations are installed but not scheduled.';
    return;
  end if;

  -- Re-applying this migration must not stack duplicate jobs, each raising its
  -- own copy of every alert.
  perform cron.unschedule(jobid) from cron.job where jobname = 'criticom-automations';

  perform cron.schedule(
    'criticom-automations',
    '*/5 * * * *',
    $job$ select public.run_automations(); $job$
  );

  raise notice 'Scheduled criticom-automations every 5 minutes.';
end $$;
