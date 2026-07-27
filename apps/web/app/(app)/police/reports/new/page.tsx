import { FormSection, TextField, TextAreaField, SelectField, CheckField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { createMetroReportAction } from '../../actions';

export const metadata = { title: 'New Police Report · Criticom' };

const WIZARDS = ['Arrest', 'Accident', 'Vehicle', 'Firearm', 'Incident', 'Tow', 'Dog'];

export default async function NewMetroReportPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { fullName } = await getSession();
  const { type } = await searchParams;
  const category = WIZARDS.includes(type ?? '') ? type! : 'Incident';
  const showVehicle = ['Accident', 'Vehicle', 'Tow'].includes(category);
  const showArrest = ['Arrest', 'Incident', 'Dog'].includes(category);
  const showFirearm = category === 'Firearm';

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">New {category.toLowerCase()} report</h1>
        <p className="text-muted-foreground">Metro police field report — {category} wizard.</p>
      </header>

      <form action={createMetroReportAction} className="space-y-4">
        <input type="hidden" name="incident_category" value={category} />

        <FormSection title="Incident">
          <TextField name="case_number" label="Case number" placeholder="Auto-generated if blank" />
          <TextField name="date_of_offense" label="Date of offense" type="date" required
            defaultValue={new Date().toISOString().slice(0, 10)} />
          <TextField name="time_of_offense" label="Time of offense" type="time" />
          <TextField name="location" label="Location" required className="sm:col-span-2" />
          <TextField name="station" label="Station" />
        </FormSection>

        <FormSection title="Officer">
          <TextField name="officer_name" label="Officer name" defaultValue={fullName} required />
          <TextField name="badge_number" label="Badge number" />
          <TextField name="partner_name" label="Partner name" />
          <CheckField name="bodycam_active" label="Bodycam active" defaultChecked />
          <SelectField name="use_of_force" label="Use of force"
            options={['None', 'Verbal', 'Physical restraint', 'Non-lethal weapon', 'Firearm discharged']} />
        </FormSection>

        {showVehicle && (
          <FormSection title="Vehicle">
            <TextField name="vehicle_make" label="Vehicle make/model" />
            <TextField name="license_plate" label="License plate" />
            <TextField name="vin_number" label="VIN" />
            <TextField name="reg_number" label="Registration number" />
            <CheckField name="vehicle_impounded" label="Vehicle impounded" />
            <TextField name="impound_lot" label="Impound lot" />
          </FormSection>
        )}

        {showArrest && (
          <FormSection title="Suspect / arrest">
            <CheckField name="arrest_made" label="Arrest made" />
            <TextField name="suspect_name" label="Suspect name" />
            <TextField name="offender_id" label="Suspect ID number" />
            <TextAreaField name="suspect_description" label="Suspect description" className="sm:col-span-2 lg:col-span-3" />
            <TextAreaField name="charges" label="Charges" className="sm:col-span-2 lg:col-span-3" />
          </FormSection>
        )}

        {showFirearm && (
          <FormSection title="Firearm">
            <SelectField name="weapon_type" label="Weapon type"
              options={['Pistol', 'Rifle', 'Shotgun', 'Other']} />
            <TextField name="weapon_size" label="Calibre" />
            <TextField name="ammunition_rounds" label="Rounds involved" type="number" defaultValue={0} />
            <TextField name="contraband_seized" label="Contraband seized" />
            <TextAreaField name="contraband_details" label="Contraband details" className="sm:col-span-2 lg:col-span-3" />
          </FormSection>
        )}

        <FormSection title="Offender & fines">
          <TextField name="offender_name" label="Offender name" />
          <TextField name="ticket_number" label="Ticket number" />
          <TextField name="fine_amount" label="Total fine (R)" type="number" step="0.01" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid grid-cols-[1fr_110px] gap-2 sm:col-span-2 lg:col-span-3">
              <TextField name={`offense_type_${i}`} label={`Offense ${i + 1}`} placeholder="e.g. Exceeding speed limit" />
              <TextField name={`offense_fine_${i}`} label="Fine (R)" type="number" />
            </div>
          ))}
        </FormSection>

        <FormSection title="Victim">
          <TextField name="victim_name" label="Victim name" />
          <TextField name="victim_contact" label="Victim contact" />
          <TextField name="victim_id" label="Victim ID" />
          <TextAreaField name="victim_injuries" label="Injuries" className="sm:col-span-2 lg:col-span-3" />
        </FormSection>

        <FormSection title="Evidence">
          <CheckField name="evidence_weapons" label="Weapons" />
          <CheckField name="evidence_drugs" label="Drugs" />
          <CheckField name="evidence_property" label="Property" />
          <TextAreaField name="evidence_log" label="Evidence log" className="sm:col-span-2 lg:col-span-3" />
        </FormSection>

        <FormSection title="Narrative">
          <TextAreaField name="officer_narrative" label="Officer narrative" rows={5} required className="sm:col-span-2 lg:col-span-3" />
        </FormSection>

        <button type="submit" className="h-11 w-full rounded-md bg-primary text-sm font-semibold">
          File report
        </button>
      </form>
    </div>
  );
}
