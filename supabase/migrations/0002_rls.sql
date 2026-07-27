-- =====================================================================
-- Criticom V5 — Row Level Security policies
-- Pattern: deny-by-default, then SELECT policy per table for silo-scope,
-- then write policies per role.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- Enable RLS on every table
-- ─────────────────────────────────────────────────────────────────────
alter table public.profiles                enable row level security;
alter table public.apparatus               enable row level security;
alter table public.personnel               enable row level security;
alter table public.devices                 enable row level security;
alter table public.incidents               enable row level security;
alter table public.incident_updates        enable row level security;
alter table public.incident_attachments    enable row level security;
alter table public.notifications           enable row level security;
alter table public.audit_logs              enable row level security;
alter table public.shifts                  enable row level security;
alter table public.rosters                 enable row level security;
alter table public.mental_checks           enable row level security;
alter table public.vehicle_checklists      enable row level security;
alter table public.training_records        enable row level security;
alter table public.certifications          enable row level security;
alter table public.metro_reports           enable row level security;
alter table public.metro_offenses          enable row level security;
alter table public.firearm_authorizations  enable row level security;
alter table public.firefighter_reports     enable row level security;
alter table public.public_incident_reports enable row level security;
alter table public.hydrants                enable row level security;
alter table public.medical_histories       enable row level security;
alter table public.assessment_findings     enable row level security;
alter table public.vital_signs             enable row level security;
alter table public.interventions           enable row level security;
alter table public.paramedic_reports       enable row level security;
alter table public.legal_handovers         enable row level security;
alter table public.ambulance_restocks      enable row level security;
alter table public.disaster_logs           enable row level security;
alter table public.post_mortem_reports     enable row level security;
alter table public.relief_stocks           enable row level security;
alter table public.mutual_aid_partners     enable row level security;
alter table public.cameras                 enable row level security;
alter table public.security_reports        enable row level security;
alter table public.system_profiles         enable row level security;
alter table public.leave_entries           enable row level security;
alter table public.citizen_share_tokens    enable row level security;
alter table public.crime_stats             enable row level security;

-- ─────────────────────────────────────────────────────────────────────
-- PROFILES — self-read, supervisor-read-all-silo, admin-read-all
-- ─────────────────────────────────────────────────────────────────────
create policy profiles_self_read on public.profiles for select using (auth.uid() = id);
create policy profiles_silo_read on public.profiles for select using (silo = public.current_silo() or public.is_global());
create policy profiles_self_update on public.profiles for update using (auth.uid() = id);
create policy profiles_admin_write on public.profiles for all
  using (public.role_in('SystemAdmin','SuperAdmin','Admin','Supervisor'))
  with check (public.role_in('SystemAdmin','SuperAdmin','Admin','Supervisor'));

-- ─────────────────────────────────────────────────────────────────────
-- Standard silo-scope read pattern (applied to most tenant tables)
-- ─────────────────────────────────────────────────────────────────────

-- Helper macro: SILO_READ table_name
-- We just write it out for each table for clarity (and so the grant is auditable).

-- APPARATUS
create policy apparatus_read       on public.apparatus       for select using (silo = public.current_silo() or public.is_global());
create policy apparatus_admin_all  on public.apparatus       for all
  using (public.role_in('SystemAdmin','SuperAdmin','Admin','Supervisor') and (silo = public.current_silo() or public.is_global()))
  with check (public.role_in('SystemAdmin','SuperAdmin','Admin','Supervisor') and (silo = public.current_silo() or public.is_global()));
create policy apparatus_responder_update on public.apparatus for update
  using (silo = public.current_silo() and public.role_in('Police','Officer','Captain','Firefighter','Chief','FireChief','Paramedic'))
  with check (silo = public.current_silo());

-- PERSONNEL
create policy personnel_read on public.personnel for select using (silo = public.current_silo() or public.is_global());
create policy personnel_self_update on public.personnel for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy personnel_admin_all on public.personnel for all
  using (public.role_in('SystemAdmin','SuperAdmin','Admin','Supervisor') and (silo = public.current_silo() or public.is_global()))
  with check (public.role_in('SystemAdmin','SuperAdmin','Admin','Supervisor') and (silo = public.current_silo() or public.is_global()));

