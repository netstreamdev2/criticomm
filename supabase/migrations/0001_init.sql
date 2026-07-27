-- =====================================================================
-- Criticom V5 — Initial schema
-- Every entity from V4 (controllers + EF models) translated to Postgres.
-- Tenant isolation: `silo` enum column on every shared table; RLS in 0002.
-- =====================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "postgis"; -- for proper geo queries on incidents/personnel/hydrants/cameras

-- ─────────────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────────────
create type silo as enum (
  'Ethekwini',          -- master / global (dispatchers, control room, sys admin)
  'MetroPolice',
  'MetroFire',
  'Medical',
  'EthekwiniDisaster'
);

create type user_role as enum (
  'SystemAdmin', 'SuperAdmin', 'Admin', 'Supervisor',
  'Dispatcher', 'Operator', 'ControlRoom', 'IncidentLogger', 'Viewer', 'System',
  'Captain', 'Police', 'Officer', 'Metro', 'Security',
  'Chief', 'FireChief', 'Firefighter',
  'Paramedic', 'Doctor',
  'Disaster',
  'CaseManager',
  'Citizen'
);

create type incident_status as enum (
  'New', 'Pending', 'Pending Dispatch', 'Pending Analysis',
  'Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting', 'Active',
  'Closed', 'Resolved'
);

create type incident_severity as enum ('Low','Medium','High','Critical');

create type apparatus_status as enum (
  'Available', 'In Use', 'En Route', 'On Scene', 'Out of Service', 'Maintenance', 'Decommissioned'
);

create type hydrant_status as enum ('Operational', 'Out of Service', 'Maintenance Required');

-- ─────────────────────────────────────────────────────────────────────
-- PROFILES — extends auth.users
-- ─────────────────────────────────────────────────────────────────────
create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  silo                silo not null default 'Ethekwini',
  role                user_role not null default 'Viewer',
  full_name           text,
  badge_number        text,
  rank                text,
  station             text,
  platoon             text,
  call_sign           text unique,
  hardware_uuid       text,
  emergency_contact   text,
  contact_number      text,
  email               text,
  profile_picture_url text,
  is_on_duty          boolean not null default false,
  last_login          timestamptz,
  total_incidents     int not null default 0,
  notes               text,
  status              text default 'Active',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on public.profiles(silo);
create index on public.profiles(role);
create index on public.profiles(is_on_duty) where is_on_duty;

-- ─────────────────────────────────────────────────────────────────────
-- APPARATUS — vehicles + units (per silo)
-- ─────────────────────────────────────────────────────────────────────
create table public.apparatus (
  id              uuid primary key default uuid_generate_v4(),
  silo            silo not null,
  unit_number     text not null,
  name            text not null,
  type            text not null,
  make            text,
  model           text,
  year            int,
  license_plate   text,
  vin             text,
  mileage         int not null default 0,
  status          apparatus_status not null default 'Available',
  station_number  text,
  department_name text,
  disc_expiry     date,
  fuel_type       text,
  fuel_level      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (silo, unit_number)
);
create index on public.apparatus(silo);
create index on public.apparatus(silo, status);

