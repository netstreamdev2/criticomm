-- ============================================================================
-- 0054 — Body cams: the register, booking one out each shift, and watching
-- ============================================================================
--
-- Run after 0053.
--
-- Metro Police officers wear a body camera (Hikvision DS-MCW407) that streams
-- over 4G to the Hikvision platform (HCM Lite). This is the HikTech side:
--
--   1. The bodycam register, kept by the same command staff as the armoury:
--      serial, model, SIM number, the camera's code on the Hikvision platform,
--      station and status. Added one at a time or imported from a
--      spreadsheet; never deleted, only retired.
--   2. Booking one out at the start of a shift, after the firearm, with three
--      quick checks — or saying on the record why there is none. Either one
--      completes the step, and the duty gate now asks for it. A bodycam that
--      fails its check goes for repair, not onto the street.
--   3. Handing it back at the end of the shift: the shift cannot end while a
--      bodycam is booked out. Damaged or lost goes to command at once.
--   4. Watching. The control room, dispatch, the command tier and a
--      department's supervisors and captains may watch a booked-out bodycam
--      live; the same people and case managers may pull recorded footage.
--      Every view needs a reason (an incident, or one from a short list),
--      goes in the audit log, and live views are held to four per person.
--      The officer's phone is told when the control room is viewing their
--      camera — never by whom.
--
-- The video never passes through the database: the web server asks the
-- Hikvision platform for a stream address only after start_bodycam_view()
-- has said yes and written the record.
--
-- Safe to re-run.
-- ============================================================================

begin;

-- ── 1. Who keeps the register, who may watch ────────────────────────────────

-- The armoury's keepers keep the bodycams too (can_manage_armoury, 0051).
create or replace function public.can_manage_bodycams(p_silo public.silo) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.can_manage_armoury(p_silo);
$$;

-- Live: the control room, dispatch and command tier everywhere; supervisors
-- and captains in their own department. Footage: the same, and case managers
-- in their own department. Ethekwini (the control silo) reaches Metro Police
-- kit, as it does for firearms and vehicles.
create or replace function public.can_watch_bodycam(p_silo public.silo, p_kind text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.role_in('SuperAdmin', 'SystemAdmin', 'SystemController', 'ControlRoom', 'Dispatcher')
      or ((public.role_in('Supervisor', 'Captain')
           or (p_kind = 'footage' and public.role_in('CaseManager')))
          and (p_silo = public.current_silo()
               or (public.current_silo() = 'Ethekwini' and p_silo = 'MetroPolice')));
$$;

-- ── 2. The register ─────────────────────────────────────────────────────────

create table if not exists public.bodycams (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null default public.current_tenant(),
  silo                   public.silo not null default 'MetroPolice',
  serial_number          text not null check (char_length(btrim(serial_number)) between 1 and 60),
  model                  text check (model is null or char_length(model) <= 60),
  sim_number             text check (sim_number is null or char_length(sim_number) <= 30),
  -- The camera's index code on the Hikvision platform (cameraIndexCode).
  -- Blank until the platform is connected; nothing streams without it.
  hik_camera_code        text check (hik_camera_code is null or hik_camera_code ~ '^[A-Za-z0-9_-]{1,64}$'),
  station                text check (station is null or char_length(station) <= 80),
  status                 text not null default 'Available'
                         check (status in ('Available', 'Booked out', 'In repair', 'Lost', 'Retired')),
  -- Who has it now. No foreign key: the record outlives an account.
  booked_to              uuid,
  booked_at              timestamptz,
  notes                  text check (notes is null or char_length(notes) <= 500),
  status_note            text,
  status_changed_at      timestamptz,
  status_changed_by_name text,
  created_by             uuid default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint bodycams_custody check (
    (status = 'Booked out') = (booked_to is not null) and (booked_to is null) = (booked_at is null))
);

-- One bodycam per serial, however it is typed: "BC-0012" is "bc 0012".
create unique index if not exists bodycams_serial_key
  on public.bodycams (tenant_id, upper(regexp_replace(serial_number, '[^A-Za-z0-9]', '', 'g')));
create unique index if not exists bodycams_hik_code_key
  on public.bodycams (tenant_id, hik_camera_code) where hik_camera_code is not null;
create index if not exists bodycams_tenant_idx on public.bodycams (tenant_id);
create index if not exists bodycams_status_idx on public.bodycams (tenant_id, silo, status);
create index if not exists bodycams_booked_to_idx on public.bodycams (booked_to) where booked_to is not null;

create or replace function public.touch_bodycam() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  new.serial_number   := btrim(new.serial_number);
  new.model           := nullif(btrim(coalesce(new.model, '')), '');
  new.sim_number      := nullif(btrim(coalesce(new.sim_number, '')), '');
  new.hik_camera_code := nullif(btrim(coalesce(new.hik_camera_code, '')), '');
  new.station         := nullif(btrim(coalesce(new.station, '')), '');
  new.notes           := nullif(btrim(coalesce(new.notes, '')), '');
  new.updated_at      := now();
  return new;
end $$;

drop trigger if exists touch_bodycam on public.bodycams;
create trigger touch_bodycam before insert or update on public.bodycams
  for each row execute function public.touch_bodycam();

-- Details are edited on the register; status and custody change only through
-- the functions below, which keep the record. Nothing is ever deleted.
create or replace function public.guard_bodycam() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Bodycams stay on the register: retire one instead' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'Available' or new.booked_to is not null or new.booked_at is not null then
      raise exception 'A new bodycam joins the register as Available; officers book it out in the app'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status
     or new.booked_to is distinct from old.booked_to
     or new.booked_at is distinct from old.booked_at then
    raise exception 'A bodycam''s status and who has it change only through the app or the register''s buttons'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_bodycam on public.bodycams;
create trigger guard_bodycam before insert or update or delete on public.bodycams
  for each row execute function public.guard_bodycam();

alter table public.bodycams enable row level security;

-- Officers see their own service's register to choose one; Ethekwini field
-- officers draw from Metro Police, as for firearms.
drop policy if exists bodycams_read on public.bodycams;
create policy bodycams_read on public.bodycams for select to authenticated
  using (
    public.is_global()
    or silo = public.current_silo()
    or (public.current_silo() = 'Ethekwini' and silo = 'MetroPolice')
  );

drop policy if exists bodycams_command_insert on public.bodycams;
create policy bodycams_command_insert on public.bodycams for insert to authenticated
  with check (public.can_manage_bodycams(silo));

drop policy if exists bodycams_command_update on public.bodycams;
create policy bodycams_command_update on public.bodycams for update to authenticated
  using (public.can_manage_bodycams(silo))
  with check (public.can_manage_bodycams(silo));

drop policy if exists tenant_isolation on public.bodycams;
create policy tenant_isolation on public.bodycams as restrictive for all to authenticated
  using (tenant_id = (select public.current_tenant()))
  with check (tenant_id = (select public.current_tenant()));

revoke all on public.bodycams from anon;
revoke delete on public.bodycams from authenticated;
grant select, insert, update on public.bodycams to authenticated;

-- ── 3. Bookings, and "no bodycam today" ─────────────────────────────────────

-- One row per time a bodycam went out with an officer. It is how footage is
-- found again: who had which camera, from when to when.
create table if not exists public.bodycam_bookings (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default public.current_tenant(),
  -- The department whose kit it is.
  silo             public.silo not null,
  bodycam_id       uuid not null references public.bodycams(id) on delete restrict,
  serial_number    text not null,
  user_id          uuid not null,
  user_name        text,
  booked_at        timestamptz not null default now(),
  battery_ok       boolean not null,
  recording_ok     boolean not null,
  mounted_ok       boolean not null,
  issue_notes      text,
  returned_at      timestamptz,
  returned_by      uuid,
  returned_by_name text,
  return_condition text check (return_condition in ('ok', 'damaged', 'lost')),
  return_notes     text,
  constraint bodycam_bookings_return check ((returned_at is null) = (return_condition is null))
);
create index if not exists bodycam_bookings_tenant_idx on public.bodycam_bookings (tenant_id, booked_at desc);
create index if not exists bodycam_bookings_cam_idx on public.bodycam_bookings (bodycam_id, booked_at desc);
create index if not exists bodycam_bookings_user_idx on public.bodycam_bookings (user_id, booked_at desc);
create unique index if not exists bodycam_bookings_open
  on public.bodycam_bookings (bodycam_id) where returned_at is null;

alter table public.bodycam_bookings enable row level security;
drop policy if exists bodycam_bookings_read on public.bodycam_bookings;
create policy bodycam_bookings_read on public.bodycam_bookings for select to authenticated
  using (
    user_id = auth.uid()
    or public.can_manage_bodycams(silo)
    or public.can_watch_bodycam(silo, 'footage')
  );
drop policy if exists tenant_isolation on public.bodycam_bookings;
create policy tenant_isolation on public.bodycam_bookings as restrictive for all to authenticated
  using (tenant_id = (select public.current_tenant()))
  with check (tenant_id = (select public.current_tenant()));

-- An officer starting a shift without a bodycam says why, on the record.
create table if not exists public.shift_no_bodycam_declarations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant(),
  silo        public.silo not null,
  user_id     uuid not null,
  user_name   text,
  reason      text not null check (char_length(btrim(reason)) between 3 and 300),
  created_at  timestamptz not null default now()
);
create index if not exists shift_no_bodycam_user_idx
  on public.shift_no_bodycam_declarations (user_id, created_at desc);
