/**
 * The patient care report (ePCR, migration 0063): the paramedic's close-out
 * of an EMS call, as data. Sections, labels and options follow V4's
 * Paramedics/Create form. The phone and the console build their forms from
 * these; file_pcr() checks the same things again and has the final word.
 * Keys are paramedic_reports columns, except the few noted below that land
 * in the vitals, interventions and medical history records.
 */

export const SEXES = ['Male', 'Female'] as const;
export const HOSPITALS = [
  'Chief Albert Luthuli Central', 'Addington Hospital', 'St. Augustines Hospital',
  'Westville Hospital', 'Entabeni Hospital', 'Ahmed Al-Kadi Private',
] as const;
export const TRANSPORT_MODES = ['Ambulance (Ground)', 'HEMS (Airlift)', 'Private Transport'] as const;
export const CARE_LEVELS = ['BLS', 'ILS', 'ALS'] as const;
export const PATIENT_RESPONSES = ['Improved', 'Unchanged', 'Deteriorated', 'Succumbed on Scene'] as const;
export const AVPU = ['Alert', 'Verbal', 'Pain', 'Unresponsive'] as const;
export const ALERT_ORIENTED = ['A&O x1 (Person)', 'A&O x2 (+Place)', 'A&O x3 (+Time)', 'A&O x4 (+Event)'] as const;
export const GCS_EYE = ['4 - Spontaneously', '3 - To Verbal Command', '2 - To Pain', '1 - No Eye Opening', '0 - Not Testable'] as const;
export const GCS_VERBAL = [
  '5 - Oriented', '4 - Confused', '3 - Inappropriate Words', '2 - Incomprehensible Sounds',
  '1 - No Verbal Response', '0 - Not Testable (Intubated)',
] as const;
export const GCS_MOTOR = [
  '6 - Obeys Commands', '5 - Localizes Pain', '4 - Withdraws from Pain', '3 - Abnormal Flexion (Decorticate)',
  '2 - Extension Response (Decerebrate)', '1 - No Motor Response',
] as const;
export const STROKE = ['Negative', 'Positive'] as const;
export const AIRWAY = ['OPA/NPA', 'Intubation (ET Tube)', 'SGA (iGel/LMA)', 'Suction', 'CPAP/BiPAP'] as const;
export const CIRCULATION = [
  'IV Access (Peripheral)', 'IO Access', 'Hemorrhage Control (Bandaging)', 'Tourniquet Applied',
  'CPR Started', 'Defibrillation / Cardioversion',
] as const;
export const ROUTES = ['IV', 'IO', 'IM', 'PO (Oral)', 'SubQ', 'Inhaled'] as const;
export const TRIAGE = ['Green (Minor)', 'Yellow (Delayed)', 'Red (Immediate)', 'Black (Deceased)'] as const;

export type PcrField = {
  key: string;
  label: string;
  kind: 'text' | 'multiline' | 'select' | 'yesno' | 'count' | 'date' | 'time' | 'flag';
  options?: readonly string[];
  placeholder?: string;
  required?: boolean;
  /** Shown only when this other answer is Yes. */
  when?: string;
  /** Shown only when the patient is taken to hospital by ambulance or air. */
  transportedOnly?: boolean;
  /** A sub-heading inside the section, before this field. */
  group?: string;
};

export type PcrSection = {
  id: string;
  title: string;
  /** Ionicons name; the phone draws it. */
  icon: string;
  fields: PcrField[];
};

