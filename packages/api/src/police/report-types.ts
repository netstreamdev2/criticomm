/**
 * Context-aware police case reports (migration 0039, `file_incident_report`).
 *
 * The incident's 10-code / type picks the report: a hijacking asks about the
 * vehicle and tracker, a robbery about what was taken, a crash about the road.
 * Every report shares the response, people, evidence and narrative blocks.
 *
 * Fields marked `column` land in their own `metro_reports` column (the server
 * whitelists exactly these keys); the rest are the type's own answers and are
 * kept, labelled, in `metro_reports.details`. The mobile form and the web
 * report card both read this one definition so they can never disagree.
 */

export type ReportFieldKind = 'text' | 'multiline' | 'yesno' | 'choice' | 'number';

export type ReportField = {
  key: string;
  label: string;
  kind: ReportFieldKind;
  options?: readonly string[];
  placeholder?: string;
  required?: boolean;
  /** Stored in its own metro_reports column rather than in `details`. */
  column?: boolean;
};

export type ReportSection = { title: string; fields: readonly ReportField[] };

export type PoliceReportType = {
  id: string;
  label: string;
  /** One line telling the officer why this form was chosen. */
  summary: string;
  /** Matched against the incident type, category and description. */
  match: RegExp;
  sections: readonly ReportSection[];
};

const col = (f: Omit<ReportField, 'column'>): ReportField => ({ ...f, column: true });

/* ── Shared blocks ────────────────────────────────────────────────────────── */

const RESPONSE: ReportSection = {
  title: 'Response',
  fields: [
    col({ key: 'partner_name', label: 'Partner / crew member', kind: 'text' }),
    col({ key: 'bodycam_active', label: 'Body camera active', kind: 'yesno' }),
    col({
      key: 'use_of_force', label: 'Use of force', kind: 'choice',
      options: ['None', 'Verbal commands', 'Physical restraint', 'Taser', 'Firearm drawn', 'Firearm discharged'],
    }),
  ],
};

const OUTCOME: ReportSection = {
  title: 'Outcome',
  fields: [
    col({ key: 'arrest_made', label: 'Arrest made', kind: 'yesno' }),
    col({ key: 'charges', label: 'Charges / offences', kind: 'text', placeholder: 'e.g. Robbery with aggravating circumstances' }),
  ],
};

const SUSPECT: ReportSection = {
  title: 'Suspect',
  fields: [
    col({ key: 'suspect_name', label: 'Suspect name (if known)', kind: 'text' }),
    col({ key: 'suspect_description', label: 'Suspect description', kind: 'multiline', placeholder: 'Gender, build, clothing, direction of flight…' }),
  ],
};

const VICTIM: ReportSection = {
  title: 'Victim / complainant',
  fields: [
    col({ key: 'victim_name', label: 'Name', kind: 'text' }),
    col({ key: 'victim_id', label: 'ID number', kind: 'text' }),
    col({ key: 'victim_contact', label: 'Contact number', kind: 'text' }),
    col({ key: 'victim_injuries', label: 'Injuries', kind: 'text', placeholder: 'None / describe' }),
  ],
};

const VEHICLE: ReportSection = {
  title: 'Vehicle',
  fields: [
    col({ key: 'vehicle_make', label: 'Make & model', kind: 'text' }),
    { key: 'vehicle_colour', label: 'Colour', kind: 'text' },
    col({ key: 'license_plate', label: 'Registration plate', kind: 'text' }),
    col({ key: 'vin_number', label: 'VIN', kind: 'text' }),
  ],
};

const WEAPON: ReportSection = {
  title: 'Weapon',
  fields: [
    col({
      key: 'weapon_type', label: 'Weapon used', kind: 'choice',
      options: ['None seen', 'Handgun', 'Rifle / shotgun', 'Knife', 'Blunt object', 'Other'],
    }),
    col({ key: 'weapon_size', label: 'Calibre / description', kind: 'text' }),
  ],
};