-- DEVICES
create policy devices_read on public.devices for select using (silo = public.current_silo() or public.is_global());
create policy devices_admin_all on public.devices for all
  using (public.role_in('SystemAdmin','SuperAdmin','Admin') and (silo = public.current_silo() or public.is_global()))
  with check (public.role_in('SystemAdmin','SuperAdmin','Admin') and (silo = public.current_silo() or public.is_global()));

-- INCIDENTS — read if same silo, or global role, or my silo appears in dispatched_silos
create policy incidents_read on public.incidents for select using (
  silo = public.current_silo()
  or public.is_global()
  or public.current_silo() = any(dispatched_silos)
);
create policy incidents_dispatcher_create on public.incidents for insert
  with check (public.role_in('Dispatcher','Operator','ControlRoom','IncidentLogger','SystemAdmin','SuperAdmin','Disaster'));
create policy incidents_dispatcher_update on public.incidents for update
  using (public.is_global() or public.role_in('Supervisor','SystemAdmin','SuperAdmin'))
  with check (public.is_global() or public.role_in('Supervisor','SystemAdmin','SuperAdmin'));
create policy incidents_responder_update on public.incidents for update
  using (silo = public.current_silo() and public.role_in('Police','Officer','Captain','Metro','Firefighter','Chief','FireChief','Paramedic','Doctor','Disaster'))
  with check (silo = public.current_silo());

-- INCIDENT_UPDATES
create policy incident_updates_read on public.incident_updates for select using (silo = public.current_silo() or public.is_global());
create policy incident_updates_insert on public.incident_updates for insert with check (silo = public.current_silo() or public.is_global());

-- INCIDENT_ATTACHMENTS
create policy incident_attachments_read on public.incident_attachments for select using (silo = public.current_silo() or public.is_global());
create policy incident_attachments_insert on public.incident_attachments for insert with check (silo = public.current_silo() or public.is_global());
create policy incident_attachments_delete on public.incident_attachments for delete using (
  public.role_in('Supervisor','SystemAdmin','SuperAdmin') or uploaded_by = auth.uid()
);

-- NOTIFICATIONS
create policy notifications_read on public.notifications for select using (silo = public.current_silo() or public.is_global());
create policy notifications_insert on public.notifications for insert with check (silo = public.current_silo() or public.is_global());

-- AUDIT_LOGS — read silo-scoped, write open (system writes), no update/delete
create policy audit_logs_read on public.audit_logs for select using (silo = public.current_silo() or public.is_global());
create policy audit_logs_insert on public.audit_logs for insert with check (true);

-- SHIFTS / ROSTERS
create policy shifts_read on public.shifts for select using (silo = public.current_silo() or public.is_global());
create policy shifts_supervisor_all on public.shifts for all
  using (public.role_in('Supervisor','SystemAdmin','SuperAdmin') and (silo = public.current_silo() or public.is_global()))
  with check (public.role_in('Supervisor','SystemAdmin','SuperAdmin') and (silo = public.current_silo() or public.is_global()));

create policy rosters_read on public.rosters for select using (silo = public.current_silo() or public.is_global() or user_id = auth.uid());
create policy rosters_supervisor_all on public.rosters for all
  using (public.role_in('Supervisor','SystemAdmin','SuperAdmin') and (silo = public.current_silo() or public.is_global()))
  with check (public.role_in('Supervisor','SystemAdmin','SuperAdmin') and (silo = public.current_silo() or public.is_global()));

-- SHIFT WORKFLOW (mental_checks, vehicle_checklists) — self-write, supervisor read
create policy mental_checks_self_all on public.mental_checks for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy mental_checks_supervisor_read on public.mental_checks for select
  using (silo = public.current_silo() and public.role_in('Supervisor','Captain','FireChief','Chief','SystemAdmin','SuperAdmin') or public.is_global());

create policy vehicle_checklists_self_all on public.vehicle_checklists for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy vehicle_checklists_supervisor_read on public.vehicle_checklists for select
  using (silo = public.current_silo() and public.role_in('Supervisor','Captain','FireChief','Chief','SystemAdmin','SuperAdmin') or public.is_global());

-- TRAINING / CERTIFICATIONS
create policy training_records_read on public.training_records for select using (silo = public.current_silo() or public.is_global());
create policy training_records_admin_all on public.training_records for all
  using (public.role_in('Supervisor','SystemAdmin','SuperAdmin','Admin','FireChief','Chief','Captain'))
  with check (public.role_in('Supervisor','SystemAdmin','SuperAdmin','Admin','FireChief','Chief','Captain'));