/** The sections, in V4's order. Casualties, sign-off and media are drawn by the screens. */
export const PCR_SECTIONS: PcrSection[] = [
  {
    id: 'patient', title: 'Personal Information', icon: 'person-outline', fields: [
      { key: 'patient_name', label: 'First & Last Name', kind: 'text', placeholder: 'Unknown' },
      { key: 'identification_number', label: 'Identification No.', kind: 'text', placeholder: 'ID / Passport' },
      { key: 'date_of_birth', label: 'Date of Birth', kind: 'date' },
      { key: 'age', label: 'Age', kind: 'count', placeholder: 'Yrs' },
      { key: 'gender', label: 'Sex', kind: 'select', options: SEXES },
      { key: 'weight', label: 'Weight', kind: 'text', placeholder: 'e.g., 75kg' },
      { key: 'language', label: 'Primary Language', kind: 'text', placeholder: 'e.g., English, Zulu' },
      { key: 'address', label: 'Home Address', kind: 'text', placeholder: 'Full residential address' },
      { key: 'contact_number', label: 'Contact Number', kind: 'text' },
      { key: 'next_of_kin', label: 'Next of Kin', kind: 'text', placeholder: 'Name & Contact' },
      { key: 'income', label: 'Income / Employment', kind: 'text', placeholder: 'Employment status' },
      { key: 'has_insurance', label: 'Medical Insurance?', kind: 'yesno' },
      { key: 'insurance_information', label: 'Provider & Policy Number', kind: 'text', when: 'has_insurance' },
    ],
  },
  {
    id: 'scene', title: 'Scene & Transport', icon: 'location-outline', fields: [
      { key: 'incident_location', label: 'Incident Location', kind: 'text' },
      { key: 'departure_time', label: 'Depart Scene', kind: 'time' },
      { key: 'scene_assessment', label: 'Scene Assessment & Safety', kind: 'multiline', placeholder: 'Hazards, number of patients, extrication required...' },
      { key: 'transport_mode', label: 'Mode', kind: 'select', options: TRANSPORT_MODES },
      { key: 'destination_hospital', label: 'Destination Facility', kind: 'select', options: HOSPITALS },
      { key: 'level_of_care', label: 'Care Level', kind: 'select', options: CARE_LEVELS, required: true },
    ],
  },
  {
    id: 'crew', title: 'Crew Assignment', icon: 'people-outline', fields: [
      { key: 'paramedic_names', label: 'Primary Practitioner(s)', kind: 'text', placeholder: 'Names of attending crew' },
      { key: 'paramedic_ids', label: 'HPCSA Registration Numbers', kind: 'text', placeholder: 'BAA/AEA/ANT...' },
    ],
  },
  {
    // V4's planned legal handover: the hand-over of care at the hospital.
    id: 'handover', title: 'Hospital Handover', icon: 'business-outline', fields: [
      { key: 'arrival_time', label: 'Hospital Arrival / Handover Time', kind: 'time', transportedOnly: true },
      { key: 'handover_doctor_name', label: 'Receiving Doctor', kind: 'text', placeholder: 'Dr Name Surname', transportedOnly: true },
      { key: 'handover_patient_status', label: 'Patient Status at Handover', kind: 'multiline', placeholder: 'Condition when care was handed over', transportedOnly: true },
    ],
  },
  {
    id: 'assessment', title: 'Clinical Assessment & Psychological Presentation', icon: 'clipboard-outline', fields: [
      { key: 'chief_complaint', label: 'Chief Complaint', kind: 'text', placeholder: 'What is the main issue?', required: true, group: 'Primary Assessment' },
      { key: 'mechanism_of_injury', label: 'Mechanism of Injury (MOI)', kind: 'text', placeholder: 'e.g. MVA, Fall, Assault' },
      { key: 'nature_of_illness', label: 'Nature of Illness (NOI)', kind: 'text', placeholder: 'e.g. Cardiac, Respiratory' },
      { key: 'presenting_problem', label: 'Presenting Problem', kind: 'text', placeholder: 'Observed state upon arrival' },
      { key: 'treatment_narrative', label: 'Full Clinical Narrative (SOAP/SAMPLE)', kind: 'multiline', placeholder: 'Subjective, Objective, Assessment, Plan...' },
      // Past medical history lands in the medical history record.
      { key: 'medical_history', label: 'Past Medical History', kind: 'text', placeholder: 'Chronic illnesses, surgeries...', group: 'History & Risk' },
      { key: 'current_medications', label: 'Current Medications', kind: 'text', placeholder: 'Prescription & OTC' },
      { key: 'allergies', label: 'Allergies', kind: 'text', placeholder: 'NKDA or list allergies...' },
      { key: 'risk_of_harm', label: 'Risk of Harm', kind: 'text', placeholder: 'Environmental or personal risk factors' },
      { key: 'psych_danger_to_self_or_others', label: 'Is Danger To Self Or Others', kind: 'flag', group: 'Psychological Presentation' },
      { key: 'psych_health_risk', label: 'Mental/Physical Health At Serious Risk Of Deterioration', kind: 'flag' },
      { key: 'psych_believes_health_risk', label: 'Patient Believes Health Is At Serious Risk Of Deterioration', kind: 'flag' },
      { key: 'psych_believes_danger', label: 'Patient Believes They Are A Danger To Self/Others', kind: 'flag' },
      { key: 'patient_response', label: 'Overall Patient Response to Treatment', kind: 'select', options: PATIENT_RESPONSES, required: true },
      { key: 'protocol_adherence', label: 'Protocol Adherence (HPCSA Guidelines Followed)', kind: 'flag' },
    ],
  },
  {
    id: 'vitals', title: 'Signs, Symptoms & Vitals', icon: 'pulse-outline', fields: [
      // Vitals land in the vital signs record.
      { key: 'blood_pressure', label: 'Blood Pressure (mmHg)', kind: 'text', placeholder: 'e.g. 120/80', group: 'Hemodynamics & Base Vitals' },
      { key: 'pulse_rate', label: 'Pulse Rate', kind: 'text', placeholder: 'bpm' },
      { key: 'pulse_waveform', label: 'Waveform', kind: 'text', placeholder: 'Regular/Irregular' },
      { key: 'respiratory_rate', label: 'Respirations', kind: 'text', placeholder: 'breaths/min' },
      { key: 'oxygen_saturation', label: 'O2 Saturation', kind: 'text', placeholder: '%' },
      { key: 'blood_glucose_level', label: 'Glucose', kind: 'text', placeholder: 'mmol/L' },
      { key: 'body_temperature', label: 'Temp', kind: 'text', placeholder: '°C' },
      { key: 'end_tidal_co2', label: 'ETCO2', kind: 'text', placeholder: 'mmHg' },
      { key: 'level_of_consciousness', label: 'Level of Consciousness', kind: 'select', options: AVPU, group: 'Neurological Assessment' },
      { key: 'alert_and_oriented', label: 'Alert & Oriented', kind: 'select', options: ALERT_ORIENTED },
      { key: 'gcs_eye', label: 'GCS: Eye Response', kind: 'select', options: GCS_EYE },
      { key: 'gcs_verbal', label: 'GCS: Verbal Response', kind: 'select', options: GCS_VERBAL },
      { key: 'gcs_motor', label: 'GCS: Motor Response', kind: 'select', options: GCS_MOTOR },
      { key: 'stroke_assessment', label: 'Stroke Assessment (FAST)', kind: 'select', options: STROKE },
      { key: 'pain_scale', label: 'Pain Scale (0-10)', kind: 'count', placeholder: '0 = None' },
      { key: 'pupils', label: 'Pupils / Eyes', kind: 'text', placeholder: 'e.g. PEARL, Sluggish, Fixed', group: 'Physical Presentation' },
      { key: 'skin_unremarkable', label: 'Unremarkable', kind: 'flag', group: 'Skin Condition' },
      { key: 'skin_cool', label: 'Cool', kind: 'flag' },
      { key: 'skin_pale', label: 'Pale', kind: 'flag' },
      { key: 'skin_diaphoretic', label: 'Diaphoretic', kind: 'flag' },
      { key: 'skin_cyanotic', label: 'Cyanotic', kind: 'flag' },
      { key: 'skin_moist', label: 'Moist', kind: 'flag' },
      { key: 'skin_flush', label: 'Flush', kind: 'flag' },
      { key: 'skin_dry', label: 'Dry', kind: 'flag' },
    ],
  },
  {
    id: 'interventions', title: 'Interventions & Medication Administration', icon: 'medkit-outline', fields: [
      // Airway, circulation and the drug land in the interventions record.
      { key: 'airway_management', label: 'Airway Management', kind: 'select', options: AIRWAY, group: 'Physical Interventions' },
      { key: 'circulation_management', label: 'Circulation Management', kind: 'select', options: CIRCULATION },
      { key: 'medication_time', label: 'Time', kind: 'time', group: 'Medication / Fluids Administration' },
      { key: 'medication_admin', label: 'Intervention / Drug', kind: 'text', placeholder: 'e.g. Adrenaline, Ringers Lactate' },
      { key: 'medication_dosage', label: 'Dosage', kind: 'text', placeholder: 'e.g. 1mg, 500ml' },
      { key: 'medication_route', label: 'Route', kind: 'select', options: ROUTES },
      { key: 'medication_comments', label: 'Comments / Reaction', kind: 'text' },
    ],
  },
  {
    id: 'inventory', title: 'Vehicle Inventory & Restock Checklist', icon: 'cube-outline', fields: [
      { key: 'inv_oxygen', label: 'Oxygen Cylinder (Main & Portable)', kind: 'flag', group: 'Airway & Breathing' },
      { key: 'inv_bvm', label: 'BVM / Masks (Adult & Ped)', kind: 'flag' },
      { key: 'inv_suction', label: 'Suction Unit Functional', kind: 'flag' },
      { key: 'inv_iv', label: 'IV Fluids & Sets', kind: 'flag', group: 'Circulation & Trauma' },
      { key: 'inv_bandages', label: 'Bandages / Gauze / Tape', kind: 'flag' },
      { key: 'inv_aed', label: 'Defibrillator / AED Pads', kind: 'flag' },
      { key: 'inv_drugs', label: 'Drug Box Sealed/Restocked', kind: 'flag', group: 'Drugs & Misc' },
      { key: 'inv_sharps', label: 'Sharps Container Status', kind: 'flag' },
      { key: 'inv_ppe', label: 'Gloves & PPE', kind: 'flag' },
    ],
  },
];

