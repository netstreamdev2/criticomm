-- ============================================================================
-- 0058 — Fines: what is owed, when it was paid, and where each fine stands
-- ============================================================================
--
-- Run after 0057.
--
-- 0057 issued fines and kept a payment ledger. This adds what an officer and
-- the finance desk need next:
--
--   1. When the money was paid. Ledger entries carry paid_on (the day on the
--      receipt), so a payment captured late still earns the AARTO discount if
--      it was made inside the 32 days.
--   2. Where each fine stands. fine_stage(): the AARTO discount period, then
--      the courtesy letter stage, then the enforcement order stage; for a
--      Section 56 notice, waiting for the court date or the date passed; for a
--      Section 341 notice, open or overdue. Overdue = open past its pay-by date.
--   3. The roadside check. check_fines_owing(): by ID number or registration,
--      what this person or vehicle owes on the register — a summary only (fine
--      numbers, offences, amounts, stages), never another officer's record of
--      names and addresses. Every look-up is written to the audit trail and
--      held to 120 an hour per officer.
--   4. Payments from a file. import_fine_payments(): rows of fine or notice
--      number, amount, date paid and receipt number, matched and recorded in
--      one go. A receipt already on a fine is skipped, so the same file can be
--      imported twice without paying twice.
--
-- Safe to re-run.
-- ============================================================================

begin;

-- ── 1. When the money was paid ──────────────────────────────────────────────

alter table public.charge_transactions add column if not exists paid_on date;

-- A fine payment is dated by its receipt: not in the future, not before the
-- notice was served. Undated means today.
create or replace function public.fine_payment_date() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_served date;
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  if new.fine_id is null then return new; end if;
  new.paid_on := coalesce(new.paid_on, v_today);
  if new.paid_on > v_today then
    raise exception 'The payment date cannot be in the future.' using errcode = 'P0001';
  end if;
  select (issued_at at time zone 'Africa/Johannesburg')::date into v_served from public.fines where id = new.fine_id;
  if v_served is not null and new.paid_on < v_served then
    raise exception 'The payment date is before the fine was issued (%).', v_served using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists fine_payment_date on public.charge_transactions;
create trigger fine_payment_date before insert on public.charge_transactions
  for each row execute function public.fine_payment_date();

-- One receipt is recorded once against a fine. Best effort: an older
-- duplicate in the ledger leaves the check to import_fine_payments().
do $$
begin
  create unique index if not exists charge_tx_fine_receipt_uq
    on public.charge_transactions (fine_id, upper(reference))
    where fine_id is not null and reference is not null and tx_type = 'Payment';
exception when unique_violation then
  raise notice 'Duplicate receipt numbers already in the ledger; the import still checks for them.';
end $$;

-- ── 2. What is owed, and where a fine stands ────────────────────────────────

-- What a fine costs on a given day: the AARTO discount through the 32nd day
-- after the day it was served (South African days), the full penalty after.
create or replace function public.fine_amount_due_on(p_fine public.fines, p_on date) returns numeric
language sql stable set search_path to 'public' as $$
  select case
    when p_fine.notice_type = 'AARTO 01'
         and p_on <= (p_fine.issued_at at time zone 'Africa/Johannesburg')::date + 32
      then p_fine.amount - p_fine.discount_amount
    else p_fine.amount
  end;
$$;

create or replace function public.fine_amount_due(p_fine public.fines) returns numeric
language sql stable set search_path to 'public' as $$
  select public.fine_amount_due_on(p_fine, (now() at time zone 'Africa/Johannesburg')::date);
$$;

