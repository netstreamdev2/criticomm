-- ============================================================================
-- 0096 — ETK incident numbers: the date and time first, the departments when known
-- ============================================================================
--
-- Run after 0095. Replaces 0077's number for new calls only.
--
-- eThekwini's numbers start with ETK. A call sent to dispatch early (0076),
-- while the logger is still filling it in, is numbered by its date, time and
-- number of the day alone:
--
--   ETK-20261021-1206-0001
--
-- When the logger finishes it, the departments it was sent to go in after
-- ETK, in a fixed order (MP Metro Police, FD Fire, MD EMS, DM Disaster
-- Management), each with a dash:
--
--   ETK-MP-MD-20261021-1206-0001
--
-- A department added later (by the logger or a dispatcher) goes in too:
--
--   ETK-MP-FD-MD-20261021-1206-0001
--
-- A call logged in one go has its departments from the start. A department
-- once in the number stays in it. CR stands for a call no department was
-- named for (an SOS raised from the control room). The date, time and number
-- of the day never change, so searching for them always finds the call.
--
-- Calls numbered before this keep their numbers (MP-…, MPFD-MD-…, INC-…).
--
--   next_incident_number()      ETK, the South African date and time, and
--                               the number of the day.
--   incident_number_with_departments()  the number with the call's departments.
--   incidents_number_departments        the trigger that keeps it so, on
--                               every insert and every change of the call's
--                               departments or of its being finished.
--
-- Safe to re-run.
-- ============================================================================

create or replace function public.next_incident_number(p_silo silo, p_tags silo[], p_at timestamptz default now())
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid := public.current_tenant();
  v_local  timestamp := coalesce(p_at, now()) at time zone 'Africa/Johannesburg';
  v_seq    integer;
begin
  insert into public.incident_day_counters (tenant_id, day, last_seq)
  values (v_tenant, v_local::date, 1)
  on conflict (tenant_id, day)
    do update set last_seq = public.incident_day_counters.last_seq + 1
  returning last_seq into v_seq;

  -- The departments go in when the call is finished (the trigger below).
  return 'ETK-' || to_char(v_local, 'YYYYMMDD') || '-' || to_char(v_local, 'HH24MI')
      || '-' || case when v_seq < 10000 then lpad(v_seq::text, 4, '0') else v_seq::text end;
end $$;

/**
 * An ETK number with the call's departments: ETK-MP-MD-20261021-1206-0001.
 * Unfinished calls keep the bare number; a code already in it stays; numbers
 * from before 0096 come back as they are.
 */
create or replace function public.incident_number_with_departments(
  p_number   text,
  p_silo     silo,
  p_tags     silo[],
  p_sent     silo[],
  p_finished boolean
) returns text language plpgsql immutable set search_path to 'public' as $$
declare
  v_core  text;
  v_had   text;
  v_all   silo[] := coalesce(p_tags, '{}') || coalesce(p_sent, '{}') || case when p_silo is null then '{}'::silo[] else array[p_silo] end;
  v_codes text[] := '{}';
begin
  if p_number is null or p_number not like 'ETK-%' then return p_number; end if;
  v_core := substring(p_number from '(\d{8}-\d{4}-\d{4,6})$');
  if v_core is null then return p_number; end if;
  -- Still being logged: the date and time, no departments yet.
  if not coalesce(p_finished, true) then return p_number; end if;

  -- What is in the number already stays in it.
  v_had := substring(p_number from '^ETK-(.*)-\d{8}-\d{4}-\d{4,6}$');
  if 'MetroPolice' = any (v_all) or v_had ~ '(^|-)MP(-|$)' then v_codes := array_append(v_codes, 'MP'); end if;
  if 'MetroFire' = any (v_all) or v_had ~ '(^|-)FD(-|$)' then v_codes := array_append(v_codes, 'FD'); end if;
  if 'Medical' = any (v_all) or v_had ~ '(^|-)MD(-|$)' then v_codes := array_append(v_codes, 'MD'); end if;
  if 'EthekwiniDisaster' = any (v_all) or v_had ~ '(^|-)DM(-|$)' then v_codes := array_append(v_codes, 'DM'); end if;
  if cardinality(v_codes) = 0 then v_codes := array['CR']; end if;

  return 'ETK-' || array_to_string(v_codes, '-') || '-' || v_core;
end $$;
revoke all on function public.incident_number_with_departments(text, silo, silo[], silo[], boolean) from public, anon;
grant execute on function public.incident_number_with_departments(text, silo, silo[], silo[], boolean) to authenticated, service_role;

create or replace function public.incidents_number_departments()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.incident_number := public.incident_number_with_departments(
    new.incident_number, new.silo, new.tagged_silos, new.dispatched_silos, new.intake_complete);
  return new;
end $$;

drop trigger if exists incidents_number_departments on public.incidents;
create trigger incidents_number_departments
  before insert or update of silo, tagged_silos, dispatched_silos, intake_complete, incident_number
  on public.incidents
  for each row execute function public.incidents_number_departments();

notify pgrst, 'reload schema';
