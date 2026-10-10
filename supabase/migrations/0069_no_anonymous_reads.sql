-- ============================================================================
-- 0069 — Nothing is read without signing in
-- ============================================================================
--
-- Run after 0068.
--
-- The public key ships inside the console and the app, so anyone can use it.
-- Without signing in, it could read incidents, their timelines and
-- attachments, alerts, the audit trail, profiles and more: department rules
-- of the form `silo = current_silo()` treat a visitor with no sign-in as the
-- control room, and the tenant walls (0046) and the dispatch desk wall (0068)
-- apply to signed-in users only. A live connection that joined before its
-- sign-in reached it was such a visitor too, so new control-room calls
-- reached screens they were never sent to.
--
-- Now every table in the public schema refuses an anonymous visitor
-- outright. Nothing the platform does needs it: activation, invitations and
-- shared locations go through database functions, which are unaffected.
-- Tables added later get the same wall when this is re-run. Safe to re-run.
-- ============================================================================

do $$
declare
  t record;
  v_walled int := 0;
  v_revoked int := 0;
begin
  for t in
    select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    if t.relrowsecurity then
      execute format('drop policy if exists signed_in_only on public.%I', t.relname);
      execute format(
        'create policy signed_in_only on public.%I as restrictive for all to anon using (false) with check (false)',
        t.relname);
      v_walled := v_walled + 1;
    else
      -- No row security on this table: the visitor loses the table itself.
      execute format('revoke all on public.%I from anon', t.relname);
      v_revoked := v_revoked + 1;
    end if;
  end loop;
  raise notice 'Signed-in only: % tables walled, % tables withdrawn from anonymous visitors', v_walled, v_revoked;
end $$;

-- Tables created from now on are not handed to anonymous visitors either.
alter default privileges in schema public revoke all on tables from anon;

notify pgrst, 'reload schema';
