-- ============================================================================
-- 0091 — Live camera from a radio: the control room sees what the officer sees
-- ============================================================================
--
-- Run after 0090. Needs 0083 (the voice server and its signing) and 0087
-- (radio presence).
--
-- From the Radio Desk the control room opens a radio's camera. The radio is
-- told within seconds, even with its screen off: it buzzes, rings once and
-- shows a notification, then sends its camera and microphone live over the
-- voice server (as Talk does). The officer always knows: the radio says the
-- control room is viewing, never who (as the bodycam, 0054).
--
-- Nothing is recorded: this is live only (recording is on hold until
-- eThekwini decides, docs/25-RADIOS.md).
--
--   radio_camera_views     each time someone opened a radio's camera: whose
--                          radio, who opened it, from when to when. At most
--                          10 minutes; one open view per radio at a time.
--   can_view_radio_camera  as can_watch_bodycam(live): the control room,
--                          dispatch and the command tier everywhere;
--                          supervisors, captains, chiefs and department
--                          administrators in their own department.
--   start_radio_camera()   opens a radio's camera (or joins the open view);
--                          audited.
--   end_radio_camera()     closes it; audited with how long.
--   my_radio_camera()      the radio asks: is my camera open? (not by whom)
--   radio_camera_pass()    the signed pass for the voice server: the radio
--                          sends camera and microphone, the viewer watches.
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. Who may open a radio's camera ────────────────────────────────────────

create or replace function public.can_view_radio_camera(p_silo public.silo) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.role_in('SuperAdmin', 'SystemAdmin', 'SystemController', 'ControlRoom', 'Dispatcher')
      or (public.role_in('Supervisor', 'Captain', 'FireChief', 'Admin') and p_silo = public.current_silo());
$$;
revoke all on function public.can_view_radio_camera(public.silo) from public, anon;
grant execute on function public.can_view_radio_camera(public.silo) to authenticated;

-- ── 2. The views ────────────────────────────────────────────────────────────

create table if not exists public.radio_camera_views (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default public.current_tenant(),
  silo         public.silo not null,
  device_id    text not null check (device_id ~ '^HT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
  officer_id   uuid not null,
  viewer_id    uuid not null,
  viewer_name  text,
  started_at   timestamptz not null default now(),
  -- A view closes by itself: nobody's camera stays open because a tab was left open.
  ends_by      timestamptz not null default now() + interval '10 minutes',
  ended_at     timestamptz,
  ended_by     uuid,
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists radio_camera_views_open_idx on public.radio_camera_views (tenant_id, device_id) where ended_at is null;
create index if not exists radio_camera_views_time_idx on public.radio_camera_views (tenant_id, started_at desc);

alter table public.radio_camera_views enable row level security;

drop policy if exists tenant_isolation on public.radio_camera_views;
create policy tenant_isolation on public.radio_camera_views as restrictive for all to authenticated
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

drop policy if exists radio_camera_views_read on public.radio_camera_views;
create policy radio_camera_views_read on public.radio_camera_views for select to authenticated
  using (viewer_id = auth.uid() or public.can_view_radio_camera(silo));

revoke all on public.radio_camera_views from anon;
revoke insert, update, delete on public.radio_camera_views from authenticated;
grant select on public.radio_camera_views to authenticated;

-- ── 3. Open, close ──────────────────────────────────────────────────────────

/** Opens a radio's camera, or joins the view already open on it. The radio must be on. Audited. */
create or replace function public.start_radio_camera(p_device text)
returns public.radio_camera_views language plpgsql security definer set search_path to 'public' as $$
declare
  v_device   text := upper(btrim(coalesce(p_device, '')));
  v_presence public.radio_presence;
  v_view     public.radio_camera_views;
  v_name     text;
  v_officer  text;
begin
  if auth.uid() is null or public.current_tenant() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into v_presence from public.radio_presence
   where tenant_id = public.current_tenant() and device_id = v_device;
  if not found then raise exception 'Radio not found' using errcode = 'P0002'; end if;
  if not public.can_view_radio_camera(v_presence.silo) then
    raise exception 'Not permitted for your role' using errcode = '42501';
  end if;
  if not v_presence.signed_in or v_presence.last_seen_at < now() - interval '3 minutes' then
    raise exception 'This radio is off' using errcode = '22023';
  end if;
  if v_presence.user_id = auth.uid() then
    raise exception 'That is your own radio' using errcode = '22023';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  select full_name into v_officer from public.profiles where id = v_presence.user_id;

  select * into v_view from public.radio_camera_views
   where tenant_id = v_presence.tenant_id and device_id = v_device and ended_at is null and ends_by > now()
   order by started_at desc limit 1;

  if found then
    insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
    values (v_presence.tenant_id, v_presence.silo, auth.uid(), v_name, 'RadioCameraJoined', 'radio_camera_view', v_view.id::text,
            format('%s joined the view of %s''s camera (%s)', coalesce(v_name, 'Someone'), coalesce(v_officer, 'an officer'), v_device));
    return v_view;
  end if;

  -- A view left open past its time is closed now, so the radio is never told twice.
  update public.radio_camera_views set ended_at = ends_by
   where tenant_id = v_presence.tenant_id and device_id = v_device and ended_at is null and ends_by <= now();

  insert into public.radio_camera_views (tenant_id, silo, device_id, officer_id, viewer_id, viewer_name)
  values (v_presence.tenant_id, v_presence.silo, v_device, v_presence.user_id, auth.uid(), v_name)
  returning * into v_view;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_presence.tenant_id, v_presence.silo, auth.uid(), v_name, 'RadioCameraStarted', 'radio_camera_view', v_view.id::text,
          format('%s opened %s''s camera (%s)', coalesce(v_name, 'Someone'), coalesce(v_officer, 'an officer'), v_device));
  return v_view;
end $$;
revoke all on function public.start_radio_camera(text) from public, anon;
grant execute on function public.start_radio_camera(text) to authenticated;

/** Closes a view: whoever opened it, or anyone who may view that radio's camera. Audited with how long. */
create or replace function public.end_radio_camera(p_view uuid)
returns public.radio_camera_views language plpgsql security definer set search_path to 'public' as $$
declare
  v_view public.radio_camera_views;
  v_name text;
begin
  select * into v_view from public.radio_camera_views
   where id = p_view and tenant_id = public.current_tenant()
   for update;
  if not found then raise exception 'View not found' using errcode = 'P0002'; end if;
  if v_view.viewer_id is distinct from auth.uid() and not public.can_view_radio_camera(v_view.silo) then
    raise exception 'Not permitted for your role' using errcode = '42501';
  end if;
  if v_view.ended_at is not null then return v_view; end if;

  update public.radio_camera_views set ended_at = least(now(), ends_by), ended_by = auth.uid()
   where id = v_view.id
  returning * into v_view;

  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_view.tenant_id, v_view.silo, auth.uid(), v_name, 'RadioCameraEnded', 'radio_camera_view', v_view.id::text,
          format('Camera of %s closed after %s seconds', v_view.device_id,
                 round(extract(epoch from (v_view.ended_at - v_view.started_at)))::int));
  return v_view;