create index if not exists shift_no_bodycam_tenant_idx
  on public.shift_no_bodycam_declarations (tenant_id, created_at desc);

alter table public.shift_no_bodycam_declarations enable row level security;
drop policy if exists shift_no_bodycam_read on public.shift_no_bodycam_declarations;
create policy shift_no_bodycam_read on public.shift_no_bodycam_declarations for select to authenticated
  using (user_id = auth.uid() or public.can_manage_bodycams(silo));
drop policy if exists tenant_isolation on public.shift_no_bodycam_declarations;
create policy tenant_isolation on public.shift_no_bodycam_declarations as restrictive for all to authenticated
  using (tenant_id = (select public.current_tenant()))
  with check (tenant_id = (select public.current_tenant()));

-- ── 4. Every view of a bodycam, live or recorded ────────────────────────────

create table if not exists public.bodycam_views (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default public.current_tenant(),
  -- The bodycam's department.
  silo            public.silo not null,
  bodycam_id      uuid not null references public.bodycams(id) on delete restrict,
  serial_number   text not null,
  -- Who was wearing it: now (live) or in the window (footage), when known.
  officer_id      uuid,
  officer_name    text,
  kind            text not null check (kind in ('live', 'footage')),
  footage_from    timestamptz,
  footage_to      timestamptz,
  incident_id     uuid references public.incidents(id) on delete set null,
  incident_number text,
  reason_code     text not null
                  check (reason_code in ('incident', 'officer_safety', 'sos', 'supervision', 'investigation', 'other')),
  reason_note     text check (reason_note is null or char_length(reason_note) <= 300),
  viewer_id       uuid not null,
  viewer_name     text,
  viewer_role     public.user_role,
  started_at      timestamptz not null default now(),
  -- The viewer's screen confirms it is still open every half minute.
  last_seen_at    timestamptz not null default now(),
  ended_at        timestamptz,
  -- closed: they closed it · timeout: nobody answered "Still watching?" or the
  -- screen went away · stopped: the bodycam was handed back · failed: no stream.
  end_reason      text check (end_reason in ('closed', 'timeout', 'stopped', 'failed')),
  constraint bodycam_views_window check (
    (kind = 'footage') = (footage_from is not null and footage_to is not null)
    and (footage_from is null or footage_to > footage_from)),
  constraint bodycam_views_ended check ((ended_at is null) = (end_reason is null))
);
create index if not exists bodycam_views_tenant_idx on public.bodycam_views (tenant_id, started_at desc);
create index if not exists bodycam_views_open_idx on public.bodycam_views (viewer_id) where ended_at is null;
create index if not exists bodycam_views_cam_idx on public.bodycam_views (bodycam_id, started_at desc);
create index if not exists bodycam_views_incident_idx on public.bodycam_views (incident_id);

alter table public.bodycam_views enable row level security;
-- Viewers see their own; the register's keepers see who watched their kit.
drop policy if exists bodycam_views_read on public.bodycam_views;
create policy bodycam_views_read on public.bodycam_views for select to authenticated
  using (viewer_id = auth.uid() or public.can_manage_bodycams(silo));
drop policy if exists tenant_isolation on public.bodycam_views;
create policy tenant_isolation on public.bodycam_views as restrictive for all to authenticated
  using (tenant_id = (select public.current_tenant()))
  with check (tenant_id = (select public.current_tenant()));

