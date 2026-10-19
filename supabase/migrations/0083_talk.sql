-- ============================================================================
-- 0083 — Talk: HikTech's own push-to-talk, between radios and the console
-- ============================================================================
--
-- Run after 0082.
--
-- Live voice runs on a LiveKit server (LiveKit Cloud while testing; our own
-- server in South Africa later). The database decides who may join which
-- talk group, and who may speak in it, and signs the pass the voice server
-- checks. The server's secret is kept here, read by nothing but the signing
-- function: no browser, phone or web server ever holds it.
--
--   Talk groups
--     dept:<department>   a department's channel. Its people listen and
--                         speak; dispatch and the organisation-wide roles too.
--     all                 All call. Everyone listens; the dispatch desk,
--                         command and administrators speak.
--     incident:<id>       a call's own channel: whoever works the call.
--   The call logger and the viewer listen and never speak (0081: they watch).
--
--   talk_server            the voice server's address, key and secret (one row).
--   set_talk_server()      the system administrators set it; audited, the
--                          secret never written to the audit.
--   talk_server_status()   is it set up, and where (no secret).
--   talk_access(channel)   may I listen, may I speak, may I talk over others
--                          (priority: the desk), and what is it called.
--   talk_pass(channel)     the signed pass (2 hours) to join; audited.
--   log_talk(...)          each time someone spoke: who, where, how long.
--   talk_log               that record, read by whoever may listen there.
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. The voice server, and its secret ─────────────────────────────────────

