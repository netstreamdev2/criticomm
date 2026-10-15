/**
 * How a call came in, and each patient with their own severity (0080). A
 * patient's severity is their own: a burning building is a Critical incident
 * while the person in it may have minor burns (Low). No dependencies, so the
 * schemas, both apps and the PDF share it.
 */

export const CALL_CHANNELS = ['Phone call', 'WhatsApp', 'In person', 'Other'] as const;
export type CallChannel = (typeof CALL_CHANNELS)[number];
/** What most calls are: the emergency number. */
export const DEFAULT_CALL_CHANNEL: CallChannel = 'Phone call';

export const PATIENT_SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Unknown'] as const;
export type PatientSeverity = (typeof PATIENT_SEVERITIES)[number];

export type CallPatient = {
  name: string | null;
  severity: PatientSeverity;
  /** The caller is this patient. */
  caller: boolean;
};

/** The most patients a call carries; the database keeps the same limit. */
export const MAX_PATIENTS = 20;

/** "Phone call", or "Other: radio from a guard"; null when not recorded. */
export function callChannelText(channel: string | null | undefined, other?: string | null): string | null {
  if (!channel) return null;
  return channel === 'Other' && other ? `Other: ${other}` : channel;
}

/** The patients as kept, read safely: anything the database would not keep is left out. */
export function readPatients(raw: unknown): CallPatient[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p): CallPatient[] => {
    if (!p || typeof p !== 'object') return [];
    const o = p as Record<string, unknown>;
    const severity = PATIENT_SEVERITIES.includes(o.severity as PatientSeverity) ? (o.severity as PatientSeverity) : 'Unknown';
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 200) : null;
    return [{ name, severity, caller: o.caller === true }];
  }).slice(0, MAX_PATIENTS);
}

/** One patient in words: "Sipho Dube · Low", "The caller · Medium", "Name not given · Critical". */
export function patientText(p: CallPatient): string {
  return `${p.caller ? (p.name ? `${p.name} (the caller)` : 'The caller') : p.name ?? 'Name not given'} · ${p.severity}`;
}