-- Reads only; every write goes through the functions below.
revoke all on public.bodycam_bookings from anon;
revoke all on public.shift_no_bodycam_declarations from anon;
revoke all on public.bodycam_views from anon;
revoke insert, update, delete on public.bodycam_bookings from authenticated;
revoke insert, update, delete on public.shift_no_bodycam_declarations from authenticated;
revoke insert, update, delete on public.bodycam_views from authenticated;
grant select on public.bodycam_bookings to authenticated;
grant select on public.shift_no_bodycam_declarations to authenticated;
grant select on public.bodycam_views to authenticated;

-- ── 5. Watching ─────────────────────────────────────────────────────────────

create or replace function public.bodycam_reason_label(p_code text) returns text
language sql immutable set search_path to 'public' as $$
  select case p_code
    when 'incident'       then 'incident'
    when 'officer_safety' then 'officer safety check'
    when 'sos'            then 'SOS or officer in distress'
    when 'supervision'    then 'supervising work in progress'
    when 'investigation'  then 'investigation or evidence review'
    when 'other'          then 'other'
    else p_code
  end;
$$;

-- Open a view. Says yes or no, writes the record and the audit log, and
-- returns the camera's Hikvision code for the web server to fetch a stream.
create or replace function public.start_bodycam_view(
  p_bodycam_id  uuid,
  p_kind        text,
  p_incident_id uuid,
  p_reason_code text,
  p_reason_note text,
  p_from        timestamptz default null,
  p_to          timestamptz default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_me       public.profiles;
  v_cam      public.bodycams;
  v_incident public.incidents;
  v_view     public.bodycam_views;
  v_note     text := nullif(btrim(coalesce(p_reason_note, '')), '');
  v_reason   text := nullif(btrim(coalesce(p_reason_code, '')), '');
  v_officer  uuid;
  v_name     text;
  v_open     int;
  v_what     text;
begin
  select * into v_me from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Your account is not active' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('live', 'footage') then
    raise exception 'Choose live video or recorded footage' using errcode = '22023';
  end if;

  select * into v_cam from public.bodycams where id = p_bodycam_id and tenant_id = public.current_tenant();
  if not found then raise exception 'That bodycam is not on the register' using errcode = 'P0002'; end if;
  if not public.can_watch_bodycam(v_cam.silo, p_kind) then
    raise exception 'Your role cannot % this department''s bodycams',
      case when p_kind = 'live' then 'watch' else 'pull footage from' end using errcode = '42501';
  end if;

  -- Why. Opening it from an incident is the reason.
  if p_incident_id is not null then
    select * into v_incident from public.incidents
     where id = p_incident_id and tenant_id = public.current_tenant();
    if not found or not (
      public.is_global() or v_incident.silo = v_me.silo
      or v_me.silo = any (coalesce(v_incident.dispatched_silos, '{}'::public.silo[]))
    ) then
      raise exception 'That incident was not found' using errcode = '22023';
    end if;
    v_reason := 'incident';
  end if;
  if v_reason is null or v_reason not in ('incident', 'officer_safety', 'sos', 'supervision', 'investigation', 'other') then
    raise exception 'Say why you are opening this bodycam' using errcode = '22023';
  end if;
  if v_reason = 'incident' and p_incident_id is null then
    raise exception 'Choose the incident this is for' using errcode = '22023';
  end if;
  if v_reason = 'other' and char_length(coalesce(v_note, '')) < 5 then
    raise exception 'Say why in a few words' using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 300 then
    raise exception 'Keep the reason under 300 characters' using errcode = '22023';
  end if;

  if p_kind = 'live' then
    if p_from is not null or p_to is not null then
      raise exception 'A live view has no time window' using errcode = '22023';
    end if;
    if v_cam.status <> 'Booked out' then
      raise exception 'Bodycam % is not out with an officer right now', v_cam.serial_number using errcode = '22023';
    end if;
    v_officer := v_cam.booked_to;
    -- Four at once, each one uses the camera's mobile data. A screen that has
    -- not confirmed for two minutes has gone and no longer counts.
    select count(*) into v_open from public.bodycam_views
     where viewer_id = auth.uid() and kind = 'live' and ended_at is null
       and last_seen_at > now() - interval '2 minutes';
    if v_open >= 4 then
      raise exception 'You are already watching 4 bodycams. Close one first.' using errcode = '22023';
    end if;
  else
    if p_from is null or p_to is null or p_to <= p_from then
      raise exception 'Choose when the footage starts and ends' using errcode = '22023';
    end if;
    if p_to - p_from > interval '24 hours' then
      raise exception 'Footage windows are capped at 24 hours' using errcode = '22023';
    end if;
    if p_from > now() then
      raise exception 'That window has not happened yet' using errcode = '22023';
    end if;
    -- Who was wearing it then: the latest booking that overlaps the window.
    select b.user_id into v_officer from public.bodycam_bookings b
     where b.bodycam_id = v_cam.id and b.booked_at < p_to and coalesce(b.returned_at, now()) > p_from
     order by b.booked_at desc limit 1;
  end if;
  if v_officer is not null then
    select btrim(p.rank || ' ' || p.first_name || ' ' || p.last_name) into v_name
      from public.personnel p where p.user_id = v_officer and p.tenant_id = v_cam.tenant_id limit 1;
  end if;

  insert into public.bodycam_views (
    tenant_id, silo, bodycam_id, serial_number, officer_id, officer_name, kind, footage_from, footage_to,
    incident_id, incident_number, reason_code, reason_note, viewer_id, viewer_name, viewer_role
  ) values (
    v_cam.tenant_id, v_cam.silo, v_cam.id, v_cam.serial_number, v_officer, v_name, p_kind,
    case when p_kind = 'footage' then p_from end, case when p_kind = 'footage' then p_to end,
    v_incident.id, v_incident.incident_number, v_reason, v_note, auth.uid(), v_me.full_name, v_me.role
  ) returning * into v_view;

  v_what := format('Bodycam %s%s, %s. Reason: %s%s',
    v_cam.serial_number, coalesce(' (' || v_name || ')', ''),
    case when p_kind = 'live' then 'live'
         else format('footage %s to %s',
                     to_char(p_from at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI'),
                     to_char(p_to at time zone 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI')) end,
    case when v_reason = 'incident' then 'incident ' || v_incident.incident_number
         else public.bodycam_reason_label(v_reason) end,
    coalesce(' — ' || v_note, ''));
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_cam.tenant_id, v_cam.silo, auth.uid(), v_me.full_name,
          case when p_kind = 'live' then 'BodycamLiveViewed' else 'BodycamFootageViewed' end,
          'bodycam', v_cam.id::text, v_what);
  -- …and on the incident's own history, when it was opened for one.
  if v_incident.id is not null then
    insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
    values (v_cam.tenant_id, v_incident.silo, auth.uid(), v_me.full_name,
            case when p_kind = 'live' then 'BodycamLiveViewed' else 'BodycamFootageViewed' end,
            'incident', v_incident.id::text, v_what);
  end if;

  return jsonb_build_object(
    'view_id', v_view.id,
    'kind', p_kind,
    'serial_number', v_cam.serial_number,
    'hik_camera_code', v_cam.hik_camera_code,
    'officer_name', v_name
  );
end $$;

-- The viewer's screen confirms every half minute that the view is still
-- open. A live view ends once the bodycam is handed back, or if the screen
-- stayed silent for two minutes.
create or replace function public.touch_bodycam_view(p_view_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_view public.bodycam_views;
  v_cam  public.bodycams;
begin
  select * into v_view from public.bodycam_views
   where id = p_view_id and viewer_id = auth.uid() and tenant_id = public.current_tenant()
   for update;
  if not found then raise exception 'That view was not found' using errcode = 'P0002'; end if;
  if v_view.ended_at is not null then
    return jsonb_build_object('active', false, 'reason', v_view.end_reason);
  end if;
  if v_view.kind = 'live' then
    select * into v_cam from public.bodycams where id = v_view.bodycam_id;
    if v_cam.status <> 'Booked out' or v_cam.booked_to is distinct from v_view.officer_id then
      update public.bodycam_views set ended_at = now(), end_reason = 'stopped' where id = v_view.id;
      return jsonb_build_object('active', false, 'reason', 'stopped');
    end if;
    if v_view.last_seen_at < now() - interval '2 minutes' then
      update public.bodycam_views set ended_at = now(), end_reason = 'timeout' where id = v_view.id;
      return jsonb_build_object('active', false, 'reason', 'timeout');
    end if;
  end if;
  update public.bodycam_views set last_seen_at = now() where id = v_view.id;
  return jsonb_build_object('active', true);
end $$;

create or replace function public.end_bodycam_view(p_view_id uuid, p_reason text default 'closed') returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_reason text := case when p_reason in ('closed', 'timeout', 'failed') then p_reason else 'closed' end;
begin
  update public.bodycam_views set ended_at = now(), end_reason = v_reason
   where id = p_view_id and viewer_id = auth.uid() and tenant_id = public.current_tenant()
     and ended_at is null;
  return jsonb_build_object('ended', found);
end $$;

-- For the officer's phone: is the control room viewing my camera right now?
-- Never says who.
create or replace function public.bodycam_watch_status() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select jsonb_build_object(
        'serial_number', c.serial_number,
        'watching', exists (
          select 1 from public.bodycam_views v
           where v.bodycam_id = c.id and v.kind = 'live' and v.ended_at is null
             and v.officer_id = auth.uid() and v.last_seen_at > now() - interval '90 seconds'),
        'since', (
          select min(v.started_at) from public.bodycam_views v
           where v.bodycam_id = c.id and v.kind = 'live' and v.ended_at is null
             and v.officer_id = auth.uid() and v.last_seen_at > now() - interval '90 seconds'))
       from public.bodycams c
      where c.booked_to = auth.uid() and c.status = 'Booked out' and c.tenant_id = public.current_tenant()
      limit 1),
    jsonb_build_object('serial_number', null, 'watching', false, 'since', null));
$$;

-- ── 6. Start of shift: book one out, or say why not ─────────────────────────

create or replace function public.shift_requires_bodycam() returns boolean
language sql stable set search_path to 'public' as $$
  select public.current_silo() in ('MetroPolice', 'Ethekwini');
$$;

-- Booked out today and still with them, or declared none today.
create or replace function public.shift_bodycam_resolved_today() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
           select 1 from public.bodycam_bookings b
             join public.bodycams c on c.id = b.bodycam_id
            where b.user_id = auth.uid() and b.tenant_id = public.current_tenant()
              and b.booked_at >= public.sa_today_start() and b.returned_at is null
              and c.status = 'Booked out' and c.booked_to = auth.uid())
      or exists (
           select 1 from public.shift_no_bodycam_declarations d
            where d.user_id = auth.uid() and d.tenant_id = public.current_tenant()
              and d.created_at >= public.sa_today_start());
$$;

-- The duty gate (0037) now asks for the bodycam step too.
create or replace function public.has_completed_shift_start_today() returns boolean
language sql stable security definer set search_path = public as $$
  select public.shift_readiness_passed_today()
     and public.shift_vehicle_passed_today()
     and (not public.shift_requires_firearm() or public.shift_firearm_resolved_today())
     and (not public.shift_requires_bodycam() or public.shift_bodycam_resolved_today());
$$;

create or replace function public.book_out_bodycam(
  p_bodycam_id   uuid,
  p_battery_ok   boolean,
  p_recording_ok boolean,
  p_mounted_ok   boolean,
  p_notes        text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_person public.personnel;
  v_cam    public.bodycams;
  v_row    public.bodycam_bookings;
  v_name   text;
  v_notes  text := nullif(btrim(coalesce(p_notes, '')), '');
  v_ok     boolean := coalesce(p_battery_ok, false) and coalesce(p_recording_ok, false) and coalesce(p_mounted_ok, false);
  v_failed text;
  v_why    text;
begin
  if auth.uid() is null then raise exception 'Sign in before booking out a bodycam' using errcode = '42501'; end if;
  select * into v_person from public.personnel
   where user_id = auth.uid() and tenant_id = public.current_tenant();
  if not found then raise exception 'No personnel record is linked to this account'; end if;
  if not public.shift_readiness_passed_today() then
    raise exception 'Complete the readiness assessment first';
  end if;
  if not public.shift_vehicle_passed_today() then
    raise exception 'Complete and sign the vehicle inspection first';
  end if;
  v_name := btrim(v_person.rank || ' ' || v_person.first_name || ' ' || v_person.last_name);

  select * into v_cam from public.bodycams
   where id = p_bodycam_id and tenant_id = public.current_tenant()
     and (silo = v_person.silo or (v_person.silo = 'Ethekwini' and silo = 'MetroPolice'))
   for update;
  if not found then raise exception 'That bodycam is not on your register' using errcode = 'P0002'; end if;
  if not (v_cam.status = 'Available' or (v_cam.status = 'Booked out' and v_cam.booked_to = auth.uid())) then
    raise exception 'Bodycam % is %: choose another', v_cam.serial_number, lower(v_cam.status) using errcode = '22023';
  end if;
  if not v_ok and v_notes is null then
    raise exception 'Say what is wrong with the bodycam in the notes' using errcode = '22023';
  end if;

  -- Still holding it from an earlier shift: that booking closes here.
  update public.bodycam_bookings
     set returned_at = now(), returned_by = auth.uid(), returned_by_name = v_name,
         return_condition = 'ok', return_notes = 'Carried over to a new shift'
   where bodycam_id = v_cam.id and returned_at is null;

  if v_ok then
    insert into public.bodycam_bookings (
      tenant_id, silo, bodycam_id, serial_number, user_id, user_name,
      battery_ok, recording_ok, mounted_ok, issue_notes
    ) values (
      v_cam.tenant_id, v_cam.silo, v_cam.id, v_cam.serial_number, auth.uid(), v_name,
      true, true, true, v_notes
    ) returning * into v_row;
    update public.bodycams
       set status = 'Booked out', booked_to = auth.uid(), booked_at = now(),
           status_note = null, status_changed_at = now(), status_changed_by_name = v_name
     where id = v_cam.id;
    insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
    values (v_cam.tenant_id, v_cam.silo, auth.uid(), v_name, 'BodycamBookedOut', 'bodycam', v_cam.id::text,
            format('%s booked out by %s', v_cam.serial_number, v_name));
    return jsonb_build_object('booked', true, 'booking_id', v_row.id, 'serial_number', v_cam.serial_number);
  end if;

  -- A failed check sends it for repair, not onto the street.
  v_failed := concat_ws(', ',
    case when not coalesce(p_battery_ok, false) then 'battery' end,
    case when not coalesce(p_recording_ok, false) then 'test recording' end,
    case when not coalesce(p_mounted_ok, false) then 'mount' end);
  v_why := format('Failed its check at book-out (%s): %s', v_failed, v_notes);
  insert into public.bodycam_bookings (
    tenant_id, silo, bodycam_id, serial_number, user_id, user_name,
    battery_ok, recording_ok, mounted_ok, issue_notes,
    returned_at, returned_by, returned_by_name, return_condition, return_notes
  ) values (
    v_cam.tenant_id, v_cam.silo, v_cam.id, v_cam.serial_number, auth.uid(), v_name,
    coalesce(p_battery_ok, false), coalesce(p_recording_ok, false), coalesce(p_mounted_ok, false), v_notes,
    now(), auth.uid(), v_name, 'damaged', v_why
  );
  update public.bodycams
     set status = 'In repair', booked_to = null, booked_at = null,
         status_note = v_why, status_changed_at = now(), status_changed_by_name = v_name
   where id = v_cam.id;
  perform public.notify_command(v_cam.tenant_id, v_cam.silo,
    format('Bodycam needs repair: %s', v_cam.serial_number),
    format('%s found a fault at book-out (%s): %s', v_name, v_failed, v_notes),
    'Medium', '/police/bodycams');
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_cam.tenant_id, v_cam.silo, auth.uid(), v_name, 'BodycamFailedCheck', 'bodycam', v_cam.id::text,
          format('%s: %s', v_cam.serial_number, v_why));
  return jsonb_build_object('booked', false, 'status', 'In repair', 'serial_number', v_cam.serial_number,
                            'failed', v_failed);
end $$;

create or replace function public.declare_shift_no_bodycam(p_reason text)
returns public.shift_no_bodycam_declarations
language plpgsql security definer set search_path to 'public' as $$
declare
  v_person public.personnel;
  v_row    public.shift_no_bodycam_declarations;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into v_person from public.personnel
   where user_id = auth.uid() and tenant_id = public.current_tenant();
  if not found then raise exception 'No personnel record is linked to this account'; end if;
  if not public.shift_readiness_passed_today() then
    raise exception 'Complete the readiness assessment first';
  end if;
  if not public.shift_vehicle_passed_today() then
    raise exception 'Complete and sign the vehicle inspection first';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'Say why you have no bodycam today' using errcode = '22023';
  end if;
  if char_length(v_reason) > 300 then
    raise exception 'Keep the reason under 300 characters' using errcode = '22023';
  end if;

  insert into public.shift_no_bodycam_declarations (tenant_id, silo, user_id, user_name, reason)
  values (public.current_tenant(), v_person.silo, auth.uid(),
          btrim(v_person.rank || ' ' || v_person.first_name || ' ' || v_person.last_name), v_reason)
  returning * into v_row;
  return v_row;
end $$;

-- ── 7. Handing it back ──────────────────────────────────────────────────────

-- The return itself, shared by the officer and the register's keepers.
create or replace function public.record_bodycam_return(
  p_cam       public.bodycams,
  p_condition text,
  p_notes     text,
  p_by        uuid,
  p_by_name   text
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_notes  text := nullif(btrim(coalesce(p_notes, '')), '');
  v_status text;
  v_holder text;
begin
  if p_condition is null or p_condition not in ('ok', 'damaged', 'lost') then
    raise exception 'Choose the bodycam''s condition' using errcode = '22023';
  end if;
  if p_condition <> 'ok' and char_length(coalesce(v_notes, '')) < 5 then
    raise exception 'Say what happened to the bodycam' using errcode = '22023';
  end if;
  v_status := case p_condition when 'ok' then 'Available' when 'damaged' then 'In repair' else 'Lost' end;
  select btrim(p.rank || ' ' || p.first_name || ' ' || p.last_name) into v_holder
    from public.personnel p where p.user_id = p_cam.booked_to and p.tenant_id = p_cam.tenant_id limit 1;

  update public.bodycam_bookings
     set returned_at = now(), returned_by = p_by, returned_by_name = p_by_name,
         return_condition = p_condition, return_notes = v_notes
   where bodycam_id = p_cam.id and returned_at is null;
  update public.bodycams
     set status = v_status, booked_to = null, booked_at = null,
         status_note = case when p_condition = 'ok' then null else v_notes end,
         status_changed_at = now(), status_changed_by_name = p_by_name
   where id = p_cam.id;
  -- Nobody keeps watching a camera that is back on the shelf.
  update public.bodycam_views set ended_at = now(), end_reason = 'stopped'
   where bodycam_id = p_cam.id and kind = 'live' and ended_at is null;

  if p_condition <> 'ok' then
    perform public.notify_command(p_cam.tenant_id, p_cam.silo,
      format('Bodycam %s: %s', case when p_condition = 'lost' then 'lost' else 'damaged' end, p_cam.serial_number),
      format('%s, handed back by %s: %s', coalesce(v_holder, 'An officer''s bodycam'), p_by_name, v_notes),
      case when p_condition = 'lost' then 'High' else 'Medium' end, '/police/bodycams');
  end if;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (p_cam.tenant_id, p_cam.silo, p_by, p_by_name, 'BodycamReturned', 'bodycam', p_cam.id::text,
          format('%s from %s: %s%s', p_cam.serial_number, coalesce(v_holder, 'an officer'),
                 case p_condition when 'ok' then 'in order' when 'damaged' then 'damaged' else 'lost' end,
                 coalesce(' — ' || v_notes, '')));
  return jsonb_build_object('status', v_status);
end $$;
revoke all on function public.record_bodycam_return(public.bodycams, text, text, uuid, text)
  from public, anon, authenticated;

-- The officer hands it back at the end of the shift, from the app.
create or replace function public.return_bodycam(p_bodycam_id uuid, p_condition text, p_notes text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_me  public.profiles;
  v_cam public.bodycams;
  v_name text;
begin
  select * into v_me from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Sign in before handing back a bodycam' using errcode = '42501'; end if;
  select * into v_cam from public.bodycams
   where id = p_bodycam_id and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'That bodycam is not on your register' using errcode = 'P0002'; end if;
  if v_cam.status <> 'Booked out' or v_cam.booked_to is distinct from auth.uid() then
    raise exception 'Bodycam % is not booked out to you', v_cam.serial_number using errcode = '22023';
  end if;
  select btrim(p.rank || ' ' || p.first_name || ' ' || p.last_name) into v_name
    from public.personnel p where p.user_id = auth.uid() and p.tenant_id = v_cam.tenant_id limit 1;
  return public.record_bodycam_return(v_cam, p_condition, p_notes, auth.uid(), coalesce(v_name, v_me.full_name));
end $$;

-- A keeper receives it on the officer's behalf (a dead phone, a forgotten
-- return), from the register.
create or replace function public.receive_bodycam(p_bodycam_id uuid, p_condition text, p_notes text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_me  public.profiles;
  v_cam public.bodycams;
begin
  select * into v_me from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into v_cam from public.bodycams
   where id = p_bodycam_id and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'No such bodycam on your register' using errcode = 'P0002'; end if;
  if not public.can_manage_bodycams(v_cam.silo) then
    raise exception 'Your role cannot manage these bodycams' using errcode = '42501';
  end if;
  if v_cam.status <> 'Booked out' then
    raise exception 'Bodycam % is not booked out', v_cam.serial_number using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_notes, ''))) < 5 then
    raise exception 'Say who handed it in and why it was received here' using errcode = '22023';
  end if;
  return public.record_bodycam_return(v_cam, p_condition, p_notes, v_me.id, v_me.full_name);
