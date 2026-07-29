-- =====================================================================
-- CRITICOM V5 — 0010
--   alerts              targeted, realtime pop-up notifications
--   alert_reads         per-user read receipts for silo-wide alerts
--   push_tokens         Expo push tokens for the responder app
--   integration_settings DB-backed config for the Admin → Integrations panel
-- =====================================================================

-- ── ALERTS ───────────────────────────────────────────────────────────
-- One row = one thing a human should be told about, right now.
-- target_user_id null  ⇒ everyone in `silo` (a department broadcast)
-- silo 'Ethekwini'     ⇒ global control room / dispatchers
create table if not exists public.alerts (
  id              uuid primary key default uuid_generate_v4(),
  silo            silo not null,
  target_user_id  uuid references auth.users (id) on delete cascade,
  kind            text not null default 'info',
    -- 'assignment' | 'incident_new' | 'incident_update' | 'broadcast' | 'system' | 'info'
  severity        text not null default 'Medium',        -- Low | Medium | High | Critical
  title           text not null,
  body            text,
  incident_id     uuid references public.incidents (id) on delete cascade,
  link            text,                                   -- in-app href
  -- 'toast'  quiet corner toast
  -- 'modal'  full-screen interrupt that must be acknowledged
  presentation    text not null default 'toast',
  requires_ack    boolean not null default false,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz
);

create index if not exists alerts_silo_created_idx on public.alerts (silo, created_at desc);
create index if not exists alerts_target_idx on public.alerts (target_user_id, created_at desc);
create index if not exists alerts_incident_idx on public.alerts (incident_id);

alter table public.alerts enable row level security;

-- You see an alert if it is addressed to you personally, or broadcast to your
-- silo, or you are global staff.
create policy alerts_read on public.alerts for select
  using (
    target_user_id = auth.uid()
    or (target_user_id is null and (silo = public.current_silo() or public.is_global()))
  );

-- Anyone who can dispatch or supervise may raise an alert; the app also raises
-- them automatically as a side effect of dispatching.
create policy alerts_write on public.alerts for insert
  with check (
    public.role_in(
      'Dispatcher','ControlRoom','Operator','IncidentLogger','Supervisor','Captain',
      'Chief','FireChief','CaseManager','Admin','SystemAdmin','SuperAdmin','System'
    )
  );

create policy alerts_update on public.alerts for update
  using (public.role_in('Supervisor','Captain','Chief','FireChief','Admin','SystemAdmin','SuperAdmin'))
  with check (public.role_in('Supervisor','Captain','Chief','FireChief','Admin','SystemAdmin','SuperAdmin'));

