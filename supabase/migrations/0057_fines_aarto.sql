-- ============================================================================
-- 0057 — Fines: issued on the phone, kept as legal documents
-- ============================================================================
--
-- Run after 0056.
--
-- Metro Police officers issue fines at the roadside. From 1 July 2026
-- eThekwini is under AARTO (Phase 2), so a road traffic offence is served in
-- person on an AARTO 01 infringement notice: 50% discount if paid within 32
-- days, then a courtesy letter, then an enforcement order. Municipal by-law
-- offences are still Criminal Procedure Act matters: a Section 56 written
-- notice when the offender is present (admission of guilt or court), or a
-- Section 341 notice left on an unattended vehicle.
--
-- What this migration does to the fines register that 0033 started:
--
--   1. The fields an AARTO 01 notice carries: infringer particulars, vehicle,
--      place and time, charge, discount, officer and infrastructure number,
--      both signatures, and the notes page (driver description, conditions,
--      witnesses). One row per charge, as AARTO numbers each charge on its
--      own; up to three charges served together share a group_ref.
--   2. An offence catalogue (charge book) the admins keep: code, legal
--      reference, penalty and demerit points. When it has an amount, that
--      amount is charged — the officer cannot change it.
--   3. Writes only through checked functions:
--        issue_fines()      the officer serving the notice (idempotent, so a
--                           phone retrying after a dead zone never files twice)
--        cancel_fine()      command staff, with a reason, kept on the record
--        set_fine_status()  command staff: representation lodged / withdrawn
--      Payments are recorded on the ledger (charge_transactions) and the
--      ledger sets Paid / Partially Paid.
--   4. A fine is a legal document: what was served can never be edited or
--      deleted. Only its status, a cancellation and a late official notice
--      number may change.
--   5. Who sees what: an officer sees the fines they issued; captains,
--      supervisors and admins in Metro Police (and the Ethekwini control
--      silo) see all of them; the SystemAdmin, SuperAdmin and controller see
--      the tenant's. The dispatch desks and viewers no longer read fines —
--      they hold ID numbers and addresses (POPIA).
--
-- Safe to re-run.
-- ============================================================================

begin;

-- ── 1. Who may do what ──────────────────────────────────────────────────────

-- Issue: the officers who serve notices.
create or replace function public.can_issue_fines() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.role_in('Police', 'Captain', 'Supervisor')
     and public.current_silo() in ('MetroPolice', 'Ethekwini');
$$;

-- See every fine: command staff in the department, the tenant-wide tier.
-- Ethekwini (the control silo) reaches Metro Police, as it does for the armoury.
create or replace function public.can_view_all_fines(p_silo public.silo) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.role_in('SystemAdmin', 'SuperAdmin', 'SystemController')
      or (public.role_in('Admin', 'Captain', 'Supervisor')
          and (p_silo = public.current_silo()
               or (public.current_silo() = 'Ethekwini' and p_silo = 'MetroPolice')));
$$;

-- Cancel, change status, record payments: the same people.
create or replace function public.can_manage_fines(p_silo public.silo) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.can_view_all_fines(p_silo);
$$;

-- Keep the charge book: the admin tier.
create or replace function public.can_manage_fine_offences() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.role_in('SystemAdmin', 'SuperAdmin', 'SystemController')
      or (public.role_in('Admin') and public.current_silo() in ('MetroPolice', 'Ethekwini'));
$$;

revoke all on function public.can_issue_fines() from public, anon;
revoke all on function public.can_view_all_fines(public.silo) from public, anon;
revoke all on function public.can_manage_fines(public.silo) from public, anon;
revoke all on function public.can_manage_fine_offences() from public, anon;
grant execute on function public.can_issue_fines() to authenticated;
grant execute on function public.can_view_all_fines(public.silo) to authenticated;
grant execute on function public.can_manage_fines(public.silo) to authenticated;
grant execute on function public.can_manage_fine_offences() to authenticated;

-- A South African ID number: 13 digits, a real date of birth, Luhn check digit.
create or replace function public.is_valid_rsa_id(p_id text) returns boolean
language plpgsql immutable set search_path to 'public' as $$
declare
  v_sum int := 0;
  v_digit int;
  v_month int;
  v_day int;
begin
  if p_id is null or p_id !~ '^[0-9]{13}$' then return false; end if;
  v_month := substr(p_id, 3, 2)::int;
  v_day := substr(p_id, 5, 2)::int;
  if v_month < 1 or v_month > 12 or v_day < 1 or v_day > 31 then return false; end if;
  -- Luhn over all 13 digits: double every second digit from the right.
  for i in 1..13 loop
    v_digit := substr(p_id, 14 - i, 1)::int;
    if i % 2 = 0 then
      v_digit := v_digit * 2;
      if v_digit > 9 then v_digit := v_digit - 9; end if;
    end if;
    v_sum := v_sum + v_digit;
  end loop;
  return v_sum % 10 = 0;