const EVIDENCE: ReportSection = {
  title: 'Evidence',
  fields: [
    col({ key: 'evidence_weapons', label: 'Weapons booked as evidence', kind: 'yesno' }),
    col({ key: 'evidence_drugs', label: 'Drugs booked as evidence', kind: 'yesno' }),
    col({ key: 'evidence_property', label: 'Property booked as evidence', kind: 'yesno' }),
    col({ key: 'evidence_log', label: 'Evidence log / SAP13 reference', kind: 'text' }),
  ],
};

const NARRATIVE: ReportSection = {
  title: 'Narrative',
  fields: [
    col({
      key: 'officer_narrative', label: 'Officer narrative', kind: 'multiline', required: true,
      placeholder: 'What you found on arrival, what was done, and how the scene was left (min. 20 characters).',
    }),
  ],
};

const wrap = (...specific: ReportSection[]): ReportSection[] => [RESPONSE, ...specific, OUTCOME, EVIDENCE, NARRATIVE];

/* ── Report types, most specific first ────────────────────────────────────── */

export const POLICE_REPORT_TYPES: readonly PoliceReportType[] = [
  {
    id: 'vehicle_crime',
    label: 'Hijacking / vehicle theft',
    summary: 'Vehicle, tracker and modus operandi for circulation.',
    match: /hijack|car ?jack|stolen vehicle|vehicle theft|car theft|theft of (motor )?vehicle/i,
    sections: wrap(
      VEHICLE,
      {
        title: 'Hijacking / theft',
        fields: [
          {
            key: 'modus_operandi', label: 'Modus operandi', kind: 'choice',
            options: ['Hijacked at gunpoint', 'Hijacked at knife point', 'Stolen while parked', 'Keys / remote taken', 'Other'],
          },
          { key: 'tracking_company', label: 'Tracking company (if fitted)', kind: 'text' },
          { key: 'vehicle_recovered', label: 'Vehicle recovered', kind: 'yesno' },
          { key: 'circulated', label: 'Circulated on the stolen vehicle list', kind: 'yesno' },
        ],
      },
      WEAPON, SUSPECT, VICTIM,
    ),
  },
  {
    id: 'robbery',
    label: 'Robbery',
    summary: 'What was taken, from where, and how the suspects left.',
    match: /robbery|hold ?up|mugg|cash.in.transit|cit heist/i,
    sections: wrap(
      {
        title: 'Robbery',
        fields: [
          {
            key: 'premises_type', label: 'Robbed from', kind: 'choice',
            options: ['Person on the street', 'Business', 'Residence', 'Cash-in-transit', 'Vehicle occupant'],
          },
          { key: 'property_taken', label: 'Property taken', kind: 'multiline' },
          { key: 'estimated_value', label: 'Estimated value (R)', kind: 'number' },
          { key: 'suspect_count', label: 'Number of suspects', kind: 'number' },
          { key: 'getaway', label: 'Getaway vehicle / direction', kind: 'text' },
        ],
      },
      WEAPON, SUSPECT, VICTIM,
    ),
  },
  {
    id: 'assault',
    label: 'Assault / violent crime',
    summary: 'Nature of the assault, injuries and protection orders.',
    match: /assault|gbh|domestic|stab|shooting|violence|fight/i,
    sections: wrap(
      {
        title: 'Assault',
        fields: [
          {
            key: 'assault_type', label: 'Type', kind: 'choice',
            options: ['Common assault', 'Assault GBH', 'Domestic violence', 'Sexual assault', 'Stabbing', 'Shooting'],
          },
          { key: 'relationship', label: 'Relationship between victim and suspect', kind: 'text' },
          { key: 'medical_attention', label: 'Victim taken for medical attention', kind: 'yesno' },
          { key: 'protection_order', label: 'Protection order in place', kind: 'yesno' },
        ],
      },
      WEAPON, SUSPECT, VICTIM,
    ),
  },
  {
    id: 'burglary_theft',
    label: 'Burglary / theft',
    summary: 'Point of entry and property stolen.',
    match: /burglar|break.?in|housebreak|theft|shoplift|stolen/i,
    sections: wrap(
      {
        title: 'Burglary / theft',
        fields: [
          {
            key: 'premises_type', label: 'Premises', kind: 'choice',
            options: ['Residence', 'Business', 'School', 'Vehicle', 'Other'],
          },
          { key: 'point_of_entry', label: 'Point of entry', kind: 'text', placeholder: 'e.g. Forced rear door' },
          { key: 'property_taken', label: 'Property taken', kind: 'multiline' },
          { key: 'estimated_value', label: 'Estimated value (R)', kind: 'number' },
          { key: 'alarm_triggered', label: 'Alarm triggered', kind: 'yesno' },
        ],
      },
      SUSPECT, VICTIM,
    ),
  },
  {
    id: 'accident',
    label: 'Motor vehicle accident',
    summary: 'Vehicles, casualties and road conditions.',
    match: /accident|collision|mva|crash|hit.and.run|pedestrian|overturn/i,
    sections: wrap(
      {
        title: 'Collision',
        fields: [
          { key: 'vehicles_involved', label: 'Vehicles involved', kind: 'number' },
          { key: 'injured', label: 'Injured', kind: 'number' },
          { key: 'fatalities', label: 'Fatalities', kind: 'number' },
          {
            key: 'road_conditions', label: 'Road conditions', kind: 'choice',
            options: ['Dry', 'Wet', 'Poor visibility', 'Road works', 'Poor lighting'],
          },
          { key: 'ems_on_scene', label: 'EMS on scene', kind: 'yesno' },
          { key: 'breathalysed', label: 'Driver breathalysed', kind: 'yesno' },
        ],
      },
      VEHICLE,
      {
        title: 'Driver',
        fields: [
          col({ key: 'offender_name', label: 'Driver name', kind: 'text' }),
          col({ key: 'offender_id', label: 'Driver ID / licence number', kind: 'text' }),
        ],
      },
      VICTIM,
    ),
  },
  {
    id: 'traffic',
    label: 'Traffic offence',
    summary: 'Offender, ticket and impoundment.',
    match: /traffic|speed|reckless|negligent driv|drunk driv|dui|drink.driv|roadblock|parking|unlicensed|unroadworthy/i,
    sections: wrap(
      {
        title: 'Offence',
        fields: [
          {
            key: 'offence', label: 'Offence', kind: 'choice',
            options: ['Speeding', 'Reckless / negligent driving', 'Driving under the influence', 'Unlicensed driver', 'Unroadworthy vehicle', 'Parking', 'Other'],
          },
          col({ key: 'offender_name', label: 'Offender name', kind: 'text' }),
          col({ key: 'offender_id', label: 'Offender ID / licence number', kind: 'text' }),
          col({ key: 'ticket_number', label: 'Ticket / notice number', kind: 'text' }),
          col({ key: 'fine_amount', label: 'Fine amount (R)', kind: 'number' }),
        ],
      },
      VEHICLE,
      {
        title: 'Impoundment',
        fields: [
          col({ key: 'vehicle_impounded', label: 'Vehicle impounded', kind: 'yesno' }),
          col({ key: 'impound_lot', label: 'Impound lot', kind: 'text' }),
        ],
      },
    ),
  },
  {
    id: 'public_order',
    label: 'Public order / protest',
    summary: 'Crowd, damage and how the scene was managed.',
    match: /protest|riot|unrest|crowd|march|strike|disturb|noise|gathering|blockade/i,
    sections: wrap({
      title: 'Public order',
      fields: [
        { key: 'crowd_size', label: 'Estimated crowd size', kind: 'number' },
        { key: 'organiser', label: 'Organiser / group', kind: 'text' },
        { key: 'roads_blocked', label: 'Roads blocked', kind: 'text' },
        { key: 'property_damage', label: 'Damage to property', kind: 'yesno' },
        {
          key: 'dispersal', label: 'Dispersal used', kind: 'choice',
          options: ['None — dispersed peacefully', 'Negotiation', 'Rubber rounds', 'Water cannon', 'Stun grenades'],
        },
      ],
    }),
  },
  {
    id: 'firearm_drugs',
    label: 'Firearm / drugs / contraband',
    summary: 'What was seized and how it was booked.',
    match: /firearm|gun|shots fired|ammunition|drug|narcotic|dagga|contraband|illicit/i,
    sections: wrap(
      WEAPON,
      {
        title: 'Seizure',
        fields: [
          col({ key: 'ammunition_rounds', label: 'Rounds of ammunition seized', kind: 'number' }),
          col({ key: 'contraband_seized', label: 'Contraband seized', kind: 'yesno' }),
          col({ key: 'contraband_details', label: 'Contraband details', kind: 'multiline', placeholder: 'Type, quantity, packaging…' }),
        ],
      },
      SUSPECT,
    ),
  },
  {
    id: 'general',
    label: 'General incident',
    summary: 'Standard case report.',
    match: /.*/,
    sections: wrap(SUSPECT, VICTIM),
  },
];

