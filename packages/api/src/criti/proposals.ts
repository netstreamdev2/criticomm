import { z } from 'zod';
import { deptList } from './abilities.ts';
import { MEDICAL_PRIORITIES, REGIONS, type CallDraft, type Proposal, type ProposalView } from './types.ts';

/**
 * Proposals: what Criti offers to do, checked twice.
 *
 * Once when it is offered (the chat and the tiles only offer what the
 * person's role may do, on records they can read), and again when it is
 * confirmed: the confirmation is re-read against this schema, the role and
 * the live record before anything runs. A proposal that comes back changed
 * is judged as what it now says, never as what was shown.
 */

const desk = z.enum(['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster']);
const silo = z.enum(['Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster']);
const id = z.string().uuid();
const incidentNumber = z.string().trim().min(1).max(60);
const note = z.string().trim().max(500).nullable();

export const callDraftSchema = z.object({
  // The same limits as the intake form (logIncomingCallSchema).
  caller_name: z.string().trim().max(100),
  caller_number: z.string().trim().max(40),
  is_caller_patient: z.boolean().nullable(),
  patient_names: z.string().trim().max(300),
  call_description: z.string().trim().max(500),
  incident_type: z.string().trim().max(100),
  incident_category: z.string().trim().max(200),
  incident_severity: z.enum(['Low', 'Medium', 'High', 'Critical']).nullable(),
  location_address: z.string().trim().max(200),
  location_lat: z.number().min(-90).max(90).nullable(),
  location_lng: z.number().min(-180).max(180).nullable(),
  suburb: z.string().trim().max(120),
  city: z.string().trim().max(120),
  postal_code: z.string().trim().max(20),
  region: z.union([z.enum(REGIONS), z.literal('')]),
  // The intake form counts 0 to 4, then "Multiple (5+)".
  number_of_victims: z.number().int().min(0).max(5).nullable(),
  ems_not_required: z.boolean(),
  medical_priority: z.union([z.enum(MEDICAL_PRIORITIES), z.literal('')]),
  notes: z.string().trim().max(2000),
  tagged_silos: z.array(desk).max(4),
});

export const proposalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('log_call'), call: callDraftSchema }),
  z.object({
    kind: z.literal('assign_officer'), incident_id: id, incident_number: incidentNumber,
    user_id: id, officer: z.string().trim().min(1).max(160), note,
  }),
  z.object({ kind: z.literal('dispatch_all'), incident_id: id, incident_number: incidentNumber, silos: z.array(desk).min(1).max(4), note }),
  z.object({ kind: z.literal('send_to_desk'), incident_id: id, incident_number: incidentNumber, silos: z.array(desk).min(1).max(4), note }),
  z.object({ kind: z.literal('add_note'), incident_id: id, incident_number: incidentNumber, text: z.string().trim().min(2).max(1000) }),
  z.object({
    kind: z.literal('set_status'), incident_id: id, incident_number: incidentNumber,
    status: z.enum(['En Route', 'Arrived', 'On Scene', 'Transporting']),
  }),
  z.object({
    kind: z.literal('cancel_call'), incident_id: id, incident_number: incidentNumber,
    // close_case() asks for at least ten characters on a live call.
    reason: z.string().trim().min(10, 'Give a reason of at least 10 characters').max(500),
  }),
  z.object({
    kind: z.literal('broadcast'), silos: z.array(silo).min(1).max(5),
    message: z.string().trim().min(3).max(500), severity: z.enum(['Medium', 'High', 'Critical']),
  }),
]);

/** An empty draft, for the form and for a call Criti has only started. */
export function emptyCallDraft(): CallDraft {
  return {
    caller_name: '', caller_number: '', is_caller_patient: null, patient_names: '', call_description: '',
    incident_type: '', incident_category: '', incident_severity: null, location_address: '',
    location_lat: null, location_lng: null, suburb: '', city: 'Durban', postal_code: '', region: '',
    number_of_victims: null, ems_not_required: false, medical_priority: '', notes: '', tagged_silos: [],
  };
}

/** What a call still needs before it can be logged, in the words of the intake form. */
export function missingCallFields(call: CallDraft): string[] {
  const missing: string[] = [];
  if (!call.caller_name.trim()) missing.push("the caller's name");
  if (!call.caller_number.trim()) missing.push("the caller's number");
  if (call.is_caller_patient === null) missing.push('whether the caller is the patient');
  if (!call.incident_type.trim()) missing.push('the incident code');
  if (!call.call_description.trim()) missing.push('what the caller said');
  if (!call.location_address.trim()) missing.push('the address');
  if (call.location_lat === null || call.location_lng === null) missing.push('the place on the map');
  if (!call.region) missing.push('the region');
  if (!call.incident_severity) missing.push('the severity');
  if (!call.ems_not_required && call.number_of_victims === null) missing.push('how many people are hurt');
  if (!call.ems_not_required && !call.medical_priority) missing.push('the medical priority code');
  if (call.tagged_silos.length === 0) missing.push('which dispatch desk gets it');
  return missing;
}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
const desks = (n: number) => (n === 1 ? 'dispatch desk' : 'dispatch desks');

