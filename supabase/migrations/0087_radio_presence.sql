-- ============================================================================
-- 0087 — Radio presence: our own app as the radio's backup
-- ============================================================================
--
-- Run after 0086.
--
-- PocStar is the radios' main platform. Until its API arrives, and whenever
-- it is not answering, the HikTech app on the same radio (or phone) says how
-- the radio is: signed in or not, battery, network, which talk group it is
-- in and whether it is talking now, and where it is while on duty. The
-- Radio Desk shows PocStar first and falls back to this.
--
-- No audio is kept: this is the radio's state, not what was said.
--
--   radio_presence           one row per device running the app, keyed by the
--                            Radio ID the app shows (HT-XXXX-XXXX)
--   report_radio_presence()  the app's report, for the person signed in only.
--                            A position is kept only while they are on duty.
--                            A radio handed to someone else is audited.
--   radio_devices            may now name the HikTech app as the platform,
--                            with the Radio ID as the account
--
-- RealPTT is gone: its subscription lapsed in August 2026 and it is not
-- coming back. Its radios leave the register and its integration entry is
-- removed (the audit trail of what was done with them stays).
--
-- Who reads presence: the person, and the desks and command who oversee
-- crews, for their own department unless they see every department (as
-- duty_tracks, 0071). Nobody writes it except report_radio_presence().
--
-- Safe to re-run.
-- ============================================================================

-- ── 1. Presence ─────────────────────────────────────────────────────────────

