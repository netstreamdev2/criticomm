-- ============================================================================
-- 0081 — The call logger logs calls and watches them unfold; nothing more
-- ============================================================================
--
-- Run after 0080.
--
-- A call logger (IncidentLogger) logs calls, finishes the ones they sent
-- early, and watches every call as it unfolds: the call, its timeline, its
-- map and its photos. They never review or close a case (close_case already
-- refuses them, 0061), and with this:
--
--   * they no longer read the departments' reports (police, fire, patient
--     care, post-mortem). is_global() let them read every one, and
--     can_work_incident() every one on any call. A patient care report is a
--     medical record.
--   * on a call they did not log, they add nothing: no update, no attachment,
--     no file. On their own calls they still attach what the caller sent.
--
-- Also: the case manager reads police reports as they already read the fire,
-- patient care and post-mortem ones (0059, 0063, 0065), for the police
-- reporting pages and the case review.
--
-- Everyone else reads exactly what they read before. Safe to re-run.
-- ============================================================================

/** Reads every department's reports: the roles is_global() named, less the call logger, plus the case manager. */
create or replace function public.reads_all_reports()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.role_in('SystemAdmin', 'SuperAdmin', 'Dispatcher', 'Operator', 'ControlRoom', 'Viewer', 'System',
                        'SystemController', 'CaseManager')
$$;
revoke all on function public.reads_all_reports() from public, anon;
grant execute on function public.reads_all_reports() to authenticated, service_role;

-- ── 1. The reports: their own department, or the roles above; never the call logger ──

drop policy if exists metro_reports_read on public.metro_reports;
create policy metro_reports_read on public.metro_reports for select to authenticated
  using ((silo = public.current_silo() or public.reads_all_reports()) and not public.role_in('IncidentLogger'));
drop policy if exists metro_reports_worked_read on public.metro_reports;
create policy metro_reports_worked_read on public.metro_reports for select to authenticated
  using (incident_id is not null and public.can_work_incident(incident_id) and not public.role_in('IncidentLogger'));

drop policy if exists fire_reports_read on public.firefighter_reports;
create policy fire_reports_read on public.firefighter_reports for select to authenticated
  using ((silo = public.current_silo() or public.reads_all_reports()) and not public.role_in('IncidentLogger'));
drop policy if exists fire_reports_worked_read on public.firefighter_reports;
create policy fire_reports_worked_read on public.firefighter_reports for select to authenticated
  using (incident_id is not null and public.can_work_incident(incident_id) and not public.role_in('IncidentLogger'));

drop policy if exists paramedic_reports_read on public.paramedic_reports;
create policy paramedic_reports_read on public.paramedic_reports for select to authenticated
  using ((silo = public.current_silo() or public.reads_all_reports()) and not public.role_in('IncidentLogger'));
drop policy if exists paramedic_reports_worked_read on public.paramedic_reports;
create policy paramedic_reports_worked_read on public.paramedic_reports for select to authenticated
  using (incident_id is not null and public.can_work_incident(incident_id) and not public.role_in('IncidentLogger'));

drop policy if exists post_mortem_read on public.post_mortem_reports;
create policy post_mortem_read on public.post_mortem_reports for select to authenticated
  using ((silo = public.current_silo() or public.reads_all_reports()) and not public.role_in('IncidentLogger'));
drop policy if exists post_mortem_worked_read on public.post_mortem_reports;
create policy post_mortem_worked_read on public.post_mortem_reports for select to authenticated
  using (incident_id is not null and public.can_work_incident(incident_id) and not public.role_in('IncidentLogger'));

-- ── 2. Adding to a call: the call logger only to the calls they logged ───────

/** The call logger adds to a call only when they logged it; anyone else as before. */
create or replace function public.may_add_to_incident(p_incident_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select not public.role_in('IncidentLogger')
      or exists (select 1 from public.incidents i
                  where i.id = p_incident_id and i.created_by = auth.uid() and i.tenant_id = public.current_tenant())
$$;
revoke all on function public.may_add_to_incident(uuid) from public, anon;
grant execute on function public.may_add_to_incident(uuid) to authenticated, service_role;

-- Restrictive: every insert must also pass these, whichever rule lets it in
-- (0002, 0019 and 0003 let the call logger add to any call).
drop policy if exists incident_updates_logger_own on public.incident_updates;
create policy incident_updates_logger_own on public.incident_updates as restrictive for insert to authenticated
  with check (public.may_add_to_incident(incident_id));

drop policy if exists incident_attachments_logger_own on public.incident_attachments;
create policy incident_attachments_logger_own on public.incident_attachments as restrictive for insert to authenticated
  with check (public.may_add_to_incident(incident_id));

-- Evidence files: path is <silo>/<incident_id>/<kind>/<file>. Other buckets are untouched.
drop policy if exists incident_media_logger_own on storage.objects;
create policy incident_media_logger_own on storage.objects as restrictive for insert to authenticated
  with check (
    bucket_id <> 'incident-media'
    or public.may_add_to_incident(public.try_uuid((storage.foldername(name))[2]))
  );

notify pgrst, 'reload schema';