end $$;

-- A finger signature exactly as the phone's signature pad writes it: one
-- path of move/line commands. Anything else (a script, a link, an image) is
-- refused, because the slip puts the signature on a page the console opens.
create or replace function public.is_signature_svg(p_svg text) returns boolean
language sql immutable set search_path to 'public' as $$
  select p_svg ~ ('^<svg xmlns="http://www\.w3\.org/2000/svg" viewBox="[0-9. ]{1,40}" width="[0-9.]{1,8}" height="[0-9.]{1,8}">'
               || '<path d="[ML0-9. -]*" fill="none" stroke="#[0-9a-fA-F]{3,8}" stroke-width="[0-9.]{1,5}" '
               || 'stroke-linecap="round" stroke-linejoin="round"/></svg>$');
$$;

-- ── 2. The offence catalogue (charge book) ──────────────────────────────────

create table if not exists public.fine_offences (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default public.current_tenant(),
  silo             public.silo not null default 'MetroPolice',
  -- AARTO: road traffic (NRTA) offences. By-law: municipal by-laws (CPA).
  regime           text not null check (regime in ('AARTO', 'By-law')),
  -- The AARTO Schedule 3 charge code, or the by-law section.
  code             text check (code is null or length(code) between 1 and 20),
  description      text not null check (length(trim(description)) between 3 and 200),
  legal_ref        text check (legal_ref is null or length(legal_ref) <= 120),
  -- Null until an admin enters it from the charge book; the officer then types it.
  penalty_amount   numeric(12,2) check (penalty_amount is null or penalty_amount >= 0),
  demerit_points   smallint not null default 0 check (demerit_points between 0 and 6),
  active           boolean not null default true,
  -- Seeded rows start unverified: an admin confirms code and amount first.
  verified         boolean not null default false,
  verified_by      uuid,
  verified_by_name text,
  verified_at      timestamptz,
  updated_at       timestamptz not null default now(),
  unique (tenant_id, regime, description)
);
create unique index if not exists fine_offences_code_uq
  on public.fine_offences (tenant_id, regime, code) where code is not null;
create index if not exists fine_offences_tenant_idx on public.fine_offences (tenant_id);

alter table public.fine_offences enable row level security;

drop policy if exists fine_offences_read on public.fine_offences;
create policy fine_offences_read on public.fine_offences for select to authenticated using (true);

drop policy if exists fine_offences_write on public.fine_offences;
create policy fine_offences_write on public.fine_offences for all to authenticated
  using (public.can_manage_fine_offences())
  with check (public.can_manage_fine_offences());

drop policy if exists tenant_isolation on public.fine_offences;
create policy tenant_isolation on public.fine_offences as restrictive for all to authenticated
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

-- Verifying stamps who did it; editing a verified row's code or amount
-- un-verifies it, so the stamp always matches what is charged.
create or replace function public.fine_offences_stamp() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and old.verified and new.verified
     and (new.code is distinct from old.code
          or new.penalty_amount is distinct from old.penalty_amount
          or new.legal_ref is distinct from old.legal_ref
          or new.demerit_points is distinct from old.demerit_points) then
    new.verified := false;
  end if;
  if new.verified and (tg_op = 'INSERT' or not old.verified) then
    if new.penalty_amount is null then
      raise exception 'Enter the penalty amount before verifying this offence.' using errcode = 'P0001';
    end if;
    new.verified_by := auth.uid();
    new.verified_by_name := (select full_name from public.profiles where id = auth.uid());
    new.verified_at := now();
  elsif not new.verified then
    new.verified_by := null;
    new.verified_by_name := null;
    new.verified_at := null;
  end if;
  return new;
end $$;

drop trigger if exists fine_offences_stamp on public.fine_offences;
create trigger fine_offences_stamp before insert or update on public.fine_offences
  for each row execute function public.fine_offences_stamp();

