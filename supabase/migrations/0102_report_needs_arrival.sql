-- ============================================================================
-- 0102 — No report until the arrival is proven
-- ============================================================================
--
-- Run after 0099 (and 0100, 0101).
--
-- 0099 lets a crew press "I'm on scene" by hand, so a dead GPS never stops an
-- emergency, but flags it "not verified" when the phone was not near the
-- scene. A flagged arrival could still file the report, which is the fraud
-- dispatch raised: on scene from across town, report filed, call closed.
--
-- Now:
--   * The report (Police, Fire and EMS) is refused while the officer's own
--     arrival is flagged not verified. It goes through once:
--       - the phone's position shows they were there (the flag clears by
--         itself as soon as those fixes arrive, 0099), or
--       - dispatch confirms the arrival, saying how they know
--         (confirm_arrival below: "Called the officer", "Seen on the bodycam").
--   * Arrivals by GPS, by the desk (radio crews), and arrivals from before
--     0099 are not affected. The desk filing a report for a radio crew (0075)
--     is not affected.
--
-- The geofence itself stays the Operations Setting dispatch.arrive_radius_m
-- (150 m by default, 50 to 1000), with the phone's own accuracy allowed for
-- (up to 100 m more), as 0099.
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. The report waits for a proven arrival ───────────────────────────────

create or replace function public.guard_report_arrival()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.incident_id is null or auth.uid() is null then return new; end if;
  if exists (
    select 1 from public.incident_responders r
     where r.incident_id = new.incident_id and r.user_id = auth.uid() and r.arrived_verified is false
  ) then
    raise exception 'Your arrival at the scene is not confirmed yet. It confirms itself when your phone''s position shows you there, or ask dispatch to confirm it. Then file the report.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.guard_report_arrival() from public, anon, authenticated;

drop trigger if exists metro_reports_need_arrival on public.metro_reports;
create trigger metro_reports_need_arrival before insert on public.metro_reports
  for each row execute function public.guard_report_arrival();

drop trigger if exists firefighter_reports_need_arrival on public.firefighter_reports;
create trigger firefighter_reports_need_arrival before insert on public.firefighter_reports
  for each row execute function public.guard_report_arrival();

drop trigger if exists paramedic_reports_need_arrival on public.paramedic_reports;
create trigger paramedic_reports_need_arrival before insert on public.paramedic_reports
  for each row execute function public.guard_report_arrival();

-- ── 2. Dispatch confirms an arrival ────────────────────────────────────────

/**
 * The desk confirms that a department's crew is at the scene, saying how it
 * knows. Clears the "not verified" flag on everyone of that department on the
 * call, so the report can be filed. Told on the timeline and audited.
 */
create or replace function public.confirm_arrival(p_incident uuid, p_silo public.silo, p_note text)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_incident public.incidents;
  v_name     text;
  v_note     text := nullif(left(btrim(coalesce(p_note, '')), 200), '');
  v_count    integer;
begin
  select * into v_incident from public.incidents where id = p_incident and tenant_id = public.current_tenant();
  if not found then raise exception 'Incident not found' using errcode = 'P0002'; end if;
  if not public.can_direct_department(p_silo) then
    raise exception 'Only that department''s dispatch or command confirms an arrival' using errcode = '42501';
  end if;
  if v_note is null then raise exception 'Say how you know they are there' using errcode = '22023'; end if;
  select full_name into v_name from public.profiles where id = auth.uid();

  with done as (
    update public.incident_responders
       set arrived_verified = true,
           arrive_note = left(concat_ws(' · ', arrive_note, format('Confirmed by %s: %s', coalesce(v_name, 'dispatch'), v_note)), 300),
           updated_at = now()
     where incident_id = p_incident and silo = p_silo and arrived_verified is false
    returning 1
  )
  select count(*) into v_count from done;
  if v_count = 0 then
    raise exception 'Nothing to confirm: the arrival is already confirmed' using errcode = '22023';
  end if;

  update public.incident_departments
     set arrived_verified = true, updated_at = now()
   where incident_id = p_incident and silo = p_silo and arrived_verified is false;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, p_incident,
    format('[STATUS] Arrival confirmed by dispatch · %s — %s: %s', public.department_label(p_silo), coalesce(v_name, 'dispatch'), v_note),
    auth.uid(), v_name);
  update public.incidents set updated_at = now() where id = p_incident;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, p_silo, auth.uid(), v_name, 'ArrivalConfirmed', 'incident', p_incident::text,
          format('%s · %s: %s', v_incident.incident_number, public.department_label(p_silo), v_note));
  return v_count;
end $$;
revoke all on function public.confirm_arrival(uuid, public.silo, text) from public, anon;
grant execute on function public.confirm_arrival(uuid, public.silo, text) to authenticated;

notify pgrst, 'reload schema';
