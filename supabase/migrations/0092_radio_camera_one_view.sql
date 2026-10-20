-- ============================================================================
-- 0092 — A radio's camera: truly one view at a time
-- ============================================================================
--
-- Run after 0091.
--
-- Two requests to open the same radio's camera at the same instant (a double
-- click, or the console opening it twice) each found no open view and each
-- made one. Closing the panel closed one; the other kept the radio's camera
-- live until its ten minutes ran out. Now the opening of a radio's camera
-- waits its turn (a lock on that radio), so the second request joins the
-- first view instead of making another. Any second view already open is
-- closed now.
--
-- Everything else in start_radio_camera() is as 0091 had it.
--
-- Safe to re-run.
-- ============================================================================

-- Close the extra views left open by the race, keeping the newest per radio.
update public.radio_camera_views v set ended_at = least(now(), v.ends_by)
 where v.ended_at is null
   and exists (select 1 from public.radio_camera_views o
                where o.tenant_id = v.tenant_id and o.device_id = v.device_id and o.ended_at is null
                  and (o.started_at, o.id) > (v.started_at, v.id));

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

  -- One opening of this radio's camera at a time: the next one sees the view this one makes.
  perform pg_advisory_xact_lock(hashtextextended(v_presence.tenant_id::text || ':camera:' || v_device, 0));

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

notify pgrst, 'reload schema';