-- A starting list of the offences Metro Police write most. Codes, legal
-- references and amounts are left for an admin to enter from the charge book
-- (AARTO Schedule 3 and the eThekwini by-laws): nothing is charged from a
-- guess. Until then the officer types the amount and the record says so.
insert into public.fine_offences (regime, description) values
  ('AARTO', 'Exceeding the speed limit'),
  ('AARTO', 'Driver not wearing a seatbelt'),
  ('AARTO', 'Passenger not wearing a seatbelt'),
  ('AARTO', 'Holding a cellphone while driving'),
  ('AARTO', 'Failing to stop at a red traffic signal'),
  ('AARTO', 'Failing to stop at a stop sign'),
  ('AARTO', 'Driving without a valid driving licence'),
  ('AARTO', 'Failing to produce a driving licence on request'),
  ('AARTO', 'Driving an unlicensed motor vehicle (licence disc expired)'),
  ('AARTO', 'Licence disc not displayed'),
  ('AARTO', 'Driving an unroadworthy vehicle'),
  ('AARTO', 'Crossing a solid barrier line'),
  ('AARTO', 'Stopping in a no-stopping zone'),
  ('AARTO', 'Parking in a prohibited place'),
  ('AARTO', 'Carrying more passengers than permitted'),
  ('By-law', 'Parking without paying at a pay-and-display bay'),
  ('By-law', 'Illegal dumping'),
  ('By-law', 'Street trading without a permit'),
  ('By-law', 'Consuming liquor in a public place'),
  ('By-law', 'Causing a noise nuisance'),
  ('By-law', 'Obstructing a sidewalk or public road')
on conflict (tenant_id, regime, description) do nothing;

-- ── 3. The notice on the fines register ─────────────────────────────────────

alter table public.fines
  add column if not exists notice_type text not null default 'AARTO 01',
  -- The official number: an AARTO notice number or the pre-printed book number.
  add column if not exists notice_number text,
  -- Charges served together on one notice; the phone's idempotency key.
  add column if not exists group_ref uuid,
  add column if not exists charge_seq smallint not null default 1,
  add column if not exists captured_from text not null default 'device',
  -- Infringer
  add column if not exists offender_surname text,
  add column if not exists offender_first_names text,
  add column if not exists offender_initials text,
  add column if not exists offender_id_type text,
  add column if not exists offender_id_country text,
  add column if not exists offender_dob date,
  add column if not exists offender_gender text,
  add column if not exists offender_licence_code text,
  add column if not exists offender_prdp_code text,
  add column if not exists offender_phone text,
  add column if not exists offender_email text,
  add column if not exists offender_address text,
  -- Vehicle
  add column if not exists vehicle_licence_disc text,
  add column if not exists vehicle_type text,
  add column if not exists vehicle_make text,
  add column if not exists vehicle_model text,
  add column if not exists vehicle_colour text,
  -- Place and time
  add column if not exists province text,
  add column if not exists city text,
  add column if not exists suburb text,
  add column if not exists street_a text,
  add column if not exists street_b text,
  add column if not exists direction text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists offence_at timestamptz,
  -- Charge
  add column if not exists offence_id uuid references public.fine_offences (id) on delete set null,
  add column if not exists legal_ref text,
  add column if not exists amount_source text not null default 'catalogue',
  add column if not exists discount_amount numeric(12,2) not null default 0,
  add column if not exists demerit_points smallint not null default 0,
  -- Section 56: where and when to appear
  add column if not exists court_name text,
  add column if not exists court_date date,
  -- Issuing authority and officer
  add column if not exists issuing_authority text,
  add column if not exists magisterial_district text,
  add column if not exists officer_infrastructure_no text,
  add column if not exists officer_signature text,
  add column if not exists infringer_signature text,
  add column if not exists infringer_refused boolean not null default false,
  -- The notes page: driver description, conditions, witnesses.
  add column if not exists observations jsonb not null default '{}'::jsonb,
  -- Cancellation stays on the record.
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid,
  add column if not exists cancelled_by_name text,
  add column if not exists cancel_reason text,
  -- When the server received it (issued_at is when it was served).
  add column if not exists recorded_at timestamptz not null default now();

do $$
begin
  alter table public.fines add constraint fines_notice_type_chk
    check (notice_type in ('AARTO 01', 'Section 56', 'Section 341'));
exception when duplicate_object then null; end $$;
do $$
begin
  alter table public.fines add constraint fines_charge_seq_chk check (charge_seq between 1 and 3);
exception when duplicate_object then null; end $$;
do $$
begin
  alter table public.fines add constraint fines_captured_from_chk check (captured_from in ('device', 'paper'));
exception when duplicate_object then null; end $$;
do $$
begin
  alter table public.fines add constraint fines_id_type_chk
    check (offender_id_type is null or offender_id_type in ('RSA ID', 'Passport', 'Driving licence', 'Foreign ID'));
exception when duplicate_object then null; end $$;
do $$
begin
  alter table public.fines add constraint fines_gender_chk
    check (offender_gender is null or offender_gender in ('Male', 'Female'));
exception when duplicate_object then null; end $$;
do $$
begin
  alter table public.fines add constraint fines_amount_source_chk check (amount_source in ('catalogue', 'officer'));
exception when duplicate_object then null; end $$;
do $$
begin
  alter table public.fines add constraint fines_discount_chk check (discount_amount >= 0 and discount_amount <= amount);
exception when duplicate_object then null; end $$;
do $$
begin
  alter table public.fines add constraint fines_demerit_chk check (demerit_points between 0 and 6);
