-- ============================================================================
-- 0093 — Dismissing an SOS pressed by mistake
-- ============================================================================
--
-- Run after 0092.
--
-- An officer's SOS (raise_panic, 0043 → 0077) is a Critical call in the
-- dispatch queue plus an alert to each desk. One pressed by mistake used to
-- stay on the map, in everyone's alerts and in Criti until someone worked it
-- as a real call. Now the control room can dismiss it, from the map, the
-- alerts, Criti or the call itself, with a reason. It then:
--
--   * leaves the live screens: the call is marked Resolved, labelled as a
--     dismissed SOS (who, when, why). Never Closed: closing stays the case
--     review's (0061), and a dismissed SOS is not a case to review;
--   * leaves everyone's alerts: its SOS alerts are withdrawn (0084);
--   * stays on the record: the call, its alerts, a line on its timeline and
--     an audit entry (SosDismissed) with the reason. Nothing is deleted.
--
-- Who: the system administrators, the system controller and dispatch. A
-- department's dispatch desk dismisses the SOS calls sent to it (its desk
-- scope, 0068, holds that line as for any change to a call).
--
-- Safe to re-run.
-- ============================================================================

alter table public.incidents add column if not exists sos_dismissed_at      timestamptz;
alter table public.incidents add column if not exists sos_dismissed_by      uuid;
alter table public.incidents add column if not exists sos_dismissed_by_name text;
alter table public.incidents add column if not exists sos_dismiss_reason    text
  check (sos_dismiss_reason is null or length(sos_dismiss_reason) between 3 and 300);

create index if not exists incidents_sos_dismissed_idx on public.incidents (tenant_id, sos_dismissed_at)
  where sos_dismissed_at is not null;

/** Dismiss an SOS: off the live screens and out of the alerts, on the record with the reason. */
create or replace function public.dismiss_sos(p_incident uuid, p_reason text)
returns public.incidents language plpgsql security definer set search_path to 'public' as $$
declare
  v_inc     public.incidents;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_name    text;
  v_alerts  int;
begin
  perform public.require_role('SuperAdmin', 'SystemAdmin', 'SystemController', 'Dispatcher');
  if public.current_tenant() is null then
    raise exception 'No organisation for this account' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'Say why the SOS is dismissed' using errcode = '22023';
  end if;
  if length(v_reason) > 300 then raise exception 'Keep the reason short' using errcode = '22023'; end if;

  select * into v_inc from public.incidents
   where id = p_incident and tenant_id = public.current_tenant()
   for update;
  if not found then raise exception 'Call not found' using errcode = 'P0002'; end if;
  if v_inc.source is distinct from 'Responder-Panic' then
    raise exception '% is not an SOS', v_inc.incident_number using errcode = '22023';
  end if;
  -- Dismissed already: the same answer, nothing done twice.
  if v_inc.sos_dismissed_at is not null then return v_inc; end if;
  if v_inc.status in ('Resolved', 'Closed') then
    raise exception '% is already finished', v_inc.incident_number using errcode = '22023';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();

  -- Resolved, labelled. The desk scope trigger (0068) refuses another department's desk.
  update public.incidents set
    status                = 'Resolved',
    resolved_at           = coalesce(resolved_at, now()),
    sos_dismissed_at      = now(),
    sos_dismissed_by      = auth.uid(),
    sos_dismissed_by_name = v_name,
    sos_dismiss_reason    = v_reason,
    notes                 = concat_ws(E'\n', nullif(notes, ''),
                              format('SOS dismissed by %s: %s', coalesce(v_name, 'the control room'), v_reason))
  where id = v_inc.id
  returning * into v_inc;

  -- On the call's own timeline, for whoever opens it.
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id, format('SOS dismissed by %s: %s', coalesce(v_name, 'the control room'), v_reason), auth.uid(), v_name);

  -- Out of everyone's alerts (they stay on the record, withdrawn).
  update public.alerts set withdrawn_at = now(), withdrawn_by = auth.uid()
   where incident_id = v_inc.id and kind = 'sos' and withdrawn_at is null;
  get diagnostics v_alerts = row_count;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, v_inc.silo, auth.uid(), v_name, 'SosDismissed', 'incident', v_inc.id::text,
          format('SOS %s from %s dismissed: %s (%s alert%s withdrawn)', v_inc.incident_number,
                 coalesce(v_inc.caller_name, 'an officer'), v_reason, v_alerts, case when v_alerts = 1 then '' else 's' end));
  return v_inc;
end $$;
revoke all on function public.dismiss_sos(uuid, text) from public, anon;
grant execute on function public.dismiss_sos(uuid, text) to authenticated;

notify pgrst, 'reload schema';
