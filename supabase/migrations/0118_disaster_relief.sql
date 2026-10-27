-- ============================================================================
-- 0118 — Disaster: needs assessment and relief through the ward councillors
-- ============================================================================
--
-- Run after 0117.
--
-- Revision 2, section 7: in a major incident the Disaster Management Centre
-- assesses the damage and the needs, and relief follows the findings,
-- coordinated through the ward councillors.
--
--   1. The relief checklist, eight steps, ticked on the incident like the
--      JOC's (set_incident_check(), its list grown here).
--   2. Beneficiaries and relief by ward (disaster_ward_relief): the ward and
--      its councillor; households and people helped; people with
--      disabilities, older persons and children under five; blankets,
--      mattresses, food hampers and start-house kits issued. Counts only:
--      no names (the user's decision, 2026-10-27). save_ward_relief().
--   3. Relief stock (relief_stocks, 0001): the four relief materials the
--      Directorate budgets for, each with what is in storage and its
--      minimum (set_relief_stock()). The table could be written from the
--      browser by its 0002 policy (relief_stocks_rw); that policy goes:
--      reads stay, writes only through set_relief_stock().
--
-- Writes only through the functions here (SECURITY DEFINER, checked,
-- audited); nothing for anonymous users. Safe to re-run.
-- ============================================================================

begin;

do $$
begin
  if to_regprocedure('public.escalate_incident(uuid, text, jsonb)') is null then
    raise exception 'Run 0117_disaster_joc_activation.sql first, then this one. Nothing was changed.';
  end if;
end $$;

-- ── 1. The relief checklist ─────────────────────────────────────────────────

create or replace function public.disaster_incident_checks() returns text[]
language sql immutable as $$
  select array['silver_emacc', 'silver_duty', 'silver_resources', 'silver_heads', 'silver_sitreps',
               'joc_core_team', 'joc_dcm', 'joc_bulk_sms', 'joc_pdmc',
               'duty_meet', 'duty_resources', 'duty_public', 'duty_pdmc', 'duty_declare', 'duty_report',
               'relief_initial', 'relief_needs', 'relief_halls', 'relief_task_team', 'relief_soup', 'relief_lists',
               'relief_councillors', 'relief_vulnerable']
$$;

create or replace function public.disaster_check_name(p text) returns text
language sql immutable as $$
  select case p
    when 'silver_emacc' then 'EMACC notified'
    when 'silver_duty' then 'Duty Officer and Principal Stand-by Officer informed'
    when 'silver_resources' then 'Resources assessed'
    when 'silver_heads' then 'Heads of departments on standby'
    when 'silver_sitreps' then 'Sitreps flowing'
    when 'joc_core_team' then 'Core team called in'
    when 'joc_dcm' then 'Deputy City Manager on stand-by informed'
    when 'joc_bulk_sms' then 'Bulk SMS sent with the reason'
    when 'joc_pdmc' then 'Provincial Disaster Management Centre told'
    when 'duty_meet' then 'Meeting daily on the damage and each department''s progress'
    when 'duty_resources' then 'Extra services, resources and mutual aid decided'
    when 'duty_public' then 'Public protective actions decided; warnings and advisories issued'
    when 'duty_pdmc' then 'Provincial Disaster Management Centre updated'
    when 'duty_declare' then 'Need for a local disaster declaration assessed'
    when 'duty_report' then 'Reported to the Portfolio Committee, EXCO and the PDMC'
    when 'relief_initial' then 'Initial assessment done by the Disaster Management Centre'
    when 'relief_needs' then 'Needs assessment done to set relief'
    when 'relief_halls' then 'Community halls opened for evacuation or temporary shelter'
    when 'relief_task_team' then 'Social Relief Technical Task Team alerted'
    when 'relief_soup' then 'City soup kitchen activated (evacuation)'
    when 'relief_lists' then 'Beneficiary lists produced and escalated to stakeholders'
    when 'relief_councillors' then 'Relief coordinated through ward councillors'
    when 'relief_vulnerable' then 'Needs of people with disabilities, older persons and young children addressed'
  end
$$;

-- ── 2. Beneficiaries and relief by ward ─────────────────────────────────────

create table if not exists public.disaster_ward_relief (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default public.current_tenant(),
  silo             public.silo not null default 'EthekwiniDisaster' check (silo = 'EthekwiniDisaster'),
  incident_id      uuid not null references public.incidents (id) on delete cascade,
  municipality     text not null default 'eThekwini Metro' check (municipality = any (public.disaster_municipalities())),
  ward             int not null check (ward between 1 and 120),
  councillor       text check (councillor is null or length(councillor) <= 160),
  councillor_phone text check (councillor_phone is null or (length(councillor_phone) <= 30 and public.desk_phone_ok(councillor_phone))),
  households       int not null default 0 check (households between 0 and 500000),
  people           int not null default 0 check (people between 0 and 500000),
  disabled         int not null default 0 check (disabled between 0 and 500000),
  older            int not null default 0 check (older between 0 and 500000),
  under_five       int not null default 0 check (under_five between 0 and 500000),
  blankets         int not null default 0 check (blankets between 0 and 500000),
  mattresses       int not null default 0 check (mattresses between 0 and 500000),
  food_hampers     int not null default 0 check (food_hampers between 0 and 500000),
  start_house_kits int not null default 0 check (start_house_kits between 0 and 500000),
  notes            text check (notes is null or length(notes) <= 1000),
  recorded_at      timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by_name  text,
  unique (incident_id, municipality, ward)
);
comment on table public.disaster_ward_relief is
  'Beneficiaries and relief by ward for a Disaster incident (0118): counts only, no names. save_ward_relief() only.';

alter table public.disaster_ward_relief enable row level security;
drop policy if exists tenant_isolation on public.disaster_ward_relief;
create policy tenant_isolation on public.disaster_ward_relief as restrictive for all to authenticated
  using (tenant_id = public.current_tenant()) with check (tenant_id = public.current_tenant());
drop policy if exists disaster_ward_relief_read on public.disaster_ward_relief;
create policy disaster_ward_relief_read on public.disaster_ward_relief for select to authenticated
  using (silo = public.current_silo() or public.is_global() or public.works_disaster_desk() or public.can_work_incident(incident_id));
revoke all on public.disaster_ward_relief from anon;
revoke insert, update, delete on public.disaster_ward_relief from authenticated;
grant select on public.disaster_ward_relief to authenticated;

/**
 * A ward's beneficiaries and relief on an incident: added, or changed if the
 * ward is already there. Counts are totals so far. The vulnerable groups
 * cannot be more than the people helped.
 */
create or replace function public.save_ward_relief(p_incident_id uuid, p_fields jsonb)
returns public.disaster_ward_relief
language plpgsql security definer set search_path to 'public' as $$
declare
  f      jsonb := coalesce(p_fields, '{}'::jsonb);
  r      public.disaster_ward_relief;
  v_inc  public.incidents;
  v_muni text := coalesce(public.desk_text(f ->> 'municipality', 40), 'eThekwini Metro');
  v_ward int;
  v_c    jsonb := '{}'::jsonb;
  k      text;
  v_name text;
begin
  v_inc := public.disaster_record_incident(p_incident_id);
  if not v_muni = any (public.disaster_municipalities()) then raise exception 'Choose the municipality from the list.' using errcode = 'P0001'; end if;
  v_ward := public.desk_ward(f ->> 'ward', v_muni)::int;
  if v_ward is null then raise exception 'Give the ward number, like 76.' using errcode = 'P0001'; end if;
  foreach k in array array['households', 'people', 'disabled', 'older', 'under_five', 'blankets', 'mattresses', 'food_hampers', 'start_house_kits'] loop
    v_c := v_c || jsonb_build_object(k, public.desk_whole(f ->> k, 'Counts'));
    if (v_c ->> k)::int > 500000 then raise exception 'Check the number: % is too many.', k using errcode = 'P0001'; end if;
  end loop;
  if (v_c ->> 'disabled')::int + (v_c ->> 'older')::int + (v_c ->> 'under_five')::int > 0 and (v_c ->> 'people')::int = 0 then
    raise exception 'Give the number of people helped too.' using errcode = 'P0001';
  end if;
  if greatest((v_c ->> 'disabled')::int, (v_c ->> 'older')::int, (v_c ->> 'under_five')::int) > (v_c ->> 'people')::int then
    raise exception 'People with disabilities, older persons or under-fives cannot be more than the people helped.' using errcode = 'P0001';
  end if;
  if (v_c ->> 'households')::int > (v_c ->> 'people')::int and (v_c ->> 'people')::int > 0 then
    raise exception 'Households cannot be more than the people helped.' using errcode = 'P0001';
  end if;
  perform public.desk_check_name(f ->> 'councillor');
  perform public.desk_check_phone(f ->> 'councillor_phone');
  v_name := public.desk_name();

  insert into public.disaster_ward_relief (tenant_id, incident_id, municipality, ward, councillor, councillor_phone, households, people, disabled,
                                           older, under_five, blankets, mattresses, food_hampers, start_house_kits, notes, updated_by_name)
  values (v_inc.tenant_id, v_inc.id, v_muni, v_ward, public.desk_text(f ->> 'councillor', 160), public.desk_text(f ->> 'councillor_phone', 30),
          (v_c ->> 'households')::int, (v_c ->> 'people')::int, (v_c ->> 'disabled')::int, (v_c ->> 'older')::int, (v_c ->> 'under_five')::int,
          (v_c ->> 'blankets')::int, (v_c ->> 'mattresses')::int, (v_c ->> 'food_hampers')::int, (v_c ->> 'start_house_kits')::int,
          public.desk_text(f ->> 'notes', 1000), v_name)
  on conflict (incident_id, municipality, ward) do update
    set councillor = excluded.councillor, councillor_phone = excluded.councillor_phone, households = excluded.households,
        people = excluded.people, disabled = excluded.disabled, older = excluded.older, under_five = excluded.under_five,
        blankets = excluded.blankets, mattresses = excluded.mattresses, food_hampers = excluded.food_hampers,
        start_house_kits = excluded.start_house_kits, notes = excluded.notes, updated_at = now(), updated_by_name = excluded.updated_by_name
  returning * into r;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id, format('[RELIEF] Ward %s: %s people in %s households helped; %s blankets, %s mattresses, %s food hampers, %s start-house kits — %s',
    r.ward, r.people, r.households, r.blankets, r.mattresses, r.food_hampers, r.start_house_kits, v_name), auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'WARD_RELIEF', 'incidents', v_inc.id::text,
          format('%s · ward %s · %s people', v_inc.incident_number, r.ward, r.people));
  return r;