exception when duplicate_object then null; end $$;
do $$
begin
  -- A finger signature is a few KB of SVG; anything near this is not one.
  alter table public.fines add constraint fines_signature_size_chk
    check (coalesce(length(officer_signature), 0) <= 200000 and coalesce(length(infringer_signature), 0) <= 200000);
exception when duplicate_object then null; end $$;
do $$
begin
  alter table public.fines add constraint fines_cancel_reason_chk
    check (status <> 'Cancelled' or cancelled_at is null or length(trim(coalesce(cancel_reason, ''))) >= 10);
exception when duplicate_object then null; end $$;

create unique index if not exists fines_group_charge_uq
  on public.fines (tenant_id, group_ref, charge_seq) where group_ref is not null;
create unique index if not exists fines_notice_number_uq
  on public.fines (tenant_id, notice_number) where notice_number is not null;
create index if not exists fines_issued_idx on public.fines (tenant_id, issued_at desc);
create index if not exists fines_issuer_idx on public.fines (issued_by, issued_at desc);
create index if not exists fines_status_idx on public.fines (tenant_id, status);
create index if not exists fines_vehicle_idx on public.fines (tenant_id, vehicle_reg);
create index if not exists fines_offender_idx on public.fines (tenant_id, offender_id_number);

-- ── 4. What was served never changes ────────────────────────────────────────

create or replace function public.guard_fine_record() returns trigger
language plpgsql set search_path to 'public' as $$
declare
  -- The only columns that may move after a notice is served.
  c_mutable constant text[] := array[
    'status', 'cancelled_at', 'cancelled_by', 'cancelled_by_name', 'cancel_reason', 'notice_number'
  ];
begin
  if tg_op = 'DELETE' then
    raise exception 'A fine is a legal record and cannot be deleted. Cancel it with a reason instead.'
      using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - c_mutable) is distinct from (to_jsonb(old) - c_mutable) then
    raise exception 'A served notice cannot be edited. Cancel it with a reason and issue a new one.'
      using errcode = 'P0001';
  end if;
  if old.notice_number is not null and new.notice_number is distinct from old.notice_number then
    raise exception 'The official notice number is already on the record and cannot be changed.'
      using errcode = 'P0001';
  end if;
  if old.status = 'Cancelled' and new.status <> 'Cancelled' then
    raise exception 'A cancelled fine stays cancelled.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists guard_fine_record on public.fines;
create trigger guard_fine_record before update or delete on public.fines
  for each row execute function public.guard_fine_record();

-- ── 5. Who reads, who writes ────────────────────────────────────────────────

-- 0033 let every police role write any fine and the dispatch desks read them.
drop policy if exists fines_read on public.fines;
drop policy if exists fines_write on public.fines;
drop policy if exists fines_select on public.fines;
create policy fines_select on public.fines for select to authenticated
  using (issued_by = auth.uid() or public.can_view_all_fines(silo));
-- No insert, update or delete policies: issue_fines(), cancel_fine(),
-- set_fine_status() and the ledger trigger are the only writers.

-- The ledger: payments against a fine are recorded by command staff, never
-- edited or deleted, and read only by those who can read the fine.
drop policy if exists charge_tx_fine_read on public.charge_transactions;
create policy charge_tx_fine_read on public.charge_transactions as restrictive for select to authenticated
  using (fine_id is null or exists (select 1 from public.fines f where f.id = fine_id));
drop policy if exists charge_tx_fine_insert on public.charge_transactions;
create policy charge_tx_fine_insert on public.charge_transactions as restrictive for insert to authenticated
  with check (fine_id is null or public.can_manage_fines('MetroPolice'));
drop policy if exists charge_tx_fine_update on public.charge_transactions;
create policy charge_tx_fine_update on public.charge_transactions as restrictive for update to authenticated
  using (fine_id is null);
drop policy if exists charge_tx_fine_delete on public.charge_transactions;
create policy charge_tx_fine_delete on public.charge_transactions as restrictive for delete to authenticated
  using (fine_id is null);

-- ── 6. Issuing ──────────────────────────────────────────────────────────────

-- What is owed today: the AARTO discount while the 32 days run, the full
-- penalty after.
create or replace function public.fine_amount_due(p_fine public.fines) returns numeric
language sql stable set search_path to 'public' as $$
  select case
    when p_fine.notice_type = 'AARTO 01' and now() <= p_fine.issued_at + interval '32 days'
      then p_fine.amount - p_fine.discount_amount
    else p_fine.amount
  end;
$$;

