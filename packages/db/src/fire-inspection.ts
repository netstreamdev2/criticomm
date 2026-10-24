/**
 * Fire safety site inspections (migration 0106), as data: what a fire
 * inspector checks on a site visit under the eThekwini Fire By-law, 2022, and
 * what follows when something is wrong — a compliance notice (s.81) with a
 * date to put it right and a re-inspection, or an instruction to close,
 * evacuate or stop (s.76). The phone and the console build their forms from
 * these; file_fire_inspection() checks the same things again and has the
 * final word. Its own copy of the checklist must match FIRE_INSPECTION_ITEMS
 * (scripts/test-fire-inspections.mjs compares them).
 */

export type InspectionAnswer = 'yes' | 'no' | 'na';

export type InspectionItem = {
  key: string;
  /** What is checked, as the inspector reads it on site. */
  label: string;
  /** The by-law section it rests on, for the notice. */
  section: string;
  /** Some things are not on every site (no sprinklers, no gas): those may be answered N/A. */
  na: boolean;
  /** Days to put it right, unless the inspector chooses otherwise; 0 is immediately. */
  days: number;
  /** What the notice tells the owner to do. */
  remedy: string;
};

export type InspectionGroup = { id: string; title: string; icon: string; items: InspectionItem[] };

export const FIRE_INSPECTION_GROUPS: InspectionGroup[] = [
  {
    id: 'escape', title: 'Escape routes', icon: 'exit-outline', items: [
      { key: 'escape_routes_clear', label: 'Escape routes and exits are clear', section: 's.18(2)', na: false, days: 0, remedy: 'Clear the escape routes and exits.' },
      { key: 'exit_doors_open', label: 'Exit doors open easily and are not locked shut', section: 's.18(3)', na: false, days: 0, remedy: 'Unlock the exit doors or fit approved locks.' },
      { key: 'exit_signs', label: 'Exit signs show the way out', section: 's.18(4)', na: false, days: 30, remedy: 'Put up exit signs that show the way out (SANS 1186).' },
      { key: 'fire_doors', label: 'Fire doors close and are not wedged open', section: 's.19', na: true, days: 14, remedy: 'Repair the fire doors and keep them closed.' },
    ],
  },
  {
    id: 'equipment', title: 'Fire equipment', icon: 'flame-outline', items: [
      { key: 'extinguishers', label: 'Fire extinguishers in place, serviced in the last 12 months', section: 's.25, s.31', na: true, days: 30, remedy: 'Put fire extinguishers in place and have them serviced.' },
      { key: 'hose_reels', label: 'Hose reels work, serviced in the last 12 months', section: 's.25, s.31', na: true, days: 30, remedy: 'Have the hose reels repaired and serviced.' },
      { key: 'hydrants_site', label: 'Hydrants on the site can be reached and are serviced', section: 's.28, s.31', na: true, days: 30, remedy: 'Clear the hydrants and have them serviced.' },
      { key: 'alarm', label: 'Fire alarm and detection work, with service records', section: 's.26, s.31', na: true, days: 30, remedy: 'Repair the fire alarm and detection, and keep the service records.' },
      { key: 'sprinklers', label: 'Sprinklers are kept in working order', section: 's.27, s.31', na: true, days: 60, remedy: 'Have the sprinkler system serviced.' },
      { key: 'emergency_lights', label: 'Emergency lights work', section: 's.31', na: true, days: 30, remedy: 'Repair the emergency lights and test them monthly.' },
      { key: 'kitchen_extraction', label: 'Kitchen extraction cleaned in the last 6 months', section: 's.22, s.31', na: true, days: 30, remedy: 'Clean and service the kitchen extraction.' },
    ],
  },
  {
    id: 'plan', title: 'Emergency plan', icon: 'document-text-outline', items: [
      { key: 'emergency_plan', label: 'Emergency plan kept on site', section: 's.33(1)', na: true, days: 30, remedy: 'Draw up an emergency preparedness plan and keep it on site.' },
      { key: 'evacuation_drill', label: 'Evacuation drill in the last 12 months, with a register', section: 's.33(5)', na: true, days: 60, remedy: 'Hold an evacuation drill and keep the register.' },
      { key: 'floor_plans', label: 'Evacuation floor plans on display', section: 's.33(9)', na: true, days: 30, remedy: 'Put up evacuation floor plans on every floor.' },
      { key: 'risk_assessment', label: 'Latest risk assessment on site', section: 's.24', na: true, days: 60, remedy: 'Have the risk assessment brought up to date and keep a copy on site.' },
    ],
  },
  {
    id: 'goods', title: 'Dangerous goods', icon: 'warning-outline', items: [
      { key: 'dangerous_goods_certificate', label: 'Dangerous goods certificate valid', section: 's.37, s.38', na: true, days: 30, remedy: 'Apply for or renew the dangerous goods certificate.' },
      { key: 'flammables_stored', label: 'Flammable liquids and gas stored safely', section: 's.43, s.56', na: true, days: 14, remedy: 'Store the flammable liquids and gas safely.' },
      { key: 'lpg', label: 'Gas (LPG) within the limits and fitted properly', section: 's.48', na: true, days: 14, remedy: 'Have the gas installation fixed, or keep less gas.' },
    ],
  },
  {
    id: 'site', title: 'Site and access', icon: 'business-outline', items: [
      { key: 'street_number', label: 'Street number can be seen from the street', section: 's.16(2)', na: false, days: 30, remedy: 'Put up a street number that can be seen from the street.' },
      { key: 'fire_access', label: 'Fire engines can get in (fire lanes clear)', section: 's.17', na: true, days: 7, remedy: 'Keep the fire lanes clear for fire engines.' },
      { key: 'population_certificate', label: 'Population certificate on display and not exceeded', section: 's.34', na: true, days: 30, remedy: 'Get a population certificate and keep within it.' },
      { key: 'housekeeping', label: 'No rubbish or burnable waste piled up', section: 's.5', na: false, days: 7, remedy: 'Remove the rubbish and burnable waste.' },
    ],
  },
];