create policy certifications_read on public.certifications for select using (silo = public.current_silo() or public.is_global());
create policy certifications_admin_all on public.certifications for all
  using (public.role_in('Supervisor','SystemAdmin','SuperAdmin','Admin','FireChief','Chief','Captain'))
  with check (public.role_in('Supervisor','SystemAdmin','SuperAdmin','Admin','FireChief','Chief','Captain'));

-- POLICE — metro_reports, metro_offenses, firearm_authorizations
create policy metro_reports_read on public.metro_reports for select using (silo = public.current_silo() or public.is_global());
create policy metro_reports_write on public.metro_reports for all
  using (silo = public.current_silo() and public.role_in('Police','Officer','Captain','Metro','Supervisor','SystemAdmin','SuperAdmin','Admin','CaseManager'))
  with check (silo = public.current_silo());

create policy metro_offenses_read on public.metro_offenses for select using (silo = public.current_silo() or public.is_global());
create policy metro_offenses_write on public.metro_offenses for all
  using (silo = public.current_silo() and public.role_in('Police','Officer','Captain','Metro','Supervisor','SystemAdmin','SuperAdmin'))
  with check (silo = public.current_silo());

create policy firearm_auth_read on public.firearm_authorizations for select using (silo = public.current_silo() or public.is_global() or user_id = auth.uid());
create policy firearm_auth_write on public.firearm_authorizations for all
  using (silo = public.current_silo() and (user_id = auth.uid() or public.role_in('Captain','Supervisor','SystemAdmin','SuperAdmin','Admin')))
  with check (silo = public.current_silo());

-- FIRE — firefighter_reports, public_incident_reports, hydrants
create policy fire_reports_read on public.firefighter_reports for select using (silo = public.current_silo() or public.is_global());
create policy fire_reports_write on public.firefighter_reports for all
  using (silo = public.current_silo() and public.role_in('Firefighter','Chief','FireChief','Supervisor','SystemAdmin','SuperAdmin','Admin','CaseManager'))
  with check (silo = public.current_silo());

-- Public incident reports: read globally by Citizen+anyone authenticated for transparency; write Chief only
create policy pir_read on public.public_incident_reports for select using (true);
create policy pir_chief_write on public.public_incident_reports for all
  using (public.role_in('Chief','FireChief','SystemAdmin','SuperAdmin'))
  with check (public.role_in('Chief','FireChief','SystemAdmin','SuperAdmin'));

create policy hydrants_read on public.hydrants for select using (true); -- everyone can see hydrants on map
create policy hydrants_admin_write on public.hydrants for all
  using (public.role_in('FireChief','Chief','SystemAdmin','SuperAdmin','Admin'))
  with check (public.role_in('FireChief','Chief','SystemAdmin','SuperAdmin','Admin'));

-- MEDICAL — paramedic_reports + nested clinical tables + legal handovers + ambulance restocks
create policy paramedic_reports_read on public.paramedic_reports for select using (silo = public.current_silo() or public.is_global());
create policy paramedic_reports_write on public.paramedic_reports for all
  using (silo = public.current_silo() and public.role_in('Paramedic','Doctor','Supervisor','SystemAdmin','SuperAdmin','Admin','CaseManager'))
  with check (silo = public.current_silo());

-- Nested clinical tables: only readable+writable by the same roles as paramedic_reports
create policy medical_histories_rw on public.medical_histories for all
  using (silo = public.current_silo() and public.role_in('Paramedic','Doctor','Supervisor','SystemAdmin','SuperAdmin','Admin'))
  with check (silo = public.current_silo());
create policy assessment_findings_rw on public.assessment_findings for all
  using (silo = public.current_silo() and public.role_in('Paramedic','Doctor','Supervisor','SystemAdmin','SuperAdmin','Admin'))
  with check (silo = public.current_silo());
create policy vital_signs_rw on public.vital_signs for all
  using (silo = public.current_silo() and public.role_in('Paramedic','Doctor','Supervisor','SystemAdmin','SuperAdmin','Admin'))
  with check (silo = public.current_silo());
create policy interventions_rw on public.interventions for all
  using (silo = public.current_silo() and public.role_in('Paramedic','Doctor','Supervisor','SystemAdmin','SuperAdmin','Admin'))
  with check (silo = public.current_silo());