create or replace function public.issue_fines(
  p_notice jsonb,
  p_charges jsonb,
  p_client_ref uuid,
  p_occurred_at timestamptz default now()
) returns setof public.fines
language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid := public.current_tenant();
  v_me record;
  v_type text := coalesce(nullif(trim(p_notice ->> 'notice_type'), ''), 'AARTO 01');
  v_from text := coalesce(nullif(trim(p_notice ->> 'captured_from'), ''), 'device');
  v_at timestamptz := coalesce(p_occurred_at, now());
  v_offence_at timestamptz;
  v_surname text := nullif(trim(p_notice ->> 'offender_surname'), '');
  v_first text := nullif(trim(p_notice ->> 'offender_first_names'), '');
  v_full text;
  v_id_type text := nullif(trim(p_notice ->> 'offender_id_type'), '');
  v_id text := nullif(upper(regexp_replace(coalesce(p_notice ->> 'offender_id_number', ''), '\s', '', 'g')), '');
  v_reg text := nullif(upper(regexp_replace(coalesce(p_notice ->> 'vehicle_reg', ''), '[^A-Za-z0-9]', '', 'g')), '');
  v_street text := nullif(trim(p_notice ->> 'street_a'), '');
  v_place text := nullif(trim(p_notice ->> 'location'), '');
  v_court_date date := nullif(p_notice ->> 'court_date', '')::date;
  v_court text := nullif(trim(p_notice ->> 'court_name'), '');
  v_notice_no text := nullif(upper(trim(p_notice ->> 'notice_number')), '');
  v_officer_sig text := nullif(p_notice ->> 'officer_signature', '');
  v_infringer_sig text := nullif(p_notice ->> 'infringer_signature', '');
  v_refused boolean := coalesce((p_notice ->> 'infringer_refused')::boolean, false);
  v_count int;
  v_charge jsonb;
  v_seq int;
  v_off public.fine_offences;
  v_regime text;
  v_desc text;
  v_amount numeric(12,2);
  v_source text;
  v_due date;
  v_authority text;
  v_infra text;
  v_number text;
  v_numbers text[] := '{}';
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.can_issue_fines() then
    raise exception 'Only Metro Police officers, supervisors and captains issue fines.' using errcode = '42501';
  end if;
  if v_tenant is null then
    raise exception 'Your organisation is not active.' using errcode = '42501';
  end if;
  if p_client_ref is null then
    raise exception 'A client reference is required.' using errcode = 'P0001';
  end if;

  -- A phone retrying after a dead zone gets back what it already filed.
  if exists (select 1 from public.fines where tenant_id = v_tenant and group_ref = p_client_ref) then
    return query select * from public.fines
      where tenant_id = v_tenant and group_ref = p_client_ref order by charge_seq;
    return;
  end if;

  select p.full_name, coalesce(nullif(trim(p.badge_number), ''), nullif(trim(pe.badge_number), '')) as badge
    into v_me
    from public.profiles p
    left join public.personnel pe on pe.user_id = p.id
   where p.id = auth.uid()
   limit 1;

  -- ── The notice ──
  if v_type not in ('AARTO 01', 'Section 56', 'Section 341') then
    raise exception 'Unknown notice type %.', v_type using errcode = 'P0001';
  end if;
  if v_from not in ('device', 'paper') then
    raise exception 'Unknown capture source.' using errcode = 'P0001';
  end if;
  -- Served now, or captured later from a paper book — never in the future,
  -- and not so long after that the notice can no longer be served.
  if v_at > now() + interval '5 minutes' then v_at := now(); end if;
  if v_at < now() - interval '30 days' then
    raise exception 'This notice is more than 30 days old and can no longer be captured.' using errcode = 'P0001';
  end if;
  v_offence_at := least(coalesce(nullif(p_notice ->> 'offence_at', '')::timestamptz, v_at), v_at);

  if v_type in ('AARTO 01', 'Section 56') then
    if v_surname is null then
      raise exception 'The infringer''s surname is required.' using errcode = 'P0001';
    end if;
    if v_id is null or v_id_type is null then
      raise exception 'The infringer''s identification type and number are required.' using errcode = 'P0001';
    end if;
  end if;
  if v_id_type is not null and v_id_type not in ('RSA ID', 'Passport', 'Driving licence', 'Foreign ID') then
    raise exception 'Unknown identification type.' using errcode = 'P0001';
  end if;
  if v_id_type = 'RSA ID' and not public.is_valid_rsa_id(v_id) then
    raise exception 'That South African ID number is not valid. Check the 13 digits.' using errcode = 'P0001';
  end if;
  if v_type in ('AARTO 01', 'Section 341') and v_reg is null then
    raise exception 'The vehicle registration is required.' using errcode = 'P0001';
  end if;
  if v_street is null and v_place is null then
    raise exception 'Where it happened is required: a street or a description of the place.' using errcode = 'P0001';
  end if;
  if v_type = 'Section 56' then
    if v_court is null or v_court_date is null then
      raise exception 'A Section 56 notice needs the court and the date to appear.' using errcode = 'P0001';
    end if;
    if v_court_date <= (v_at at time zone 'Africa/Johannesburg')::date then
      raise exception 'The court date must be after the day the notice is served.' using errcode = 'P0001';
    end if;
  end if;
  if (v_officer_sig is not null and not public.is_signature_svg(v_officer_sig))
     or (v_infringer_sig is not null and not public.is_signature_svg(v_infringer_sig)) then
    raise exception 'A signature is not in the form the signature pad writes.' using errcode = 'P0001';
  end if;
  if v_from = 'device' then
    if v_officer_sig is null then
      raise exception 'The officer must sign the notice.' using errcode = 'P0001';
    end if;
    if v_type <> 'Section 341' and v_infringer_sig is null and not v_refused then
      raise exception 'The infringer must sign, or record that they refused to.' using errcode = 'P0001';
    end if;
  elsif v_notice_no is null then
    raise exception 'A notice captured from a paper book needs the printed notice number.' using errcode = 'P0001';
  end if;

  v_full := coalesce(nullif(trim(concat_ws(' ', v_first, v_surname)), ''),
                     case when v_type = 'Section 341' then 'Owner of ' || coalesce(v_reg, 'the vehicle') end);
  if v_full is null then
    raise exception 'The infringer''s name is required.' using errcode = 'P0001';
  end if;

  select coalesce(nullif(trim(t.settings ->> 'issuing_authority'), ''), t.name || ' Metro Police')
    into v_authority from public.tenants t where t.id = v_tenant;
  v_infra := coalesce(nullif(trim(p_notice ->> 'officer_infrastructure_no'), ''), v_me.badge);

  -- ── The charges: one to three, each its own fine ──
  if p_charges is null or jsonb_typeof(p_charges) <> 'array' then
    raise exception 'At least one charge is required.' using errcode = 'P0001';
  end if;
  v_count := jsonb_array_length(p_charges);
  if v_count < 1 or v_count > 3 then
    raise exception 'A notice carries one to three charges.' using errcode = 'P0001';
  end if;

  for v_charge, v_seq in select value, ordinality from jsonb_array_elements(p_charges) with ordinality loop
    v_off := null;
    if nullif(v_charge ->> 'offence_id', '') is not null then
      select * into v_off from public.fine_offences
       where id = (v_charge ->> 'offence_id')::uuid and tenant_id = v_tenant and active;
      if v_off.id is null then
        raise exception 'Charge %: that offence is not in the charge book.', v_seq using errcode = 'P0001';
      end if;
    end if;

    v_regime := coalesce(v_off.regime, case when v_type = 'AARTO 01' then 'AARTO' else 'By-law' end);
    if (v_type = 'AARTO 01') <> (v_regime = 'AARTO') then
      raise exception 'Charge %: % offences go on %.', v_seq, v_regime,
        case when v_regime = 'AARTO' then 'an AARTO 01 notice' else 'a Section 56 or 341 notice' end
        using errcode = 'P0001';
    end if;

    v_desc := coalesce(v_off.description, nullif(trim(v_charge ->> 'description'), ''));
    if v_desc is null then
      raise exception 'Charge %: describe the offence.', v_seq using errcode = 'P0001';
    end if;

    -- The charge book's amount when it has one; otherwise the officer's,
    -- marked as such for the supervisor's eye.
    if v_off.penalty_amount is not null then
      v_amount := v_off.penalty_amount;
      v_source := 'catalogue';
    else
      v_amount := nullif(v_charge ->> 'amount', '')::numeric(12,2);
      v_source := 'officer';
      if v_amount is null or v_amount <= 0 then
        raise exception 'Charge %: enter the penalty amount.', v_seq using errcode = 'P0001';
      end if;
      if v_amount > 100000 then
        raise exception 'Charge %: R% is not a penalty a notice can carry.', v_seq, v_amount using errcode = 'P0001';
      end if;
    end if;

    v_due := case v_type
      when 'AARTO 01' then (v_at at time zone 'Africa/Johannesburg')::date + 32
      when 'Section 56' then v_court_date
      else (v_at at time zone 'Africa/Johannesburg')::date + 30
    end;

    v_number := public.next_doc_number('FN');
    v_numbers := v_numbers || v_number;

    insert into public.fines (
      tenant_id, silo, fine_number, notice_type, notice_number, group_ref, charge_seq, captured_from,
      offender_name, offender_surname, offender_first_names, offender_initials,
      offender_id_type, offender_id_number, offender_id_country, offender_dob, offender_gender,
      offender_licence_code, offender_prdp_code, offender_phone, offender_email, offender_address,
      vehicle_reg, vehicle_licence_disc, vehicle_type, vehicle_make, vehicle_model, vehicle_colour,
      province, city, suburb, street_a, street_b, direction, latitude, longitude, location, offence_at,
      offence_id, offence_code, offence_description, legal_ref, amount, amount_source,
      discount_amount, demerit_points, court_name, court_date, due_date,
      issuing_authority, magisterial_district, officer_infrastructure_no,
      officer_signature, infringer_signature, infringer_refused, observations,
      incident_id, issued_by, issued_by_name, issued_at, notes, status
    ) values (
      v_tenant, 'MetroPolice', v_number, v_type,
      -- A pre-printed book number covers the whole notice; AARTO numbers
      -- each charge, so only the first charge carries a single number given.
      case when v_seq = 1 then v_notice_no else nullif(upper(trim(v_charge ->> 'notice_number')), '') end,
      p_client_ref, v_seq, v_from,
      v_full, v_surname, v_first, nullif(upper(trim(p_notice ->> 'offender_initials')), ''),
      v_id_type, v_id, nullif(trim(p_notice ->> 'offender_id_country'), ''),
      nullif(p_notice ->> 'offender_dob', '')::date, nullif(p_notice ->> 'offender_gender', ''),
      nullif(upper(trim(p_notice ->> 'offender_licence_code')), ''), nullif(upper(trim(p_notice ->> 'offender_prdp_code')), ''),
      nullif(trim(p_notice ->> 'offender_phone'), ''), nullif(lower(trim(p_notice ->> 'offender_email')), ''),
      nullif(trim(p_notice ->> 'offender_address'), ''),
      v_reg, nullif(upper(trim(p_notice ->> 'vehicle_licence_disc')), ''), nullif(trim(p_notice ->> 'vehicle_type'), ''),
      nullif(trim(p_notice ->> 'vehicle_make'), ''), nullif(trim(p_notice ->> 'vehicle_model'), ''),
      nullif(trim(p_notice ->> 'vehicle_colour'), ''),
      coalesce(nullif(trim(p_notice ->> 'province'), ''), 'KwaZulu-Natal'),
      coalesce(nullif(trim(p_notice ->> 'city'), ''), 'Durban'),
      nullif(trim(p_notice ->> 'suburb'), ''), v_street, nullif(trim(p_notice ->> 'street_b'), ''),
      nullif(trim(p_notice ->> 'direction'), ''),
      nullif(p_notice ->> 'latitude', '')::double precision, nullif(p_notice ->> 'longitude', '')::double precision,
      coalesce(v_place, concat_ws(', ', v_street, nullif(trim(p_notice ->> 'street_b'), ''), nullif(trim(p_notice ->> 'suburb'), ''))),
      v_offence_at,
      v_off.id, coalesce(v_off.code, nullif(upper(trim(v_charge ->> 'code')), '')), v_desc,
      coalesce(v_off.legal_ref, nullif(trim(v_charge ->> 'legal_ref'), '')),
      v_amount, v_source,
      case when v_type = 'AARTO 01' then round(v_amount * 0.5, 2) else 0 end,
      coalesce(v_off.demerit_points, 0),
      v_court, v_court_date, v_due,
      v_authority, nullif(trim(p_notice ->> 'magisterial_district'), ''), v_infra,
      v_officer_sig, v_infringer_sig, v_refused and v_infringer_sig is null,
      coalesce(case when jsonb_typeof(p_notice -> 'observations') = 'object' then p_notice -> 'observations' end, '{}'::jsonb),
      nullif(p_notice ->> 'incident_id', '')::uuid,
      auth.uid(), v_me.full_name, v_at, nullif(trim(p_notice ->> 'notes'), ''), 'Unpaid'
    );
  end loop;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_tenant, 'MetroPolice', auth.uid(), v_me.full_name, 'FineIssued', 'fine', p_client_ref::text,
          v_type || ' ' || array_to_string(v_numbers, ', ') || ' · ' || coalesce(v_reg, v_full));

  return query select * from public.fines
    where tenant_id = v_tenant and group_ref = p_client_ref order by charge_seq;