-- Where a fine stands today. Mirrors fineStage() in packages/db/src/fines.ts.
create or replace function public.fine_stage(p_fine public.fines, p_today date default null) returns text
language sql stable set search_path to 'public' as $$
  with d as (
    select coalesce(p_today, (now() at time zone 'Africa/Johannesburg')::date) as today,
           (p_fine.issued_at at time zone 'Africa/Johannesburg')::date as served
  )
  select case
    when p_fine.status = 'Cancelled' then 'Cancelled'
    when p_fine.status = 'Paid' then 'Paid'
    when p_fine.status = 'Disputed' then 'Representation'
    when p_fine.notice_type = 'AARTO 01' then
      case when d.today <= d.served + 32 then 'Discount period'
           when d.today <= d.served + 64 then 'Courtesy letter'
           else 'Enforcement order' end
    when p_fine.notice_type = 'Section 56' then
      case when p_fine.court_date is null or d.today <= p_fine.court_date then 'Awaiting court'
           else 'Court date passed' end
    else
      case when p_fine.due_date is null or d.today <= p_fine.due_date then 'Open' else 'Overdue' end
  end
  from d;
$$;

-- Open and past its pay-by date. A representation pauses the clock.
create or replace function public.fine_is_overdue(p_fine public.fines, p_today date default null) returns boolean
language sql stable set search_path to 'public' as $$
  select p_fine.status in ('Unpaid', 'Partially Paid')
     and p_fine.due_date is not null
     and coalesce(p_today, (now() at time zone 'Africa/Johannesburg')::date) > p_fine.due_date;
$$;

-- The ledger sets Paid. The discount is judged on the date of the last
-- payment, not the day it was captured.
create or replace function public.fine_ledger_status() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_fine public.fines;
  v_paid numeric;
  v_last date;
  v_next text;
begin
  if new.fine_id is null then return new; end if;
  select * into v_fine from public.fines where id = new.fine_id for update;
  if v_fine.id is null then return new; end if;
  if v_fine.status = 'Cancelled' and new.tx_type in ('Payment', 'Adjustment') then
    raise exception '% is cancelled; no payment can be recorded against it.', v_fine.fine_number
      using errcode = 'P0001';
  end if;
  if v_fine.status = 'Cancelled' then return new; end if;

  select coalesce(sum(case when tx_type in ('Payment', 'Adjustment') then amount
                           when tx_type = 'Refund' then -amount else 0 end), 0),
         max(case when tx_type in ('Payment', 'Adjustment') then coalesce(paid_on, recorded_at::date) end)
    into v_paid, v_last
    from public.charge_transactions where fine_id = new.fine_id;

  v_next := case
    when v_paid > 0 and v_paid >= public.fine_amount_due_on(v_fine, coalesce(v_last, (now() at time zone 'Africa/Johannesburg')::date)) then 'Paid'
    when v_paid > 0 then 'Partially Paid'
    when v_fine.status = 'Disputed' then 'Disputed'
    else 'Unpaid'
  end;
  if v_next is distinct from v_fine.status then
    update public.fines set status = v_next where id = new.fine_id;
  end if;
  return new;
end $$;

-- ── 3. The roadside check ───────────────────────────────────────────────────

