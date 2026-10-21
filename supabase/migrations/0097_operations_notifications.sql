-- ============================================================================
-- 0097 — The live operations feed, kept as notifications for the dispatch desks
-- ============================================================================
--
-- Run after 0096.
--
-- A dispatcher saw a new call, and a crew going en route, only while the
-- console was open in front of them: the cards came from the live link and
-- were gone. Away from the desk (lunch, another window, the computer off) the
-- call came and went unseen.
--
-- Now every step of the live operations feed is also kept as a notification
-- for the dispatch desks (Dispatcher, ControlRoom) of the call's departments
-- and of the control room, the same desks that see the call (0068):
--
--   a new call                 New Critical call ETK-MP-MD-…
--   Dispatched                 ETK-… · Unit dispatched
--   En Route                   ETK-… · Unit en route
--   Arrived / On Scene         ETK-… · Unit on scene      (told once)
--   Transporting               ETK-… · Transporting
--   Resolved                   ETK-… · Call resolved
--   Closed                     ETK-… · Call closed
--
-- Each is read or unread per person (alert_reads), so what someone missed
-- waits in the bell and the notifications page, and the console says so with
-- a sound when they are back. An officer's SOS raises its own alarm (0043)
-- and is not repeated here. They expire after 7 days.
--
-- Safe to re-run.
-- ============================================================================

create or replace function public.notify_desks_of_call()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_kind  text;
  v_title text;
  v_word  text;
  v_silos public.silo[];
begin
  if tg_op = 'INSERT' then
    -- An officer's SOS has its own alarm.
    if new.source = 'Responder-Panic' then return new; end if;
    v_kind := 'incident_new';
    v_title := format('New %s call %s', new.incident_severity, new.incident_number);
  else
    if new.status is not distinct from old.status then return new; end if;
    -- Arrived, then On Scene: the desk is told once.
    if new.status::text = 'On Scene' and old.status::text = 'Arrived' then return new; end if;
    v_word := case new.status::text
      when 'Dispatched' then 'Unit dispatched'
      when 'En Route' then 'Unit en route'
      when 'Arrived' then 'Unit on scene'
      when 'On Scene' then 'Unit on scene'
      when 'Transporting' then 'Transporting'
      when 'Resolved' then 'Call resolved'
      when 'Closed' then 'Call closed'
    end;
    if v_word is null then return new; end if;
    v_kind := 'incident_update';
    v_title := format('%s · %s', new.incident_number, v_word);
  end if;

  -- The desks that see the call: its departments, and the control room.
  v_silos := array(
    select distinct s from unnest(
      coalesce(new.tagged_silos, '{}') || coalesce(new.dispatched_silos, '{}') || array[new.silo, 'Ethekwini'::public.silo]
    ) s
  );

  insert into public.alerts (
    tenant_id, silo, audience, target_roles, all_departments, kind, severity, title, body,
    incident_id, link, presentation, requires_ack, expires_at
  )
  select new.tenant_id, s, 'role', array['Dispatcher', 'ControlRoom']::public.user_role[], false, v_kind,
         new.incident_severity::text, v_title,
         concat_ws(' · ', new.incident_type, nullif(new.location_address, '')),
         new.id, '/incidents/' || new.id::text, 'toast', false, now() + interval '7 days'
    from unnest(v_silos) s;
  return new;
end $$;
revoke all on function public.notify_desks_of_call() from public, anon, authenticated;

drop trigger if exists incidents_notify_desks on public.incidents;
create trigger incidents_notify_desks
  after insert or update of status on public.incidents
  for each row execute function public.notify_desks_of_call();

notify pgrst, 'reload schema';
