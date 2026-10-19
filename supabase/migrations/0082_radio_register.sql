-- ============================================================================
-- 0082 — The radio register: whose radio, whose hard hat
-- ============================================================================
--
-- Run after 0081.
--
-- The police and field teams talk on push-to-talk radios (the Estalky E977)
-- and smart hard hats, on two platforms: PocStar (the Constellations console)
-- and RealPTT. Each platform knows a radio by its own account ("FIRE ALPHA",
-- "Nets1"); HikTech knows people and vehicles. This register joins the two,
-- so the live map, the SOS alarm and the incident's radio card can say
-- "Const. Khumalo's radio" instead of an account name.
--
--   radio_devices        one row per radio, hard hat or dispatcher seat:
--                        its platform and account, the person or vehicle it
--                        belongs to, and the department.
--   save_radio_device()  the only way to add or change one: the system
--                        administrators and the system controller for any
--                        department, a department's administrator for their
--                        own. Every change is audited.
--
-- Nothing is deleted: a radio that leaves service is set inactive, so its
-- history still reads. Safe to re-run.
-- ============================================================================

create table if not exists public.radio_devices (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default public.current_tenant(),
  provider         text not null check (provider in ('pocstar', 'realptt')),
  kind             text not null default 'radio' check (kind in ('radio', 'hard_hat', 'dispatcher')),
  -- The platform's own login for the device, as its console shows it.
  account          text not null check (length(btrim(account)) between 1 and 80),
  -- The name the platform shows ("FIRE ALPHA").
  label            text check (label is null or length(label) <= 80),
  -- The platform's numeric id, when known (RealPTT user_id, PocStar uid).
  provider_user_id text check (provider_user_id is null or length(provider_user_id) <= 40),
  imei             text check (imei is null or imei ~ '^[0-9]{14,17}$'),
  silo             public.silo not null,
  personnel_id     uuid references public.personnel(id) on delete set null,
  apparatus_id     uuid references public.apparatus(id) on delete set null,
  notes            text check (notes is null or length(notes) <= 500),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  unique (tenant_id, provider, account)
);
create index if not exists radio_devices_silo_idx on public.radio_devices (tenant_id, silo) where active;
create index if not exists radio_devices_personnel_idx on public.radio_devices (personnel_id) where personnel_id is not null;

alter table public.radio_devices enable row level security;
revoke all on public.radio_devices from anon;
revoke insert, update, delete on public.radio_devices from authenticated;
grant select on public.radio_devices to authenticated;

-- Read: your own department's radios; the roles that see every department see every radio.
drop policy if exists radio_devices_read on public.radio_devices;
create policy radio_devices_read on public.radio_devices for select to authenticated
  using (tenant_id = public.current_tenant() and (silo = public.current_silo() or public.is_global()));

/** Adds or changes a radio, hard hat or dispatcher seat. p_id null adds one. */
create or replace function public.save_radio_device(
  p_id               uuid,
  p_provider         text,
  p_kind             text,
  p_account          text,
  p_label            text,
  p_provider_user_id text,
  p_imei             text,
  p_silo             public.silo,
  p_personnel_id     uuid,
  p_apparatus_id     uuid,
  p_notes            text,
  p_active           boolean default true
)
returns public.radio_devices language plpgsql security definer set search_path to 'public' as $$
declare
  v_row     public.radio_devices;
  v_old     public.radio_devices;
  v_tenant  uuid := public.current_tenant();
  v_account text := nullif(btrim(p_account), '');
  v_imei    text := nullif(regexp_replace(coalesce(p_imei, ''), '\s', '', 'g'), '');
  v_name    text;
begin
  perform public.require_role('SuperAdmin', 'SystemAdmin', 'SystemController', 'Admin');
  if v_tenant is null then raise exception 'No organisation for this account' using errcode = '42501'; end if;

  if p_provider is null or p_provider not in ('pocstar', 'realptt') then
    raise exception 'Choose the platform: PocStar or RealPTT' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('radio', 'hard_hat', 'dispatcher') then
    raise exception 'Choose what it is: a radio, a hard hat or a dispatcher seat' using errcode = '22023';
  end if;
  if v_account is null then raise exception 'Enter the account the platform shows' using errcode = '22023'; end if;
  if length(v_account) > 80 then raise exception 'The account is too long' using errcode = '22023'; end if;
  if v_imei is not null and v_imei !~ '^[0-9]{14,17}$' then
    raise exception 'The IMEI is 15 digits' using errcode = '22023';
  end if;
  if p_silo is null then raise exception 'Choose the department' using errcode = '22023'; end if;

  -- A department's administrator looks after their own department's radios only.
  if public.role_in('Admin') and p_silo <> public.current_silo() then
    raise exception 'You can only add radios for your own department' using errcode = '42501';
  end if;

  if p_personnel_id is not null and not exists (
    select 1 from public.personnel where id = p_personnel_id and tenant_id = v_tenant) then
    raise exception 'That person is not on the staff register' using errcode = '22023';
  end if;
  if p_apparatus_id is not null and not exists (
    select 1 from public.apparatus where id = p_apparatus_id and tenant_id = v_tenant) then
    raise exception 'That vehicle is not in the fleet' using errcode = '22023';
  end if;

  if p_id is not null then
    select * into v_old from public.radio_devices where id = p_id and tenant_id = v_tenant for update;
    if not found then raise exception 'Radio not found' using errcode = 'P0002'; end if;
    if public.role_in('Admin') and v_old.silo <> public.current_silo() then
      raise exception 'You can only change your own department''s radios' using errcode = '42501';
    end if;
  end if;

  if exists (select 1 from public.radio_devices
              where tenant_id = v_tenant and provider = p_provider and account = v_account
                and id is distinct from p_id) then
    raise exception 'That account is already in the register' using errcode = '23505';
  end if;

  if p_id is null then
    insert into public.radio_devices (tenant_id, provider, kind, account, label, provider_user_id, imei, silo,
                                      personnel_id, apparatus_id, notes, active, created_by, updated_by)
    values (v_tenant, p_provider, p_kind, v_account, nullif(btrim(p_label), ''), nullif(btrim(p_provider_user_id), ''),
            v_imei, p_silo, p_personnel_id, p_apparatus_id, nullif(btrim(p_notes), ''), coalesce(p_active, true),
            auth.uid(), auth.uid())
    returning * into v_row;
  else
    update public.radio_devices set
      provider = p_provider, kind = p_kind, account = v_account, label = nullif(btrim(p_label), ''),
      provider_user_id = nullif(btrim(p_provider_user_id), ''), imei = v_imei, silo = p_silo,
      personnel_id = p_personnel_id, apparatus_id = p_apparatus_id, notes = nullif(btrim(p_notes), ''),
      active = coalesce(p_active, true), updated_at = now(), updated_by = auth.uid()
    where id = p_id
    returning * into v_row;
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_tenant, v_row.silo, auth.uid(), v_name,
          case when p_id is null then 'RadioAdded' when not v_row.active then 'RadioRetired' else 'RadioChanged' end,
          'radio_device', v_row.id::text,
          format('%s %s "%s"%s', v_row.provider, v_row.kind, v_row.account,
                 case when v_old.id is not null and v_old.personnel_id is distinct from v_row.personnel_id
                      then ' · person changed' else '' end));
  return v_row;
end $$;
revoke all on function public.save_radio_device(uuid, text, text, text, text, text, text, public.silo, uuid, uuid, text, boolean) from public, anon;
grant execute on function public.save_radio_device(uuid, text, text, text, text, text, text, public.silo, uuid, uuid, text, boolean) to authenticated;

notify pgrst, 'reload schema';
