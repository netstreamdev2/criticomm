import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPcr } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PCR · Criticom' };

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '' || value === false) return null;
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-sm">{value === true ? 'Yes' : value}</p>
    </div>
  );
}

type Nested = { [k: string]: string | null } | null;

export default async function PcrDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getSession();
  const p = await getPcr(supabase, id).catch(() => null);
  if (!p) notFound();

  const vitals = (p as { vitals?: Nested }).vitals;
  const assessment = (p as { assessment?: Nested }).assessment;
  const history = (p as { medical_history?: Nested }).medical_history;
  const interventions = (p as { interventions?: Nested }).interventions;

  const skin = [
    p.skin_unremarkable && 'unremarkable', p.skin_cool && 'cool', p.skin_pale && 'pale',
    p.skin_diaphoretic && 'diaphoretic', p.skin_cyanotic && 'cyanotic', p.skin_moist && 'moist',
    p.skin_flush && 'flushed', p.skin_dry && 'dry',
  ].filter(Boolean).join(', ');

  const inventory = [
    p.inv_oxygen && 'oxygen', p.inv_bvm && 'BVM', p.inv_suction && 'suction', p.inv_iv && 'IV',
    p.inv_bandages && 'bandages', p.inv_aed && 'AED', p.inv_drugs && 'drugs',
    p.inv_sharps && 'sharps', p.inv_ppe && 'PPE',
  ].filter(Boolean).join(', ');

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{p.patient_name ?? 'Unknown patient'}</h1>
          <p className="text-muted-foreground">
            PCR · created {formatSaTime(p.created_at)} · updated {formatSaTime(p.updated_at)}
          </p>
        </div>
        <Link href={`/medical/pcr/${p.id}/edit`} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold">
          Edit PCR
        </Link>
      </header>

      <Card>
        <CardHeader><CardTitle>Patient</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Item label="DOB / age" value={p.date_of_birth ? `${p.date_of_birth} (${p.age ?? '?'})` : p.age} />
          <Item label="Gender" value={p.gender} />
          <Item label="ID number" value={p.identification_number} />
          <Item label="Contact" value={p.contact_number} />
          <Item label="Address" value={p.address} />
          <Item label="Next of kin" value={p.next_of_kin} />
          <Item label="Allergies" value={p.allergies} />
          <Item label="Weight" value={p.weight} />
          <Item label="Insurance" value={p.has_insurance === 'Yes' ? p.insurance_information ?? 'Yes' : p.has_insurance} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Clinical picture</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Item label="Chief complaint" value={p.chief_complaint} />
          <Item label="Mechanism of injury" value={p.mechanism_of_injury} />
          <Item label="Presenting problem" value={p.presenting_problem} />
          <Item label="Scene assessment" value={p.scene_assessment} />
          <Item label="LOC" value={p.level_of_consciousness} />
          <Item label="GCS (E/V/M)" value={p.gcs_eye ? `${p.gcs_eye}/${p.gcs_verbal}/${p.gcs_motor}` : null} />
          <Item label="Pain scale" value={p.pain_scale} />
          <Item label="Pupils" value={p.pupils} />
          <Item label="Skin" value={skin || null} />
          {vitals && (
            <>
              <Item label="BP" value={vitals.blood_pressure} />
              <Item label="Pulse" value={vitals.pulse_rate} />
              <Item label="Resp rate" value={vitals.respiratory_rate} />
              <Item label="SpO₂" value={vitals.oxygen_saturation} />
              <Item label="GCS total" value={vitals.glasgow_coma_scale} />
              <Item label="Glucose" value={vitals.blood_glucose_level} />
              <Item label="Temp" value={vitals.temperature} />
              <Item label="ECG" value={vitals.ecg} />
            </>
          )}
        </CardContent>
      </Card>

      {assessment && (
        <Card>
          <CardHeader><CardTitle>Assessment findings</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Item label="Primary survey" value={assessment.primary_survey} />
            <Item label="Secondary survey" value={assessment.secondary_survey} />
            <Item label="Head & neck" value={assessment.head_neck} />
            <Item label="Chest" value={assessment.chest} />
            <Item label="Abdomen" value={assessment.abdomen} />
            <Item label="Pelvis" value={assessment.pelvis} />
            <Item label="Extremities" value={assessment.extremities} />
            <Item label="Back" value={assessment.back} />
            <Item label="Neuro" value={assessment.neuro} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>History & interventions</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {history && (
            <>
              <Item label="Allergies (hx)" value={history.allergies} />
              <Item label="Chronic conditions" value={history.chronic_conditions} />
              <Item label="Regular meds" value={history.medications} />
            </>
          )}
          {interventions && (
            <>
              <Item label="Airway" value={interventions.airway_management} />
              <Item label="Ventilation" value={interventions.ventilation_support} />
              <Item label="Circulation" value={interventions.circulation_management} />
              <Item label="Wound care" value={interventions.wound_care} />
              <Item label="Splinting" value={interventions.splinting} />
              <Item label="Medication" value={interventions.medication_admin} />
              <Item label="Other" value={interventions.other} />
            </>
          )}
          <Item label="Med time/dose/route" value={p.medication_dosage ? `${p.medication_time ?? ''} ${p.medication_dosage} ${p.medication_route ?? ''}` : null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Transport, narrative & inventory</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Item label="Destination" value={p.destination_hospital} />
          <Item label="Transport" value={p.transport_mode} />
          <Item label="Level of care" value={p.level_of_care} />
          <Item label="Crew" value={p.paramedic_names} />
          <Item label="Inventory used" value={inventory || null} />
          <Item label="Requires cleaning" value={p.requires_cleaning} />
          <div className="sm:col-span-3">
            <Item label="Treatment narrative" value={p.treatment_narrative && <span className="whitespace-pre-wrap">{p.treatment_narrative}</span>} />
          </div>
          <div className="sm:col-span-3">
            <Item label="Patient response" value={p.patient_response} />
          </div>
        </CardContent>
      </Card>

      {(p.responder_signature_image_base64 || p.hospital_representative_signature_base64 || p.doctor_signature_image_base64) && (
        <Card>
          <CardHeader><CardTitle>Signatures</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {([
              ['Responder', p.responder_signature_image_base64],
              ['Hospital representative', p.hospital_representative_signature_base64],
              ['Receiving doctor', p.doctor_signature_image_base64],
            ] as const).map(([label, sig]) => sig && (
              <div key={label}>
                <p className="mb-1 text-xs uppercase text-muted-foreground">{label}</p>
                <img
                  src={`data:image/png;base64,${sig}`}
                  alt={`${label} signature`}
                  className="w-full rounded-md border border-border bg-white"
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