end $$;
revoke all on function public.save_ward_relief(uuid, jsonb) from public, anon;
grant execute on function public.save_ward_relief(uuid, jsonb) to authenticated;

/** A ward entered by mistake. */
create or replace function public.remove_ward_relief(p_id uuid)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  r      public.disaster_ward_relief;
  v_inc  public.incidents;
  v_name text;
begin
  select * into r from public.disaster_ward_relief where id = p_id and tenant_id = public.current_tenant();
  if not found then return; end if;
  v_inc := public.disaster_record_incident(r.incident_id);
  v_name := public.desk_name();
  delete from public.disaster_ward_relief where id = r.id;
  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_inc.silo, v_inc.id, format('[RELIEF] Ward %s taken off the relief list — %s', r.ward, v_name), auth.uid(), v_name);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_inc.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'WARD_RELIEF_REMOVED', 'incidents', v_inc.id::text,
          format('%s · ward %s (%s people)', v_inc.incident_number, r.ward, r.people));
end $$;
revoke all on function public.remove_ward_relief(uuid) from public, anon;
grant execute on function public.remove_ward_relief(uuid) to authenticated;

-- ── 3. Relief stock ─────────────────────────────────────────────────────────

/** The relief materials the Directorate budgets for each year. */
create or replace function public.relief_stock_items() returns text[]
language sql immutable as $$ select array['blankets', 'mattresses', 'food_hampers', 'start_house_kits'] $$;

