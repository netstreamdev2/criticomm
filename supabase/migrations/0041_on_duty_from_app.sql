-- ============================================================================
-- 0041 — On duty means on duty in the app, and nothing else
-- ============================================================================
--
-- Run after 0040.
--
-- personnel.is_on_duty was a plain flag: seed scripts, admin edits and old
-- sessions that never signed off all left it true, so dispatch listed people
-- last seen weeks ago. From here the flag is only ever turned on by the
-- officer themselves, from the app, after today's start of shift (readiness,
-- 187(c) vehicle sheet, firearm step) — toggle_duty() and the heartbeat that
-- reuses it. Everything that reads is_on_duty (dispatch list, route_incident,
-- push, dashboards) is therefore right without changing each reader.
--
--   duty_started_at           when the officer went on duty in the app
--   guard_duty_clearance()    on-duty only by the officer, from the app
--   stamp_duty_started()      keeps duty_started_at honest
--   mirror_duty_to_profile()  profiles.is_on_duty follows personnel
--   expire_stale_duty()       auto off-duty after duty.max_shift_hours
--                             (default 14h; never mid-call — 0039 holds them)
--
-- One-time cleanup: everyone the app has not put on duty today goes off duty,
-- except officers still working an open call (held by 0039 until they file).
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. When the shift started ───────────────────────────────────────────────

alter table public.personnel add column if not exists duty_started_at timestamptz;

-- ── 2. One-time cleanup (before the new triggers, so it runs under 0036/0039)

-- toggle_duty() is the only writer of personnel.last_login, and it succeeds
-- only after today's start of shift. So a login stamp from today is the app
-- having put the officer on duty today; anything else is stale.
update public.personnel
set is_on_duty = false
where is_on_duty
  and (last_login is null or last_login < public.sa_today_start());

-- Whoever is left (on duty today, or held mid-call) gets a start time.
update public.personnel
set duty_started_at = coalesce(last_login, now())
where is_on_duty and duty_started_at is null;

update public.personnel
set duty_started_at = null
where not is_on_duty and duty_started_at is not null;

-- The app never wrote profiles.is_on_duty; bring it in line once.
update public.profiles pr
set is_on_duty = exists (
  select 1 from public.personnel p where p.user_id = pr.id and p.is_on_duty
)
where pr.is_on_duty is distinct from exists (
  select 1 from public.personnel p where p.user_id = pr.id and p.is_on_duty
);

-- ── 3. Only the officer, from the app, puts themselves on duty ──────────────

-- A person doing it any other way is refused with the reason. A write with no
-- signed-in user (seed script, service key, SQL editor) is quietly left off
-- duty, so one stale row never fails a whole batch.
create or replace function public.guard_duty_clearance() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.is_on_duty := false;
    return new;
  end if;

  if new.is_on_duty and not old.is_on_duty then
    if auth.uid() is null then
      new.is_on_duty := false;
    elsif new.user_id is distinct from auth.uid() then
      raise exception 'Officers go on duty themselves, from the HikTech app, after start of shift';
    elsif not public.has_completed_shift_start_today() then
      raise exception 'Complete today''s readiness and vehicle inspection first';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_duty_clearance_update on public.personnel;
create trigger guard_duty_clearance_update before insert or update of is_on_duty on public.personnel
  for each row execute function public.guard_duty_clearance();

-- ── 4. duty_started_at follows the final flag ───────────────────────────────

-- Named to sort after hold_duty_during_call (0039), which may put an officer
-- back on duty mid-call; this reads the flag after that decision. It fires on
-- every update so the officer's own row policy cannot rewrite the stamp.
create or replace function public.stamp_duty_started() returns trigger
language plpgsql set search_path = public as $$
begin
  if not new.is_on_duty then
    new.duty_started_at := null;
  elsif tg_op = 'INSERT' or not old.is_on_duty then
    new.duty_started_at := now();
  else
    new.duty_started_at := coalesce(old.duty_started_at, now());
  end if;
  return new;
end $$;

drop trigger if exists stamp_duty_started on public.personnel;
create trigger stamp_duty_started before insert or update on public.personnel
  for each row execute function public.stamp_duty_started();

-- ── 5. profiles.is_on_duty follows personnel ────────────────────────────────

create or replace function public.mirror_duty_to_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null then
    update public.profiles
    set is_on_duty = new.is_on_duty
    where id = new.user_id and is_on_duty is distinct from new.is_on_duty;
  end if;
  return null;
end $$;

drop trigger if exists mirror_duty_to_profile on public.personnel;
create trigger mirror_duty_to_profile after insert or update of is_on_duty on public.personnel
  for each row execute function public.mirror_duty_to_profile();

-- ── 6. Forgotten sign-offs expire ───────────────────────────────────────────

-- Hours come from Operations Settings (duty.max_shift_hours, per tenant),
-- clamped to the same 4–24 the admin screen allows. Officers on an open call
-- are held on duty by hold_duty_during_call() and expire after they file.
create or replace function public.expire_stale_duty() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  update public.personnel p
  set is_on_duty = false
  where p.is_on_duty
    and p.duty_started_at < now() - make_interval(hours => greatest(4, least(24, coalesce((
      select case when jsonb_typeof(s.value) = 'number' then (s.value)::text::numeric end
      from public.app_settings s
      where s.tenant_id = p.tenant_id and s.key = 'duty.max_shift_hours'
    ), 14)))::int);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.expire_stale_duty() from public, anon, authenticated;

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%). Call public.expire_stale_duty() from an external scheduler.', sqlerrm;
    return;
  end;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not present. Call public.expire_stale_duty() from an external scheduler.';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'criticom-duty-expiry';
  perform cron.schedule('criticom-duty-expiry', '*/5 * * * *', $job$ select public.expire_stale_duty(); $job$);
  raise notice 'Scheduled criticom-duty-expiry every 5 minutes.';
end $$;

notify pgrst, 'reload schema';
