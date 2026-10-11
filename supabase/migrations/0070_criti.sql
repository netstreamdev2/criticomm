-- ============================================================================
-- 0070 — Criti: the assistant's limits, kept by the database
-- ============================================================================
--
-- Run after 0069.
--
-- Criti reads and acts as the person signed in, so everything it does is
-- already held by that person's own rules. This adds the three things it
-- needed that the database did not yet keep:
--
--   1. criti_thresholds(): the minutes the automati  rules escalate on, so
--      Criti's "late dispatch" tiles and the escalations agree. The rules
--      table is admin-only; only these three figures are shared.
--
--   2. A department's dispatch desk writes only to calls sent to it. Since
--      0068 a desk could not read another department's call, its timeline or
--      its attachments, but it could still add a note or a file to one if it
--      knew the call's id. Now it cannot, by any route.
--
--   3. send_broadcast(): a broadcast goes to the people of the departments
--      chosen, and a department's staff broadcast to their own department
--      only. Before, anyone allowed to raise an alert could raise one for any
--      department, and a department-wide alert also reached every other
--      department's desk.
--
-- It also lists xAI Grok on Admin → Integrations beside Groq and Gemini.
-- Safe to re-run.
-- ============================================================================

-- ── 1. The escalation minutes ───────────────────────────────────────────────

create or replace function public.criti_thresholds()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    jsonb_object_agg(key, jsonb_build_object('enabled', enabled, 'config', config)),
    '{}'::jsonb)
    from public.automation_rules
   where key in ('sla_unassigned', 'sla_no_arrival', 'stale_incidents');
$$;
revoke all on function public.criti_thresholds() from public, anon;
grant execute on function public.criti_thresholds() to authenticated;

-- ── 2. A desk writes only to the calls sent to it ───────────────────────────
-- The subquery reads incidents under the caller's own rules, so it passes
-- exactly when the desk can see the call (0068's incidents_desk_read).

drop policy if exists incident_updates_desk_write on public.incident_updates;
create policy incident_updates_desk_write on public.incident_updates as restrictive for insert to authenticated with check (
  (select public.desk_silo()) is null
  or exists (select 1 from public.incidents i where i.id = incident_updates.incident_id)
);

drop policy if exists incident_attachments_desk_write on public.incident_attachments;
create policy incident_attachments_desk_write on public.incident_attachments as restrictive for insert to authenticated with check (
  (select public.desk_silo()) is null
  or exists (select 1 from public.incidents i where i.id = incident_attachments.incident_id)
);

-- ── 3. Broadcasts ───────────────────────────────────────────────────────────

create or replace function public.send_broadcast(p_silos silo[], p_message text, p_severity text default 'Medium')
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_me       public.profiles;
  v_message  text := btrim(coalesce(p_message, ''));
  v_severity text := coalesce(nullif(btrim(coalesce(p_severity, '')), ''), 'Medium');
  v_targets  silo[];
  v_outside  silo[];
  v_sent     integer;
begin
  perform public.require_role(
    'SuperAdmin','SystemAdmin','SystemController','Admin','Supervisor','Captain','FireChief',
    'Dispatcher','ControlRoom','System'
  );
  select * into v_me from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Not permitted' using errcode = '42501'; end if;

  if char_length(v_message) < 3 or char_length(v_message) > 500 then
    raise exception 'A broadcast is 3 to 500 characters' using errcode = '22023';
  end if;
  if v_severity not in ('Medium', 'High', 'Critical') then
    raise exception 'A broadcast is Medium, High or Critical' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct s), '{}') into v_targets from unnest(coalesce(p_silos, '{}')) s;
  if cardinality(v_targets) = 0 then
    raise exception 'Choose who receives the broadcast' using errcode = '22023';
  end if;

  -- A department's staff speak to their own department. The control room
  -- and the platform tier speak to anyone.
  if v_me.silo <> 'Ethekwini' and v_me.role not in ('SuperAdmin', 'SystemAdmin', 'SystemController', 'System') then
    select coalesce(array_agg(s), '{}') into v_outside from unnest(v_targets) s where s <> v_me.silo;
    if cardinality(v_outside) > 0 then
      raise exception 'You can broadcast to % only', public.department_label(v_me.silo) using errcode = '42501';
    end if;
  end if;

  -- One alert per person, so it reaches exactly the departments chosen. Not
  -- the sender, not the automation account, and not the platform
  -- administrator, who is not paged by live operations.
  insert into public.alerts (
    tenant_id, silo, target_user_id, kind, severity, title, body, presentation, requires_ack,
    created_by, created_by_name
  )
  select v_me.tenant_id, pr.silo, pr.id, 'broadcast', v_severity,
         format('Broadcast from %s', coalesce(v_me.full_name, 'the control room')), v_message,
         case when v_severity in ('High', 'Critical') then 'modal' else 'toast' end,
         v_severity in ('High', 'Critical'), auth.uid(), v_me.full_name
    from public.profiles pr
   where pr.tenant_id = v_me.tenant_id and pr.deactivated_at is null
     and pr.silo = any (v_targets) and pr.id <> auth.uid()
     and pr.role not in ('SuperAdmin', 'System');
  get diagnostics v_sent = row_count;

  insert into public.audit_logs (silo, user_id, user_name, department, action_type, entity_type, details)
  values (v_me.silo, auth.uid(), v_me.full_name, v_me.silo::text, 'Broadcast', 'alert',
    format('%s (%s, %s people): %s',
      (select string_agg(public.department_label(s), ', ' order by s) from unnest(v_targets) s),
      v_severity, v_sent, v_message));
  return v_sent;
end $$;

revoke all on function public.send_broadcast(silo[], text, text) from public, anon;
grant execute on function public.send_broadcast(silo[], text, text) to authenticated;

-- ── Integrations: Grok beside Groq and Gemini ───────────────────────────────

-- Keyed by (tenant_id, key) since 0030, so add the row only where it is missing.
insert into public.integration_settings (key, label, category, enabled, config)
select 'grok', 'xAI Grok — AI provider for Criti', 'AI', true, '{"model":"grok-4.7","temperature":0.2}'::jsonb
 where not exists (select 1 from public.integration_settings where key = 'grok');

notify pgrst, 'reload schema';