end $$;
revoke all on function public.end_radio_camera(uuid) from public, anon;
grant execute on function public.end_radio_camera(uuid) to authenticated;

-- ── 4. The radio asks ───────────────────────────────────────────────────────

/** Is this radio's camera open? Only the person signed in on it may ask; never says by whom. */
create or replace function public.my_radio_camera(p_device text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_device text := upper(btrim(coalesce(p_device, '')));
  v_view   public.radio_camera_views;
begin
  if auth.uid() is null or public.current_tenant() is null then return null; end if;
  if not exists (select 1 from public.radio_presence
                  where tenant_id = public.current_tenant() and device_id = v_device and user_id = auth.uid()) then
    return null;
  end if;
  select * into v_view from public.radio_camera_views
   where tenant_id = public.current_tenant() and device_id = v_device and officer_id = auth.uid()
     and ended_at is null and ends_by > now()
   order by started_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id', v_view.id, 'startedAt', v_view.started_at, 'endsBy', v_view.ends_by);
end $$;
revoke all on function public.my_radio_camera(text) from public, anon;
grant execute on function public.my_radio_camera(text) to authenticated;

-- ── 5. The pass for the voice server ───────────────────────────────────────

/**
 * A signed pass (LiveKit, 15 minutes) to the view's own room: the officer's
 * radio sends its camera and microphone; a viewer only watches and listens.
 * The room is per organisation and per view.
 */
create or replace function public.radio_camera_pass(p_view uuid)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_view    public.radio_camera_views;
  v_server  public.talk_server;
  v_radio   boolean;
  v_name    text;
  v_now     bigint := extract(epoch from now())::bigint;
  v_exp     bigint := extract(epoch from now() + interval '15 minutes')::bigint;
  v_room    text;
  v_head    text;
  v_body    text;
  v_sig     text;
begin
  select * into v_view from public.radio_camera_views
   where id = p_view and tenant_id = public.current_tenant();
  if not found then raise exception 'View not found' using errcode = 'P0002'; end if;
  if v_view.ended_at is not null or v_view.ends_by <= now() then
    raise exception 'This view has ended' using errcode = '22023';
  end if;
  v_radio := v_view.officer_id = auth.uid();
  if not v_radio and not public.can_view_radio_camera(v_view.silo) then
    raise exception 'Not permitted for your role' using errcode = '42501';
  end if;
  select * into v_server from public.talk_server where id = 1;
  if not found then raise exception 'Talk is not set up yet: no voice server' using errcode = 'P0002'; end if;

  select coalesce(full_name, 'Unknown') into v_name from public.profiles where id = auth.uid();
  v_room := format('%s:camera:%s', v_view.tenant_id, v_view.id);

  v_head := public.talk_b64url(convert_to('{"alg":"HS256","typ":"JWT"}', 'UTF8'));
  v_body := public.talk_b64url(convert_to(jsonb_build_object(
    'iss', v_server.api_key,
    'sub', auth.uid()::text,
    'name', v_name,
    'nbf', v_now - 10,
    'exp', v_exp,
    'metadata', jsonb_build_object('kind', case when v_radio then 'radio' else 'viewer' end)::text,
    'video', jsonb_build_object(
      'room', v_room,
      'roomJoin', true,
      'canSubscribe', true,
      'canPublish', v_radio,
      'canPublishData', false,
      'canPublishSources', case when v_radio then jsonb_build_array('camera', 'microphone') else '[]'::jsonb end)
  )::text, 'UTF8'));
  v_sig := public.talk_b64url(public.talk_hmac_sha256(convert_to(v_server.api_secret, 'UTF8'),
                                                     convert_to(v_head || '.' || v_body, 'UTF8')));

  return jsonb_build_object(
    'url', v_server.url,
    'token', v_head || '.' || v_body || '.' || v_sig,
    'room', v_room,
    'view', v_view.id,
    'radio', v_radio,
    'endsBy', v_view.ends_by);
end $$;
revoke all on function public.radio_camera_pass(uuid) from public, anon;
grant execute on function public.radio_camera_pass(uuid) to authenticated;

notify pgrst, 'reload schema';