create or replace function public.check_fines_owing(p_id_number text default null, p_vehicle_reg text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid := public.current_tenant();
  v_id text := nullif(upper(regexp_replace(coalesce(p_id_number, ''), '\s', '', 'g')), '');
  v_reg text := nullif(upper(regexp_replace(coalesce(p_vehicle_reg, ''), '[^A-Za-z0-9]', '', 'g')), '');
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_allowed boolean;
  v_result jsonb;
  v_name text := (select full_name from public.profiles where id = auth.uid());
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not (public.can_issue_fines() or public.can_view_all_fines('MetroPolice')) then
    raise exception 'Only Metro Police officers and command staff check what is owed.' using errcode = '42501';
  end if;
  if v_tenant is null then
    raise exception 'Your organisation is not active.' using errcode = '42501';
  end if;
  -- Exact numbers only: this is a check on a person in front of the officer,
  -- not a search of the register.
  if (v_id is null or length(v_id) < 6) and (v_reg is null or length(v_reg) < 3) then
    raise exception 'Enter a full ID number or vehicle registration.' using errcode = 'P0001';
  end if;
  select allowed into v_allowed from public.rate_limit_hit('fine_owing_check', 120, 3600);
  if not coalesce(v_allowed, false) then
    raise exception 'Too many checks in the last hour. Try again later.' using errcode = 'P0001';
  end if;

  with matched as (
    select f as fine,
           coalesce((select sum(case when t.tx_type in ('Payment', 'Adjustment') then t.amount
                                     when t.tx_type = 'Refund' then -t.amount else 0 end)
                       from public.charge_transactions t where t.fine_id = f.id), 0) as paid,
           (v_id is not null and f.offender_id_number = v_id) as by_id,
           (v_reg is not null and f.vehicle_reg = v_reg) as by_reg
      from public.fines f
     where f.tenant_id = v_tenant
       and f.status in ('Unpaid', 'Partially Paid', 'Disputed')
       and ((v_id is not null and f.offender_id_number = v_id) or (v_reg is not null and f.vehicle_reg = v_reg))
  ), rows as (
    select (m.fine).fine_number as fine_number, (m.fine).notice_type as notice_type, (m.fine).issued_at as issued_at,
           (m.fine).offence_description as offence, (m.fine).vehicle_reg as vehicle_reg, (m.fine).due_date as due_date,
           (m.fine).status as status, m.by_id, m.by_reg,
           greatest(0, public.fine_amount_due_on(m.fine, v_today) - m.paid) as owing,
           public.fine_stage(m.fine, v_today) as stage,
           public.fine_is_overdue(m.fine, v_today) as overdue
      from matched m
  )
  select jsonb_build_object(
    'id_checked', v_id is not null,
    'reg_checked', v_reg,
    'open_count', count(*),
    'total_owing', coalesce(sum(owing), 0),
    'overdue_count', count(*) filter (where overdue),
    'overdue_owing', coalesce(sum(owing) filter (where overdue), 0),
    'disputed_count', count(*) filter (where status = 'Disputed'),
    'oldest_issued', min(issued_at),
    'fines', coalesce(jsonb_agg(jsonb_build_object(
        'fine_number', fine_number,
        'notice_type', notice_type,
        'issued_at', issued_at,
        'offence', offence,
        'vehicle_reg', vehicle_reg,
        'owing', owing,
        'due_date', due_date,
        'stage', stage,
        'overdue', overdue,
        'matched_on', case when by_id and by_reg then 'both' when by_id then 'id' else 'reg' end
      ) order by issued_at), '[]'::jsonb)
  ) into v_result
  from rows;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_tenant, 'MetroPolice', auth.uid(), v_name, 'FineOwingChecked', 'fine', null,
          concat_ws(' · ',
            case when v_id is not null then 'ID ••••' || right(v_id, 4) end,
            v_reg,
            (v_result ->> 'open_count') || ' open'));

  return v_result;
end $$;

revoke all on function public.check_fines_owing(text, text) from public, anon;
grant execute on function public.check_fines_owing(text, text) to authenticated;

-- ── 4. Payments from a file ─────────────────────────────────────────────────