export const FIRE_INSPECTION_ITEMS: InspectionItem[] = FIRE_INSPECTION_GROUPS.flatMap((g) => g.items);

const ITEM = new Map(FIRE_INSPECTION_ITEMS.map((i) => [i.key, i]));
export const inspectionItem = (key: string) => ITEM.get(key) ?? null;

/** Why the inspector is there. */
export const INSPECTION_KINDS = ['Routine', 'Complaint', 'Re-inspection', 'Certificate', 'After a fire', 'Event'] as const;
export type InspectionKind = (typeof INSPECTION_KINDS)[number];

/** What the premises are used for, in plain words. */
export const OCCUPANCIES = [
  'Shop or office', 'Factory or workshop', 'Warehouse or store', 'Shopping centre', 'Restaurant or tavern',
  'Hotel or guest house', 'Flats or hostel', 'Hospital or clinic', 'Old age home', 'School or crèche',
  'Stadium, hall or church', 'Fuel station or gas store', 'Other',
] as const;
export type Occupancy = (typeof OCCUPANCIES)[number];

/** Risk sets how often a site is inspected: high every 6 months, moderate yearly, low every 2 years. */
export const RISKS = ['High', 'Moderate', 'Low'] as const;
export type Risk = (typeof RISKS)[number];
export const RISK_MONTHS: Record<Risk, number> = { High: 6, Moderate: 12, Low: 24 };

/** The usual risk of a kind of premises; the inspector may change it. */
export function usualRisk(occupancy: string | null | undefined): Risk {
  switch (occupancy) {
    case 'Hospital or clinic': case 'Old age home': case 'School or crèche': case 'Shopping centre':
    case 'Stadium, hall or church': case 'Fuel station or gas store': case 'Flats or hostel': case 'Hotel or guest house':
      return 'High';
    case 'Factory or workshop': case 'Warehouse or store': case 'Restaurant or tavern':
      return 'Moderate';
    default:
      return 'Low';
  }
}

