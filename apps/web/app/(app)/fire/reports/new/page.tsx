import { FormSection, TextField, TextAreaField, SelectField, CheckField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { createFireReportAction } from '../../actions';
import { requestT } from '@/lib/i18n';

export const metadata = { title: 'New Fire Report · HikTech' };

const INCIDENT_TYPES = [
  'Structure Fire', 'Vehicle Fire', 'Wildland/Veld Fire', 'Rubbish Fire', 'Electrical Fire',
  'Hazmat Incident', 'Rescue — Vehicle Extrication', 'Rescue — Water', 'Rescue — Heights',
  'Medical Assist', 'False Alarm', 'Other',
];

export default async function NewFireReportPage() {
  const { t } = await requestT();
  const { fullName } = await getSession();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{t('Fire incident report')}</h1>
        <p className="text-muted-foreground">
          {t('Every section, from observations to sign-off.')}</p>
      </header>

      <form action={createFireReportAction} className="space-y-4">
        <FormSection title={t('Incident')}>
          <TextField name="report_number" label={t('Report number')} placeholder={t('Auto-generated if blank')} />
          <TextField name="date_of_incident" label={t('Date')} type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <TextField name="time_of_incident" label={t('Time')} type="time" required />
          <SelectField name="type_of_incident" label={t('Incident type')} options={INCIDENT_TYPES} required />
          <TextField name="location" label={t('Location')} required className="sm:col-span-2" />
          <TextField name="fire_department_name" label={t('Department')} defaultValue="eThekwini Fire & Emergency Services" />
          <TextField name="station_number" label={t('Station number')} />
        </FormSection>

        <FormSection title={t('Response timings (minutes)')}>
          <TextField name="dispatch_minutes" label={t('Dispatch time')} type="number" defaultValue={0} />
          <TextField name="arrival_minutes" label={t('Arrival time')} type="number" defaultValue={0} />
          <TextField name="clear_minutes" label={t('Clear time')} type="number" defaultValue={0} />
          <TextField name="total_minutes" label={t('Total time on scene')} type="number" defaultValue={0} />
        </FormSection>

        <FormSection title={t('Scene observations')}>
          <SelectField name="smoke_conditions" label={t('Smoke conditions')} options={['None', 'Light', 'Moderate', 'Heavy', 'Turbulent/black']} />
          <SelectField name="flame_spread" label={t('Flame spread')} options={['None', 'Contained to object', 'Contained to room', 'Multiple rooms', 'Whole structure', 'Exposures threatened']} />
          <SelectField name="heat_signature" label={t('Heat signature')} options={['Low', 'Moderate', 'High', 'Extreme']} />
          <TextAreaField name="initial_observations" label={t('Initial observations')} className="sm:col-span-2 lg:col-span-3" />
          <TextAreaField name="hazards_identified" label={t('Hazards identified')} className="sm:col-span-2 lg:col-span-3" />
        </FormSection>

        <FormSection title={t('Operations')}>
          <TextAreaField name="fire_suppression_details" label={t('Suppression details')} className="sm:col-span-2 lg:col-span-3" />
          <CheckField name="search_and_rescue_performed" label={t('Search & rescue performed')} />
          <TextField name="persons_rescued" label={t('Persons rescued')} type="number" defaultValue={0} />
          <TextField name="rescue_location" label={t('Rescue location')} />
          <TextField name="rescue_condition" label={t('Condition of rescued')} />
          <CheckField name="ventilation_conducted" label={t('Ventilation conducted')} />
          <SelectField name="ventilation_type" label={t('Ventilation type')} options={['', 'Horizontal', 'Vertical', 'Positive pressure', 'Hydraulic']} />
          <CheckField name="salvage_overhaul" label={t('Salvage / overhaul')} />
          <CheckField name="hazmat_operations" label={t('Hazmat operations')} />
          <TextField name="hazmat_description" label={t('Hazmat description')} />
          <CheckField name="medical_aid_provided" label={t('Medical aid provided')} />
          <TextField name="medical_aid_description" label={t('Medical aid description')} />
          <CheckField name="utilities_secured" label={t('Utilities secured')} />
          <TextField name="utility_details" label={t('Utility details')} />
        </FormSection>

        <FormSection title={t('Origin & cause')}>
          <TextField name="point_of_origin_room" label={t('Point of origin — room/area')} />
          <TextField name="point_of_origin_object" label={t('Point of origin — object')} />
          <TextField name="ignition_source" label={t('Ignition source')} />
          <SelectField name="fire_cause" label={t('Fire cause')} options={['Undetermined', 'Accidental', 'Natural', 'Incendiary/arson suspected', 'Under investigation']} />
          <CheckField name="fire_investigation_conducted" label={t('Investigation conducted')} />
          <TextField name="fire_investigation_reason" label={t('Investigation reason')} />
        </FormSection>

        <FormSection title={t('Property & damage')}>
          <SelectField name="property_type" label={t('Property type')} options={['Residential', 'Commercial', 'Industrial', 'Informal settlement', 'Vehicle', 'Open land', 'Municipal', 'Other']} />
          <TextField name="property_owner" label={t('Property owner')} />
          <TextField name="property_contact" label={t('Owner contact')} />
          <TextField name="property_value" label={t('Property value (R)')} type="number" defaultValue={0} />
          <TextField name="damage_estimate" label={t('Damage estimate (R)')} type="number" defaultValue={0} />
          <TextField name="contents_value" label={t('Contents value (R)')} type="number" defaultValue={0} />
          <TextField name="insurance_info" label={t('Insurance info')} className="sm:col-span-2" />
        </FormSection>

        <FormSection title={t('Casualties')}>
          <TextField name="civilian_injuries" label={t('Civilian injuries')} type="number" defaultValue={0} />
          <TextField name="civilian_fatalities" label={t('Civilian fatalities')} type="number" defaultValue={0} />
          <TextField name="firefighter_injuries" label={t('Firefighter injuries')} type="number" defaultValue={0} />
          <TextField name="firefighter_fatalities" label={t('Firefighter fatalities')} type="number" defaultValue={0} />
          <TextAreaField name="civilian_injury_details" label={t('Civilian injury details')} />
          <TextAreaField name="civilian_fatality_details" label={t('Civilian fatality details')} />
          <TextAreaField name="firefighter_injury_details" label={t('Firefighter injury details')} />
          <TextAreaField name="firefighter_fatality_details" label={t('Firefighter fatality details')} />
          <CheckField name="treatment_provided" label={t('Treatment provided on scene')} />
          <TextField name="treatment_details" label={t('Treatment details')} />
        </FormSection>

        <FormSection title={t('Coordination & review')}>
          <TextField name="other_agencies_on_scene" label={t('Other agencies on scene')} />
          <CheckField name="mutual_aid_used" label={t('Mutual aid used')} />
          <TextField name="equipment_used" label={t('Equipment used')} />
          <TextAreaField name="challenges_faced" label={t('Challenges faced')} />
          <TextAreaField name="successes" label={t('Successes')} />
          <TextAreaField name="recommendations" label={t('Recommendations')} />
          <CheckField name="post_incident_critique_scheduled" label={t('Post-incident critique scheduled')} />
        </FormSection>

        <FormSection title={t('Narrative & sign-off')}>
          <TextAreaField name="narrative_summary" label={t('Narrative summary')} rows={5} required className="sm:col-span-2 lg:col-span-3" />
          <TextField name="reporting_officer_name" label={t('Reporting officer')} defaultValue={fullName} required />
          <TextField name="reporting_officer_rank" label={t('Rank')} />
          <TextField name="reporting_officer_id" label={t('Officer ID')} />
        </FormSection>

        <button type="submit" className="h-11 w-full rounded-md bg-primary text-sm font-semibold">
          {t('Submit fire report')}</button>
      </form>
    </div>
  );
}