create or replace function public.import_fine_payments(p_rows jsonb, p_file_name text default null, p_file_sha256 text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid := public.current_tenant();
  v_name text := (select full_name from public.profiles where id = auth.uid());
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_row jsonb;
  v_line int;
  v_ref text;
  v_receipt text;
  v_amount numeric(12,2);
  v_on date;
  v_method text;
  v_fine public.fines;
  v_matches int;
  v_out jsonb := '[]'::jsonb;
  v_recorded int := 0;
  v_total numeric := 0;
  v_outcome text;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.can_manage_fines('MetroPolice') then
    raise exception 'Only command staff record payments.' using errcode = '42501';
  end if;
  if v_tenant is null then
    raise exception 'Your organisation is not active.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The file has no payments.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Import at most 2 000 payments at a time.' using errcode = 'P0001';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_line := nullif(v_row ->> 'line', '')::int;
    v_ref := nullif(upper(regexp_replace(coalesce(v_row ->> 'reference', ''), '\s', '', 'g')), '');
    v_receipt := nullif(trim(coalesce(v_row ->> 'receipt', '')), '');
    v_method := coalesce(nullif(v_row ->> 'method', ''), 'EFT');
    v_status := null;
    v_outcome := null;
    v_fine := null;

    begin
      v_amount := nullif(v_row ->> 'amount', '')::numeric(12,2);
      v_on := nullif(v_row ->> 'paid_on', '')::date;
    exception when others then
      v_outcome := 'bad_value';
    end;

    if v_outcome is null then
      if v_ref is null then v_outcome := 'no_reference';
      elsif v_receipt is null then v_outcome := 'no_receipt';
      elsif v_amount is null or v_amount <= 0 then v_outcome := 'bad_amount';
      elsif v_on is null or v_on > v_today then v_outcome := 'bad_date';
      elsif v_method not in ('Cash', 'Card', 'EFT', 'Other') then v_outcome := 'bad_method';
      end if;
    end if;

    if v_outcome is null then
      select count(*) into v_matches from public.fines
       where tenant_id = v_tenant and (upper(fine_number) = v_ref or upper(notice_number) = v_ref);
      if v_matches = 0 then
        v_outcome := 'no_match';
      elsif v_matches > 1 then
        v_outcome := 'ambiguous';
      else
        select * into v_fine from public.fines
         where tenant_id = v_tenant and (upper(fine_number) = v_ref or upper(notice_number) = v_ref);
        if v_fine.status = 'Cancelled' then
          v_outcome := 'cancelled';
        elsif exists (select 1 from public.charge_transactions
                       where fine_id = v_fine.id and tx_type = 'Payment' and upper(reference) = upper(v_receipt)) then
          v_outcome := 'duplicate';
        elsif v_on < (v_fine.issued_at at time zone 'Africa/Johannesburg')::date then
          v_outcome := 'before_issue';
        end if;
      end if;
    end if;

    if v_outcome is null then
      begin
        insert into public.charge_transactions (
          tenant_id, silo, fine_id, tx_type, amount, method, reference, recorded_by, recorded_name, note, paid_on
        ) values (
          v_tenant, v_fine.silo, v_fine.id, 'Payment', v_amount, v_method, v_receipt, auth.uid(), v_name,
          nullif(trim(coalesce(v_row ->> 'note', '')), ''), v_on
        );
        select status into v_status from public.fines where id = v_fine.id;
        v_outcome := 'recorded';
        v_recorded := v_recorded + 1;
        v_total := v_total + v_amount;
      exception when others then
        v_outcome := 'failed';
      end;
    end if;

    v_out := v_out || jsonb_build_object(
      'line', v_line, 'reference', v_ref, 'receipt', v_receipt, 'amount', v_amount,
      'outcome', v_outcome, 'fine_id', v_fine.id, 'fine_number', v_fine.fine_number, 'status', v_status
    );
  end loop;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_tenant, 'MetroPolice', auth.uid(), v_name, 'FinePaymentsImported', 'fine', null,
          concat_ws(' · ', coalesce(p_file_name, 'payments'), v_recorded || ' of ' || jsonb_array_length(p_rows) || ' recorded',
                    'R' || to_char(v_total, 'FM999999990.00'), left(p_file_sha256, 12)));

  return jsonb_build_object('recorded', v_recorded, 'total', v_total, 'rows', v_out);
end $$;

revoke all on function public.import_fine_payments(jsonb, text, text) from public, anon;
grant execute on function public.import_fine_payments(jsonb, text, text) to authenticated;

revoke all on function public.fine_stage(public.fines, date) from public, anon;
revoke all on function public.fine_is_overdue(public.fines, date) from public, anon;
revoke all on function public.fine_amount_due_on(public.fines, date) from public, anon;
grant execute on function public.fine_stage(public.fines, date) to authenticated;
grant execute on function public.fine_is_overdue(public.fines, date) to authenticated;
grant execute on function public.fine_amount_due_on(public.fines, date) to authenticated;

commit;
