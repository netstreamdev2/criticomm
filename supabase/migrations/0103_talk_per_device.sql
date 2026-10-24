-- ============================================================================
-- 0103 — Talk per device: a radio and a hard hat on one account both hear,
--         and the desk can talk to one of them only
-- ============================================================================
--
-- Run after 0095 (and 0101).
--
-- An officer signs in on their radio and on their smart hard hat with the
-- same account. Talk joined both under that account, and the voice server
-- keeps one connection per name: the second device to join pushed the first
-- off, so the console's voice came out of the hard hat or the radio, never
-- both.
--
--   * talk_pass() now takes the device's Radio ID (HT-XXXX-XXXX). Each device
--     joins under "<person>:<device>", so all of them stay on and all hear the
--     group. The name others see says which device ("· hard hat HH-0001").
--   * A talk group for one device: "radio:<Radio ID>". The desk calls it from
--     the Radio Desk ("Talk to this radio only"); only that device joins (the
--     app checks its own Radio ID), the person on it may answer, nobody else
--     hears. The desk may join and speak where it may see the device (its
--     department, or every department for those who see all).
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. Who may join a talk group: as 0088, plus one device's own group ─────

create or replace function public.talk_access(p_channel text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_listen  boolean := false;
  v_speak   boolean := false;
  v_name    text;
  v_silo    public.silo;
  v_inc     public.incidents;
  v_dev     public.radio_presence;
  v_kit     text;
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
  elsif p_channel like 'radio:%' then
    -- 0103: one device only. The person signed in on it, and the desk that may see it.
    select * into v_dev from public.radio_presence
     where tenant_id = public.current_tenant() and device_id = upper(substr(p_channel, 7));
    if not found then return jsonb_build_object('listen', false, 'speak', false, 'name', null); end if;
    begin
      select lower(public.field_kit_word(k.kind)) || ' ' || k.asset_no into v_kit
        from public.field_kit k where k.tenant_id = v_dev.tenant_id and k.device_id = v_dev.device_id;
    exception when undefined_table or undefined_function then v_kit := null;
    end;
    v_name := format('%s only', coalesce(
      nullif(trim(concat_ws(' ', (select coalesce(nullif(trim(concat_ws(' ', p.rank, p.first_name, p.last_name)), ''), null)
                                    from public.personnel p where p.id = v_dev.personnel_id),
                               case when v_kit is not null then format('(%s)', v_kit) end)), ''),
      v_dev.device_id));
    v_listen := v_dev.user_id = auth.uid()
             or (v_desk and (v_dev.silo = public.current_silo() or public.is_global()));
    v_speak := v_listen and not v_watcher;
  end if;

  -- The desk may talk over a radio (priority); everyone else waits for a clear channel.
  return jsonb_build_object('listen', v_listen, 'speak', v_listen and v_speak, 'name', v_name,
                            'priority', v_listen and v_speak and v_desk);
end $$;
revoke all on function public.talk_access(text) from public, anon;
grant execute on function public.talk_access(text) to authenticated;

-- ── 2. The pass: one name per device ───────────────────────────────────────
-- As 0083, with the device (marked 0103). The one-argument form is replaced:
-- two forms would make a call with only the channel ambiguous.

drop function if exists public.talk_pass(text);

create or replace function public.talk_pass(p_channel text, p_device text default null)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_access  jsonb := public.talk_access(p_channel);
  v_server  public.talk_server;
  v_tenant  uuid := public.current_tenant();
  v_name    text;
  v_now     bigint := extract(epoch from now())::bigint;
  v_exp     bigint := extract(epoch from now() + interval '2 hours')::bigint;
  v_room    text;
  v_head    text;
  v_body    text;
  v_sig     text;
  -- 0103: the device's Radio ID, only in its own shape.
  v_device  text := case when upper(btrim(coalesce(p_device, ''))) ~ '^HT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'
                         then upper(btrim(p_device)) end;
  v_kit     text;
  v_ident   text;
begin
  if not coalesce((v_access ->> 'listen')::boolean, false) then
    raise exception 'You may not join that talk group' using errcode = '42501';
  end if;
  select * into v_server from public.talk_server where id = 1;
  if not found then raise exception 'Talk is not set up yet: no voice server' using errcode = 'P0002'; end if;

  select coalesce(full_name, 'Unknown') into v_name from public.profiles where id = auth.uid();
  -- 0103: each device its own name, so a radio and a hard hat on one account both stay on.
  v_ident := auth.uid()::text || coalesce(':' || v_device, '');
  if v_device is not null then
    begin
      select lower(public.field_kit_word(k.kind)) || ' ' || k.asset_no into v_kit
        from public.field_kit k where k.tenant_id = v_tenant and k.device_id = v_device;
    exception when undefined_table or undefined_function then v_kit := null;
    end;
    v_name := v_name || ' · ' || coalesce(v_kit, v_device);
  end if;
  v_room := format('%s:%s', v_tenant, p_channel);

  v_head := public.talk_b64url(convert_to('{"alg":"HS256","typ":"JWT"}', 'UTF8'));
  v_body := public.talk_b64url(convert_to(jsonb_build_object(
    'iss', v_server.api_key,
    'sub', v_ident,
    'name', v_name,
    'nbf', v_now - 10,
    'exp', v_exp,
    'metadata', jsonb_build_object('role', (select role::text from public.profiles where id = auth.uid()),
                                   'silo', public.current_silo()::text,
                                   'user', auth.uid()::text,
                                   'device', v_device)::text,
    'video', jsonb_build_object(
      'room', v_room,
      'roomJoin', true,
      'canSubscribe', true,
      'canPublish', coalesce((v_access ->> 'speak')::boolean, false),
      'canPublishData', true,
      'canPublishSources', jsonb_build_array('microphone'))
  )::text, 'UTF8'));
  v_sig := public.talk_b64url(public.talk_hmac_sha256(convert_to(v_server.api_secret, 'UTF8'),
                                                     convert_to(v_head || '.' || v_body, 'UTF8')));

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_tenant, public.current_silo(), auth.uid(), v_name, 'TalkJoined', 'talk_group', p_channel,
          format('%s · %s', v_access ->> 'name', case when (v_access ->> 'speak')::boolean then 'listen and speak' else 'listen only' end));

  return jsonb_build_object(
    'url', v_server.url,
    'token', v_head || '.' || v_body || '.' || v_sig,
    'room', v_room,
    'channel', p_channel,
    'name', v_access ->> 'name',
    'canSpeak', coalesce((v_access ->> 'speak')::boolean, false),
    'priority', coalesce((v_access ->> 'priority')::boolean, false),
    'identity', v_ident,
    'expiresAt', to_timestamp(v_exp));
end $$;
revoke all on function public.talk_pass(text, text) from public, anon;
grant execute on function public.talk_pass(text, text) to authenticated;

notify pgrst, 'reload schema';
