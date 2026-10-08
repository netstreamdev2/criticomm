/**
 * The fire incident report (migration 0059): the firefighter's close-out of a
 * Fire incident, as data. The phone builds its form from these sections and
 * checks it with validateFireReport(); file_fire_report() checks the same
 * things again and has the final word. Keys are firefighter_reports columns.
 */

export const FIRE_INCIDENT_TYPES = [
  'Structure Fire', 'Vehicle Fire', 'Veld / Grass Fire', 'Rubbish Fire', 'Electrical Fire',
  'Hazmat Incident', 'Rescue — Vehicle Extrication', 'Rescue — Water', 'Rescue — Heights',
  'Medical Assist', 'False Alarm', 'Other',
] as const;
export const SMOKE_CONDITIONS = ['None', 'Light', 'Moderate', 'Heavy', 'Turbulent / black'] as const;
export const FLAME_SPREAD = ['None', 'Contained to object', 'Contained to room', 'Multiple rooms', 'Whole structure', 'Exposures threatened'] as const;
export const HEAT_SIGNATURE = ['Low', 'Moderate', 'High', 'Extreme'] as const;
export const VENTILATION_TYPES = ['None', 'Horizontal', 'Vertical', 'Positive pressure', 'Hydraulic'] as const;
export const FIRE_CAUSES = [
  'Under investigation', 'Accidental', 'Electrical fault', 'Deliberate / incendiary', 'Natural', 'Undetermined',
] as const;

export type FireField = {
  key: string;
  label: string;
  kind: 'text' | 'multiline' | 'select' | 'yesno' | 'count' | 'money';
  options?: readonly string[];
  placeholder?: string;
  required?: boolean;
  /** Shown only when another answer is Yes (or a count above zero). */
  when?: string;
};

export type FireSection = {
  id: string;
  title: string;
  /** Ionicons name; the phone draws it. */
  icon: string;
  fields: FireField[];
};

/**
 * The sections, in the order the firefighter fills them. Incident details and
 * the response timeline come from the incident itself and are shown, not asked.
 */
export const FIRE_REPORT_SECTIONS: FireSection[] = [
  {
    id: 'incident', title: 'Incident details', icon: 'information-circle-outline', fields: [
      { key: 'type_of_incident', label: 'Type of incident', kind: 'select', options: FIRE_INCIDENT_TYPES, required: true },
      { key: 'location', label: 'Location', kind: 'text', placeholder: 'As found on scene' },
    ],
  },
  {
    id: 'narrative', title: 'Narrative', icon: 'document-text-outline', fields: [
      { key: 'fire_department_name', label: 'Department', kind: 'text' },
      { key: 'station_number', label: 'Station number', kind: 'text' },
      { key: 'narrative_summary', label: 'Summary', kind: 'multiline', required: true, placeholder: 'What you found, what you did, how it ended' },
      { key: 'initial_observations', label: 'Initial observations', kind: 'multiline' },
    ],
  },
  {
    id: 'conditions', title: 'Conditions', icon: 'cloudy-outline', fields: [
      { key: 'smoke_conditions', label: 'Smoke conditions', kind: 'select', options: SMOKE_CONDITIONS },
      { key: 'flame_spread', label: 'Flame spread', kind: 'select', options: FLAME_SPREAD },
      { key: 'heat_signature', label: 'Heat signature', kind: 'select', options: HEAT_SIGNATURE },
      { key: 'hazards_identified', label: 'Hazards identified', kind: 'text', placeholder: 'e.g. Downed power lines' },
    ],
  },
  {
    id: 'actions', title: 'Actions & rescue', icon: 'construct-outline', fields: [
      { key: 'fire_suppression_details', label: 'Suppression details', kind: 'multiline' },
      { key: 'search_and_rescue_performed', label: 'Search & rescue performed?', kind: 'yesno' },
      { key: 'persons_rescued', label: 'Persons rescued', kind: 'count', when: 'search_and_rescue_performed' },
      { key: 'rescue_location', label: 'Where they were found', kind: 'text', when: 'search_and_rescue_performed' },
      { key: 'rescue_condition', label: 'Their condition', kind: 'text', when: 'search_and_rescue_performed' },
    ],
  },
  {
    id: 'support', title: 'Support operations', icon: 'medkit-outline', fields: [
      { key: 'ventilation_type', label: 'Ventilation type', kind: 'select', options: VENTILATION_TYPES },
      { key: 'hazmat_description', label: 'Hazmat description', kind: 'text', placeholder: 'Chemicals or spills involved' },
      { key: 'medical_aid_provided', label: 'Medical aid provided', kind: 'yesno' },
      { key: 'medical_aid_description', label: 'Medical aid given', kind: 'text', when: 'medical_aid_provided' },
      { key: 'utilities_secured', label: 'Utilities secured', kind: 'yesno' },
      { key: 'utility_details', label: 'Which utilities', kind: 'text', when: 'utilities_secured' },
      { key: 'fire_investigation_conducted', label: 'Investigation conducted', kind: 'yesno' },
      { key: 'fire_investigation_reason', label: 'Why, and by whom', kind: 'text', when: 'fire_investigation_conducted' },
    ],
  },
  {
    id: 'origin', title: 'Origin & cause', icon: 'search-outline', fields: [
      { key: 'point_of_origin_room', label: 'Room of origin', kind: 'text' },
      { key: 'point_of_origin_object', label: 'Object of origin', kind: 'text' },
      { key: 'ignition_source', label: 'Ignition source', kind: 'text' },
      { key: 'fire_cause', label: 'Cause', kind: 'select', options: FIRE_CAUSES, required: true },
    ],
  },
  {
    id: 'property', title: 'Property & damage', icon: 'home-outline', fields: [
      { key: 'property_type', label: 'Property type', kind: 'text', placeholder: 'e.g. Dwelling, warehouse, vehicle' },
      { key: 'property_owner', label: 'Property owner', kind: 'text' },
      { key: 'property_contact', label: 'Owner contact', kind: 'text' },
      { key: 'property_value', label: 'Estimated value (R)', kind: 'money' },
      { key: 'damage_estimate', label: 'Damage estimate (R)', kind: 'money' },
    ],
  },
  {
    id: 'casualties', title: 'Casualties', icon: 'people-outline', fields: [
      { key: 'civilian_injuries', label: 'Civilian injuries', kind: 'count' },
      { key: 'civilian_injury_details', label: 'Civilian injury details', kind: 'text', when: 'civilian_injuries' },
      { key: 'civilian_fatalities', label: 'Civilian fatalities', kind: 'count' },
      { key: 'civilian_fatality_details', label: 'Civilian fatality details', kind: 'text', when: 'civilian_fatalities' },
      { key: 'firefighter_injuries', label: 'Firefighter injuries', kind: 'count' },
      { key: 'firefighter_injury_details', label: 'Firefighter injury details', kind: 'text', when: 'firefighter_injuries' },
      { key: 'firefighter_fatalities', label: 'Firefighter fatalities', kind: 'count' },
      { key: 'firefighter_fatality_details', label: 'Firefighter fatality details', kind: 'text', when: 'firefighter_fatalities' },
    ],
  },
  {
    id: 'debrief', title: 'Debrief', icon: 'chatbubbles-outline', fields: [
      { key: 'other_agencies_on_scene', label: 'Other agencies on scene', kind: 'text', placeholder: 'e.g. SAPS, EMS, Eskom' },
      { key: 'mutual_aid_used', label: 'Mutual aid used', kind: 'yesno' },
      { key: 'equipment_used', label: 'Equipment used', kind: 'text' },
      { key: 'challenges_faced', label: 'Challenges faced', kind: 'multiline' },
      { key: 'recommendations', label: 'Recommendations', kind: 'multiline' },
    ],
  },
];