const BY_ID = new Map(POLICE_REPORT_TYPES.map((t) => [t.id, t]));

/** The report a call needs, judged from what the call-taker recorded. */
export function reportTypeFor(incident: {
  incident_type?: string | null;
  incident_category?: string | null;
  call_description?: string | null;
}): PoliceReportType {
  // The type and category say what the call *is*; the description only breaks ties.
  const primary = `${incident.incident_type ?? ''} ${incident.incident_category ?? ''}`;
  const fallback = incident.call_description ?? '';
  return (
    POLICE_REPORT_TYPES.find((t) => t.id !== 'general' && t.match.test(primary))
    ?? POLICE_REPORT_TYPES.find((t) => t.id !== 'general' && t.match.test(fallback))
    ?? BY_ID.get('general')!
  );
}

export function getReportType(id: string | null | undefined): PoliceReportType {
  return (id && BY_ID.get(id)) || BY_ID.get('general')!;
}

/**
 * Split the officer's answers into the whitelisted columns and the type's own
 * details, dropping blanks. Answers are sent as strings, as the server parses.
 */
export function splitReportAnswers(type: PoliceReportType, answers: Record<string, string>) {
  const fields: Record<string, string> = {};
  const details: Record<string, string> = {};
  for (const section of type.sections) {
    for (const f of section.fields) {
      const v = (answers[f.key] ?? '').trim();
      if (!v) continue;
      (f.column ? fields : details)[f.key] = v;
    }
  }
  return { fields, details };
}

/** Problems that stop the report being filed, in form order. */
export function validateReportAnswers(type: PoliceReportType, answers: Record<string, string>) {
  const problems: string[] = [];
  for (const section of type.sections) {
    for (const f of section.fields) {
      const v = (answers[f.key] ?? '').trim();
      if (f.required && !v) problems.push(`${f.label} is required.`);
      if (f.kind === 'number' && v && !/^\d+(\.\d+)?$/.test(v)) problems.push(`${f.label} must be a number.`);
    }
  }
  const narrative = (answers.officer_narrative ?? '').trim();
  if (narrative && narrative.length < 20) problems.push('The narrative needs at least 20 characters.');
  return problems;
}

/** Labelled type-specific answers for display (web report card, PDF). */
export function describeReportDetails(type: PoliceReportType, details: Record<string, unknown> | null | undefined) {
  const out: Array<{ label: string; value: string }> = [];
  if (!details) return out;
  const seen = new Set<string>();
  for (const section of type.sections) {
    for (const f of section.fields) {
      if (f.column || seen.has(f.key)) continue;
      seen.add(f.key);
      const v = details[f.key];
      if (v === undefined || v === null || v === '') continue;
      out.push({ label: f.label, value: String(v) });
    }
  }
  return out;
}