/** How a proposal reads before it is confirmed. */
export function viewProposal(
  proposal: Proposal,
  extra: { lines?: string[]; warnings?: string[]; missing?: string[] } = {},
): ProposalView {
  const base = { proposal, warnings: extra.warnings ?? [], missing: extra.missing ?? [] };
  const more = extra.lines ?? [];
  switch (proposal.kind) {
    case 'log_call': {
      const c = proposal.call;
      const hurt = c.ems_not_required
        ? 'No injuries. EMS not required.'
        : c.number_of_victims === null ? null
          : `${c.number_of_victims === 5 ? 'Five or more' : c.number_of_victims} hurt${c.medical_priority ? `, ${c.medical_priority}` : ''}`;
      const place = [c.suburb, c.region ? `${c.region} region` : ''].filter(Boolean).join(', ');
      return {
        ...base,
        missing: [...new Set([...missingCallFields(c), ...base.missing])],
        title: `Log a call${c.incident_type ? `: ${c.incident_type}` : ''}`,
        lines: [
          c.caller_name || c.caller_number ? `Caller: ${[c.caller_name, c.caller_number].filter(Boolean).join(', ')}` : null,
          c.is_caller_patient === null ? null
            : c.is_caller_patient ? 'The caller is the patient.'
              : `The caller is not the patient${c.patient_names ? `. Patient: ${c.patient_names}` : ''}.`,
          c.location_address ? `Where: ${c.location_address}${place ? ` (${place})` : ''}` : null,
          c.incident_type ? `Code: ${c.incident_type}${c.incident_category ? ` (${c.incident_category})` : ''}` : null,
          c.incident_severity ? `Severity: ${c.incident_severity}` : null,
          hurt,
          c.tagged_silos.length ? `Goes to the ${deptList(c.tagged_silos)} ${desks(c.tagged_silos.length)}.` : null,
          c.call_description ? `What the caller said: ${clip(c.call_description, 240)}` : null,
          c.notes ? `Notes: ${clip(c.notes, 160)}` : null,
          ...more,
        ].filter((l): l is string => Boolean(l)),
        confirmLabel: 'Log the call',
      };
    }
    case 'assign_officer':
      return {
        ...base,
        title: `Assign ${proposal.officer} to ${proposal.incident_number}`,
        lines: [
          `${proposal.officer} leads the call and gets an alert on their phone.`,
          ...more,
          proposal.note ? `Note for the crew: ${clip(proposal.note, 200)}` : '',
        ].filter(Boolean),
        confirmLabel: 'Assign',
      };
    case 'dispatch_all':
      return {
        ...base,
        title: `Send ${proposal.incident_number} to everyone on duty`,
        lines: [
          `Everyone on duty in ${deptList(proposal.silos)} gets the call. The first to respond leads it.`,
          ...more,
          proposal.note ? `Note for the crews: ${clip(proposal.note, 200)}` : '',
        ].filter(Boolean),
        confirmLabel: 'Send',
      };
    case 'send_to_desk':
      return {
        ...base,
        title: `Send ${proposal.incident_number} to the ${deptList(proposal.silos)} ${desks(proposal.silos.length)}`,
        lines: [
          `Their dispatchers are alerted and the call joins their queue.`,
          ...more,
          proposal.note ? `Note: ${clip(proposal.note, 200)}` : '',
        ].filter(Boolean),
        confirmLabel: 'Send',
      };
    case 'add_note':
      return {
        ...base,
        title: `Add a note to ${proposal.incident_number}`,
        lines: [`“${clip(proposal.text, 400)}”`, 'It goes on the call’s timeline with your name.', ...more],
        confirmLabel: 'Add note',
      };
    case 'set_status':
      return {
        ...base,
        title: `Mark ${proposal.incident_number} ${proposal.status}`,
        lines: ['For a crew that radioed it in. It is recorded with your name.', ...more],
        confirmLabel: `Mark ${proposal.status}`,
      };
    case 'cancel_call':
      return {
        ...base,
        title: `Close ${proposal.incident_number} without a report`,
        lines: [`Reason: ${clip(proposal.reason, 300)}`, 'Anyone on the call is told to stand down. This cannot be undone.', ...more],
        confirmLabel: 'Close the call',
      };
    case 'broadcast':
      return {
        ...base,
        title: `Broadcast to ${deptList(proposal.silos)}`,
        lines: [
          `“${clip(proposal.message, 400)}”`,
          proposal.severity === 'Medium'
            ? `Every screen in ${deptList(proposal.silos)} shows it.`
            : `Every screen in ${deptList(proposal.silos)} shows it as a pop-up (${proposal.severity}).`,
          ...more,
        ],
        confirmLabel: 'Send broadcast',
      };
  }
}