export const PCR_FIELDS: PcrField[] = PCR_SECTIONS.flatMap((s) => s.fields);
export const INVENTORY_KEYS = PCR_SECTIONS.find((s) => s.id === 'inventory')!.fields.map((f) => f.key);

/** The three sign-off pads, in V4's order. The lead paramedic's is required. */
export const PCR_SIGNATURES = [
  { key: 'responder_signature_image_base64', label: 'Lead Paramedic Signature', required: true, handover: false },
  { key: 'hospital_representative_signature_base64', label: 'Receiving Nurse / Handover', required: false, handover: false },
  { key: 'doctor_signature_image_base64', label: 'Attending Doctor Sign Off', required: false, handover: true },
] as const;

export type SecondaryPatient = { name: string; age: string; gender: string; triage: string; injuries: string };

/** Transported by ambulance or air: the patient is handed over at a hospital. */
export function pcrTransported(answers: Record<string, string>): boolean {
  const mode = answers.transport_mode ?? '';
  return mode === 'Ambulance (Ground)' || mode === 'HEMS (Airlift)';
}

/** Whether a field is showing, given the other answers. */
export function pcrFieldShown(field: PcrField, answers: Record<string, string>): boolean {
  if (field.transportedOnly && !pcrTransported(answers)) return false;
  return !field.when || answers[field.when] === 'Yes';
}