end $$;

-- Back into service, off for repair, lost, or retired.
create or replace function public.set_bodycam_status(p_bodycam_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_me  public.profiles;
  v_cam public.bodycams;
begin
  select * into v_me from public.profiles where id = auth.uid() and deactivated_at is null;
  if not found then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into v_cam from public.bodycams
   where id = p_bodycam_id and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'No such bodycam on your register' using errcode = 'P0002'; end if;
  if not public.can_manage_bodycams(v_cam.silo) then
    raise exception 'Your role cannot manage these bodycams' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('Available', 'In repair', 'Lost', 'Retired') then
    raise exception 'Choose Available, In repair, Lost or Retired' using errcode = '22023';
  end if;
  if v_cam.status = 'Booked out' then
    raise exception 'Bodycam % is booked out. Receive it back first.', v_cam.serial_number using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason: it goes on the bodycam''s record' using errcode = '22023';
  end if;
  update public.bodycams
     set status = p_status, status_note = btrim(p_reason), status_changed_at = now(),
         status_changed_by_name = v_me.full_name
   where id = v_cam.id;
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, entity_id, details)
  values (v_cam.tenant_id, v_cam.silo, v_me.id, v_me.full_name, 'BodycamStatus', 'bodycam', v_cam.id::text,
          format('%s: %s → %s. %s', v_cam.serial_number, v_cam.status, p_status, btrim(p_reason)));
  return jsonb_build_object('status', p_status);
