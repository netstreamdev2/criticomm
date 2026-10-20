-- ============================================================================
-- 0089 — Issuing and returning firearms: through guarded functions only
-- ============================================================================
--
-- Run after 0088.
--
-- The firearm issue register (/police/firearms, firearm_authorizations) was
-- written straight from the console under 0002's policy, which checked only
-- the department. Two faults followed:
--
--   * any Metro Police account, an ordinary officer included, could write an
--     issue or mark one returned;
--   * a system administrator (whose department is the control room) could
--     not issue at all: the row is Metro Police's, and the policy wanted the
--     writer's own department. It failed with "not permitted" (42501).
--
-- Now:
--
--   issue_firearm_authorization(p)    issues a firearm. Captains, supervisors
--                                      and the administrator of Metro Police;
--                                      the system administrators and the
--                                      system controller from any department.
--                                      Checked and audited.
--   return_firearm_authorization(...) books it back in, once. The same people.
--
-- Nobody writes the table directly any more. Reading is unchanged (0002).
-- The armoury register still learns each serial (0037's trigger).
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. Who may issue and return ─────────────────────────────────────────────

/**
 * Captains, supervisors and the department administrator of Metro Police;
 * the system administrators and the system controller anywhere (as the
 * armoury, 0051). Internal.
 */
create or replace function public.firearm_issuer_check()
returns void language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.require_role('Captain', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin', 'SystemController');
  if public.current_tenant() is null then
    raise exception 'No organisation for this account' using errcode = '42501';
  end if;
  if public.role_in('Captain', 'Supervisor', 'Admin') and public.current_silo()::text <> 'MetroPolice' then
    raise exception 'Only Metro Police issues firearms' using errcode = '42501';
  end if;
end $$;
revoke all on function public.firearm_issuer_check() from public, anon, authenticated;

-- ── 2. Issue ────────────────────────────────────────────────────────────────
-- {"employee_name", "id_number", "firearm_number" (required), "company_number",
--  "form_number", "make", "rounds", "from", "to", "posted_location",
--  "chamber_status", "notes"}

create or replace function public.issue_firearm_authorization(p jsonb)
returns public.firearm_authorizations language plpgsql security definer set search_path to 'public' as $$
declare
  v_row     public.firearm_authorizations;
  v_name    text;
  v_who     text := nullif(btrim(p ->> 'employee_name'), '');
  v_id      text := nullif(btrim(p ->> 'id_number'), '');
  v_serial  text := nullif(btrim(p ->> 'firearm_number'), '');
  v_form    text := nullif(btrim(p ->> 'form_number'), '');
  v_rounds  integer;
  v_from    timestamptz;
  v_to      timestamptz;
  v_chamber text := nullif(btrim(p ->> 'chamber_status'), '');
begin
  perform public.firearm_issuer_check();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Send the issue as an object' using errcode = '22023';
  end if;

  if v_who is null then raise exception 'Enter the employee''s name' using errcode = '22023'; end if;
  if v_id is null then raise exception 'Enter the ID number' using errcode = '22023'; end if;
  if v_serial is null then raise exception 'Enter the firearm serial number' using errcode = '22023'; end if;
  if length(v_who) > 120 or length(v_id) > 40 or length(v_serial) > 60 or length(coalesce(v_form, '')) > 60 then
    raise exception 'One of the entries is too long' using errcode = '22023';
  end if;

  begin
    v_rounds := coalesce(nullif(btrim(p ->> 'rounds'), '')::integer, 0);
  exception when others then
    raise exception 'Rounds issued is a number' using errcode = '22023';
  end;
  if v_rounds < 0 or v_rounds > 500 then raise exception 'Rounds issued is between 0 and 500' using errcode = '22023'; end if;

  begin
    v_from := (p ->> 'from')::timestamptz;
    v_to := (p ->> 'to')::timestamptz;
  exception when others then
    raise exception 'Enter the from and to times' using errcode = '22023';
  end;
  if v_from is null or v_to is null then raise exception 'Enter the from and to times' using errcode = '22023'; end if;
  if v_to <= v_from then raise exception 'The "to" time is after the "from" time' using errcode = '22023'; end if;
  if v_to - v_from > interval '7 days' then raise exception 'An issue lasts at most 7 days' using errcode = '22023'; end if;

  if v_chamber is not null and v_chamber not in ('Cleared', 'Loaded', 'Unknown') then
    raise exception 'Chamber status is Cleared, Loaded or Unknown' using errcode = '22023';
  end if;

  -- The person issuing, by name, from their own profile: not typed in.
  select full_name into v_name from public.profiles where id = auth.uid();
  v_form := coalesce(v_form, format('FA-%s', to_char(now() at time zone 'Africa/Johannesburg', 'YYYYMMDD-HH24MISS-MS')));
  if exists (select 1 from public.firearm_authorizations where form_number = v_form) then
    raise exception 'That form number is already in the register' using errcode = '23505';
  end if;

  insert into public.firearm_authorizations (
    tenant_id, silo, form_number, employee_name, company_number, id_number, firearm_number, make, rounds_ammunition,
    from_date, to_date, posted_location, issued_by, chamber_status, notes)
  values (
    public.current_tenant(), 'MetroPolice', v_form, v_who, left(nullif(btrim(p ->> 'company_number'), ''), 40), v_id, v_serial,
    left(nullif(btrim(p ->> 'make'), ''), 80), v_rounds, v_from, v_to, left(nullif(btrim(p ->> 'posted_location'), ''), 120),
    coalesce(v_name, 'Unknown'), v_chamber, left(nullif(btrim(p ->> 'notes'), ''), 1000))
  returning * into v_row;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_row.tenant_id, 'MetroPolice', auth.uid(), v_name, 'FirearmIssued', 'firearm_authorization', v_row.id::text,
          format('%s → %s (%s rounds)', v_row.firearm_number, v_row.employee_name, v_row.rounds_ammunition));
  return v_row;
end $$;
revoke all on function public.issue_firearm_authorization(jsonb) from public, anon;
grant execute on function public.issue_firearm_authorization(jsonb) to authenticated;

-- ── 3. Return ───────────────────────────────────────────────────────────────

create or replace function public.return_firearm_authorization(p_id uuid, p_rounds_returned integer, p_condition text default null)
returns public.firearm_authorizations language plpgsql security definer set search_path to 'public' as $$
declare
  v_row  public.firearm_authorizations;
  v_name text;
begin
  perform public.firearm_issuer_check();
  select * into v_row from public.firearm_authorizations
   where id = p_id and tenant_id = public.current_tenant()
   for update;
  if not found then raise exception 'Issue not found' using errcode = 'P0002'; end if;
  if v_row.date_received is not null then
    raise exception 'This firearm is already returned' using errcode = '22023';
  end if;
  if p_rounds_returned is null or p_rounds_returned < 0 or p_rounds_returned > v_row.rounds_ammunition then
    raise exception 'Rounds returned is between 0 and the % issued', v_row.rounds_ammunition using errcode = '22023';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  update public.firearm_authorizations set
    rounds_returned = p_rounds_returned,
    received_by     = coalesce(v_name, 'Unknown'),
    condition       = left(nullif(btrim(p_condition), ''), 200),
    date_received   = now()
  where id = v_row.id
  returning * into v_row;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_row.tenant_id, 'MetroPolice', auth.uid(), v_name, 'FirearmReturned', 'firearm_authorization', v_row.id::text,
          format('%s from %s: %s of %s rounds back%s', v_row.firearm_number, v_row.employee_name, v_row.rounds_returned,
                 v_row.rounds_ammunition, case when v_row.condition is not null then ', ' || v_row.condition else '' end));
  return v_row;
end $$;
revoke all on function public.return_firearm_authorization(uuid, integer, text) from public, anon;
grant execute on function public.return_firearm_authorization(uuid, integer, text) to authenticated;

-- ── 4. No direct writes ─────────────────────────────────────────────────────

drop policy if exists firearm_auth_write on public.firearm_authorizations;
revoke insert, update, delete on public.firearm_authorizations from authenticated, anon;
grant select on public.firearm_authorizations to authenticated;

notify pgrst, 'reload schema';