end $$;

revoke all on function public.issue_fines(jsonb, jsonb, uuid, timestamptz) from public, anon;
grant execute on function public.issue_fines(jsonb, jsonb, uuid, timestamptz) to authenticated;

-- ── 7. Cancelling, representations, the official number ─────────────────────

create or replace function public.cancel_fine(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_fine public.fines;
  v_name text := (select full_name from public.profiles where id = auth.uid());
  v_paid numeric;
begin
  select * into v_fine from public.fines where id = p_id and tenant_id = public.current_tenant() for update;
  if v_fine.id is null then
    raise exception 'Fine not found.' using errcode = 'P0001';
  end if;
  if not public.can_manage_fines(v_fine.silo) then
    raise exception 'Only command staff may cancel a fine.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give the reason for cancelling (at least 10 characters). It stays on the record.'
      using errcode = 'P0001';
  end if;
  if v_fine.status = 'Cancelled' then
    raise exception '% is already cancelled.', v_fine.fine_number using errcode = 'P0001';
  end if;
  select coalesce(sum(amount), 0) into v_paid from public.charge_transactions
   where fine_id = p_id and tx_type in ('Payment', 'Adjustment');
  if v_paid > 0 then
    raise exception 'Money has been paid against %. Record the refund before cancelling.', v_fine.fine_number
      using errcode = 'P0001';
  end if;

  update public.fines
     set status = 'Cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancelled_by_name = v_name, cancel_reason = trim(p_reason)
   where id = p_id;

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_fine.tenant_id, v_fine.silo, auth.uid(), v_name, 'FineCancelled', 'fine', p_id::text,
          v_fine.fine_number || ' · ' || trim(p_reason));
