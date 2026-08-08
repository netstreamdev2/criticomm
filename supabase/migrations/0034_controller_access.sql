-- 0034 — SystemController access to the modules it runs from the dashboard
--
-- 0033 gave the controller global read (is_global) and global write
-- (can_write_global), which covers everything policy-checked through those
-- helpers. Three older policies name their roles explicitly and predate the
-- seat, so the controller must be added by hand:
--
--   leave_entries  the command dashboard approves and rejects leave inline
--   alerts         approving leave notifies the member via raiseAlert()
--   rosters        the controller adjusts the duty board it monitors

drop policy if exists leave_self_read on public.leave_entries;
create policy leave_self_read on public.leave_entries for select
  using (user_id = auth.uid()
         or public.role_in('Supervisor','SystemAdmin','SuperAdmin','Admin','SystemController'));

drop policy if exists leave_admin_all on public.leave_entries;
create policy leave_admin_all on public.leave_entries for all
  using (public.role_in('Supervisor','SystemAdmin','SuperAdmin','Admin','SystemController'))
  with check (public.role_in('Supervisor','SystemAdmin','SuperAdmin','Admin','SystemController'));

drop policy if exists alerts_write on public.alerts;
create policy alerts_write on public.alerts for insert
  with check (
    public.role_in(
      'Dispatcher','ControlRoom','Operator','IncidentLogger','Supervisor','Captain',
      'Chief','FireChief','CaseManager','Admin','SystemAdmin','SuperAdmin','System',
      'SystemController'
    )
  );

drop policy if exists rosters_supervisor_all on public.rosters;
create policy rosters_supervisor_all on public.rosters for all
  using (public.role_in('Supervisor','SystemAdmin','SuperAdmin','SystemController')
         and (silo = public.current_silo() or public.is_global()))
  with check (public.role_in('Supervisor','SystemAdmin','SuperAdmin','SystemController')
              and (silo = public.current_silo() or public.is_global()));
