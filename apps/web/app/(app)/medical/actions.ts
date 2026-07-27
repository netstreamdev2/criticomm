'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createPcr, updatePcr, addRestock, logAudit } from '@criticom/api';
import { getSession } from '@/lib/session';

const S = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? null : v;
};
const B = (fd: FormData, k: string) => fd.get(k) === 'on';
const N = (fd: FormData, k: string) => {
  const v = Number(fd.get(k));
  return Number.isFinite(v) ? v : null;
};

function pcrFields(fd: FormData) {
  return {
    patient_name: S(fd, 'patient_name'),
    date_of_birth: S(fd, 'date_of_birth'),
    gender: S(fd, 'gender'),
    age: N(fd, 'age'),
    address: S(fd, 'address'),
    contact_number: S(fd, 'contact_number'),
    identification_number: S(fd, 'identification_number'),
    next_of_kin: S(fd, 'next_of_kin'),
    language: S(fd, 'language'),
    weight: S(fd, 'weight'),
    allergies: S(fd, 'allergies'),
    insurance_information: S(fd, 'insurance_information'),
    has_insurance: S(fd, 'has_insurance'),
    incident_location: S(fd, 'incident_location'),
    mechanism_of_injury: S(fd, 'mechanism_of_injury'),
    scene_assessment: S(fd, 'scene_assessment'),
    chief_complaint: S(fd, 'chief_complaint'),
    nature_of_illness: S(fd, 'nature_of_illness'),
    presenting_problem: S(fd, 'presenting_problem'),
    current_medications: S(fd, 'current_medications'),
    risk_of_harm: S(fd, 'risk_of_harm'),
    protocol_adherence: B(fd, 'protocol_adherence'),
    psych_danger_to_self_or_others: B(fd, 'psych_danger_to_self_or_others'),
    psych_health_risk: B(fd, 'psych_health_risk'),
    level_of_consciousness: S(fd, 'level_of_consciousness'),
    alert_and_oriented: S(fd, 'alert_and_oriented'),
    gcs_eye: S(fd, 'gcs_eye'),
    gcs_verbal: S(fd, 'gcs_verbal'),
    gcs_motor: S(fd, 'gcs_motor'),
    stroke_assessment: S(fd, 'stroke_assessment'),
    pain_scale: N(fd, 'pain_scale'),
    pupils: S(fd, 'pupils'),
    skin_unremarkable: B(fd, 'skin_unremarkable'),
    skin_cool: B(fd, 'skin_cool'),
    skin_pale: B(fd, 'skin_pale'),
    skin_diaphoretic: B(fd, 'skin_diaphoretic'),
    skin_cyanotic: B(fd, 'skin_cyanotic'),
    skin_moist: B(fd, 'skin_moist'),
    skin_flush: B(fd, 'skin_flush'),
    skin_dry: B(fd, 'skin_dry'),
    medication_time: S(fd, 'medication_time'),
    medication_dosage: S(fd, 'medication_dosage'),
    medication_route: S(fd, 'medication_route'),
    medication_comments: S(fd, 'medication_comments'),
    destination_hospital: S(fd, 'destination_hospital'),
    transport_mode: S(fd, 'transport_mode'),
    level_of_care: S(fd, 'level_of_care'),
    treatment_narrative: S(fd, 'treatment_narrative'),
    patient_response: S(fd, 'patient_response'),
    paramedic_names: S(fd, 'paramedic_names'),
    paramedic_ids: S(fd, 'paramedic_ids'),
    inv_oxygen: B(fd, 'inv_oxygen'),
    inv_bvm: B(fd, 'inv_bvm'),
    inv_suction: B(fd, 'inv_suction'),
    inv_iv: B(fd, 'inv_iv'),
    inv_bandages: B(fd, 'inv_bandages'),
    inv_aed: B(fd, 'inv_aed'),
    inv_drugs: B(fd, 'inv_drugs'),
    inv_sharps: B(fd, 'inv_sharps'),
    inv_ppe: B(fd, 'inv_ppe'),
    requires_cleaning: B(fd, 'requires_cleaning'),
    responder_signature_image_base64: S(fd, 'responder_signature_image_base64'),
    hospital_representative_signature_base64: S(fd, 'hospital_representative_signature_base64'),
    doctor_signature_image_base64: S(fd, 'doctor_signature_image_base64'),
  };
}

export async function createPcrAction(formData: FormData) {
  const { supabase, fullName } = await getSession();

  const pcr = await createPcr(supabase, pcrFields(formData), {
    vitals: {
      blood_pressure: S(formData, 'blood_pressure'),
      pulse_rate: S(formData, 'pulse_rate'),
      respiratory_rate: S(formData, 'respiratory_rate'),
      oxygen_saturation: S(formData, 'oxygen_saturation'),
      glasgow_coma_scale: S(formData, 'glasgow_coma_scale'),
      blood_glucose_level: S(formData, 'blood_glucose_level'),
      temperature: S(formData, 'temperature'),
      ecg: S(formData, 'ecg'),
    },
    assessment: {
      primary_survey: S(formData, 'primary_survey'),
      secondary_survey: S(formData, 'secondary_survey'),
      head_neck: S(formData, 'head_neck'),
      chest: S(formData, 'chest'),
      abdomen: S(formData, 'abdomen'),
      pelvis: S(formData, 'pelvis'),
      extremities: S(formData, 'extremities'),
      back: S(formData, 'back'),
      neuro: S(formData, 'neuro'),
    },
    medical_history: {
      allergies: S(formData, 'hist_allergies'),
      chronic_conditions: S(formData, 'hist_chronic_conditions'),
      medications: S(formData, 'hist_medications'),
    },
    interventions: {
      airway_management: S(formData, 'airway_management'),
      ventilation_support: S(formData, 'ventilation_support'),
      circulation_management: S(formData, 'circulation_management'),
      wound_care: S(formData, 'wound_care'),
      splinting: S(formData, 'splinting'),
      medication_admin: S(formData, 'medication_admin'),
      other: S(formData, 'interventions_other'),
    },
  });

  await logAudit(supabase, {
    silo: 'Medical', action_type: 'PCRCreated', entity_type: 'paramedic_report',
    entity_id: pcr.id, user_name: fullName, details: pcr.chief_complaint ?? undefined,
  });
  revalidatePath('/medical/pcr');
  redirect(`/medical/pcr/${pcr.id}`);
}

export async function updatePcrAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const id = String(formData.get('pcr_id'));
  await updatePcr(supabase, id, pcrFields(formData));
  await logAudit(supabase, {
    silo: 'Medical', action_type: 'PCRUpdated', entity_type: 'paramedic_report',
    entity_id: id, user_name: fullName,
  });
  revalidatePath(`/medical/pcr/${id}`);
  redirect(`/medical/pcr/${id}`);
}

export async function addRestockAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  await addRestock(supabase, {
    unit_id: String(formData.get('unit_id')),
    drug_name: String(formData.get('drug_name')),
    qty_used: Number(formData.get('qty_used')) || 0,
    qty_remaining: Number(formData.get('qty_remaining')) || 0,
    last_checked_by: fullName,
  });
  revalidatePath('/medical/restock');
}