create table if not exists public.radio_presence (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default public.current_tenant(),
  silo          public.silo not null,
  -- The Radio ID the app shows: HT- and eight letters or digits, no I, L, O or U.
  device_id     text not null check (device_id ~ '^HT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
  user_id       uuid not null,
  personnel_id  uuid references public.personnel(id) on delete set null,
  model         text check (model is null or length(model) <= 60),
  app_version   text check (app_version is null or length(app_version) <= 30),
  battery       smallint check (battery is null or battery between 0 and 100),
  charging      boolean,
  network       text check (network is null or network in ('wifi', 'cellular', 'none', 'other')),
  talk_channel  text check (talk_channel is null or length(talk_channel) <= 80),
  talking       boolean not null default false,
  -- Positions recorded on the radio with no signal, still waiting to be sent (0071).
  queued        integer check (queued is null or queued between 0 and 1000000),
  signed_in     boolean not null default true,
  lat           double precision check (lat is null or lat between -90 and 90),
  lng           double precision check (lng is null or lng between -180 and 180),
  accuracy      real,
  fix_at        timestamptz,
  last_seen_at  timestamptz not null default now(),
  unique (tenant_id, device_id)
);
alter table public.radio_presence add column if not exists queued integer check (queued is null or queued between 0 and 1000000);
create index if not exists radio_presence_silo_idx on public.radio_presence (tenant_id, silo, last_seen_at desc);
create index if not exists radio_presence_person_idx on public.radio_presence (tenant_id, user_id);

alter table public.radio_presence enable row level security;

drop policy if exists tenant_isolation on public.radio_presence;
create policy tenant_isolation on public.radio_presence as restrictive for all to authenticated
  using (tenant_id = public.current_tenant())
  with check (tenant_id = public.current_tenant());

drop policy if exists radio_presence_read on public.radio_presence;
create policy radio_presence_read on public.radio_presence for select to authenticated using (
  user_id = auth.uid()
  or (
    public.role_in('SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'Supervisor', 'Captain', 'FireChief',
                   'Dispatcher', 'ControlRoom', 'Operator', 'System')
    and (radio_presence.silo = public.current_silo() or public.is_global())
  )
);

revoke all on public.radio_presence from anon;
revoke insert, update, delete on public.radio_presence from authenticated;
grant select on public.radio_presence to authenticated;

-- ── 2. The app's report ─────────────────────────────────────────────────────
-- {"device": "HT-4F2K-9QXA", "model"?: text, "app"?: text, "battery"?: 0-100,
--  "charging"?: bool, "network"?: text, "channel"?: text, "talking"?: bool,
--  "queued"?: n, "signedIn"?: bool, "lat"?: n, "lng"?: n, "acc"?: n, "fixAt"?: ISO time}
-- Anything not right is left out rather than refused: a report is "now", and
-- the next one comes in half a minute.

create or replace function public.report_radio_presence(p jsonb)
returns public.radio_presence language plpgsql security definer set search_path to 'public' as $$
declare
  v_person  public.personnel;
  v_old     public.radio_presence;
  v_row     public.radio_presence;
  v_device  text := upper(btrim(coalesce(p ->> 'device', '')));
  v_num     numeric;
  v_battery smallint;
  v_queued  integer;
  v_lat     double precision;
  v_lng     double precision;
  v_acc     real;
  v_fix     timestamptz;
  v_network text := lower(btrim(coalesce(p ->> 'network', '')));
  v_name    text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into v_person from public.personnel
   where user_id = auth.uid() and tenant_id = public.current_tenant()
   limit 1;
  if not found then
    raise exception 'No personnel record is linked to this account' using errcode = 'P0001';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Send the report as an object' using errcode = '22023';
  end if;
  if v_device !~ '^HT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$' then
    raise exception 'That is not a Radio ID' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'battery') = 'number' then
    v_num := (p ->> 'battery')::numeric;
    if v_num between 0 and 100 then v_battery := round(v_num)::smallint; end if;
  end if;
  if jsonb_typeof(p -> 'queued') = 'number' then
    v_num := (p ->> 'queued')::numeric;
    if v_num between 0 and 1000000 then v_queued := round(v_num)::integer; end if;
  end if;
  if v_network not in ('wifi', 'cellular', 'none', 'other') then v_network := null; end if;

  -- Where the radio is: only while its person is on duty, and only a real fix.
  if v_person.is_on_duty
     and jsonb_typeof(p -> 'lat') = 'number' and jsonb_typeof(p -> 'lng') = 'number'
     and jsonb_typeof(p -> 'fixAt') = 'string'
     and (p ->> 'fixAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$' then
    v_lat := (p ->> 'lat')::double precision;
    v_lng := (p ->> 'lng')::double precision;
    v_fix := least((p ->> 'fixAt')::timestamptz, now());
    if v_lat not between -90 and 90 or v_lng not between -180 and 180 or (v_lat = 0 and v_lng = 0)
       or v_fix < now() - interval '72 hours' then
      v_lat := null; v_lng := null; v_fix := null;
    elsif jsonb_typeof(p -> 'acc') = 'number' then
      v_acc := least(greatest((p ->> 'acc')::double precision, 0), 1e6)::real;
    end if;
  end if;

  select * into v_old from public.radio_presence
   where tenant_id = v_person.tenant_id and device_id = v_device
   for update;

  if found then
    update public.radio_presence set
      silo         = v_person.silo,
      user_id      = auth.uid(),
      personnel_id = v_person.id,
      model        = coalesce(left(nullif(btrim(p ->> 'model'), ''), 60), v_old.model),
      app_version  = coalesce(left(nullif(btrim(p ->> 'app'), ''), 30), v_old.app_version),
      battery      = v_battery,
      charging     = case when jsonb_typeof(p -> 'charging') = 'boolean' then (p ->> 'charging')::boolean end,
      network      = v_network,
      talk_channel = left(nullif(btrim(p ->> 'channel'), ''), 80),
      talking      = coalesce(case when jsonb_typeof(p -> 'talking') = 'boolean' then (p ->> 'talking')::boolean end, false),
      queued       = v_queued,
      signed_in    = coalesce(case when jsonb_typeof(p -> 'signedIn') = 'boolean' then (p ->> 'signedIn')::boolean end, true),
      -- A newer fix moves it; no fix keeps the last one while on duty, and clears it off duty.
      lat          = case when v_fix is not null and (v_old.fix_at is null or v_fix >= v_old.fix_at) then v_lat
                          when v_person.is_on_duty then v_old.lat end,
      lng          = case when v_fix is not null and (v_old.fix_at is null or v_fix >= v_old.fix_at) then v_lng
                          when v_person.is_on_duty then v_old.lng end,
      accuracy     = case when v_fix is not null and (v_old.fix_at is null or v_fix >= v_old.fix_at) then v_acc
                          when v_person.is_on_duty then v_old.accuracy end,
      fix_at       = case when v_fix is not null and (v_old.fix_at is null or v_fix >= v_old.fix_at) then v_fix
                          when v_person.is_on_duty then v_old.fix_at end,
      last_seen_at = now()
    where id = v_old.id
    returning * into v_row;
  else
    insert into public.radio_presence (tenant_id, silo, device_id, user_id, personnel_id, model, app_version, battery,
                                       charging, network, talk_channel, talking, queued, signed_in, lat, lng, accuracy, fix_at)
    values (v_person.tenant_id, v_person.silo, v_device, auth.uid(), v_person.id,
            left(nullif(btrim(p ->> 'model'), ''), 60), left(nullif(btrim(p ->> 'app'), ''), 30), v_battery,
            case when jsonb_typeof(p -> 'charging') = 'boolean' then (p ->> 'charging')::boolean end,
            v_network, left(nullif(btrim(p ->> 'channel'), ''), 80),
            coalesce(case when jsonb_typeof(p -> 'talking') = 'boolean' then (p ->> 'talking')::boolean end, false),
            v_queued,
            coalesce(case when jsonb_typeof(p -> 'signedIn') = 'boolean' then (p ->> 'signedIn')::boolean end, true),
            v_lat, v_lng, v_acc, v_fix)
    returning * into v_row;
  end if;

  -- A radio handed from one person to another is on the record: who carried it, from when.
  if v_old.id is not null and v_old.user_id is distinct from auth.uid() then
    select full_name into v_name from public.profiles where id = auth.uid();
    insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
    values (v_person.tenant_id, v_person.silo, auth.uid(), v_name, 'RadioHandedOver', 'radio_presence', v_device,
            format('%s now signed in on %s', coalesce(v_name, 'Someone'), v_device));
  end if;

  return v_row;
end $$;

revoke all on function public.report_radio_presence(jsonb) from public, anon;
grant execute on function public.report_radio_presence(jsonb) to authenticated;

-- ── 3. The register: PocStar and the HikTech app; RealPTT gone ─────────────

delete from public.radio_devices where provider = 'realptt';
do $$
begin
  delete from public.integration_settings where key = 'realptt';
exception when undefined_table then
  null;
end $$;

alter table public.radio_devices drop constraint if exists radio_devices_provider_check;
alter table public.radio_devices add constraint radio_devices_provider_check
  check (provider in ('pocstar', 'hiktech'));

/** As 0082, with the HikTech app as a platform (its account is the Radio ID the app shows), and no RealPTT. */
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

  if p_provider is null or p_provider not in ('pocstar', 'hiktech') then
    raise exception 'Choose the platform' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('radio', 'hard_hat', 'dispatcher') then
    raise exception 'Choose what it is: a radio, a hard hat or a dispatcher seat' using errcode = '22023';
  end if;
  if v_account is null then raise exception 'Enter the account the platform shows' using errcode = '22023'; end if;
  if length(v_account) > 80 then raise exception 'The account is too long' using errcode = '22023'; end if;
  if p_provider = 'hiktech' then
    v_account := upper(v_account);
    if v_account !~ '^HT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$' then
      raise exception 'That Radio ID is not right' using errcode = '22023';
    end if;
  end if;
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
