-- ============================================================================
-- 0045 — Retire the roles this platform does not use
-- ============================================================================
--
-- Run after 0044.
--
-- The platform serves the four eThekwini departments (police, fire, medical,
-- disaster). Seven inherited roles are either out of scope or exact duplicates
-- of another role, and are retired here:
--
--   retired      becomes        why
--   ──────────   ────────────   ─────────────────────────────────────────────
--   Officer      Police         same desk, same access — rank lives in `rank`
--   Metro        Police         same desk, same access — rank lives in `rank`
--   Chief        FireChief      duplicate of FireChief
--   Operator     ControlRoom    identical access everywhere
--   Responder    by department  Police / Firefighter / Paramedic / Disaster
--   Security     Staff          not a municipal role; Staff is least privilege,
--   Citizen      Staff            so nobody is promoted — an admin reassigns
--
-- Postgres cannot drop a value from an enum, and rebuilding `user_role` would
-- mean recreating every policy and function that names it. So the labels stay
-- in the type as dead values, and this migration makes them unusable:
--
--   1. every account holding one is moved to its replacement (profiles AND the
--      role in the sign-in token, which is what the web and app read);
--   2. the operators register and the access rules are cleaned the same way;
--   3. CHECK constraints refuse the retired roles from now on, so no script,
--      admin screen or API call can hand one out again.
--
-- Older policies and functions still list the retired names next to their
-- replacements. With nobody able to hold them, those entries match no one.
-- Before moving anyone, every current policy and function was checked: the
-- replacement role already has the access the retired role had, except in the
-- two firearm policies in step 4, which are fixed here.
--
-- All-or-nothing: the final check aborts the whole run if anything is left.
-- Safe to re-run.
--
-- Preview who will change, before running:
--
--   select p.full_name, p.silo, p.role
--     from public.profiles p
--    where p.role::text in ('Officer','Metro','Chief','Operator','Responder','Security','Citizen')
--    order by p.role, p.full_name;
-- ============================================================================

begin;

-- ── 1. Accounts ─────────────────────────────────────────────────────────────

update public.profiles
   set role = case
     when role::text in ('Officer', 'Metro') then 'Police'
     when role::text = 'Chief'               then 'FireChief'
     when role::text = 'Operator'            then 'ControlRoom'
     when role::text in ('Security', 'Citizen') then 'Staff'
     when role::text = 'Responder' then case silo::text
       when 'MetroFire'         then 'Firefighter'
       when 'Medical'           then 'Paramedic'
       when 'EthekwiniDisaster' then 'Disaster'
       else 'Police'
     end
   end::public.user_role
 where role::text in ('Officer', 'Metro', 'Chief', 'Operator', 'Responder', 'Security', 'Citizen');

-- The web middleware and the app read the role from the sign-in token
-- (auth.users.raw_app_meta_data), not from profiles. Bring every token that
-- still names a retired role into line: the profile's role when there is one,
-- else the same mapping as above.
update auth.users u
   set raw_app_meta_data = jsonb_set(
     coalesce(u.raw_app_meta_data, '{}'::jsonb), '{role}',
     to_jsonb(coalesce(
       (select p.role::text from public.profiles p where p.id = u.id),
       case
         when u.raw_app_meta_data ->> 'role' in ('Officer', 'Metro') then 'Police'
         when u.raw_app_meta_data ->> 'role' = 'Chief'               then 'FireChief'
         when u.raw_app_meta_data ->> 'role' = 'Operator'            then 'ControlRoom'
         when u.raw_app_meta_data ->> 'role' in ('Security', 'Citizen') then 'Staff'
         else case u.raw_app_meta_data ->> 'silo'
           when 'MetroFire'         then 'Firefighter'
           when 'Medical'           then 'Paramedic'
           when 'EthekwiniDisaster' then 'Disaster'
           else 'Police'
         end
       end
     ))
   )
 where u.raw_app_meta_data ->> 'role' in ('Officer', 'Metro', 'Chief', 'Operator', 'Responder', 'Security', 'Citizen');

-- ── 2. Operators register and access rules ──────────────────────────────────

-- system_profiles.role is free text; the operators screen offered 'Operator'.
update public.system_profiles
   set role = case
     when role in ('Officer', 'Metro') then 'Police'
     when role = 'Chief'               then 'FireChief'
     when role = 'Operator'            then 'ControlRoom'
     else 'Staff'
   end
 where role in ('Officer', 'Metro', 'Chief', 'Operator', 'Responder', 'Security', 'Citizen');

-- A rule for a retired role applies to nobody now. Moving it onto the
-- replacement would change what the replacement's existing holders can see,
-- so it is removed instead. The replacement's own rules apply to the people
-- moved onto it.
delete from public.access_rules
 where role in ('Officer', 'Metro', 'Chief', 'Operator', 'Responder', 'Security', 'Citizen');

-- ── 3. Never again ──────────────────────────────────────────────────────────

alter table public.profiles drop constraint if exists profiles_role_not_retired;
alter table public.profiles add constraint profiles_role_not_retired check (
  role::text not in ('Officer', 'Metro', 'Chief', 'Operator', 'Responder', 'Security', 'Citizen')
);

alter table public.system_profiles drop constraint if exists system_profiles_role_not_retired;
alter table public.system_profiles add constraint system_profiles_role_not_retired check (
  role is null or role not in ('Officer', 'Metro', 'Chief', 'Operator', 'Responder', 'Security', 'Citizen')
);

alter table public.access_rules drop constraint if exists access_rules_role_not_retired;
alter table public.access_rules add constraint access_rules_role_not_retired check (
  role not in ('Officer', 'Metro', 'Chief', 'Operator', 'Responder', 'Security', 'Citizen')
);

-- ── 4. The two policies where Chief stood alone ─────────────────────────────

-- 0037 named 'Chief' without 'FireChief'. Same rule, with the kept name.
drop policy if exists firearms_command_write on public.firearms;
create policy firearms_command_write on public.firearms for all to authenticated
  using (
    public.role_in('SystemAdmin','SuperAdmin','SystemController')
    or (silo = public.current_silo()
        and public.role_in('Admin','System','Supervisor','Captain','FireChief'))
  )
  with check (
    public.role_in('SystemAdmin','SuperAdmin','SystemController')
    or (silo = public.current_silo()
        and public.role_in('Admin','System','Supervisor','Captain','FireChief'))
  );

drop policy if exists shift_no_firearm_read on public.shift_no_firearm_declarations;
create policy shift_no_firearm_read on public.shift_no_firearm_declarations for select to authenticated
  using (
    user_id = auth.uid()
    or public.role_in('SystemAdmin','SuperAdmin','SystemController')
    or (silo = public.current_silo()
        and public.role_in('Admin','System','Supervisor','Captain','FireChief'))
  );

-- ── 5. Prove it ─────────────────────────────────────────────────────────────

do $$
declare
  v_left int;
begin
  select count(*) into v_left from auth.users
   where raw_app_meta_data ->> 'role' in ('Officer', 'Metro', 'Chief', 'Operator', 'Responder', 'Security', 'Citizen');
  if v_left > 0 then
    raise exception '% sign-in token(s) still hold a retired role — nothing was changed', v_left;
  end if;
end $$;

commit;

-- After running: anyone who was moved must sign out and back in (or wait up to
-- an hour) — a signed-in session keeps its old token until it refreshes.
