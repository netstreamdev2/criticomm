/**
 * Shared PCR form sections — used by both /medical/pcr/new and /medical/pcr/[id]/edit.
 * Server component; fields are uncontrolled with defaults from an existing PCR.
 */
import { FormSection, TextField, TextAreaField, SelectField, CheckField } from '@/components/fields';
import { SignaturePad } from '@/components/signature-pad';

// Loose shape so both create (empty) and edit (row) can pass through.
export type PcrDefaults = Partial<Record<string, string | number | boolean | null>>;

export function PcrFormSections({ d = {} }: { d?: PcrDefaults }) {
  const s = (k: string) => (d[k] as string | null | undefined) ?? undefined;
  const n = (k: string) => (d[k] as number | null | undefined) ?? undefined;
  const b = (k: string) => Boolean(d[k]);

  return (
    <>
      <FormSection title="Patient demographics">
        <TextField name="patient_name" label="Patient name" defaultValue={s('patient_name')} />
        <TextField name="date_of_birth" label="Date of birth" type="date" defaultValue={s('date_of_birth')} />
        <TextField name="age" label="Age" type="number" defaultValue={n('age')} />
        <SelectField name="gender" label="Gender" options={['', 'Male', 'Female', 'Other']} defaultValue={s('gender')} />
        <TextField name="identification_number" label="ID number" defaultValue={s('identification_number')} />
        <TextField name="contact_number" label="Contact number" defaultValue={s('contact_number')} />
        <TextField name="address" label="Address" defaultValue={s('address')} className="sm:col-span-2" />
        <TextField name="next_of_kin" label="Next of kin" defaultValue={s('next_of_kin')} />
        <TextField name="language" label="Language" defaultValue={s('language')} />
        <TextField name="weight" label="Weight (kg)" defaultValue={s('weight')} />
        <TextField name="allergies" label="Allergies" defaultValue={s('allergies')} />
        <SelectField name="has_insurance" label="Has insurance" options={['', 'Yes', 'No', 'Unknown']} defaultValue={s('has_insurance')} />
        <TextField name="insurance_information" label="Insurance information" defaultValue={s('insurance_information')} />
      </FormSection>

      <FormSection title="Incident & scene">
        <TextField name="incident_location" label="Incident location" defaultValue={s('incident_location')} className="sm:col-span-2" />
        <SelectField name="mechanism_of_injury" label="Mechanism of injury"
          options={['', 'MVA', 'Fall', 'Assault', 'Burn', 'Penetrating trauma', 'Medical — non-trauma', 'Other']}
          defaultValue={s('mechanism_of_injury')} />
        <TextAreaField name="scene_assessment" label="Scene assessment" defaultValue={s('scene_assessment')} className="sm:col-span-2 lg:col-span-3" />
        <TextField name="chief_complaint" label="Chief complaint" defaultValue={s('chief_complaint')} />
        <TextField name="nature_of_illness" label="Nature of illness" defaultValue={s('nature_of_illness')} />
        <TextField name="presenting_problem" label="Presenting problem" defaultValue={s('presenting_problem')} />
        <TextField name="current_medications" label="Current medications" defaultValue={s('current_medications')} className="sm:col-span-2" />
      </FormSection>

      <FormSection title="Vital signs">
        <TextField name="blood_pressure" label="Blood pressure" placeholder="120/80" defaultValue={s('blood_pressure')} />
        <TextField name="pulse_rate" label="Pulse (bpm)" defaultValue={s('pulse_rate')} />
        <TextField name="respiratory_rate" label="Respiratory rate" defaultValue={s('respiratory_rate')} />
        <TextField name="oxygen_saturation" label="SpO₂ (%)" defaultValue={s('oxygen_saturation')} />
        <TextField name="glasgow_coma_scale" label="GCS total" defaultValue={s('glasgow_coma_scale')} />
        <TextField name="blood_glucose_level" label="Blood glucose" defaultValue={s('blood_glucose_level')} />
        <TextField name="temperature" label="Temperature (°C)" defaultValue={s('temperature')} />
        <TextField name="ecg" label="ECG" defaultValue={s('ecg')} />
      </FormSection>

      <FormSection title="Neurological">
        <SelectField name="level_of_consciousness" label="Level of consciousness"
          options={['', 'Alert', 'Verbal', 'Pain', 'Unresponsive']} defaultValue={s('level_of_consciousness')} />
        <TextField name="alert_and_oriented" label="Alert & oriented (x1–x4)" defaultValue={s('alert_and_oriented')} />
        <SelectField name="gcs_eye" label="GCS — eye" options={['', '1', '2', '3', '4']} defaultValue={s('gcs_eye')} />
        <SelectField name="gcs_verbal" label="GCS — verbal" options={['', '1', '2', '3', '4', '5']} defaultValue={s('gcs_verbal')} />
        <SelectField name="gcs_motor" label="GCS — motor" options={['', '1', '2', '3', '4', '5', '6']} defaultValue={s('gcs_motor')} />
        <TextField name="stroke_assessment" label="Stroke assessment (FAST)" defaultValue={s('stroke_assessment')} />
        <TextField name="pain_scale" label="Pain scale (0–10)" type="number" defaultValue={n('pain_scale')} />
        <TextField name="pupils" label="Pupils (PERRLA)" defaultValue={s('pupils')} />
      </FormSection>

      <FormSection title="Skin condition">
        <CheckField name="skin_unremarkable" label="Unremarkable" defaultChecked={b('skin_unremarkable')} />
        <CheckField name="skin_cool" label="Cool" defaultChecked={b('skin_cool')} />
        <CheckField name="skin_pale" label="Pale" defaultChecked={b('skin_pale')} />
        <CheckField name="skin_diaphoretic" label="Diaphoretic" defaultChecked={b('skin_diaphoretic')} />
        <CheckField name="skin_cyanotic" label="Cyanotic" defaultChecked={b('skin_cyanotic')} />
        <CheckField name="skin_moist" label="Moist" defaultChecked={b('skin_moist')} />
        <CheckField name="skin_flush" label="Flushed" defaultChecked={b('skin_flush')} />
        <CheckField name="skin_dry" label="Dry" defaultChecked={b('skin_dry')} />
      </FormSection>

      <FormSection title="Assessment findings">
        <TextAreaField name="primary_survey" label="Primary survey (ABCDE)" className="sm:col-span-2 lg:col-span-3" />
        <TextAreaField name="secondary_survey" label="Secondary survey" className="sm:col-span-2 lg:col-span-3" />
        <TextField name="head_neck" label="Head & neck" />
        <TextField name="chest" label="Chest" />
        <TextField name="abdomen" label="Abdomen" />
        <TextField name="pelvis" label="Pelvis" />
        <TextField name="extremities" label="Extremities" />
        <TextField name="back" label="Back" />
        <TextField name="neuro" label="Neuro" />
      </FormSection>

      <FormSection title="Medical history">
        <TextField name="hist_allergies" label="Allergies (history)" />
        <TextField name="hist_chronic_conditions" label="Chronic conditions" />
        <TextField name="hist_medications" label="Regular medications" />
      </FormSection>

      <FormSection title="Interventions">
        <TextField name="airway_management" label="Airway management" />
        <TextField name="ventilation_support" label="Ventilation support" />
        <TextField name="circulation_management" label="Circulation management" />
        <TextField name="wound_care" label="Wound care" />
        <TextField name="splinting" label="Splinting" />
        <TextField name="medication_admin" label="Medication administered" />
        <TextField name="interventions_other" label="Other interventions" />
        <TextField name="medication_time" label="Medication time" type="time" defaultValue={s('medication_time')} />
        <TextField name="medication_dosage" label="Dosage" defaultValue={s('medication_dosage')} />
        <SelectField name="medication_route" label="Route" options={['', 'PO', 'IV', 'IM', 'SC', 'Inhaled', 'Topical']} defaultValue={s('medication_route')} />
        <TextField name="medication_comments" label="Medication comments" defaultValue={s('medication_comments')} className="sm:col-span-2" />
      </FormSection>

      <FormSection title="Psychological assessment">
        <CheckField name="psych_danger_to_self_or_others" label="Danger to self or others" defaultChecked={b('psych_danger_to_self_or_others')} />
        <CheckField name="psych_health_risk" label="Health at serious risk" defaultChecked={b('psych_health_risk')} />
        <TextField name="risk_of_harm" label="Risk of harm notes" defaultValue={s('risk_of_harm')} />
        <CheckField name="protocol_adherence" label="Protocol adhered to" defaultChecked={b('protocol_adherence')} />
      </FormSection>

      <FormSection title="Transport & handover">
        <TextField name="destination_hospital" label="Destination hospital" defaultValue={s('destination_hospital')} />
        <SelectField name="transport_mode" label="Transport mode" options={['', 'Ambulance', 'Helicopter', 'Private', 'Refused transport']} defaultValue={s('transport_mode')} />
        <SelectField name="level_of_care" label="Level of care" options={['', 'BLS', 'ILS', 'ALS']} defaultValue={s('level_of_care')} />
      </FormSection>

      <FormSection title="Narrative & crew">
        <TextAreaField name="treatment_narrative" label="Treatment narrative" rows={5} defaultValue={s('treatment_narrative')} className="sm:col-span-2 lg:col-span-3" />
        <TextAreaField name="patient_response" label="Patient response" defaultValue={s('patient_response')} className="sm:col-span-2 lg:col-span-3" />
        <TextField name="paramedic_names" label="Paramedic names" defaultValue={s('paramedic_names')} />
        <TextField name="paramedic_ids" label="Paramedic IDs" defaultValue={s('paramedic_ids')} />
      </FormSection>

      <FormSection title="Signatures">
        <SignaturePad name="responder_signature_image_base64" label="Responder signature" defaultValue={s('responder_signature_image_base64')} />
        <SignaturePad name="hospital_representative_signature_base64" label="Hospital representative" defaultValue={s('hospital_representative_signature_base64')} />
        <SignaturePad name="doctor_signature_image_base64" label="Receiving doctor" defaultValue={s('doctor_signature_image_base64')} />
      </FormSection>

      <FormSection title="Inventory used">
        <CheckField name="inv_oxygen" label="Oxygen" defaultChecked={b('inv_oxygen')} />
        <CheckField name="inv_bvm" label="BVM" defaultChecked={b('inv_bvm')} />
        <CheckField name="inv_suction" label="Suction" defaultChecked={b('inv_suction')} />
        <CheckField name="inv_iv" label="IV kit" defaultChecked={b('inv_iv')} />
        <CheckField name="inv_bandages" label="Bandages" defaultChecked={b('inv_bandages')} />
        <CheckField name="inv_aed" label="AED" defaultChecked={b('inv_aed')} />
        <CheckField name="inv_drugs" label="Scheduled drugs" defaultChecked={b('inv_drugs')} />
        <CheckField name="inv_sharps" label="Sharps" defaultChecked={b('inv_sharps')} />
        <CheckField name="inv_ppe" label="PPE" defaultChecked={b('inv_ppe')} />
        <CheckField name="requires_cleaning" label="Unit requires cleaning" defaultChecked={b('requires_cleaning')} />
      </FormSection>
    </>
  );
}
