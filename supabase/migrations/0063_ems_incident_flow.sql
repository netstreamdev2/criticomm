-- ============================================================================
-- 0063 — EMS: an incident is closed by its patient care report
-- ============================================================================
--
-- Run after 0062.
--
-- The paramedic's side of an incident, made as tight as Fire's (0059):
--
--   1. file_pcr(): the paramedic or doctor leading the call files the ePCR
--      from the phone, with V4's sections (personal information, scene and
--      transport, crew, clinical assessment, vitals, interventions and
--      medication, inventory, the three sign-offs, casualties). It lands on
--      paramedic_reports with its vitals, interventions and medical history,
--      linked to the incident, and in the same transaction resolves the
--      incident, writes the timeline and audit trail and tells dispatch and
--      command. A replay from the phone's outbox returns the report filed.
--   2. V4's last question, "Does the vehicle require cleaning?": Yes puts the
--      ambulance off road (Out of Service), releases the crew from it and
--      tells command, as the EMS start of shift does (0060). Stock left
--      unticked tells command the ambulance is short.
--   3. An EMS incident is resolved by its report, never by a bare status from
--      a paramedic or doctor.
--   4. Who reads a PCR: EMS and the tenant-wide tier as before, plus everyone
--      who worked the incident and case managers, with its vitals,
--      interventions and history.
--   5. A PCR filed against an incident is never deleted, its link and filing
--      stamp never change, and it is locked once the case is closed. Until
--      then EMS may correct it, as V4 allowed.
--
-- Safe to re-run.
-- ============================================================================

begin;

alter table public.paramedic_reports
  add column if not exists report_number          text,
  add column if not exists filed_by               uuid references auth.users(id),
  add column if not exists filed_at               timestamptz,
  add column if not exists ambulance_id           uuid references public.apparatus(id) on delete set null,
  add column if not exists total_response_seconds bigint;

create unique index if not exists paramedic_reports_incident_once
  on public.paramedic_reports (incident_id) where incident_id is not null and report_number is not null;

-- ── 1. File the PCR — the paramedic's close-out ─────────────────────────────

create or replace function public.file_pcr(p_incident_id uuid, p_fields jsonb)
returns public.paramedic_reports
language plpgsql security definer set search_path to 'public' as $$
declare
  f            jsonb := coalesce(p_fields, '{}'::jsonb);
  v_incident   public.incidents;
  v_person     public.personnel;
  v_report     public.paramedic_reports;
  v_vehicle    public.apparatus;
  v_history    uuid;
  v_vitals     uuid;
  v_int        uuid;
  v_name       text;
  v_medic      text;
  v_now        timestamptz := now();
  v_today      date := (now() at time zone 'Africa/Johannesburg')::date;
  v_mode       text := nullif(trim(coalesce(f ->> 'transport_mode', '')), '');
  v_dest       text := nullif(trim(coalesce(f ->> 'destination_hospital', '')), '');
  v_care       text := nullif(trim(coalesce(f ->> 'level_of_care', '')), '');
  v_response   text := nullif(trim(coalesce(f ->> 'patient_response', '')), '');
  v_complaint  text := nullif(trim(coalesce(f ->> 'chief_complaint', '')), '');
  v_signature  text := nullif(trim(coalesce(f ->> 'responder_signature_image_base64', '')), '');
  v_cleaning   text := f ->> 'requires_cleaning';
  v_pain       int;
  v_gcs        int;
  v_short      text;
  v_ambulance  uuid;
  v_secondary  jsonb;