export const FIRE_REPORT_FIELDS: FireField[] = FIRE_REPORT_SECTIONS.flatMap((s) => s.fields);

const count = (v: string | undefined) => {
  const n = Number(String(v ?? '').replace(/[^0-9]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Whether a field is showing, given the other answers. */
export function fireFieldShown(field: FireField, answers: Record<string, string>): boolean {
  if (!field.when) return true;
  const v = answers[field.when];
  const parent = FIRE_REPORT_FIELDS.find((f) => f.key === field.when);
  return parent?.kind === 'count' ? count(v) > 0 : v === 'Yes';
}

/**
 * What file_fire_report() would refuse: each problem with the fields to fix,
 * so the form can mark them as well as say what is wrong.
 */
export function fireReportProblems(answers: Record<string, string>): Array<{ message: string; keys: string[] }> {
  const out: Array<{ message: string; keys: string[] }> = [];
  const has = (k: string) => Boolean((answers[k] ?? '').trim());
  if (!has('type_of_incident')) out.push({ message: 'Choose the type of incident.', keys: ['type_of_incident'] });
  if ((answers.narrative_summary ?? '').trim().length < 20) {
    out.push({ message: 'Write the summary (at least 20 characters).', keys: ['narrative_summary'] });
  }
  if (!has('fire_cause')) out.push({ message: 'Give the cause, or Under investigation.', keys: ['fire_cause'] });
  if (count(answers.civilian_injuries) + count(answers.firefighter_injuries) > 0
    && !has('civilian_injury_details') && !has('firefighter_injury_details')) {
    out.push({
      message: 'Describe the injuries.',
      keys: [count(answers.civilian_injuries) > 0 ? 'civilian_injury_details' : 'firefighter_injury_details'],
    });
  }
  if (count(answers.civilian_fatalities) + count(answers.firefighter_fatalities) > 0
    && !has('civilian_fatality_details') && !has('firefighter_fatality_details')) {
    out.push({
      message: 'Describe the fatalities.',
      keys: [count(answers.civilian_fatalities) > 0 ? 'civilian_fatality_details' : 'firefighter_fatality_details'],
    });
  }
  return out;
}

/** What file_fire_report() would refuse, in the words the screen shows. */
export function validateFireReport(answers: Record<string, string>): string[] {
  return fireReportProblems(answers).map((p) => p.message);
}

/** The answers as file_fire_report() takes them: hidden fields dropped, text trimmed. */
export function fireReportPayload(answers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FIRE_REPORT_FIELDS) {
    const v = (answers[f.key] ?? '').trim();
    if (!v || !fireFieldShown(f, answers)) continue;
    out[f.key] = v;
  }
  return out;
}

/** "1h 05m" from seconds. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';
  const m = Math.round(seconds / 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
