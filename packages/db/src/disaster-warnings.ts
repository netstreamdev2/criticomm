/**
 * Early warnings (0116), as data for the desk and the server: SA Weather
 * Service impact-based warnings and the steps the Directorate takes each
 * one through (Disaster incident management, revision 2, section 3). The
 * database checks the same lists; keep them in step.
 */

export type WarningColour = 'Yellow' | 'Orange' | 'Red';
export const WARNING_COLOURS: WarningColour[] = ['Yellow', 'Orange', 'Red'];

/** SAWS's colour for a level: Yellow 1–4, Orange 5–8, Red 9–10. */
export function colourFor(level: number): WarningColour {
  return level >= 9 ? 'Red' : level >= 5 ? 'Orange' : 'Yellow';
}

/** At Level 4 or higher the JOC meets to check readiness. */
export const JOC_LEVEL = 4;

export const WARNING_HAZARDS = [
  'Disruptive rain', 'Severe thunderstorms', 'Damaging winds', 'Damaging waves', 'Storm surge',
  'Disruptive snow', 'Reduced visibility', 'Extremely high temperatures', 'Extremely cold temperatures',
  'Fire danger', 'Other',
] as const;

/** SAWS's own spelling ("Severe Thunderstorms", "Storm surges") → the desk's list. */
export function warningHazard(event: string): string {
  const e = event.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!e) return 'Other';
  if (e.startsWith('storm surge')) return 'Storm surge';
  if (e.includes('high temperature') || e.includes('heat')) return 'Extremely high temperatures';
  if (e.includes('cold')) return 'Extremely cold temperatures';
  if (e.includes('fire')) return 'Fire danger';
  const known = WARNING_HAZARDS.find((h) => h.toLowerCase() === e);
  return known ?? event.trim().charAt(0).toUpperCase() + event.trim().slice(1).toLowerCase();
}

/**
 * The incident hazard a warning most likely becomes (step 3), for the "Add
 * an incident from this warning" form. The desk can change it.
 */
export function incidentHazardFor(warning: string): string {
  switch (warning) {
    case 'Disruptive rain': return 'Floods';
    case 'Severe thunderstorms':
    case 'Damaging winds': return 'Severe storms';
    case 'Damaging waves':
    case 'Storm surge': return 'Storm surge';
    case 'Extremely high temperatures':
    case 'Extremely cold temperatures': return 'Extreme temperature';
    case 'Fire danger': return 'Wildfire';
    default: return '';
  }
}

export type WarningStep = { key: string; label: string; who: string; group: 'check' | 'channel' };

/** W2: the checks first, then the channels Communications spreads it on. */
export const WARNING_STEPS: WarningStep[] = [
  { key: 'fews', label: 'Checked with the FEWS team', who: 'Disaster Management with the FEWS team', group: 'check' },
  { key: 'emergency_services', label: 'Emergency Services told', who: 'Disaster Management', group: 'check' },
  { key: 'water', label: 'Water and Sanitation told', who: 'Disaster Management', group: 'check' },
  { key: 'electricity', label: 'Electricity told', who: 'Disaster Management', group: 'check' },
  { key: 'sanral', label: 'SANRAL told', who: 'Disaster Management', group: 'check' },
  { key: 'whatsapp', label: 'WhatsApp groups', who: 'Communications and Community Participation', group: 'channel' },
  { key: 'facebook', label: 'Facebook', who: 'Communications and Community Participation', group: 'channel' },
  { key: 'instagram', label: 'Instagram', who: 'Communications and Community Participation', group: 'channel' },
  { key: 'youtube', label: 'YouTube', who: 'Communications and Community Participation', group: 'channel' },
  { key: 'linkedin', label: 'LinkedIn', who: 'Communications and Community Participation', group: 'channel' },
  { key: 'radio', label: 'Radio', who: 'Communications and Community Participation', group: 'channel' },
  { key: 'loudhailing', label: 'Loud-hailing and word of mouth', who: 'Ward councillors and Metro Police', group: 'channel' },
  { key: 'sms_councillors', label: 'SMS to all councillors', who: 'Disaster Management', group: 'channel' },
];

export const READINESS_OUTCOMES = ['Monitor', 'Pre-position resources', 'Open halls', 'Respond'] as const;
export type ReadinessOutcome = (typeof READINESS_OUTCOMES)[number];

export type WarningState = 'Upcoming' | 'In force' | 'Expired' | 'Ended' | 'Cancelled';

/** Where a warning stands now: the desk's status, then its validity. */
export function warningState(w: { status: string; valid_from: string; valid_until: string }, now: Date = new Date()): WarningState {
  if (w.status === 'Cancelled') return 'Cancelled';
  if (w.status === 'Ended') return 'Ended';
  const t = now.getTime();
  if (Date.parse(w.valid_until) <= t) return 'Expired';
  if (Date.parse(w.valid_from) > t) return 'Upcoming';
  return 'In force';
}

/** Still to watch: in force or about to be. */
export const isLive = (s: WarningState) => s === 'In force' || s === 'Upcoming';

/**
 * The message for the councillors and the channels. SAWS asks that its
 * warnings are passed on as issued, so this is SAWS's own text with the
 * validity and the City's emergency number, nothing rewritten.
 */
export function warningMessage(w: {
  colour: string; level: number; hazard: string; valid_from: string; valid_until: string; areas: string;
  impacts: string | null; instructions: string | null;
}, emergencyNumber: string): string {
  const when = (iso: string) => new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
  return [
    `SA Weather Service: ${w.colour} Level ${w.level} warning for ${w.hazard}.`,
    `Valid ${when(w.valid_from)} to ${when(w.valid_until)}.`,
    `Areas: ${w.areas}.`,
    w.impacts ? `Impacts: ${w.impacts.replace(/\s*\n\s*-?\s*/g, '; ').replace(/^-\s*/, '')}` : null,
    w.instructions ? `What to do: ${w.instructions}` : null,
    `Emergency: ${emergencyNumber} (eThekwini Disaster Management).`,
  ].filter(Boolean).join('\n');
}

/**
 * Plain letters only: one curly quote or long dash makes every SMS part hold
 * 70 letters instead of 153, so a long message costs twice as much.
 */
export function plainSms(text: string): string {
  return text
    .replace(/[‘’‛′]/g, "'").replace(/[“”″]/g, '"')
    .replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/ /g, ' ')
    .replace(/[^\n\x20-\x7E]/g, '');
}

/** Six SMS parts of 153 plain letters. */
export const SMS_MAX_CHARS = 6 * 153;
export const smsParts = (text: string) => (text.length <= 160 ? 1 : Math.ceil(text.length / 153));

/**
 * The warning as an SMS: SAWS's words in plain letters, within six parts.
 * Too long, it leaves out "What to do" first, then is cut short.
 */
export function warningSms(w: Parameters<typeof warningMessage>[0], emergencyNumber: string): string {
  const full = plainSms(warningMessage(w, emergencyNumber));
  if (full.length <= SMS_MAX_CHARS) return full;
  const short = plainSms(warningMessage({ ...w, instructions: null }, emergencyNumber));
  return short.length <= SMS_MAX_CHARS ? short : `${short.slice(0, SMS_MAX_CHARS - 3)}...`;
}