begin
  perform public.require_role('Paramedic', 'Doctor', 'Responder', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin');
  if public.current_silo() is distinct from 'Medical' then
    raise exception 'Only EMS files a patient care report' using errcode = '42501';
  end if;

  select * into v_incident from public.incidents
  where id = p_incident_id and tenant_id = public.current_tenant()
  for update;
  if not found then raise exception 'Incident % not found', p_incident_id; end if;

  -- Replay of a report already filed (offline retry): return it unchanged.
  if v_incident.report_filed_at is not null then
    select * into v_report from public.paramedic_reports
    where incident_id = p_incident_id and report_number is not null order by filed_at limit 1;
    if found then return v_report; end if;
    raise exception '% is already closed', v_incident.incident_number using errcode = 'P0001';
  end if;

  if v_incident.status in ('Resolved', 'Closed') then
    raise exception '% is already %', v_incident.incident_number, lower(v_incident.status::text) using errcode = 'P0001';
  end if;
  if v_incident.accepted_by is distinct from auth.uid() then
    raise exception 'Only the crew member leading % files its patient report', v_incident.incident_number using errcode = 'P0001';
  end if;
  if v_incident.status not in ('Arrived', 'On Scene', 'Transporting') then
    raise exception 'Mark yourself on scene before filing the patient report for %', v_incident.incident_number using errcode = 'P0001';
  end if;

  -- What the report must say.
  if v_complaint is null then raise exception 'Chief Complaint is required.' using errcode = 'P0001'; end if;
  if v_care is null or v_care not in ('BLS', 'ILS', 'ALS') then
    raise exception 'Care Level is required.' using errcode = 'P0001';
  end if;
  if v_response is null or v_response not in ('Improved', 'Unchanged', 'Deteriorated', 'Succumbed on Scene') then
    raise exception 'Overall Patient Response to Treatment is required.' using errcode = 'P0001';
  end if;
  if v_mode is not null and v_mode not in ('Ambulance (Ground)', 'HEMS (Airlift)', 'Private Transport') then
    raise exception 'Choose the transport mode from the list.' using errcode = 'P0001';
  end if;
  if v_mode in ('Ambulance (Ground)', 'HEMS (Airlift)') and v_dest is null then
    raise exception 'Choose the destination facility.' using errcode = 'P0001';
  end if;
  if v_signature is null or v_signature not like 'data:image/%' or length(v_signature) > 600000 then
    raise exception 'The lead paramedic must sign.' using errcode = 'P0001';
  end if;
  if v_cleaning is null or v_cleaning not in ('true', 'false') then
    raise exception 'Say whether the vehicle requires cleaning.' using errcode = 'P0001';
  end if;
  if coalesce(f ->> 'departure_time', '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9])?$'
     or coalesce(f ->> 'arrival_time', '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9])?$'
     or coalesce(f ->> 'medication_time', '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9])?$' then
    raise exception 'Times must be HH:MM.' using errcode = 'P0001';
  end if;
  if coalesce(f ->> 'date_of_birth', '') !~ '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$' then
    raise exception 'Date of Birth must be a date.' using errcode = 'P0001';
  end if;
  v_pain := nullif(regexp_replace(coalesce(f ->> 'pain_scale', ''), '[^0-9]', '', 'g'), '')::int;
  if v_pain is not null and (v_pain < 0 or v_pain > 10) then
    raise exception 'Pain Scale must be 0 to 10.' using errcode = 'P0001';
  end if;
  for v_short in select unnest(array['hospital_representative_signature_base64', 'doctor_signature_image_base64']) loop
    if nullif(f ->> v_short, '') is not null and ((f ->> v_short) not like 'data:image/%' or length(f ->> v_short) > 600000) then
      raise exception 'A signature could not be read. Sign again.' using errcode = 'P0001';
    end if;
  end loop;
  begin
    v_secondary := coalesce(nullif(f ->> 'secondary_patients_json', ''), '[]')::jsonb;
  exception when others then
    raise exception 'The casualties list could not be read. Check it and file again.' using errcode = 'P0001';
  end;
  if jsonb_typeof(v_secondary) <> 'array' or jsonb_array_length(v_secondary) > 50 then
    raise exception 'The casualties list could not be read. Check it and file again.' using errcode = 'P0001';
  end if;

  select * into v_person from public.personnel
  where user_id = auth.uid() and tenant_id = public.current_tenant();
  select full_name into v_name from public.profiles where id = auth.uid();
  v_medic := coalesce(nullif(trim(concat_ws(' ', v_person.first_name, v_person.last_name)), ''), v_name, 'Paramedic');
  v_ambulance := coalesce(v_person.assigned_apparatus_id, v_incident.unit_id);
  v_gcs := nullif(regexp_replace(coalesce(f ->> 'gcs_eye', ''), '\D.*$', ''), '')::int
         + nullif(regexp_replace(coalesce(f ->> 'gcs_verbal', ''), '\D.*$', ''), '')::int
         + nullif(regexp_replace(coalesce(f ->> 'gcs_motor', ''), '\D.*$', ''), '')::int;

  insert into public.medical_histories (tenant_id, silo, patient_id, allergies, chronic_conditions, medications)
  values (v_incident.tenant_id, 'Medical', nullif(trim(f ->> 'identification_number'), ''),
    nullif(trim(f ->> 'allergies'), ''), nullif(trim(f ->> 'medical_history'), ''), nullif(trim(f ->> 'current_medications'), ''))
  returning id into v_history;

  insert into public.vital_signs (tenant_id, silo, blood_pressure, pulse_rate, respiratory_rate, oxygen_saturation,
    glasgow_coma_scale, blood_glucose_level, temperature)
  values (v_incident.tenant_id, 'Medical', nullif(trim(f ->> 'blood_pressure'), ''), nullif(trim(f ->> 'pulse_rate'), ''),
    nullif(trim(f ->> 'respiratory_rate'), ''), nullif(trim(f ->> 'oxygen_saturation'), ''),
    v_gcs::text, nullif(trim(f ->> 'blood_glucose_level'), ''), nullif(trim(f ->> 'body_temperature'), ''))
  returning id into v_vitals;

  insert into public.interventions (tenant_id, silo, airway_management, circulation_management, medication_admin)
  values (v_incident.tenant_id, 'Medical', nullif(trim(f ->> 'airway_management'), ''),
    nullif(trim(f ->> 'circulation_management'), ''), nullif(trim(f ->> 'medication_admin'), ''))
  returning id into v_int;

  insert into public.paramedic_reports (
    tenant_id, silo, incident_id, report_number, filed_by, filed_at, ambulance_id, total_response_seconds,
    patient_name, identification_number, date_of_birth, age, gender, weight, language, address, contact_number,
    next_of_kin, income, has_insurance, insurance_information, allergies,
    medical_history_id, vitals_id, interventions_id,
    incident_location, time_of_arrival, departure_time, scene_assessment, mechanism_of_injury,
    transport_mode, destination_hospital, level_of_care,
    paramedic_names, paramedic_ids, arrival_time,
    chief_complaint, nature_of_illness, presenting_problem, treatment_narrative,
    current_medications, risk_of_harm, patient_response, protocol_adherence,
    psych_danger_to_self_or_others, psych_health_risk, psych_believes_health_risk, psych_believes_danger,
    pulse_waveform, body_temperature, end_tidal_co2, level_of_consciousness, alert_and_oriented,
    gcs_eye, gcs_verbal, gcs_motor, stroke_assessment, pain_scale, pupils,
    skin_unremarkable, skin_cool, skin_pale, skin_diaphoretic, skin_cyanotic, skin_moist, skin_flush, skin_dry,
    medication_time, medication_dosage, medication_route, medication_comments,
    inv_oxygen, inv_bvm, inv_suction, inv_iv, inv_bandages, inv_aed, inv_drugs, inv_sharps, inv_ppe,
    responder_signature_image_base64, hospital_representative_signature_base64, doctor_signature_image_base64,
    requires_cleaning, secondary_patients_json
  ) values (
    v_incident.tenant_id, 'Medical', v_incident.id, 'PCR-' || v_incident.incident_number, auth.uid(), v_now, v_ambulance,
    -- V4's total response time: from dispatch (or logging) to the report.
    greatest(0, extract(epoch from (v_now - coalesce(v_incident.dispatch_time, v_incident.incident_created_at))))::bigint,
    nullif(trim(f ->> 'patient_name'), ''), nullif(trim(f ->> 'identification_number'), ''),
    nullif(f ->> 'date_of_birth', '')::date,
    least(150, nullif(regexp_replace(coalesce(f ->> 'age', ''), '[^0-9]', '', 'g'), '')::int),
    nullif(trim(f ->> 'gender'), ''), nullif(trim(f ->> 'weight'), ''), nullif(trim(f ->> 'language'), ''),
    nullif(trim(f ->> 'address'), ''), nullif(trim(f ->> 'contact_number'), ''), nullif(trim(f ->> 'next_of_kin'), ''),
    nullif(trim(f ->> 'income'), ''), case when f ->> 'has_insurance' = 'Yes' then 'yes' else 'no' end,
    case when f ->> 'has_insurance' = 'Yes' then nullif(trim(f ->> 'insurance_information'), '') end,
    nullif(trim(f ->> 'allergies'), ''),
    v_history, v_vitals, v_int,
    coalesce(nullif(trim(f ->> 'incident_location'), ''), v_incident.location_address),
    v_incident.arrived_timestamp,
    case when nullif(f ->> 'departure_time', '') is not null
         then ((v_today + (f ->> 'departure_time')::time) at time zone 'Africa/Johannesburg') end,
    nullif(trim(f ->> 'scene_assessment'), ''), nullif(trim(f ->> 'mechanism_of_injury'), ''),
    v_mode, v_dest, v_care,
    coalesce(nullif(trim(f ->> 'paramedic_names'), ''), v_medic), nullif(trim(f ->> 'paramedic_ids'), ''),
    case when nullif(f ->> 'arrival_time', '') is not null
         then ((v_today + (f ->> 'arrival_time')::time) at time zone 'Africa/Johannesburg') end,
    v_complaint, nullif(trim(f ->> 'nature_of_illness'), ''), nullif(trim(f ->> 'presenting_problem'), ''),
    nullif(trim(f ->> 'treatment_narrative'), ''),
    nullif(trim(f ->> 'current_medications'), ''), nullif(trim(f ->> 'risk_of_harm'), ''), v_response,
    coalesce(f ->> 'protocol_adherence', '') = 'true',
    coalesce(f ->> 'psych_danger_to_self_or_others', '') = 'true', coalesce(f ->> 'psych_health_risk', '') = 'true',
    coalesce(f ->> 'psych_believes_health_risk', '') = 'true', coalesce(f ->> 'psych_believes_danger', '') = 'true',
    nullif(trim(f ->> 'pulse_waveform'), ''), nullif(trim(f ->> 'body_temperature'), ''), nullif(trim(f ->> 'end_tidal_co2'), ''),
    nullif(trim(f ->> 'level_of_consciousness'), ''), nullif(trim(f ->> 'alert_and_oriented'), ''),
    nullif(trim(f ->> 'gcs_eye'), ''), nullif(trim(f ->> 'gcs_verbal'), ''), nullif(trim(f ->> 'gcs_motor'), ''),
    nullif(trim(f ->> 'stroke_assessment'), ''), v_pain, nullif(trim(f ->> 'pupils'), ''),
    coalesce(f ->> 'skin_unremarkable', '') = 'true', coalesce(f ->> 'skin_cool', '') = 'true',
    coalesce(f ->> 'skin_pale', '') = 'true', coalesce(f ->> 'skin_diaphoretic', '') = 'true',
    coalesce(f ->> 'skin_cyanotic', '') = 'true', coalesce(f ->> 'skin_moist', '') = 'true',
    coalesce(f ->> 'skin_flush', '') = 'true', coalesce(f ->> 'skin_dry', '') = 'true',
    nullif(f ->> 'medication_time', '')::time, nullif(trim(f ->> 'medication_dosage'), ''),
    nullif(trim(f ->> 'medication_route'), ''), nullif(trim(f ->> 'medication_comments'), ''),
    coalesce(f ->> 'inv_oxygen', '') = 'true', coalesce(f ->> 'inv_bvm', '') = 'true', coalesce(f ->> 'inv_suction', '') = 'true',
    coalesce(f ->> 'inv_iv', '') = 'true', coalesce(f ->> 'inv_bandages', '') = 'true', coalesce(f ->> 'inv_aed', '') = 'true',
    coalesce(f ->> 'inv_drugs', '') = 'true', coalesce(f ->> 'inv_sharps', '') = 'true', coalesce(f ->> 'inv_ppe', '') = 'true',
    v_signature, nullif(f ->> 'hospital_representative_signature_base64', ''), nullif(f ->> 'doctor_signature_image_base64', ''),
    v_cleaning = 'true', v_secondary
  ) returning * into v_report;

  update public.incidents
     set status            = 'Resolved',
         unit_status       = 'Resolved',
         resolved_at       = v_now,
         resolved_by       = auth.uid(),
         report_filed_at   = v_now,
         responding_officer = coalesce(responding_officer, v_report.paramedic_names),
         updated_at        = v_now
   where id = p_incident_id
  returning * into v_incident;

  insert into public.incident_updates (silo, incident_id, message, created_by, created_by_name)
  values (v_incident.silo, v_incident.id,
    format('[REPORT] Patient care report %s filed by %s%s — incident resolved', v_report.report_number, v_medic,
      case when v_dest is not null then ' · patient to ' || v_dest else '' end),
    auth.uid(), v_name);

  insert into public.audit_logs (tenant_id, silo, user_id, user_name, department, action_type, entity_type, entity_id, details)
  values (v_incident.tenant_id, 'Medical', auth.uid(), v_name, 'Medical', 'REPORT_FILED', 'incidents', v_incident.id::text,
    format('Patient care report %s filed for %s (%s, %s); incident resolved', v_report.report_number,
      v_incident.incident_number, v_care, v_response));

  perform public.notify_incident_chain(
    v_incident, 'resolved',
    format('%s resolved — patient report filed by %s', v_incident.incident_number, v_medic),
    format('%s · %s', v_complaint, coalesce(v_dest, v_incident.location_address))
  );

  -- After the call: the ambulance.
  if v_ambulance is not null then
    select * into v_vehicle from public.apparatus where id = v_ambulance and tenant_id = v_incident.tenant_id;
  end if;
  if v_vehicle.id is not null and v_cleaning = 'true' then
    update public.apparatus set status = 'Out of Service',
      status_note = format('Off road for cleaning (%s)', v_report.report_number),
      status_changed_at = v_now, status_changed_by_name = v_medic
     where id = v_vehicle.id;
    update public.personnel set assigned_apparatus_id = null, is_on_duty = false
     where assigned_apparatus_id = v_vehicle.id and tenant_id = v_incident.tenant_id;
    perform public.notify_command(v_incident.tenant_id, 'Medical',
      'Ambulance off road for cleaning: ' || v_vehicle.unit_number,
      format('After %s. Reported by %s.', v_incident.incident_number, v_medic), 'High', '/shift/today');
  end if;
  if v_vehicle.id is not null then
    v_short := concat_ws(', ',
      case when not v_report.inv_oxygen then 'oxygen' end,
      case when not v_report.inv_bvm then 'BVM / masks' end,
      case when not v_report.inv_suction then 'suction unit' end,
      case when not v_report.inv_iv then 'IV fluids & sets' end,
      case when not v_report.inv_bandages then 'bandages' end,
      case when not v_report.inv_aed then 'AED pads' end,
      case when not v_report.inv_drugs then 'drug box' end,
      case when not v_report.inv_sharps then 'sharps container' end,
      case when not v_report.inv_ppe then 'gloves & PPE' end);
    if nullif(v_short, '') is not null then
      perform public.notify_command(v_incident.tenant_id, 'Medical',
        'Ambulance stock short: ' || v_vehicle.unit_number,
        format('After %s: %s. Reported by %s.', v_incident.incident_number, v_short, v_medic), 'Medium', '/medical');
    end if;
  end if;

  return v_report;
end $$;

revoke execute on function public.file_pcr(uuid, jsonb) from public, anon;
grant  execute on function public.file_pcr(uuid, jsonb) to authenticated;

-- ── 2. An EMS incident is resolved by its report ────────────────────────────

create or replace function public.guard_ems_resolution() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.status in ('Resolved', 'Closed')
     and old.status not in ('Resolved', 'Closed')
     and new.report_filed_at is null
     and (new.silo = 'Medical' or 'Medical' = any(coalesce(new.dispatched_silos, '{}')))
     and public.role_in('Paramedic', 'Doctor') then
    raise exception 'File the patient report to close %', new.incident_number using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists guard_ems_resolution on public.incidents;
create trigger guard_ems_resolution before update of status on public.incidents
  for each row execute function public.guard_ems_resolution();

-- ── 3. Who reads a PCR ──────────────────────────────────────────────────────

drop policy if exists paramedic_reports_worked_read on public.paramedic_reports;
create policy paramedic_reports_worked_read on public.paramedic_reports for select to authenticated
  using (incident_id is not null and public.can_work_incident(incident_id));

drop policy if exists paramedic_reports_case_read on public.paramedic_reports;
create policy paramedic_reports_case_read on public.paramedic_reports for select to authenticated
  using (public.role_in('CaseManager', 'SystemController'));

-- The clinical records go with the report: whoever may read it reads them.
drop policy if exists medical_histories_report_read on public.medical_histories;
create policy medical_histories_report_read on public.medical_histories for select to authenticated
  using (exists (select 1 from public.paramedic_reports p where p.medical_history_id = medical_histories.id));
drop policy if exists vital_signs_report_read on public.vital_signs;
create policy vital_signs_report_read on public.vital_signs for select to authenticated
  using (exists (select 1 from public.paramedic_reports p where p.vitals_id = vital_signs.id));
drop policy if exists interventions_report_read on public.interventions;
create policy interventions_report_read on public.interventions for select to authenticated
  using (exists (select 1 from public.paramedic_reports p where p.interventions_id = interventions.id));

-- ── 4. A filed PCR stays on record ──────────────────────────────────────────

create or replace function public.guard_pcr_record() returns trigger
language plpgsql set search_path to 'public' as $$
declare
  v_status incident_status;
begin
  if old.incident_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A patient report filed against an incident cannot be deleted.' using errcode = 'P0001';
  end if;
  if new.incident_id is distinct from old.incident_id or new.report_number is distinct from old.report_number
     or new.filed_by is distinct from old.filed_by or new.filed_at is distinct from old.filed_at
     or new.created_at is distinct from old.created_at then
    raise exception 'A filed patient report keeps its incident and filing record.' using errcode = 'P0001';
  end if;
  select status into v_status from public.incidents where id = old.incident_id;
  if v_status = 'Closed' then
    raise exception 'The case is closed; its patient report can no longer be changed.' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists guard_pcr_record on public.paramedic_reports;
create trigger guard_pcr_record before update or delete on public.paramedic_reports
  for each row execute function public.guard_pcr_record();

commit;

notify pgrst, 'reload schema';