/** Whether a sign-off pad must be signed: the lead always, the receiving doctor at a handover. */
export function pcrSignatureRequired(key: string, answers: Record<string, string>): boolean {
  if (key === 'responder_signature_image_base64') return true;
  return key === 'doctor_signature_image_base64' && pcrTransported(answers);
}

/** "4 - Spontaneously" → 4. */
const score = (v: string | undefined) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : null;
};

/** The Glasgow Coma Scale total, once all three responses are scored. */
export function gcsTotal(answers: Record<string, string>): number | null {
  const parts = [score(answers.gcs_eye), score(answers.gcs_verbal), score(answers.gcs_motor)];
  return parts.every((p) => p !== null) ? (parts as number[]).reduce((a, b) => a + b, 0) : null;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What file_pcr() would refuse: each problem with the fields to fix, so the
 * form can mark them as well as say what is wrong.
 */
export function pcrProblems(answers: Record<string, string>): Array<{ message: string; keys: string[] }> {
  const out: Array<{ message: string; keys: string[] }> = [];
  const has = (k: string) => Boolean((answers[k] ?? '').trim());
  for (const f of PCR_FIELDS) {
    if (f.required && !has(f.key)) out.push({ message: `${f.label} is required.`, keys: [f.key] });
  }
  if (pcrTransported(answers)) {
    if (!has('destination_hospital')) out.push({ message: 'Choose the destination facility.', keys: ['destination_hospital'] });
    if (!has('arrival_time')) out.push({ message: 'Hospital Arrival / Handover Time is required.', keys: ['arrival_time'] });
    if (!has('handover_doctor_name')) out.push({ message: 'Receiving Doctor is required.', keys: ['handover_doctor_name'] });
    if (!has('handover_patient_status')) out.push({ message: 'Patient Status at Handover is required.', keys: ['handover_patient_status'] });
    if (!has('doctor_signature_image_base64')) {
      out.push({ message: 'The receiving doctor must sign.', keys: ['doctor_signature_image_base64'] });
    }
  }
  if ((answers.handover_patient_status ?? '').trim().length > 500) {
    out.push({ message: 'Patient Status at Handover is too long (500 characters).', keys: ['handover_patient_status'] });
  }
  for (const f of PCR_FIELDS) {
    const v = (answers[f.key] ?? '').trim();
    if (!v) continue;
    if (f.kind === 'time' && !TIME.test(v)) out.push({ message: `${f.label} must be a time (HH:MM).`, keys: [f.key] });
    if (f.kind === 'date' && !DATE.test(v)) out.push({ message: `${f.label} must be a date (YYYY-MM-DD).`, keys: [f.key] });
  }
  const pain = score(answers.pain_scale);
  if (has('pain_scale') && (pain === null || pain < 0 || pain > 10)) {
    out.push({ message: 'Pain Scale must be 0 to 10.', keys: ['pain_scale'] });
  }
  if (!has('responder_signature_image_base64')) {
    out.push({ message: 'The lead paramedic must sign.', keys: ['responder_signature_image_base64'] });
  }
  return out;
}

/** What file_pcr() would refuse, in the words the screen shows. */
export function validatePcr(answers: Record<string, string>): string[] {
  return pcrProblems(answers).map((p) => p.message);
}

/**
 * The answers as file_pcr() takes them: hidden fields dropped, text trimmed,
 * ticks as "true", the casualties and the cleaning answer added.
 */
export function pcrPayload(
  answers: Record<string, string>,
  casualties: readonly SecondaryPatient[],
  requiresCleaning: boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of PCR_FIELDS) {
    if (!pcrFieldShown(f, answers)) continue;
    const v = (answers[f.key] ?? '').trim();
    if (f.kind === 'flag') {
      out[f.key] = v === 'true' ? 'true' : 'false';
      continue;
    }
    if (v) out[f.key] = v;
  }
  for (const s of PCR_SIGNATURES) {
    const v = (answers[s.key] ?? '').trim();
    if (v) out[s.key] = v;
  }
  const rows = casualties
    .map((c) => ({ name: c.name.trim(), age: c.age.trim(), gender: c.gender.trim(), triage: c.triage.trim(), injuries: c.injuries.trim() }))
    .filter((c) => c.name || c.age || c.injuries || c.triage);
  out.secondary_patients_json = JSON.stringify(rows);
  out.requires_cleaning = requiresCleaning ? 'true' : 'false';
  return out;
}