create table if not exists public.talk_server (
  id          int primary key default 1 check (id = 1),
  url         text not null check (url ~ '^wss?://'),
  api_key     text not null check (length(api_key) between 4 and 200),
  api_secret  text not null check (length(api_secret) between 16 and 500),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
alter table public.talk_server enable row level security;
-- No policies and no grants: only the functions below read it.
revoke all on public.talk_server from public, anon, authenticated;

/** HMAC-SHA256 from core sha256(), so signing needs no extension. Internal. */
create or replace function public.talk_hmac_sha256(p_key bytea, p_msg bytea)
returns bytea language plpgsql immutable strict set search_path to 'public' as $$
declare
  k bytea := p_key;
  ipad bytea;
  opad bytea;
  i int;
begin
  if length(k) > 64 then k := sha256(k); end if;
  k := k || decode(repeat('00', 64 - length(k)), 'hex');
  ipad := k;
  opad := k;
  for i in 0..63 loop
    ipad := set_byte(ipad, i, get_byte(k, i) # 54);   -- 0x36
    opad := set_byte(opad, i, get_byte(k, i) # 92);   -- 0x5c
  end loop;
  return sha256(opad || sha256(ipad || p_msg));
end $$;
revoke all on function public.talk_hmac_sha256(bytea, bytea) from public, anon, authenticated;

/** base64url without padding, as a JWT writes it. Internal. */
create or replace function public.talk_b64url(p bytea)
returns text language sql immutable strict set search_path to 'public' as $$
  select rtrim(translate(replace(encode(p, 'base64'), E'\n', ''), '+/', '-_'), '=')
$$;
revoke all on function public.talk_b64url(bytea) from public, anon, authenticated;

/** The system administrators point HikTech at a voice server. The secret is never echoed or audited. */
create or replace function public.set_talk_server(p_url text, p_api_key text, p_api_secret text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_name text;
begin
  perform public.require_role('SuperAdmin', 'SystemAdmin');
  if p_url is null or btrim(p_url) !~ '^wss?://[^\s/]+' then
    raise exception 'The voice server address starts with wss://' using errcode = '22023';
  end if;
  if coalesce(length(btrim(p_api_key)), 0) < 4 then raise exception 'Enter the API key' using errcode = '22023'; end if;
  if coalesce(length(btrim(p_api_secret)), 0) < 16 then raise exception 'Enter the API secret' using errcode = '22023'; end if;
  insert into public.talk_server (id, url, api_key, api_secret, updated_at, updated_by)
  values (1, rtrim(btrim(p_url), '/'), btrim(p_api_key), btrim(p_api_secret), now(), auth.uid())
  on conflict (id) do update set url = excluded.url, api_key = excluded.api_key, api_secret = excluded.api_secret,
    updated_at = now(), updated_by = auth.uid();
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, details)
  values (public.current_tenant(), public.current_silo(), auth.uid(), v_name, 'TalkServerSet', 'talk_server',
          format('Voice server set to %s', rtrim(btrim(p_url), '/')));
end $$;
revoke all on function public.set_talk_server(text, text, text) from public, anon;
grant execute on function public.set_talk_server(text, text, text) to authenticated;

/** Is a voice server set up, and where. No secret. */
create or replace function public.talk_server_status()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'configured', exists (select 1 from public.talk_server),
    'url', (select url from public.talk_server),
    'updatedAt', (select updated_at from public.talk_server))
  where auth.uid() is not null
$$;
revoke all on function public.talk_server_status() from public, anon;
grant execute on function public.talk_server_status() to authenticated;

-- ── 2. Who may listen and speak where ──────────────────────────────────────

/**
 * May this person listen on a talk group, may they speak, and what it is
 * called. Unknown or forbidden: listen false. Every rule is here, once.
 */
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
    v_speak := v_desk or public.role_in('Captain', 'FireChief');
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

-- ── 3. The pass the voice server checks ────────────────────────────────────

/**
 * A signed pass (a LiveKit access token, 2 hours) to join one talk group:
 * listen always, speak only where talk_access() says so. The room is
 * per organisation, so two organisations never share a channel. Audited.
 */
create or replace function public.talk_pass(p_channel text)
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
begin
  if not coalesce((v_access ->> 'listen')::boolean, false) then
    raise exception 'You may not join that talk group' using errcode = '42501';
  end if;
  select * into v_server from public.talk_server where id = 1;
  if not found then raise exception 'Talk is not set up yet: no voice server' using errcode = 'P0002'; end if;

  select coalesce(full_name, 'Unknown') into v_name from public.profiles where id = auth.uid();
  v_room := format('%s:%s', v_tenant, p_channel);

  v_head := public.talk_b64url(convert_to('{"alg":"HS256","typ":"JWT"}', 'UTF8'));
  v_body := public.talk_b64url(convert_to(jsonb_build_object(
    'iss', v_server.api_key,
    'sub', auth.uid()::text,
    'name', v_name,
    'nbf', v_now - 10,
    'exp', v_exp,
    'metadata', jsonb_build_object('role', (select role::text from public.profiles where id = auth.uid()),
                                   'silo', public.current_silo()::text)::text,
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
    'identity', auth.uid(),
    'expiresAt', to_timestamp(v_exp));
end $$;
revoke all on function public.talk_pass(text) from public, anon;
grant execute on function public.talk_pass(text) to authenticated;

-- ── 4. Who spoke, where, and for how long ──────────────────────────────────

create table if not exists public.talk_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant(),
  channel     text not null check (length(channel) <= 80),
  user_id     uuid not null,
  user_name   text,
  started_at  timestamptz not null,
  ended_at    timestamptz not null,
  seconds     numeric(7, 1) generated always as (round(extract(epoch from (ended_at - started_at))::numeric, 1)) stored,
  created_at  timestamptz not null default now(),
  check (ended_at >= started_at)
);
create index if not exists talk_log_channel_idx on public.talk_log (tenant_id, channel, started_at desc);
alter table public.talk_log enable row level security;
revoke all on public.talk_log from anon;
revoke insert, update, delete on public.talk_log from authenticated;
grant select on public.talk_log to authenticated;

drop policy if exists talk_log_read on public.talk_log;
create policy talk_log_read on public.talk_log for select to authenticated
  using (tenant_id = public.current_tenant() and coalesce((public.talk_access(channel) ->> 'listen')::boolean, false));

/** Records one transmission by the person speaking. Only where they may speak; times bounded. */
create or replace function public.log_talk(p_channel text, p_started_at timestamptz, p_ended_at timestamptz)
returns public.talk_log language plpgsql security definer set search_path to 'public' as $$
declare
  v_row  public.talk_log;
  v_name text;
begin
  if not coalesce((public.talk_access(p_channel) ->> 'speak')::boolean, false) then
    raise exception 'You may not speak in that talk group' using errcode = '42501';
  end if;
  if p_started_at is null or p_ended_at is null or p_ended_at < p_started_at
     or p_ended_at > now() + interval '1 minute' or p_started_at < now() - interval '12 hours'
     or p_ended_at - p_started_at > interval '10 minutes' then
    raise exception 'That transmission time is not right' using errcode = '22023';
  end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.talk_log (tenant_id, channel, user_id, user_name, started_at, ended_at)
  values (public.current_tenant(), p_channel, auth.uid(), v_name, p_started_at, p_ended_at)
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.log_talk(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.log_talk(text, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
