-- ============================================================================
-- 0109 — PIN sign-in: choose your department and your name
-- ============================================================================
--
-- Run after 0108.
--
-- On a registered device the sign-in screen lists the officers who may sign
-- in on it with a PIN — by department, then name — so nobody has to type a
-- badge number. The device keeps the list for when there is no signal.
--
--   sign_in_device_officers()   server only: the officers a registered device
--                               lists (its department, or every department
--                               for a device registered by a tenant-wide
--                               administrator), who have a PIN and are active
--
-- Only a live device with its own key gets the list, through the web server.
-- Names, badge numbers and departments only. Safe to re-run.
-- ============================================================================

create or replace function public.sign_in_device_officers(p_device uuid, p_device_hash text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_dev public.sign_in_devices;
begin
  select * into v_dev from public.sign_in_devices where id = p_device;
  if not found or v_dev.removed_at is not null or v_dev.secret_hash is distinct from p_device_hash then
    return jsonb_build_object('state', 'device');
  end if;
  return jsonb_build_object('state', 'ok', 'officers', coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', o.id, 'full_name', o.full_name, 'badge_number', o.badge_number, 'silo', o.silo)
           order by o.silo, o.full_name)
      from (
        select p.id, p.full_name, p.badge_number, p.silo
          from public.profiles p
          join public.sign_in_pins s on s.user_id = p.id
         where p.tenant_id = v_dev.tenant_id
           and p.deactivated_at is null
           and (v_dev.silo is null or p.silo = v_dev.silo or public.sign_in_any_department(p.role::text))
         order by p.silo, p.full_name
         limit 3000
      ) o
  ), '[]'::jsonb));
end $$;
revoke all on function public.sign_in_device_officers(uuid, text) from public, anon, authenticated;
grant execute on function public.sign_in_device_officers(uuid, text) to service_role;

notify pgrst, 'reload schema';
