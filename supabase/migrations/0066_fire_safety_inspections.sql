-- ============================================================================
-- 0066 — Fire & Rescue: fire safety inspections
-- ============================================================================
--
-- Run after 0065.
--
-- V4's Firefighters/CreateInspection: a firefighter inspects a business or
-- site — name, contact person, address, extinguishers present and serviced,
-- emergency exits clear, notes — and records PASS or FAIL. V4 filed it as a
-- closed incident plus a fire report; here it is its own register:
--
--   1. fire_safety_inspections, numbered INSP-YYYYMMDD-nnnn per tenant and day,
--      stamped on the server with the inspector and the time.
--   2. Fire & Rescue files them (Firefighter, FireChief and the admin tier, in
--      MetroFire). A FAIL, or any violation, needs notes on what was found.
--      A FAIL tells fire command.
--   3. Permanent: no edits, no deletes. Fire and the tenant-wide tier read them.
--
-- Safe to re-run.
-- ============================================================================

begin;

create table if not exists public.fire_safety_inspections (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default public.current_tenant(),
  silo            silo not null default 'MetroFire',
  inspection_ref  text,
  business_name   text not null,
  address         text not null,
  contact_person  text not null,
  extinguishers   text not null check (extinguishers in ('Yes', 'No', 'N/A')),
  exits           text not null check (exits in ('Yes', 'No')),
  notes           text,
  result          text not null check (result in ('PASS', 'FAIL')),
  inspector_id    uuid not null default auth.uid() references auth.users(id),
  inspector_name  text,
  inspected_at    timestamptz not null default now()
);
create unique index if not exists fire_safety_inspections_ref on public.fire_safety_inspections (tenant_id, inspection_ref);
create index if not exists fire_safety_inspections_when on public.fire_safety_inspections (tenant_id, inspected_at desc);
alter table public.fire_safety_inspections enable row level security;

drop policy if exists tenant_isolation on public.fire_safety_inspections;
create policy tenant_isolation on public.fire_safety_inspections as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());

drop policy if exists fire_inspections_read on public.fire_safety_inspections;
create policy fire_inspections_read on public.fire_safety_inspections for select to authenticated
  using (silo = public.current_silo() or public.is_global() or public.role_in('CaseManager', 'SystemController'));

drop policy if exists fire_inspections_insert on public.fire_safety_inspections;
create policy fire_inspections_insert on public.fire_safety_inspections for insert to authenticated
  with check (
    silo = 'MetroFire' and public.current_silo() = 'MetroFire'
    and public.role_in('Firefighter', 'FireChief', 'Admin', 'SystemAdmin', 'SuperAdmin')
    and inspector_id = auth.uid()
  );

-- What an inspection must say, and the server's stamp on it.
create or replace function public.stamp_fire_inspection() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_name text;
  v_day  text := to_char(now() at time zone 'Africa/Johannesburg', 'YYYYMMDD');
  v_seq  int;
begin
  new.business_name := nullif(trim(coalesce(new.business_name, '')), '');
  new.address := nullif(trim(coalesce(new.address, '')), '');
  new.contact_person := nullif(trim(coalesce(new.contact_person, '')), '');
  new.notes := nullif(trim(coalesce(new.notes, '')), '');
  if new.business_name is null then raise exception 'Business / Site Name is required.' using errcode = 'P0001'; end if;
  if new.contact_person is null then raise exception 'Contact Person is required.' using errcode = 'P0001'; end if;
  if new.address is null then raise exception 'Site Address is required.' using errcode = 'P0001'; end if;
  if (new.result = 'FAIL' or new.extinguishers = 'No' or new.exits = 'No') and new.notes is null then
    raise exception 'Detail the violations or hazards in the notes.' using errcode = 'P0001';
  end if;
  if length(new.business_name) > 200 or length(new.address) > 300 or length(new.contact_person) > 120
     or length(coalesce(new.notes, '')) > 4000 then
    raise exception 'An answer is too long.' using errcode = 'P0001';
  end if;

  select coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), pr.full_name) into v_name
    from public.profiles pr left join public.personnel p on p.user_id = pr.id and p.tenant_id = new.tenant_id
   where pr.id = auth.uid();
  perform pg_advisory_xact_lock(hashtext('fire_inspection:' || new.tenant_id::text || v_day));
  select count(*) + 1 into v_seq from public.fire_safety_inspections
   where tenant_id = new.tenant_id and inspection_ref like 'INSP-' || v_day || '-%';

  new.id := coalesce(new.id, gen_random_uuid());
  new.silo := 'MetroFire';
  new.inspector_id := auth.uid();
  new.inspector_name := coalesce(v_name, 'Fire Inspector');
  new.inspected_at := now();
  new.inspection_ref := 'INSP-' || v_day || '-' || lpad(v_seq::text, 4, '0');
  return new;
end $$;

drop trigger if exists stamp_fire_inspection on public.fire_safety_inspections;
create trigger stamp_fire_inspection before insert on public.fire_safety_inspections
  for each row execute function public.stamp_fire_inspection();

create or replace function public.after_fire_inspection() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (new.tenant_id, 'MetroFire', new.inspector_id, new.inspector_name, 'MetroFire', 'FireInspectionFiled',
    'fire_safety_inspections', new.id::text, format('%s: %s at %s — %s', new.inspection_ref, new.business_name, new.address, new.result));
  if new.result = 'FAIL' then
    perform public.notify_command(new.tenant_id, 'MetroFire', 'Fire safety inspection failed: ' || new.business_name,
      format('%s · %s. %s', new.inspection_ref, new.address, coalesce(new.notes, '')), 'Medium', '/fire/inspections');
  end if;
  return null;
end $$;

drop trigger if exists after_fire_inspection on public.fire_safety_inspections;
create trigger after_fire_inspection after insert on public.fire_safety_inspections
  for each row execute function public.after_fire_inspection();

-- A filed inspection is a permanent record.
create or replace function public.guard_fire_inspection() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  raise exception 'A filed fire safety inspection cannot be changed or deleted.' using errcode = 'P0001';
end $$;

drop trigger if exists guard_fire_inspection on public.fire_safety_inspections;
create trigger guard_fire_inspection before update or delete on public.fire_safety_inspections
  for each row execute function public.guard_fire_inspection();

grant select, insert on public.fire_safety_inspections to authenticated;

commit;

notify pgrst, 'reload schema';