/** Days to put a fault right, as the inspector chooses them. */
export const NOTICE_DAYS = [0, 7, 14, 30, 60, 90] as const;
export const daysWords = (d: number) => (d === 0 ? 'Immediately' : `${d} days`);

/** How the notice reached the owner (s.81): handed over, refused, or fixed to the premises. */
export const SERVED = ['Handed over', 'Refused to sign', 'Affixed to the premises'] as const;
export type Served = (typeof SERVED)[number];

/** An instruction for a danger that cannot wait (s.76). */
export const INSTRUCTIONS = ['Close the premises', 'Evacuate the premises', 'Stop the activity'] as const;
export type Instruction = (typeof INSTRUCTIONS)[number];

export type InspectionOutcome = 'Compliant' | 'Compliance notice' | 'Instruction';

/** One inspection as the inspector fills it in. */
export type InspectionDraft = {
  /** A premises already on the register; empty for a new one. */
  premises_id?: string | null;
  name?: string;
  address?: string;
  occupancy?: string;
  risk?: string;
  contact_person?: string;
  contact_number?: string;
  kind?: string;
  checklist?: Record<string, InspectionAnswer | undefined>;
  /** Days to put each fault right, by item. */
  days?: Record<string, number | undefined>;
  instruction?: string | null;
  instruction_reason?: string;
  person_in_charge?: string;
  served?: string;
  notes?: string;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
};

/** The items answered No. */
export function failingItems(checklist: InspectionDraft['checklist']): InspectionItem[] {
  return FIRE_INSPECTION_ITEMS.filter((i) => checklist?.[i.key] === 'no');
}

export function outcomeOf(draft: Pick<InspectionDraft, 'checklist' | 'instruction'>): InspectionOutcome {
  if (draft.instruction) return 'Instruction';
  return failingItems(draft.checklist).length ? 'Compliance notice' : 'Compliant';
}

/** Days given for each fault: the inspector's choice, else the item's own. */
export function noticeDays(draft: Pick<InspectionDraft, 'checklist' | 'days'>): Array<{ item: InspectionItem; days: number }> {
  return failingItems(draft.checklist).map((item) => {
    const chosen = draft.days?.[item.key];
    return { item, days: typeof chosen === 'number' && (NOTICE_DAYS as readonly number[]).includes(chosen) ? chosen : item.days };
  });
}

/** "YYYY-MM-DD" in South African time. */
export function saDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** A "YYYY-MM-DD" day moved on by whole days (no time of day, so no time zone slips). */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** A "YYYY-MM-DD" day moved on by whole months, held to the month's last day. */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}

/**
 * The dates that follow from the visit: when the faults must be put right
 * (the longest time given) and when the inspector comes back — the next day
 * for "immediately", else on the date itself. A compliant site is next due
 * after its risk's months.
 */
export function followUp(
  draft: Pick<InspectionDraft, 'checklist' | 'days' | 'instruction' | 'risk'>,
  today: string = saDay(),
): { complyBy: string | null; reinspectOn: string | null; nextDue: string } {
  const outcome = outcomeOf(draft);
  const months = RISK_MONTHS[(draft.risk as Risk) ?? 'Moderate'] ?? 12;
  if (outcome === 'Compliant') return { complyBy: null, reinspectOn: null, nextDue: addMonths(today, months) };
  const longest = Math.max(0, ...noticeDays(draft).map((n) => n.days));
  const complyBy = addDays(today, longest);
  const reinspectOn = longest === 0 ? addDays(today, 1) : complyBy;
  return { complyBy, reinspectOn, nextDue: reinspectOn };
}