end $$;

-- Representation lodged (Disputed) or decided against the infringer (back to
-- Unpaid). Paid and Partially Paid come from the ledger, Cancelled from
-- cancel_fine().
create or replace function public.set_fine_status(p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_fine public.fines;
  v_name text := (select full_name from public.profiles where id = auth.uid());
begin
  select * into v_fine from public.fines where id = p_id and tenant_id = public.current_tenant() for update;
  if v_fine.id is null then
    raise exception 'Fine not found.' using errcode = 'P0001';
  end if;
  if not public.can_manage_fines(v_fine.silo) then
    raise exception 'Only command staff may change a fine''s status.' using errcode = '42501';
  end if;
  if p_status not in ('Disputed', 'Unpaid') then
    raise exception 'Set Disputed or Unpaid here. Payments set Paid; cancelling has its own step.'
      using errcode = 'P0001';
  end if;
  if v_fine.status in ('Cancelled', 'Paid') then
    raise exception '% is % and its status cannot change.', v_fine.fine_number, lower(v_fine.status)
      using errcode = 'P0001';
  end if;
  update public.fines set status = p_status where id = p_id;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_fine.tenant_id, v_fine.silo, auth.uid(), v_name, 'FineStatusChanged', 'fine', p_id::text,
          v_fine.fine_number || ' → ' || p_status || coalesce(' · ' || nullif(trim(p_note), ''), ''));