alter table public.relief_stocks
  add column if not exists item_key        text check (item_key is null or item_key = any (public.relief_stock_items())),
  add column if not exists minimum         int not null default 0 check (minimum between 0 and 1000000),
  add column if not exists updated_by_name text;
create unique index if not exists relief_stocks_item on public.relief_stocks (tenant_id, item_key) where item_key is not null;

-- Writes from the browser end here; reading stays as it was.
drop policy if exists relief_stocks_rw on public.relief_stocks;
drop policy if exists relief_stocks_read on public.relief_stocks;
create policy relief_stocks_read on public.relief_stocks for select to authenticated
  using ((silo = public.current_silo() and public.role_in('Disaster', 'Supervisor', 'SystemAdmin', 'SuperAdmin', 'Admin'))
         or public.is_global() or public.works_disaster_desk());
revoke all on public.relief_stocks from anon;
revoke insert, update, delete on public.relief_stocks from authenticated;
grant select on public.relief_stocks to authenticated;

/** What is in storage after a delivery or a count, and the minimum to keep. */
create or replace function public.set_relief_stock(p_item text, p_in_storage int, p_minimum int)
returns public.relief_stocks
language plpgsql security definer set search_path to 'public' as $$
declare
  s      public.relief_stocks;
  v_name text;
  v_was  int;
  v_label text := case p_item when 'blankets' then 'Blankets' when 'mattresses' then 'Mattresses'
                              when 'food_hampers' then 'Food hampers' when 'start_house_kits' then 'Start-house kits' end;