-- ─────────────────────────────────────────────────────────────────────
-- PERSONNEL — operational staff (per silo). Joins to profiles 1:1.
-- ─────────────────────────────────────────────────────────────────────
create table public.personnel (
  id                  uuid primary key default uuid_generate_v4(),
  silo                silo not null,
  user_id             uuid references auth.users(id) on delete set null,
  first_name          text not null,
  last_name           text not null,
  badge_number        text not null,
  rank                text not null,
  role_id             text,
  unit                text,
  assigned_apparatus_id uuid references public.apparatus(id) on delete set null,
  latitude            double precision,
  longitude           double precision,
  location            geography(point, 4326), -- generated from lat/lng via trigger
  is_on_duty          boolean not null default false,
  last_login          timestamptz,
  station             text,
  platoon             text,
  emergency_contact   text,
  profile_picture_url text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on public.personnel(silo);
create index on public.personnel(user_id);
create index on public.personnel(silo, is_on_duty) where is_on_duty;
create index on public.personnel using gist(location);

-- ─────────────────────────────────────────────────────────────────────
-- DEVICES — mobile data terminals, radios, tablets
-- ─────────────────────────────────────────────────────────────────────
create table public.devices (
  id               uuid primary key default uuid_generate_v4(),
  silo             silo not null,
  device_id        text not null,
  device_type      text,
  model            text,
  assigned_station text,
  is_active        boolean not null default true,
  enrolled_date    timestamptz not null default now(),
  unique (silo, device_id)
);
create index on public.devices(silo);

-- ─────────────────────────────────────────────────────────────────────
-- INCIDENTS — the heart of the system. Replaces the V4 master+silo-copy pattern.
-- A single row per incident; `dispatched_silos` records the multi-silo broadcast list.
-- ─────────────────────────────────────────────────────────────────────
create table public.incidents (
  id                  uuid primary key default uuid_generate_v4(),
  silo                silo not null,                -- silo that "owns" the incident
  dispatched_silos    silo[] not null default '{}', -- when supervisor broadcasts to multiple
  incident_number     text not null,                -- formerly IncidentId, e.g. INC-20260603-123
  source              text not null default 'Master', -- 'Master', 'DisasterLogger', 'Police-Field', etc.

  -- Caller
  caller_name         text not null,
  caller_number       text not null,
  caller_location     text,
  is_caller_patient   boolean,
  patient_name        text,

  -- Description
  call_description    text not null,
  notes               text,

  -- Classification
  incident_type       text not null,
  incident_severity   incident_severity not null default 'Medium',
  fire_incident_type  text,
  medical_type        text,
  disaster_type       text,

  -- Location
  location_address    text not null,
  suburb              text,
  city                text,
  postal_code         text,
  location_lat        double precision not null,
  location_lng        double precision not null,
  location_point      geography(point, 4326), -- generated via trigger from lat/lng

  -- Lifecycle / workflow
  status              incident_status not null default 'Pending Dispatch',
  call_timestamp      timestamptz not null default now(),
  incident_created_at timestamptz not null default now(),
  dispatch_time       timestamptz,
  arrived_timestamp   timestamptz,
  closed_at           timestamptz,

  -- Assignment
  unit_id             uuid references public.apparatus(id) on delete set null,
  unit_type           text,  -- "BroadcastAll" or comma list "Fire,Police"
  unit_status         text,
  responding_officer  text,
  acceptance          boolean not null default false,

  -- Victims
  number_of_victims   int,

  -- Audit
  created_by          uuid references auth.users(id) on delete set null,
  updated_at          timestamptz not null default now(),

  unique (silo, incident_number)
);
create index on public.incidents(silo);
create index on public.incidents(silo, status);
create index on public.incidents(silo, status, incident_created_at desc);
create index on public.incidents(unit_id);
create index on public.incidents(incident_number);
create index on public.incidents(caller_number, call_timestamp); -- duplicate detection
create index on public.incidents using gist(location_point);

-- ─────────────────────────────────────────────────────────────────────
-- INCIDENT_UPDATES — chronological log of dispatcher/responder notes
-- ─────────────────────────────────────────────────────────────────────
create table public.incident_updates (
  id           uuid primary key default uuid_generate_v4(),
  silo         silo not null,
  incident_id  uuid not null references public.incidents(id) on delete cascade,
  message      text not null,
  created_by   uuid references auth.users(id) on delete set null,
  created_by_name text,
  timestamp    timestamptz not null default now()
);
create index on public.incident_updates(incident_id, timestamp desc);
create index on public.incident_updates(silo);

-- ─────────────────────────────────────────────────────────────────────
-- INCIDENT_ATTACHMENTS — replaces V4's pattern of encoding URLs into log messages
-- ─────────────────────────────────────────────────────────────────────
create table public.incident_attachments (
  id           uuid primary key default uuid_generate_v4(),
  silo         silo not null,
  incident_id  uuid not null references public.incidents(id) on delete cascade,
  storage_path text not null,         -- path within Supabase Storage 'incident-media' bucket
  kind         text not null,         -- 'image' | 'audio' | 'video' | 'document'
  content_type text,
  size_bytes   bigint,
  uploaded_by  uuid references auth.users(id) on delete set null,
  uploaded_by_name text,
  caption      text,
  created_at   timestamptz not null default now()
);
create index on public.incident_attachments(incident_id);

-- ─────────────────────────────────────────────────────────────────────
-- NOTIFICATIONS — operator-readable alerts (separate from auth.notifications)
-- ─────────────────────────────────────────────────────────────────────
create table public.notifications (
  id             uuid primary key default uuid_generate_v4(),
  silo           silo not null,
  arrived        text,
  unit_type      text,
  responder_name text,
  location       text,
  time           text,
  created_at     timestamptz not null default now()
);
create index on public.notifications(silo, created_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- AUDIT_LOGS
-- ─────────────────────────────────────────────────────────────────────
create table public.audit_logs (
  id          uuid primary key default uuid_generate_v4(),
  silo        silo not null,
  timestamp   timestamptz not null default now(),
  user_id     uuid references auth.users(id) on delete set null,
  user_name   text,
  department  text,
  action_type text not null,
  entity_type text,
  entity_id   text,
  details     text
);
create index on public.audit_logs(silo, timestamp desc);
create index on public.audit_logs(user_id);

-- ─────────────────────────────────────────────────────────────────────
-- SHIFT / ROSTER
-- ─────────────────────────────────────────────────────────────────────
create table public.shifts (
  id                          uuid primary key default uuid_generate_v4(),
  silo                        silo not null,
  shift_name                  text not null,
  activity_type               text,
  start_time                  timestamptz not null,
  end_time                    timestamptz not null,
  description                 text,
  department                  text,
  created_by_supervisor_name  text,
  created_at                  timestamptz not null default now()
);
create index on public.shifts(silo, start_time);

create table public.rosters (
  id                          uuid primary key default uuid_generate_v4(),
  silo                        silo not null,
  user_id                     uuid not null references auth.users(id) on delete cascade,
  user_name                   text not null,
  badge_number                text,
  shift_id                    uuid references public.shifts(id) on delete cascade,
  station                     text not null,
  activity_type               text not null,
  description                 text,
  created_by_supervisor_id    text,
  created_by_supervisor_name  text,
  created_at                  timestamptz not null default now()
);
create index on public.rosters(silo, shift_id);
create index on public.rosters(user_id);

-- ─────────────────────────────────────────────────────────────────────
-- START-OF-SHIFT WORKFLOW
-- ─────────────────────────────────────────────────────────────────────
create table public.mental_checks (
  id                    uuid primary key default uuid_generate_v4(),
  silo                  silo not null,
  user_id               uuid not null references auth.users(id) on delete cascade,
  timestamp             timestamptz not null default now(),
  memory_recall         boolean not null,
  judgment              boolean not null,
  situational_awareness boolean not null,
  not_under_influence   boolean not null,
  anger_check           boolean not null,
  reflexes              boolean not null,
  comments              text
);
create index on public.mental_checks(silo, user_id, timestamp desc);

create table public.vehicle_checklists (
  id                  uuid primary key default uuid_generate_v4(),
  silo                silo not null,
  user_id             uuid not null references auth.users(id) on delete cascade,
  apparatus_id        uuid not null references public.apparatus(id) on delete cascade,
  checked_at          timestamptz not null default now(),
  fuel_level          text not null,
  lights_functional   boolean not null,
  tires_condition_ok  boolean not null,
  equipment_stocked   boolean not null,
  comms_working       boolean not null,
  brakes_responsive   boolean not null
);
create index on public.vehicle_checklists(silo, user_id, checked_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- TRAINING & CERTIFICATIONS
-- ─────────────────────────────────────────────────────────────────────
create table public.training_records (
  id              uuid primary key default uuid_generate_v4(),
  silo            silo not null,
  personnel_id    uuid not null references public.personnel(id) on delete cascade,
  training_name   text not null,
  date_completed  date not null,
  notes_learned   text
);
create index on public.training_records(silo, personnel_id);

create table public.certifications (
  id              uuid primary key default uuid_generate_v4(),
  silo            silo not null,
  personnel_id    uuid not null references public.personnel(id) on delete cascade,
  name            text not null,
  expiry_date     date not null,
  issued_by       text,
  date_achieved   date,
  remarks         text,
  file_path       text                  -- Supabase Storage path in 'certifications' bucket
);
create index on public.certifications(silo, personnel_id, expiry_date);

-- ─────────────────────────────────────────────────────────────────────
-- POLICE — Metro reports, offenses, firearm authorizations
-- ─────────────────────────────────────────────────────────────────────
create table public.metro_reports (
  id                   uuid primary key default uuid_generate_v4(),
  silo                 silo not null default 'MetroPolice',
  incident_id          uuid references public.incidents(id) on delete set null,
  case_number          text,
  date_of_offense      date not null default current_date,
  time_of_offense      text,
  location             text,
  station              text,
  incident_category    text,
  officer_name         text,
  officer_narrative    text,
  ticket_number        text,
  offender_name        text,
  offender_id          text,
  vehicle_make         text,
  license_plate        text,
  vin_number           text,
  fine_amount          numeric(10,2),
  vehicle_impounded    text not null default 'No',
  dispatch_time        text,
  arrival_time         text,
  clear_time           text,
  total_time           text,
  arrest_made          text,
  suspect_name         text,
  suspect_description  text,
  charges              text,
  victim_name          text,
  victim_contact       text,
  victim_id            text,
  victim_injuries      text,
  reg_number           text,
  impound_lot          text,
  evidence_weapons     boolean not null default false,
  evidence_drugs       boolean not null default false,
  evidence_property    boolean not null default false,
  evidence_log         text,
  badge_number         text,
  partner_name         text,
  victims_json         jsonb not null default '[]'::jsonb,
  contraband_seized    text,
  ammunition_rounds    int not null default 0,
  bodycam_active       text,
  use_of_force         text,
  weapon_type          text,
  weapon_size          text,
  contraband_details   text,
  created_at           timestamptz not null default now()
);
create index on public.metro_reports(silo);
create index on public.metro_reports(case_number);
create index on public.metro_reports(incident_id);

create table public.metro_offenses (
  id             uuid primary key default uuid_generate_v4(),
  silo           silo not null default 'MetroPolice',
  metro_id       uuid not null references public.metro_reports(id) on delete cascade,
  offense_type   text not null,
  fine_amount    int not null
);
create index on public.metro_offenses(metro_id);

create table public.firearm_authorizations (
  id                uuid primary key default uuid_generate_v4(),
  silo              silo not null default 'MetroPolice',
  user_id           uuid references auth.users(id) on delete set null,
  form_number       text not null unique,
  employee_name     text not null,
  company_number    text,
  id_number         text not null,
  firearm_number    text not null,
  make              text,
  rounds_ammunition int not null default 0,
  from_date         timestamptz not null,
  to_date           timestamptz not null,
  posted_location   text,
  issued_by         text,
  received_by       text,
  rounds_returned   int not null default 0,
  date_received     timestamptz,
  signature         text,
  condition         text,
  chamber_status    text,
  notes             text,
  created_at        timestamptz not null default now()
);
create index on public.firearm_authorizations(silo, employee_name);
create index on public.firearm_authorizations(silo, from_date desc);

-- ─────────────────────────────────────────────────────────────────────
-- FIRE — firefighter reports + public-incident reports + hydrants
-- ─────────────────────────────────────────────────────────────────────
create table public.firefighter_reports (
  id                              uuid primary key default uuid_generate_v4(),
  silo                            silo not null default 'MetroFire',
  incident_id                     uuid references public.incidents(id) on delete set null,
  apparatus_id                    uuid references public.apparatus(id) on delete set null,
  report_number                   text not null,
  date_of_incident                date not null,
  time_of_incident                time not null,
  location                        text,
  type_of_incident                text,
  -- Timings (V4 stored as long seconds; V5 keeps interval for ergonomics)
  dispatch_time_seconds           bigint not null default 0,
  arrival_time_seconds            bigint not null default 0,
  clear_time_seconds              bigint not null default 0,
  total_time_on_scene_seconds     bigint not null default 0,
  fire_department_name            text,
  station_number                  text,
  narrative_summary               text,
  initial_observations            text,
  smoke_conditions                text,
  flame_spread                    text,
  heat_signature                  text,
  victims_json                    jsonb not null default '[]'::jsonb,
  hazards_identified              text,
  fire_suppression_details        text,
  search_and_rescue_performed     boolean not null default false,
  persons_rescued                 int not null default 0,
  rescue_location                 text,
  rescue_condition                text,
  ventilation_conducted           boolean not null default false,
  ventilation_type                text,
  salvage_overhaul                boolean not null default false,
  hazmat_operations               boolean not null default false,
  hazmat_description              text,
  medical_aid_provided            boolean not null default false,
  medical_aid_description         text,
  utilities_secured               boolean not null default false,
  utility_details                 text,
  point_of_origin_room            text,
  point_of_origin_object          text,
  ignition_source                 text,
  fire_cause                      text,
  fire_investigation_conducted    boolean not null default false,
  fire_investigation_reason       text,
  property_type                   text,
  property_owner                  text,
  property_contact                text,
  property_value                  numeric(14,2) not null default 0,
  damage_estimate                 numeric(14,2) not null default 0,
  contents_value                  numeric(14,2) not null default 0,
  insurance_info                  text,
  photos_attached                 boolean not null default false,
  no_photo_reason                 text,
  civilian_injuries               int not null default 0,
  civilian_injury_details         text,
  civilian_fatalities             int not null default 0,
  civilian_fatality_details       text,
  firefighter_injuries            int not null default 0,
  firefighter_injury_details      text,
  firefighter_fatalities          int not null default 0,
  firefighter_fatality_details    text,
  treatment_provided              boolean not null default false,
  treatment_details               text,
  other_agencies_on_scene         text,
  mutual_aid_used                 boolean not null default false,
  equipment_used                  text,
  challenges_faced                text,
  successes                       text,
  recommendations                 text,
  post_incident_critique_scheduled boolean not null default false,
  reporting_officer_name          text,
  reporting_officer_rank          text,
  reporting_officer_id            text,
  report_submission_date          timestamptz not null default now(),
  supervisor_name                 text,
  supervisor_rank                 text,
  supervisor_review_date          timestamptz
);
create index on public.firefighter_reports(silo, date_of_incident desc);
create index on public.firefighter_reports(report_number);
create index on public.firefighter_reports(incident_id);

create table public.public_incident_reports (
  id                            uuid primary key default uuid_generate_v4(),
  silo                          silo not null default 'MetroFire',
  firefighter_report_id         uuid not null references public.firefighter_reports(id) on delete cascade,
  public_report_number          text not null unique,
  date_of_incident              date not null,
  time_of_incident              time not null,
  fire_department_name          text,
  station_number                text,
  incident_type                 text,
  public_location               text not null,
  public_summary                text not null,
  damage_assessment             text,
  cause_summary                 text,
  actions_taken                 text,
  public_safety_advisory        text,
  total_civilian_injuries       int not null default 0,
  total_civilian_fatalities     int not null default 0,
  total_responder_injuries      int not null default 0,
  total_responder_fatalities    int not null default 0,
  published_date                timestamptz not null default now(),
  authorizing_officer_name      text not null,
  authorizing_officer_id        text
);
create index on public.public_incident_reports(silo);

create table public.hydrants (
  id              uuid primary key default uuid_generate_v4(),
  silo            silo not null default 'MetroFire',
  location_name   text not null,
  latitude        double precision not null,
  longitude       double precision not null,
  location_point  geography(point, 4326),
  status          hydrant_status not null default 'Operational',
  last_inspected  timestamptz not null default now()
);
create index on public.hydrants using gist(location_point);
create index on public.hydrants(silo);

-- ─────────────────────────────────────────────────────────────────────
-- MEDICAL — patient care reports + nested clinical data
-- ─────────────────────────────────────────────────────────────────────
create table public.medical_histories (
  id                   uuid primary key default uuid_generate_v4(),
  silo                 silo not null default 'Medical',
  patient_id           text,
  allergies            text,           -- encrypted via pgcrypto in future migration
  chronic_conditions   text,
  medications          text
);

create table public.assessment_findings (
  id                uuid primary key default uuid_generate_v4(),
  silo              silo not null default 'Medical',
  primary_survey    text,
  secondary_survey  text,
  head_neck         text,
  chest             text,
  abdomen           text,
  pelvis            text,
  extremities       text,
  back              text,
  neuro             text
);

create table public.vital_signs (
  id                  uuid primary key default uuid_generate_v4(),
  silo                silo not null default 'Medical',
  blood_pressure      text,
  pulse_rate          text,
  respiratory_rate    text,
  oxygen_saturation   text,
  glasgow_coma_scale  text,
  blood_glucose_level text,
  temperature         text,
  ecg                 text
);

create table public.interventions (
  id                       uuid primary key default uuid_generate_v4(),
  silo                     silo not null default 'Medical',
  airway_management        text,
  ventilation_support      text,
  circulation_management   text,
  wound_care               text,
  splinting                text,
  medication_admin         text,
  other                    text
);

create table public.paramedic_reports (
  id                              uuid primary key default uuid_generate_v4(),
  silo                            silo not null default 'Medical',
  incident_id                     uuid references public.incidents(id) on delete set null,

  -- Patient
  patient_name                    text,
  date_of_birth                   date,
  gender                          text,
  address                         text,
  contact_number                  text,
  insurance_information           text,
  next_of_kin                     text,
  allergies                       text,
  weight                          text,
  identification_number           text,        -- encrypted in future migration
  age                             int,
  language                        text,
  income                          text,
  has_insurance                   text,

  -- Nested 1:1 references (FKs to the standalone tables)
  medical_history_id              uuid references public.medical_histories(id) on delete set null,
  assessment_id                   uuid references public.assessment_findings(id) on delete set null,
  vitals_id                       uuid references public.vital_signs(id) on delete set null,
  interventions_id                uuid references public.interventions(id) on delete set null,

  -- Incident
  incident_location               text,
  time_of_arrival                 timestamptz,
  mechanism_of_injury             text,
  scene_assessment                text,
  destination_hospital            text,
  transport_mode                  text,
  eta                             timestamptz,
  level_of_care                   text,

  -- Crew & narrative
  paramedic_names                 text,
  paramedic_ids                   text,
  departure_time                  timestamptz,
  arrival_time                    timestamptz,
  treatment_narrative             text,
  patient_response                text,
  secondary_patients_json         jsonb not null default '[]'::jsonb,

  -- Clinical
  chief_complaint                 text,
  nature_of_illness               text,
  presenting_problem              text,
  current_medications             text,
  risk_of_harm                    text,
  protocol_adherence              boolean not null default false,

  -- Psychological
  psych_danger_to_self_or_others  boolean not null default false,
  psych_health_risk               boolean not null default false,
  psych_believes_health_risk      boolean not null default false,
  psych_believes_danger           boolean not null default false,

  -- Neurological / Vitals (loose fields V4 stored on Paramedic directly)
  pulse_waveform                  text,
  body_temperature                text,
  end_tidal_co2                   text,
  level_of_consciousness          text,
  alert_and_oriented              text,
  gcs_eye                         text,
  gcs_verbal                      text,
  gcs_motor                       text,
  stroke_assessment               text,
  pain_scale                      int,
  pupils                          text,

  -- Skin
  skin_unremarkable               boolean not null default false,
  skin_cool                       boolean not null default false,
  skin_pale                       boolean not null default false,
  skin_diaphoretic                boolean not null default false,
  skin_cyanotic                   boolean not null default false,
  skin_moist                      boolean not null default false,
  skin_flush                      boolean not null default false,
  skin_dry                        boolean not null default false,

  -- Medications
  medication_time                 time,
  medication_dosage               text,
  medication_route                text,
  medication_comments             text,

  -- Inventory
  inv_oxygen                      boolean not null default false,
  inv_bvm                         boolean not null default false,
  inv_suction                     boolean not null default false,
  inv_iv                          boolean not null default false,
  inv_bandages                    boolean not null default false,
  inv_aed                         boolean not null default false,
  inv_drugs                       boolean not null default false,
  inv_sharps                      boolean not null default false,
  inv_ppe                         boolean not null default false,

  -- Signatures (base64 PNGs)
  responder_signature_image_base64           text,
  hospital_representative_signature_base64   text,
  doctor_signature_image_base64              text,

  requires_cleaning                          boolean not null default false,

  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);
create index on public.paramedic_reports(silo, time_of_arrival desc);
create index on public.paramedic_reports(incident_id);

create table public.legal_handovers (
  id                            uuid primary key default uuid_generate_v4(),
  silo                          silo not null default 'Medical',
  incident_id                   uuid not null references public.incidents(id) on delete cascade,
  receiving_hosp                text not null,
  doctor_name                   text not null,
  signature_base64              text,
  time_of_handover              timestamptz not null default now(),
  patient_status_at_handover    text
);

create table public.ambulance_restocks (
  id              uuid primary key default uuid_generate_v4(),
  silo            silo not null default 'Medical',
  unit_id         uuid not null references public.apparatus(id) on delete cascade,
  drug_name       text not null,
  qty_used        int not null default 0,
  qty_remaining   int not null default 0,
  last_checked_by text not null,
  restock_date    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────
-- DISASTER — logs, post-mortem reports, mutual-aid partners, relief stock
-- ─────────────────────────────────────────────────────────────────────
create table public.disaster_logs (
  id                  uuid primary key default uuid_generate_v4(),
  silo                silo not null default 'EthekwiniDisaster',
  incident_id         uuid references public.incidents(id) on delete set null,
  incident_number     text not null,
  incident_type       text not null,
  location            text not null,
  description         text not null,
  resource_type       text not null,
  dispatch_timestamp  timestamptz not null default now(),
  updates             jsonb not null default '[]'::jsonb  -- list of {timestamp,text}
);
create index on public.disaster_logs(silo, incident_number);

create table public.post_mortem_reports (
  id                     uuid primary key default uuid_generate_v4(),
  silo                   silo not null default 'EthekwiniDisaster',
  incident_id            uuid references public.incidents(id) on delete set null,
  incident_number        text not null,
  incident_type          text,
  location               text,
  start_time             timestamptz,
  end_time               timestamptz,
  total_duration_hours   numeric(8,2),
  injuries               int not null default 0,
  fatalities             int not null default 0,
  displaced_people       int not null default 0,
  root_cause             text,
  lessons_learned        text,
  timeline_snapshot      jsonb,
  reporting_officer      text,
  report_filed_at        timestamptz not null default now()
);
create index on public.post_mortem_reports(silo, incident_number);

create table public.relief_stocks (
  id                    uuid primary key default uuid_generate_v4(),
  silo                  silo not null default 'EthekwiniDisaster',
  item_name             text not null,
  category              text,
  quantity              int not null,
  unit_of_measure       text,
  last_inventory_check  timestamptz not null default now()
);

create table public.mutual_aid_partners (
  id               uuid primary key default uuid_generate_v4(),
  silo             silo not null default 'EthekwiniDisaster',
  agency_name      text not null,
  resource_type    text not null,
  contact_number   text,
  radio_frequency  text,
  commander_name   text,
  is_active        boolean not null default true
);
create index on public.mutual_aid_partners(resource_type, is_active);

-- ─────────────────────────────────────────────────────────────────────
-- CAMERAS (CCTV imports)
-- ─────────────────────────────────────────────────────────────────────
create table public.cameras (
  id                  text primary key,        -- external camera ID
  silo                silo not null default 'Ethekwini',
  latitude            double precision,
  longitude           double precision,
  location_point      geography(point, 4326),
  name                text,
  direction_of_travel text,
  roadway_name        text,
  url                 text,
  disabled            boolean not null default false,
  blocked             boolean not null default false,
  imported_at         timestamptz not null default now()
);
create index on public.cameras using gist(location_point);

-- ─────────────────────────────────────────────────────────────────────
-- SECURITY (private guard incident reports — V4 has a Security model)
-- ─────────────────────────────────────────────────────────────────────
create table public.security_reports (
  id                          uuid primary key default uuid_generate_v4(),
  silo                        silo not null default 'MetroPolice',
  guard_name                  text not null,
  guard_id                    text,
  badge_number                text,
  contact_number              text,
  id_number                   text,
  sira_number                 text,
  sira_grade                  text,
  firearm_issued              boolean not null default false,
  firearm_number              text,
  gps_arrival_time            timestamptz,
  gps_departure_time          timestamptz,
  location                    text,
  latitude                    double precision,
  longitude                   double precision,
  location_point              geography(point, 4326),
  zone_code                   text,
  weather_conditions          text,
  lighting_conditions         text,
  incident_type               text not null,
  incident_code               text,
  incident_description        text,
  severity_level              text,
  incident_start_time         timestamptz not null,
  incident_end_time           timestamptz,
  witness_names               jsonb,
  suspect_descriptions        jsonb,
  injured_parties             jsonb,
  authorized_personnel_on_site jsonb,
  vehicle_descriptions        jsonb,
  vehicle_plate_numbers       jsonb,
  actions_taken               text,
  equipment_used              text,
  body_cam_footage_path       text,
  photo_evidence_paths        jsonb,
  photo_evidence_base64       text,
  video_evidence_paths        jsonb,
  audio_evidence_paths        jsonb,
  authorities_notified        boolean not null default false,
  authorities_contacted       text,
  dispatch_operator_name      text,
  authorities_arrival_time    timestamptz,
  supervisor_name             text,
  supervisor_remarks          text,
  incident_reported_to        text,
  is_incident_resolved        boolean not null default false,
  resolution_time             timestamptz,
  resolution_summary          text,
  additional_notes            text,
  created_by                  text,
  report_created_at           timestamptz not null default now(),
  report_updated_at           timestamptz not null default now(),
  is_emergency                boolean not null default false,
  is_repeat_incident          boolean not null default false,
  previous_incident_reference text
);
create index on public.security_reports(silo, incident_start_time desc);

-- ─────────────────────────────────────────────────────────────────────
-- SYSTEM_PROFILES (operator dispatcher profile records)
-- ─────────────────────────────────────────────────────────────────────
create table public.system_profiles (
  id                       uuid primary key default uuid_generate_v4(),
  user_id                  uuid references auth.users(id) on delete cascade,
  first_name               text not null,
  last_name                text not null,
  badge_number             text,
  rank                     text,
  role                     text,
  call_sign                text unique,
  status                   text default 'Active',
  station                  text,
  platoon                  text,
  contact_number           text,
  email                    text,
  emergency_contact        text,
  profile_picture_url      text,
  is_on_duty               boolean not null default false,
  last_login               timestamptz,
  total_incidents_handled  int not null default 0,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────
-- LEAVE — V4 currently uses mock data; V5 stores it properly
-- ─────────────────────────────────────────────────────────────────────
create table public.leave_entries (
  id           uuid primary key default uuid_generate_v4(),
  silo         silo not null,
  user_id      uuid references auth.users(id) on delete cascade,
  leave_seq    text,
  staff        int,
  rank         text,
  force        int,
  service_no   text,
  eff_from     date not null,
  eff_to       date not null,
  absence      text,
  status       text not null,
  created_at   timestamptz not null default now()
);
create index on public.leave_entries(silo, user_id, eff_from);

-- ─────────────────────────────────────────────────────────────────────
-- CITIZEN PUBLIC GPS-SHARE TOKENS
-- ─────────────────────────────────────────────────────────────────────
create table public.citizen_share_tokens (
  token         text primary key,
  incident_id   uuid not null references public.incidents(id) on delete cascade,
  silo          silo not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '24 hours',
  used_at       timestamptz
);
create index on public.citizen_share_tokens(incident_id);

-- ─────────────────────────────────────────────────────────────────────
-- CRIME_STATS — loaded once from sapacr-2008-2023-v1.1.csv
-- ─────────────────────────────────────────────────────────────────────
create table public.crime_stats (
  id                      bigserial primary key,
  year                    text not null,
  station_name            text not null,
  local_municipality      text,
  district_municipality   text,
  latitude                double precision,
  longitude               double precision,
  location_point          geography(point, 4326),
  murder                  int default 0,
  carjacking              int default 0,
  burglary_residential    int default 0,
  robbery_residential     int default 0,
  drug_crime              int default 0,
  dui                     int default 0
);
create index on public.crime_stats(year);
create index on public.crime_stats(district_municipality);
create index on public.crime_stats using gist(location_point);

-- ─────────────────────────────────────────────────────────────────────
-- TRIGGERS — keep generated columns + updated_at in sync
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.tg_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create or replace function public.tg_set_location_point() returns trigger language plpgsql as $$
begin
  if (tg_table_name = 'incidents' and new.location_lat is not null and new.location_lng is not null) then
    new.location_point := st_setsrid(st_makepoint(new.location_lng, new.location_lat), 4326)::geography;
  elsif (tg_table_name in ('personnel','security_reports') and new.latitude is not null and new.longitude is not null) then
    new.location := st_setsrid(st_makepoint(new.longitude, new.latitude), 4326)::geography;
  elsif (tg_table_name in ('hydrants','cameras','crime_stats') and new.latitude is not null and new.longitude is not null) then
    new.location_point := st_setsrid(st_makepoint(new.longitude, new.latitude), 4326)::geography;
  end if;
  return new;
end $$;

create trigger trg_profiles_updated         before update on public.profiles         for each row execute function public.tg_set_updated_at();
create trigger trg_apparatus_updated        before update on public.apparatus        for each row execute function public.tg_set_updated_at();
create trigger trg_personnel_updated        before update on public.personnel        for each row execute function public.tg_set_updated_at();
create trigger trg_incidents_updated        before update on public.incidents        for each row execute function public.tg_set_updated_at();
create trigger trg_paramedic_updated        before update on public.paramedic_reports for each row execute function public.tg_set_updated_at();
create trigger trg_system_profile_updated   before update on public.system_profiles  for each row execute function public.tg_set_updated_at();

create trigger trg_incidents_geo            before insert or update on public.incidents       for each row execute function public.tg_set_location_point();
create trigger trg_personnel_geo            before insert or update on public.personnel       for each row execute function public.tg_set_location_point();
create trigger trg_security_geo             before insert or update on public.security_reports for each row execute function public.tg_set_location_point();
create trigger trg_hydrants_geo             before insert or update on public.hydrants        for each row execute function public.tg_set_location_point();
create trigger trg_cameras_geo              before insert or update on public.cameras         for each row execute function public.tg_set_location_point();
create trigger trg_crime_geo                before insert or update on public.crime_stats     for each row execute function public.tg_set_location_point();

-- ─────────────────────────────────────────────────────────────────────
-- HELPER FUNCTIONS — for RLS in next migration
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.current_silo() returns silo language sql stable as $$
  select coalesce(
    (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'silo'),
    (current_setting('request.jwt.claims', true)::jsonb -> 'user_metadata' ->> 'silo'),
    'Ethekwini'
  )::silo;
$$;

create or replace function public.app_role() returns user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_global() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('SystemAdmin','SuperAdmin','Dispatcher','Operator','ControlRoom','IncidentLogger','Viewer','System')
     from public.profiles where id = auth.uid()),
    false
  );
$$;

create or replace function public.role_in(variadic roles user_role[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = any(roles));
$$;