end $$;

-- The official number arrives after the fact (a handheld or the RTIA): it may
-- be written once, by the issuing officer or command staff.
create or replace function public.set_fine_notice_number(p_id uuid, p_number text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_fine public.fines;
  v_number text := nullif(upper(trim(coalesce(p_number, ''))), '');
begin
  select * into v_fine from public.fines where id = p_id and tenant_id = public.current_tenant() for update;
  if v_fine.id is null then
    raise exception 'Fine not found.' using errcode = 'P0001';
  end if;
  if v_fine.issued_by is distinct from auth.uid() and not public.can_manage_fines(v_fine.silo) then
    raise exception 'Only the issuing officer or command staff may add the notice number.' using errcode = '42501';
  end if;
  if v_number is null or length(v_number) > 30 then
    raise exception 'Enter the notice number as printed (up to 30 characters).' using errcode = 'P0001';
  end if;
  update public.fines set notice_number = v_number where id = p_id;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_fine.tenant_id, v_fine.silo, auth.uid(), (select full_name from public.profiles where id = auth.uid()),
          'FineNoticeNumberSet', 'fine', p_id::text, v_fine.fine_number || ' · ' || v_number);
end $$;

revoke all on function public.cancel_fine(uuid, text) from public, anon;
revoke all on function public.set_fine_status(uuid, text, text) from public, anon;
revoke all on function public.set_fine_notice_number(uuid, text) from public, anon;
grant execute on function public.cancel_fine(uuid, text) to authenticated;
grant execute on function public.set_fine_status(uuid, text, text) to authenticated;
grant execute on function public.set_fine_notice_number(uuid, text) to authenticated;

-- ── 8. The ledger sets Paid ─────────────────────────────────────────────────

create or replace function public.fine_ledger_status() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_fine public.fines;
  v_paid numeric;
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
                           when tx_type = 'Refund' then -amount else 0 end), 0)
    into v_paid from public.charge_transactions where fine_id = new.fine_id;

  v_next := case
    when v_paid >= public.fine_amount_due(v_fine) then 'Paid'
    when v_paid > 0 then 'Partially Paid'
    when v_fine.status = 'Disputed' then 'Disputed'
    else 'Unpaid'
  end;
  if v_next is distinct from v_fine.status then
    update public.fines set status = v_next where id = new.fine_id;
  end if;
  return new;
end $$;

drop trigger if exists fine_ledger_status on public.charge_transactions;
create trigger fine_ledger_status after insert on public.charge_transactions
  for each row execute function public.fine_ledger_status();

commit;
