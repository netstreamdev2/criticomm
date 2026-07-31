-- ============================================================================
-- 0020 — Actually revoke anonymous EXECUTE (0019's revokes were no-ops)
-- ============================================================================
--
-- 0019 added the role guards correctly, but its
--   revoke execute on function ... from anon;
-- lines had no effect. Postgres grants EXECUTE to PUBLIC on every function at
-- creation, and `anon` inherits it. Revoking from `anon` by name leaves the
-- PUBLIC grant untouched, so has_function_privilege('anon', …, 'EXECUTE')
-- stayed true.
--
-- Visible in the ACL as the entry with an empty grantee — `=X/postgres` is
-- PUBLIC, `anon=X/postgres` is the named role. Only the latter was being
-- removed. (`purge_expired_share_tokens` was created with explicit grants and
-- no PUBLIC entry, which is why its revoke in 0019 did work — a useful control.)
--
-- Correct form: revoke from PUBLIC, then grant back explicitly. Because
-- revoking PUBLIC also strips `authenticated` and `service_role`, both must be
-- re-granted or the application breaks.
--
-- Scope is deliberately limited to SECURITY DEFINER functions that read or
-- write operational data. The RLS helper predicates (is_global, role_in,
-- current_silo, can_write_global, require_role, app_role) are left broadly
-- executable on purpose: they are evaluated during policy checks on behalf of
-- whichever role is querying, including anon on the public share-location
-- page, and restricting them would break RLS evaluation itself.
-- ============================================================================

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef
      and p.proname in (
        -- mutating
        'log_incoming_call', 'route_incident', 'dispatch_unit', 'close_case',
        'update_responder_status', 'assign_vehicle', 'toggle_duty', 'cleanup_on_logout',
        -- read-only, but SECURITY DEFINER so they bypass RLS: an anonymous
        -- caller could mine dispatcher KPIs, or use the duplicate check as a
        -- lookup oracle to test whether a phone number appears in the system.
        'check_duplicate_incident', 'get_dispatcher_kpis', 'has_completed_shift_start_today'
      )
  loop
    execute format('revoke execute on function %s from public, anon', fn.sig);
    execute format('grant execute on function %s to authenticated, service_role', fn.sig);
  end loop;
end $$;

-- The citizen has no account, so this one stays reachable anonymously. It is
-- authenticated by a single-use, expiring bearer token, and since 0018 those
-- tokens are no longer enumerable. Re-granted explicitly rather than left on
-- the blanket PUBLIC grant, so the intent is recorded rather than inherited.
revoke execute on function public.citizen_update_location(text, double precision, double precision) from public;
grant execute on function public.citizen_update_location(text, double precision, double precision)
  to anon, authenticated, service_role;