begin
  if not public.works_disaster_desk() then raise exception 'Only the Disaster desk does this' using errcode = '42501'; end if;
  if p_item is null or not p_item = any (public.relief_stock_items()) then raise exception 'Choose the item from the list' using errcode = '22023'; end if;
  if p_in_storage is null or p_in_storage not between 0 and 1000000 then raise exception 'Give what is in storage as a whole number.' using errcode = 'P0001'; end if;
  if p_minimum is null or p_minimum not between 0 and 1000000 then raise exception 'Give the minimum as a whole number.' using errcode = 'P0001'; end if;
  v_name := public.desk_name();
  select quantity into v_was from public.relief_stocks where tenant_id = public.current_tenant() and item_key = p_item;
  insert into public.relief_stocks (tenant_id, silo, item_key, item_name, category, quantity, minimum, unit_of_measure, last_inventory_check, updated_by_name)
  values (public.current_tenant(), 'EthekwiniDisaster', p_item, v_label, 'Relief', p_in_storage, p_minimum, 'items', now(), v_name)
  on conflict (tenant_id, item_key) where item_key is not null do update
    set quantity = excluded.quantity, minimum = excluded.minimum, last_inventory_check = now(), updated_by_name = excluded.updated_by_name
  returning * into s;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (s.tenant_id, 'EthekwiniDisaster', auth.uid(), v_name, 'EthekwiniDisaster', 'RELIEF_STOCK', 'relief_stocks', s.id::text,
          format('%s: %s in storage (was %s), minimum %s', v_label, s.quantity, coalesce(v_was::text, 'none'), s.minimum));
  return s;
end $$;
revoke all on function public.set_relief_stock(text, int, int) from public, anon;
grant execute on function public.set_relief_stock(text, int, int) to authenticated;

-- ── Prove it ────────────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'relief_stocks' and policyname = 'relief_stocks_rw') then
    raise exception '0118: relief stock can still be written from the browser';
  end if;
  if has_table_privilege('authenticated', 'public.relief_stocks', 'update') or has_table_privilege('authenticated', 'public.disaster_ward_relief', 'insert') then
    raise exception '0118: signed-in users can write the tables directly';
  end if;
  if has_function_privilege('anon', 'public.save_ward_relief(uuid, jsonb)', 'execute') or has_function_privilege('anon', 'public.set_relief_stock(text, int, int)', 'execute') then
    raise exception '0118: anonymous users can write relief';
  end if;
  if not 'relief_vulnerable' = any (public.disaster_incident_checks()) then raise exception '0118: the relief checklist is missing'; end if;
end $$;

commit;