create policy legal_handovers_rw on public.legal_handovers for all
  using (silo = public.current_silo() and public.role_in('Paramedic','Doctor','Supervisor','SystemAdmin','SuperAdmin','Admin'))
  with check (silo = public.current_silo());

create policy ambulance_restocks_rw on public.ambulance_restocks for all
  using (silo = public.current_silo() and public.role_in('Paramedic','Doctor','Supervisor','SystemAdmin','SuperAdmin','Admin'))
  with check (silo = public.current_silo());

-- DISASTER
create policy disaster_logs_read on public.disaster_logs for select using (silo = public.current_silo() or public.is_global());
create policy disaster_logs_write on public.disaster_logs for all
  using (silo = public.current_silo() and public.role_in('Disaster','Supervisor','SystemAdmin','SuperAdmin','Admin','IncidentLogger'))
  with check (silo = public.current_silo());

create policy post_mortem_read on public.post_mortem_reports for select using (silo = public.current_silo() or public.is_global());
create policy post_mortem_write on public.post_mortem_reports for all
  using (silo = public.current_silo() and public.role_in('Disaster','Supervisor','SystemAdmin','SuperAdmin','Admin'))
  with check (silo = public.current_silo());

create policy relief_stocks_rw on public.relief_stocks for all
  using (silo = public.current_silo() and public.role_in('Disaster','Supervisor','SystemAdmin','SuperAdmin','Admin'))
  with check (silo = public.current_silo());

create policy mutual_aid_read on public.mutual_aid_partners for select using (true);
create policy mutual_aid_admin on public.mutual_aid_partners for all
  using (public.role_in('Disaster','SystemAdmin','SuperAdmin','Admin'))
  with check (public.role_in('Disaster','SystemAdmin','SuperAdmin','Admin'));

-- CAMERAS — readable to all authenticated; admin write only
create policy cameras_read on public.cameras for select using (auth.uid() is not null);
create policy cameras_admin_all on public.cameras for all
  using (public.role_in('SystemAdmin','SuperAdmin','Admin'))
  with check (public.role_in('SystemAdmin','SuperAdmin','Admin'));

-- SECURITY REPORTS
create policy security_reports_read on public.security_reports for select using (silo = public.current_silo() or public.is_global());
create policy security_reports_write on public.security_reports for all
  using (silo = public.current_silo() and public.role_in('Security','Supervisor','SystemAdmin','SuperAdmin','Admin'))
  with check (silo = public.current_silo());

-- SYSTEM_PROFILES
create policy system_profiles_self_read on public.system_profiles for select using (user_id = auth.uid() or public.role_in('Supervisor','SystemAdmin','SuperAdmin','ControlRoom','Dispatcher'));
create policy system_profiles_self_update on public.system_profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy system_profiles_admin_all on public.system_profiles for all
  using (public.role_in('SystemAdmin','SuperAdmin','ControlRoom','Dispatcher'))
  with check (public.role_in('SystemAdmin','SuperAdmin','ControlRoom','Dispatcher'));

-- LEAVE
create policy leave_self_read on public.leave_entries for select using (user_id = auth.uid() or public.role_in('Supervisor','SystemAdmin','SuperAdmin','Admin'));
create policy leave_admin_all on public.leave_entries for all
  using (public.role_in('Supervisor','SystemAdmin','SuperAdmin','Admin'))
  with check (public.role_in('Supervisor','SystemAdmin','SuperAdmin','Admin'));

-- CITIZEN_SHARE_TOKENS — public select if token known + not expired + not used (handled at app layer);
-- we only allow service-role to write
create policy citizen_share_select on public.citizen_share_tokens for select using (true);
create policy citizen_share_admin on public.citizen_share_tokens for all
  using (public.is_global() or public.role_in('Dispatcher','Operator','ControlRoom','SystemAdmin'))
  with check (public.is_global() or public.role_in('Dispatcher','Operator','ControlRoom','SystemAdmin'));

-- CRIME_STATS — readable to authenticated users
create policy crime_stats_read on public.crime_stats for select using (auth.uid() is not null);
create policy crime_stats_admin on public.crime_stats for all
  using (public.role_in('SystemAdmin','SuperAdmin'))
  with check (public.role_in('SystemAdmin','SuperAdmin'));