/** The ambulance stock items the crew did not tick, by label. */
export function inventoryShort(answers: Record<string, string | boolean | null | undefined>): string[] {
  return PCR_FIELDS.filter((f) => INVENTORY_KEYS.includes(f.key))
    .filter((f) => String(answers[f.key] ?? '') !== 'true')
    .map((f) => f.label);
}

/**
 * A filed report read back, section by section, in V4's order: every answered
 * question, ticked boxes listed under their heading, and the GCS total.
 * The screens and the case PDF use the same readout.
 */
export function pcrReadout(answers: Record<string, string>): Array<{ title: string; items: Array<{ label: string; value: string }> }> {
  return PCR_SECTIONS.map((section) => {
    const items: Array<{ label: string; value: string }> = [];
    let group: string | null = null;
    let ticked: string[] = [];
    let prev: PcrField | null = null;
    const flush = () => {
      if (group && ticked.length) items.push({ label: group, value: ticked.join(', ') });
      ticked = [];
    };
    for (const f of section.fields) {
      if (f.group || f.kind !== 'flag' || prev?.kind !== 'flag') {
        flush();
        group = f.kind === 'flag' ? (f.group ?? null) : null;
      }
      const v = (answers[f.key] ?? '').trim();
      if (f.kind === 'flag') {
        if (v === 'true') {
          if (group) ticked.push(f.label);
          else items.push({ label: f.label, value: 'Yes' });
        }
      } else if (v && pcrFieldShown(f, answers)) {
        items.push({ label: f.label, value: v });
      }
      if (f.key === 'gcs_motor') {
        const total = gcsTotal(answers);
        if (total !== null) items.push({ label: 'GCS total', value: `${total} / 15` });
      }
      prev = f;
    }
    flush();
    return { title: section.title, items };
  }).filter((s) => s.items.length > 0);
}