-- ── ALERT READ RECEIPTS ──────────────────────────────────────────────
-- Kept separate from `alerts` because one silo-wide alert is read by many
-- people at different times.
create table if not exists public.alert_reads (
  alert_id     uuid not null references public.alerts (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  read_at      timestamptz not null default now(),
  acknowledged boolean not null default false,
  primary key (alert_id, user_id)
);

create index if not exists alert_reads_user_idx on public.alert_reads (user_id, read_at desc);

alter table public.alert_reads enable row level security;

create policy alert_reads_own on public.alert_reads for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── PUSH TOKENS ──────────────────────────────────────────────────────
-- Expo push tokens, one row per device. Re-registering the same token for a
-- different user reassigns it (phones get handed between shifts).
create table if not exists public.push_tokens (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  token       text not null unique,
  platform    text,                     -- 'ios' | 'android'
  device_name text,
  silo        silo,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists push_tokens_user_idx on public.push_tokens (user_id);
create index if not exists push_tokens_silo_idx on public.push_tokens (silo);

alter table public.push_tokens enable row level security;

create policy push_tokens_own on public.push_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── INTEGRATION SETTINGS ─────────────────────────────────────────────
-- Non-secret configuration for third-party integrations. Secrets stay in
-- environment variables; this table records which integrations are switched
-- on, their endpoints, and operational parameters admins can tune.
create table if not exists public.integration_settings (
  key         text primary key,          -- 'gemini' | 'bulksms' | 'realptt' | …
  label       text not null,
  category    text not null default 'General',
  enabled     boolean not null default false,
  config      jsonb not null default '{}'::jsonb,
  last_tested_at     timestamptz,
  last_test_ok       boolean,
  last_test_message  text,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

alter table public.integration_settings enable row level security;

-- Readable by any authenticated user (the panel shows status to admins, and
-- feature flags are read by the app itself); writable only by system admins.
create policy integration_settings_read on public.integration_settings for select
  using (auth.role() = 'authenticated');

create policy integration_settings_write on public.integration_settings for all
  using (public.role_in('Admin','SystemAdmin','SuperAdmin'))
  with check (public.role_in('Admin','SystemAdmin','SuperAdmin'));

-- Seed the catalogue. `enabled` reflects intent; the panel cross-checks the
-- server for whether the matching credentials are actually present.
insert into public.integration_settings (key, label, category, enabled, config) values
  ('supabase',      'Supabase — database, auth, storage, realtime', 'Core',          true,  '{}'),
  ('gemini',        'Google Gemini — Criti AI assistant',           'AI',            true,  '{"model":"gemini-2.5-flash-lite","temperature":0.4}'),
  ('expo_push',     'Expo Push — responder app notifications',      'Notifications', true,  '{"critical_sound":true}'),
  ('bulksms',       'BulkSMS — citizen SMS + GPS requests',         'Notifications', false, '{"sender":"CRITICOM"}'),
  ('realptt',       'RealPTT — push-to-talk radio bridge',          'Comms',         false, '{"base_url":"https://api.realptt.com"}'),
  ('zoiper',        'Zoiper — softphone dial-out',                  'Comms',         true,  '{"scheme":"tel"}'),
  ('tomtom',        'TomTom — traffic incidents feed',              'External feeds',false, '{}'),
  ('flightradar24', 'FlightRadar24 — aircraft positions',           'External feeds',false, '{}'),
  ('ais',           'AIS — vessel positions (Durban harbour)',      'External feeds',false, '{}'),
  ('itraffic',      'i-Traffic — incident CSV import',              'External feeds',false, '{}'),
  ('openweather',   'Wind & weather — fire spread modelling',       'External feeds',false, '{}'),
  ('leaflet_esri',  'Esri World Imagery — map basemap',             'Mapping',       true,  '{"basemap":"satellite"}')
on conflict (key) do nothing;

-- ── REALTIME ─────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.alerts;

-- ── HELPER: fan an incident out to the departments it was routed to ──
-- Called by the dispatch console. Writes one silo-wide alert per target so
-- every screen in that department pops immediately, plus a control-room copy.
create or replace function public.raise_dispatch_alerts(
  p_incident_id uuid,
  p_silos       silo[],
  p_by_name     text default null
) returns integer
language plpgsql
security invoker
as $$
declare
  inc         public.incidents%rowtype;
  target      silo;
  inserted    integer := 0;
begin
  select * into inc from public.incidents where id = p_incident_id;
  if not found then
    raise exception 'incident % not found', p_incident_id;
  end if;

  foreach target in array p_silos loop
    insert into public.alerts (
      silo, kind, severity, title, body, incident_id, link,
      presentation, requires_ack, created_by, created_by_name
    ) values (
      target,
      'assignment',
      inc.incident_severity::text,
      format('%s dispatched to your department', inc.incident_number),
      format('%s · %s', inc.incident_type, inc.location_address),
      inc.id,
      format('/incidents/%s', inc.id),
      -- High and Critical calls interrupt; the rest are corner toasts.
      case when inc.incident_severity::text in ('High','Critical') then 'modal' else 'toast' end,
      inc.incident_severity::text in ('High','Critical'),
      auth.uid(),
      p_by_name
    );
    inserted := inserted + 1;
  end loop;

  return inserted;
end;
$$;

grant execute on function public.raise_dispatch_alerts(uuid, silo[], text) to authenticated;
