-- ============================================================================
-- 0088 — All call: the radios speak too
-- ============================================================================
--
-- Run after 0087.
--
-- In 0083 only the dispatch desk, command and administrators could speak on
-- All call; officers on the radios could only listen. In the field that
-- left a radio unable to answer the console. Now everyone who listens on
-- All call may speak on it, except the call logger and the viewer, who
-- only ever watch (0081). The desk keeps priority: it can still talk over
-- a radio, and a radio still waits for a clear channel.
--
-- Everything else in talk_access() is as 0083 had it.
--
-- Safe to re-run.
-- ============================================================================

create or replace function public.talk_access(p_channel text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_listen  boolean := false;
  v_speak   boolean := false;
  v_name    text;
  v_silo    public.silo;
  v_inc     public.incidents;
  v_watcher boolean := public.role_in('IncidentLogger', 'Viewer');
  v_desk    boolean := public.role_in('SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'System',
                                      'Dispatcher', 'ControlRoom', 'Operator', 'Supervisor');
  v_labels  jsonb := '{"MetroPolice":"Metro Police","MetroFire":"Fire & Rescue","Medical":"EMS","EthekwiniDisaster":"Disaster Management","Ethekwini":"Control room"}';
begin
  if auth.uid() is null or public.current_tenant() is null then
    return jsonb_build_object('listen', false, 'speak', false, 'name', null);
  end if;

  if p_channel = 'all' then
    v_name := 'All call';
    v_listen := true;
    v_speak := not v_watcher;
  elsif p_channel like 'dept:%' then
    begin
      v_silo := substr(p_channel, 6)::public.silo;
    exception when others then
      return jsonb_build_object('listen', false, 'speak', false, 'name', null);
    end;
    v_name := coalesce(v_labels ->> v_silo::text, v_silo::text);
    v_listen := v_silo = public.current_silo() or public.is_global();
    v_speak := v_listen and not v_watcher;
  elsif p_channel like 'incident:%' then
    select * into v_inc from public.incidents
     where id = public.try_uuid(substr(p_channel, 10)) and tenant_id = public.current_tenant();
    if not found then return jsonb_build_object('listen', false, 'speak', false, 'name', null); end if;
    v_name := format('Call %s', v_inc.incident_number);
    v_listen := public.can_work_incident(v_inc.id);
    v_speak := v_listen and not v_watcher and v_inc.status::text <> 'Closed';
  end if;

  -- The desk may talk over a radio (priority); everyone else waits for a clear channel.
  return jsonb_build_object('listen', v_listen, 'speak', v_listen and v_speak, 'name', v_name,
                            'priority', v_listen and v_speak and v_desk);
end $$;
revoke all on function public.talk_access(text) from public, anon;
grant execute on function public.talk_access(text) to authenticated;

notify pgrst, 'reload schema';