end $$;

-- ── 8. Ending a shift needs the bodycam back ────────────────────────────────

-- As 0051, with the bodycam checked after the firearm.
create or replace function public.end_shift(p_mileage_km int default null, p_vehicle_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_person  public.personnel;
  v_vehicle public.apparatus;
  v_serial  text;
  v_note    text := nullif(btrim(coalesce(p_vehicle_note, '')), '');
  v_name    text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into v_person from public.personnel
   where user_id = auth.uid() and tenant_id = public.current_tenant() for update;
  if not found then raise exception 'No personnel record is linked to this account'; end if;
  v_name := btrim(v_person.rank || ' ' || v_person.first_name || ' ' || v_person.last_name);

  select serial_number into v_serial from public.firearms
   where issued_to = auth.uid() and status = 'Issued' and tenant_id = public.current_tenant() limit 1;
  if found then
    raise exception 'Return firearm % before ending your shift', v_serial using errcode = '22023';
  end if;

  select serial_number into v_serial from public.bodycams
   where booked_to = auth.uid() and status = 'Booked out' and tenant_id = public.current_tenant() limit 1;
  if found then
    raise exception 'Hand back bodycam % before ending your shift', v_serial using errcode = '22023';
  end if;

  if v_person.assigned_apparatus_id is not null then
    select * into v_vehicle from public.apparatus where id = v_person.assigned_apparatus_id for update;
    if p_mileage_km is not null and (p_mileage_km < coalesce(v_vehicle.mileage, 0) or p_mileage_km > 2000000) then
      raise exception 'Mileage cannot be below the vehicle''s last reading (% km)', v_vehicle.mileage using errcode = '22023';
    end if;
  end if;

  -- Off duty first: 0039 refuses here if they still lead an open call.
  update public.personnel
     set is_on_duty = false, latitude = null, longitude = null, assigned_apparatus_id = null
   where id = v_person.id;

  if v_vehicle.id is not null then
    update public.apparatus
       set status = case when status = 'In Use' then (case when v_note is null then 'Available' else 'Maintenance' end)::public.apparatus_status
                         else status end,
           mileage = greatest(mileage, coalesce(p_mileage_km, 0)),
           status_note = case when v_note is not null and status = 'In Use' then 'Reported at end of shift: ' || v_note else status_note end,
           status_changed_at = case when v_note is not null and status = 'In Use' then now() else status_changed_at end,
           status_changed_by_name = case when v_note is not null and status = 'In Use' then v_name else status_changed_by_name end,
           updated_at = now()
     where id = v_vehicle.id;
    if v_note is not null then
      perform public.notify_command(v_vehicle.tenant_id, v_vehicle.silo,
        format('Vehicle fault reported: %s', v_vehicle.unit_number),
        format('%s at end of shift: %s', v_name, v_note), 'Medium', '/shift/today');
    end if;
  end if;

  insert into public.shift_ends (tenant_id, silo, user_id, user_name, apparatus_id, unit_number, mileage_km, vehicle_note, source)
  values (v_person.tenant_id, v_person.silo, auth.uid(), v_name, v_vehicle.id, v_vehicle.unit_number, p_mileage_km, v_note, 'app');

  return jsonb_build_object('status', 'ended', 'vehicle', v_vehicle.unit_number,
    'vehicle_status', case when v_vehicle.id is null then null when v_note is null then 'Available' else 'Maintenance' end);
end $$;

-- As 0051, and command also hears about a bodycam taken home.
create or replace function public.cleanup_on_logout() returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_person  public.personnel;
  v_vehicle public.apparatus;
  v_serial  text;
  v_cam     public.bodycams;
  v_name    text;
begin
  select * into v_person from public.personnel
   where user_id = auth.uid() and tenant_id = public.current_tenant();
  if not found then return; end if;
  v_name := btrim(v_person.rank || ' ' || v_person.first_name || ' ' || v_person.last_name);
  select serial_number into v_serial from public.firearms
   where issued_to = auth.uid() and status = 'Issued' and tenant_id = public.current_tenant() limit 1;
  select * into v_cam from public.bodycams
   where booked_to = auth.uid() and status = 'Booked out' and tenant_id = public.current_tenant() limit 1;

  if v_person.assigned_apparatus_id is not null then
    select * into v_vehicle from public.apparatus where id = v_person.assigned_apparatus_id;
    update public.apparatus set status = 'Available' where id = v_person.assigned_apparatus_id and status = 'In Use';
  end if;

  update public.personnel
     set is_on_duty = false, latitude = null, longitude = null, assigned_apparatus_id = null
   where id = v_person.id;

  if v_vehicle.id is not null or v_serial is not null or v_cam.id is not null then
    insert into public.shift_ends (tenant_id, silo, user_id, user_name, apparatus_id, unit_number, source)
    values (v_person.tenant_id, v_person.silo, auth.uid(), v_name, v_vehicle.id, v_vehicle.unit_number,
            case when v_serial is null then 'sign_out' else 'firearm_out' end);
  end if;
  if v_serial is not null then
    perform public.notify_command(v_person.tenant_id,
      case when v_person.silo = 'Ethekwini' then 'MetroPolice'::public.silo else v_person.silo end,
      format('Firearm still out: %s', v_name),
      format('%s signed out with firearm %s still booked out. Receive it on the armoury page.', v_name, v_serial),
      'High', '/police/armoury');
  end if;
  if v_cam.id is not null then
    perform public.notify_command(v_cam.tenant_id, v_cam.silo,
      format('Bodycam still out: %s', v_name),
      format('%s signed out with bodycam %s still booked out. Receive it on the bodycam register.', v_name, v_cam.serial_number),
      'Medium', '/police/bodycams');
  end if;
end $$;

-- ── 9. Importing the register from a spreadsheet ────────────────────────────

alter table public.asset_imports drop constraint if exists asset_imports_kind_check;
alter table public.asset_imports add constraint asset_imports_kind_check
  check (kind in ('firearms', 'vehicles', 'bodycams'));

-- Matched by serial number (letters and digits only, any case). New ones
-- arrive Available; existing ones get their details updated, never their
-- status or custody. A blank cell never erases.
create or replace function public.import_bodycams(p_rows jsonb, p_file_name text, p_file_sha256 text, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor    public.profiles := public.check_asset_import(p_rows, p_file_name, p_file_sha256, p_reason);
  v_row      jsonb;
  v_line     text;
  v_serial   text;
  v_key      text;
  v_model    text;
  v_sim      text;
  v_code     text;
  v_station  text;
  v_notes    text;
  v_silo     public.silo;
  v_hits     int;
  v_existing public.bodycams;
  v_added    int := 0;
  v_updated  int := 0;
  v_same     int := 0;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_line    := coalesce(v_row ->> 'line', '?');
    v_serial  := btrim(coalesce(v_row ->> 'serial_number', ''));
    v_key     := upper(regexp_replace(v_serial, '[^A-Za-z0-9]', '', 'g'));
    v_model   := nullif(btrim(coalesce(v_row ->> 'model', '')), '');
    v_sim     := nullif(btrim(coalesce(v_row ->> 'sim_number', '')), '');
    v_code    := nullif(btrim(coalesce(v_row ->> 'hik_camera_code', '')), '');
    v_station := nullif(btrim(coalesce(v_row ->> 'station', '')), '');
    v_notes   := nullif(btrim(coalesce(v_row ->> 'notes', '')), '');
    if v_key = '' then raise exception 'Row %: no serial number', v_line using errcode = '22023'; end if;
    if v_code is not null and v_code !~ '^[A-Za-z0-9_-]{1,64}$' then
      raise exception 'Row %: the Hikvision camera code may only hold letters, digits, - and _', v_line using errcode = '22023';
    end if;
    begin
      v_silo := (v_row ->> 'silo')::public.silo;
    exception when others then
      raise exception 'Row %: unknown department', v_line using errcode = '22023';
    end;
    if v_silo is null then raise exception 'Row %: no department', v_line using errcode = '22023'; end if;
    if not public.can_manage_bodycams(v_silo) then
      raise exception 'Row %: your role cannot manage that department''s bodycams', v_line using errcode = '42501';
    end if;

    select count(*) into v_hits from public.bodycams
     where tenant_id = public.current_tenant()
       and upper(regexp_replace(serial_number, '[^A-Za-z0-9]', '', 'g')) = v_key;
    begin
      if v_hits = 0 then
        insert into public.bodycams (tenant_id, silo, serial_number, model, sim_number, hik_camera_code, station, notes,
                                     created_by, status_note, status_changed_at, status_changed_by_name)
        values (public.current_tenant(), v_silo, v_serial, v_model, v_sim, v_code, v_station, v_notes,
                v_actor.id, 'Imported: ' || btrim(p_reason), now(), v_actor.full_name);
        v_added := v_added + 1;
      else
        select * into v_existing from public.bodycams
         where tenant_id = public.current_tenant()
           and upper(regexp_replace(serial_number, '[^A-Za-z0-9]', '', 'g')) = v_key for update;
        if (v_existing.model, v_existing.sim_number, v_existing.hik_camera_code, v_existing.station, v_existing.notes, v_existing.silo)
           is distinct from
           (coalesce(v_model, v_existing.model), coalesce(v_sim, v_existing.sim_number),
            coalesce(v_code, v_existing.hik_camera_code), coalesce(v_station, v_existing.station),
            coalesce(v_notes, v_existing.notes), v_silo) then
          update public.bodycams
             set model = coalesce(v_model, model), sim_number = coalesce(v_sim, sim_number),
                 hik_camera_code = coalesce(v_code, hik_camera_code), station = coalesce(v_station, station),
                 notes = coalesce(v_notes, notes), silo = v_silo
           where id = v_existing.id;
          v_updated := v_updated + 1;
        else
          v_same := v_same + 1;
        end if;
      end if;
    exception when unique_violation then
      if v_code is not null then
        raise exception 'Row %: Hikvision camera code % is already on another bodycam', v_line, v_code using errcode = '23505';
      end if;
      raise exception 'Row %: serial % is already on the register', v_line, v_serial using errcode = '23505';
    end;
  end loop;

  insert into public.asset_imports (tenant_id, kind, imported_by, imported_by_name, file_name, file_sha256, reason,
                                    row_count, added, updated, unchanged)
  values (public.current_tenant(), 'bodycams', v_actor.id, v_actor.full_name, left(btrim(coalesce(p_file_name, 'bodycams')), 200),
          p_file_sha256, btrim(p_reason), jsonb_array_length(p_rows), v_added, v_updated, v_same);
  insert into public.audit_logs (tenant_id, silo, user_id, user_name, action_type, entity_type, details)
  values (public.current_tenant(), v_actor.silo, v_actor.id, v_actor.full_name, 'BodycamsImported', 'bodycam',
          format('%s: %s added, %s updated, %s unchanged. Reason: %s', p_file_name, v_added, v_updated, v_same, btrim(p_reason)));
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'unchanged', v_same);
end $$;

-- ── 10. The Hikvision integration now serves bodycams ───────────────────────

-- Existing values win; the new settings only fill gaps. stream_source
-- 'test' plays a public sample video until the platform is connected.
update public.integration_settings
   set label = 'Hikvision HCM Lite — bodycam live video and footage',
       config = jsonb_build_object(
                  'stream_source', 'hikvision',
                  'test_stream_url', 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
                  'record_location', '0',
                  'transcode', true) || config
 where key = 'hikvision';

-- Consoles see bookings and hand-backs as they happen.
do $$
begin
  alter publication supabase_realtime add table public.bodycams;
exception when duplicate_object then null;
          when undefined_object then null;
end $$;

-- ── 11. Who may call what ───────────────────────────────────────────────────

revoke all on function public.can_manage_bodycams(public.silo) from public, anon;
revoke all on function public.can_watch_bodycam(public.silo, text) from public, anon;
revoke all on function public.start_bodycam_view(uuid, text, uuid, text, text, timestamptz, timestamptz) from public, anon;
revoke all on function public.touch_bodycam_view(uuid) from public, anon;
revoke all on function public.end_bodycam_view(uuid, text) from public, anon;
revoke all on function public.bodycam_watch_status() from public, anon;
revoke all on function public.shift_requires_bodycam() from public, anon;
revoke all on function public.shift_bodycam_resolved_today() from public, anon;
revoke all on function public.book_out_bodycam(uuid, boolean, boolean, boolean, text) from public, anon;
revoke all on function public.declare_shift_no_bodycam(text) from public, anon;
revoke all on function public.return_bodycam(uuid, text, text) from public, anon;
revoke all on function public.receive_bodycam(uuid, text, text) from public, anon;
revoke all on function public.set_bodycam_status(uuid, text, text) from public, anon;
revoke all on function public.import_bodycams(jsonb, text, text, text) from public, anon;
revoke all on function public.end_shift(int, text) from public, anon;
revoke all on function public.cleanup_on_logout() from public, anon;
grant execute on function public.can_manage_bodycams(public.silo) to authenticated;
grant execute on function public.can_watch_bodycam(public.silo, text) to authenticated;
grant execute on function public.start_bodycam_view(uuid, text, uuid, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.touch_bodycam_view(uuid) to authenticated;
grant execute on function public.end_bodycam_view(uuid, text) to authenticated;
grant execute on function public.bodycam_watch_status() to authenticated;
grant execute on function public.shift_requires_bodycam() to authenticated;
grant execute on function public.shift_bodycam_resolved_today() to authenticated;
grant execute on function public.has_completed_shift_start_today() to authenticated;
grant execute on function public.book_out_bodycam(uuid, boolean, boolean, boolean, text) to authenticated;
grant execute on function public.declare_shift_no_bodycam(text) to authenticated;
grant execute on function public.return_bodycam(uuid, text, text) to authenticated;
grant execute on function public.receive_bodycam(uuid, text, text) to authenticated;
grant execute on function public.set_bodycam_status(uuid, text, text) to authenticated;
grant execute on function public.import_bodycams(jsonb, text, text, text) to authenticated;
grant execute on function public.end_shift(int, text) to authenticated;
grant execute on function public.cleanup_on_logout() to authenticated;

-- ── 12. Prove it ────────────────────────────────────────────────────────────

do $$
declare
  v_bad text;
begin
  select string_agg(distinct c.table_name, ', ') into v_bad
    from information_schema.columns c
    join pg_tables pt on pt.schemaname = 'public' and pt.tablename = c.table_name
   where c.table_schema = 'public' and c.column_name = 'tenant_id'
     and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = c.table_name
                        and p.policyname = 'tenant_isolation' and p.permissive = 'RESTRICTIVE');
  if v_bad is not null then
    raise exception 'No tenant wall on: % — nothing was changed', v_bad;
  end if;
  select string_agg(tablename || '.' || policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'public'
     and tablename in ('bodycam_bookings', 'shift_no_bodycam_declarations', 'bodycam_views')
     and permissive = 'PERMISSIVE' and cmd <> 'SELECT';
  if v_bad is not null then
    raise exception 'Write policies found on %: nothing was changed', v_bad;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