/** What file_fire_inspection() would refuse, with the fields to mark. */
export function inspectionProblems(draft: InspectionDraft): Array<{ message: string; keys: string[] }> {
  const out: Array<{ message: string; keys: string[] }> = [];
  const v = (s: string | null | undefined) => (s ?? '').trim();
  if (!draft.premises_id) {
    if (!v(draft.name)) out.push({ message: 'Enter the name of the business or site.', keys: ['name'] });
    if (!v(draft.address)) out.push({ message: 'Enter the address.', keys: ['address'] });
    if (!(OCCUPANCIES as readonly string[]).includes(v(draft.occupancy))) out.push({ message: 'Choose what the premises are used for.', keys: ['occupancy'] });
    if (!(RISKS as readonly string[]).includes(v(draft.risk))) out.push({ message: 'Choose the risk.', keys: ['risk'] });
  }
  if (!(INSPECTION_KINDS as readonly string[]).includes(v(draft.kind))) out.push({ message: 'Choose why you are inspecting.', keys: ['kind'] });
  const unanswered = FIRE_INSPECTION_ITEMS.filter((i) => {
    const a = draft.checklist?.[i.key];
    return a !== 'yes' && a !== 'no' && !(a === 'na' && i.na);
  });
  if (unanswered.length) out.push({ message: `Answer every check (${unanswered.length} left).`, keys: unanswered.map((i) => i.key) });
  const outcome = outcomeOf(draft);
  if (draft.instruction && !(INSTRUCTIONS as readonly string[]).includes(draft.instruction)) {
    out.push({ message: 'Choose the instruction.', keys: ['instruction'] });
  }
  if (draft.instruction && v(draft.instruction_reason).length < 10) {
    out.push({ message: 'Say why the instruction is given (at least 10 characters).', keys: ['instruction_reason'] });
  }
  if (outcome !== 'Compliant') {
    if (!(SERVED as readonly string[]).includes(v(draft.served))) out.push({ message: 'Say how the notice was served.', keys: ['served'] });
    if (v(draft.served) !== 'Affixed to the premises' && !v(draft.person_in_charge)) {
      out.push({ message: 'Enter the name of the person in charge.', keys: ['person_in_charge'] });
    }
  }
  if (v(draft.contact_number) && !/^\+?[0-9 ()-]{7,20}$/.test(v(draft.contact_number))) {
    out.push({ message: 'The contact number is not a phone number.', keys: ['contact_number'] });
  }
  return out;
}

/** The inspection as file_fire_inspection() takes it. */
export function inspectionPayload(draft: InspectionDraft): Record<string, unknown> {
  const v = (s: string | null | undefined) => (s ?? '').trim();
  const checklist: Record<string, InspectionAnswer> = {};
  for (const i of FIRE_INSPECTION_ITEMS) {
    const a = draft.checklist?.[i.key];
    if (a === 'yes' || a === 'no' || (a === 'na' && i.na)) checklist[i.key] = a;
  }
  return {
    ...(draft.premises_id ? { premises_id: draft.premises_id } : {
      name: v(draft.name), address: v(draft.address), occupancy: v(draft.occupancy), risk: v(draft.risk),
    }),
    contact_person: v(draft.contact_person) || null,
    contact_number: v(draft.contact_number) || null,
    kind: v(draft.kind),
    checklist,
    notice: noticeDays({ checklist, days: draft.days }).map((n) => ({ key: n.item.key, days: n.days })),
    instruction: draft.instruction || null,
    instruction_reason: draft.instruction ? v(draft.instruction_reason) : null,
    person_in_charge: v(draft.person_in_charge) || null,
    served: outcomeOf({ checklist, instruction: draft.instruction }) === 'Compliant' ? null : v(draft.served) || null,
    notes: v(draft.notes) || null,
    lat: typeof draft.lat === 'number' ? draft.lat : null,
    lng: typeof draft.lng === 'number' ? draft.lng : null,
    accuracy: typeof draft.accuracy === 'number' ? Math.round(draft.accuracy) : null,
  };
}

/** A premises' state on the register, for the lists. */
export function premisesState(p: { next_due: string | null; last_outcome: string | null }, today: string = saDay()):
  'Never inspected' | 'Overdue' | 'Due soon' | 'Notice open' | 'Up to date' {
  if (!p.next_due) return 'Never inspected';
  if (p.next_due < today) return 'Overdue';
  if (p.last_outcome && p.last_outcome !== 'Compliant') return 'Notice open';
  return p.next_due <= addDays(today, 14) ? 'Due soon' : 'Up to date';
}
