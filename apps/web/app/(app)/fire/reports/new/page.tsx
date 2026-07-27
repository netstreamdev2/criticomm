import { FormSection, TextField, TextAreaField, SelectField, CheckField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { createFireReportAction } from '../../actions';

export const metadata = { title: 'New Fire Report · Criticom' };

const INCIDENT_TYPES = [
  'Structure Fire', 'Vehicle Fire', 'Wildland/Veld Fire', 'Rubbish Fire', 'Electrical Fire',
  'Hazmat Incident', 'Rescue — Vehicle Extrication', 'Rescue — Water', 'Rescue — Heights',
  'Medical Assist', 'False Alarm', 'Other',
];

export default async function NewFireReportPage() {
  const { fullName } = await getSession();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Fire incident report</h1>
        <p className="text-muted-foreground">
          Full V4 FirefighterReport — every section from observations to sign-off.
        </p>
      </header>

      <form action={createFireReportAction} className="space-y-4">
        <FormSection title="Incident">
          <TextField name="report_number" label="Report number" placeholder="Auto-generated if blank" />
          <TextField name="date_of_incident" label="Date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <TextField name="time_of_incident" label="Time" type="time" required />
          <SelectField name="type_of_incident" label="Incident type" options={INCIDENT_TYPES} required />
          <TextField name="location" label="Location" required className="sm:col-span-2" />
          <TextField name="fire_department_name" label="Department" defaultValue="eThekwini Fire & Emergency Services" />
          <TextField name="station_number" label="Station number" />
        </FormSection>

        <FormSection title="Response timings (minutes)">
          <TextField name="dispatch_minutes" label="Dispatch time" type="number" defaultValue={0} />
          <TextField name="arrival_minutes" label="Arrival time" type="number" defaultValue={0} />
          <TextField name="clear_minutes" label="Clear time" type="number" defaultValue={0} />
          <TextField name="total_minutes" label="Total time on scene" type="number" defaultValue={0} />
        </FormSection>

        <FormSection title="Scene observations">
          <SelectField name="smoke_conditions" label="Smoke conditions" options={['None', 'Light', 'Moderate', 'Heavy', 'Turbulent/black']} />
          <SelectField name="flame_spread" label="Flame spread" options={['None', 'Contained to object', 'Contained to room', 'Multiple rooms', 'Whole structure', 'Exposures threatened']} />
          <SelectField name="heat_signature" label="Heat signature" options={['Low', 'Moderate', 'High', 'Extreme']} />
          <TextAreaField name="initial_observations" label="Initial observations" className="sm:col-span-2 lg:col-span-3" />
          <TextAreaField name="hazards_identified" label="Hazards identified" className="sm:col-span-2 lg:col-span-3" />
        </FormSection>

        <FormSection title="Operations">
          <TextAreaField name="fire_suppression_details" label="Suppression details" className="sm:col-span-2 lg:col-span-3" />
          <CheckField name="search_and_rescue_performed" label="Search & rescue performed" />
          <TextField name="persons_rescued" label="Persons rescued" type="number" defaultValue={0} />
          <TextField name="rescue_location" label="Rescue location" />
          <TextField name="rescue_condition" label="Condition of rescued" />
          <CheckField name="ventilation_conducted" label="Ventilation conducted" />
          <SelectField name="ventilation_type" label="Ventilation type" options={['', 'Horizontal', 'Vertical', 'Positive pressure', 'Hydraulic']} />
          <CheckField name="salvage_overhaul" label="Salvage / overhaul" />
          <CheckField name="hazmat_operations" label="Hazmat operations" />
          <TextField name="hazmat_description" label="Hazmat description" />
          <CheckField name="medical_aid_provided" label="Medical aid provided" />
          <TextField name="medical_aid_description" label="Medical aid description" />
          <CheckField name="utilities_secured" label="Utilities secured" />
          <TextField name="utility_details" label="Utility details" />
        </FormSection>

        <FormSection title="Origin & cause">
          <TextField name="point_of_origin_room" label="Point of origin — room/area" />
          <TextField name="point_of_origin_object" label="Point of origin — object" />
          <TextField name="ignition_source" label="Ignition source" />
          <SelectField name="fire_cause" label="Fire cause" options={['Undetermined', 'Accidental', 'Natural', 'Incendiary/arson suspected', 'Under investigation']} />
          <CheckField name="fire_investigation_conducted" label="Investigation conducted" />
          <TextField name="fire_investigation_reason" label="Investigation reason" />
        </FormSection>

        <FormSection title="Property & damage">
          <SelectField name="property_type" label="Property type" options={['Residential', 'Commercial', 'Industrial', 'Informal settlement', 'Vehicle', 'Open land', 'Municipal', 'Other']} />
          <TextField name="property_owner" label="Property owner" />
          <TextField name="property_contact" label="Owner contact" />
          <TextField name="property_value" label="Property value (R)" type="number" defaultValue={0} />
          <TextField name="damage_estimate" label="Damage estimate (R)" type="number" defaultValue={0} />
          <TextField name="contents_value" label="Contents value (R)" type="number" defaultValue={0} />
          <TextField name="insurance_info" label="Insurance info" className="sm:col-span-2" />
        </FormSection>

        <FormSection title="Casualties">
          <TextField name="civilian_injuries" label="Civilian injuries" type="number" defaultValue={0} />
          <TextField name="civilian_fatalities" label="Civilian fatalities" type="number" defaultValue={0} />
          <TextField name="firefighter_injuries" label="Firefighter injuries" type="number" defaultValue={0} />
          <TextField name="firefighter_fatalities" label="Firefighter fatalities" type="number" defaultValue={0} />
          <TextAreaField name="civilian_injury_details" label="Civilian injury details" />
          <TextAreaField name="civilian_fatality_details" label="Civilian fatality details" />
          <TextAreaField name="firefighter_injury_details" label="Firefighter injury details" />
          <TextAreaField name="firefighter_fatality_details" label="Firefighter fatality details" />
          <CheckField name="treatment_provided" label="Treatment provided on scene" />
          <TextField name="treatment_details" label="Treatment details" />
        </FormSection>

        <FormSection title="Coordination & review">
          <TextField name="other_agencies_on_scene" label="Other agencies on scene" />
          <CheckField name="mutual_aid_used" label="Mutual aid used" />
          <TextField name="equipment_used" label="Equipment used" />
          <TextAreaField name="challenges_faced" label="Challenges faced" />
          <TextAreaField name="successes" label="Successes" />
          <TextAreaField name="recommendations" label="Recommendations" />
          <CheckField name="post_incident_critique_scheduled" label="Post-incident critique scheduled" />
        </FormSection>

        <FormSection title="Narrative & sign-off">
          <TextAreaField name="narrative_summary" label="Narrative summary" rows={5} required className="sm:col-span-2 lg:col-span-3" />
          <TextField name="reporting_officer_name" label="Reporting officer" defaultValue={fullName} required />
          <TextField name="reporting_officer_rank" label="Rank" />
          <TextField name="reporting_officer_id" label="Officer ID" />
        </FormSection>

        <button type="submit" className="h-11 w-full rounded-md bg-primary text-sm font-semibold">
          Submit fire report
        </button>
      </form>
    </div>
  );
}
