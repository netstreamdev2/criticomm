import type { IncidentSeverity, Silo } from '@criticom/db';
import { suggestedDesks } from '@criticom/db/desks';
import { DESKS, broadcastTargets, canPropose, deptList, deptName, parseDepartment, parseDesks } from './abilities.ts';
import { freeCrewsFor, tagsOf, teamOf } from './insights.ts';
import { emptyCallDraft, viewProposal } from './proposals.ts';
import {
  MEDICAL_PRIORITIES, type CallDraft, type CritiCrew, type CritiIncident, type CritiMe, type CritiThresholds,
  type CrewStep, type DeskSilo, type Proposal, type ProposalKind, type ProposalView,
} from './types.ts';

/**
 * From what the model suggested to something the person can confirm.
 *
 * The model names calls by number and people by name, never by id, and only
 * what it was shown. Each suggestion is matched against the person's own
 * board: a call they cannot read, a crew outside their team or an action
 * their role may not take is dropped, with the reason in plain words. What
 * survives still needs the person's confirmation, and the database checks it
 * again when it runs.
 */

export type CodeGroup = { category: string; codes: string[] };

export type ResolveContext = {
  me: CritiMe;
  incidents: CritiIncident[];
  crews: CritiCrew[];
  thresholds: Pick<CritiThresholds, 'etaSpeedKmh' | 'etaRoadFactor'>;
  codes: CodeGroup[];
};

export type Resolved = {
  views: ProposalView[];
  /** Calls still being logged: the server places them on the map before showing them. */
  drafts: CallDraft[];
  /** Why a suggestion was not offered, in words for the person. */
  problems: string[];
};

const PENDING = new Set(['New', 'Pending', 'Pending Dispatch', 'Pending Analysis']);
const FINISHED = new Set(['Resolved', 'Closed']);
const STEPS: readonly CrewStep[] = ['En Route', 'Arrived', 'On Scene', 'Transporting'];

const VERB: Record<ProposalKind, string> = {
  log_call: 'log calls',
  assign_officer: 'assign crews',
  dispatch_all: 'dispatch crews',
  send_to_desk: 'send calls to other dispatch desks',
  add_note: 'add notes to calls',
  set_status: "record a crew's status",
  cancel_call: 'close live calls',
  broadcast: 'send broadcasts',
};

const WHO: Record<ProposalKind, string> = {
  log_call: 'Call takers and the control room log calls.',
  assign_officer: 'The dispatch desk and supervisors assign crews.',
  dispatch_all: 'The dispatch desk and supervisors dispatch crews.',
  send_to_desk: 'Call takers, dispatchers and supervisors do this.',
  add_note: 'Everyone who works calls can add notes.',
  set_status: 'The dispatch desk and supervisors do this when a crew radios in.',
  cancel_call: 'The dispatch desk and command close live calls, with a reason.',
  broadcast: 'Supervisors, command and the dispatch desk send broadcasts.',
};

const text = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const sameNumber = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * A call by its number. Numbers from before 0077 (INC-…) restarted each day
 * in each department, so one number can name two calls: then every match
 * comes back and nothing is guessed. "0012", "INC-0012" or "call 12" finds
 * the open call ending -0012 when only one does, in either form
 * (MP-20261010-1115-0012 too).
 */
export function findByNumber(incidents: CritiIncident[], wanted: string): CritiIncident | CritiIncident[] | null {
  const exact = incidents.filter((i) => sameNumber(i.incident_number, wanted));
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return exact;
  const seq = /^(?:INC-|call\s*|no\.?\s*)?(\d{1,6})$/i.exec(wanted.trim())?.[1];
  if (!seq) return null;
  const tail = `-${seq.padStart(4, '0')}`;
  const short = incidents.filter((i) => i.incident_number.endsWith(tail));
  return short.length === 1 ? short[0]! : short.length > 1 ? short : null;
}

/** A code from the configured list: exact first, then a single close match. */
export function matchCode(codes: CodeGroup[], wanted: string): { incident_type: string; incident_category: string } | null {
  const w = wanted.trim().toLowerCase();
  if (!w) return null;
  const all = codes.flatMap((g) => g.codes.map((c) => ({ incident_type: c, incident_category: g.category })));
  const exact = all.find((c) => c.incident_type.toLowerCase() === w);
  if (exact) return exact;
  const close = all.filter((c) => {
    const n = c.incident_type.toLowerCase();
    return n.includes(w) || w.includes(n);
  });
  return close.length === 1 ? close[0]! : null;
}

function priority(v: unknown): string {
  const t = text(v, 80).toUpperCase();
  if (!t) return '';
  const p = /^P?([1-4])\b/.exec(t)?.[1]
    ?? (/RED|CRITICAL|LIFE/.test(t) ? '1' : /ORANGE|URGENT|SERIOUS/.test(t) ? '2' : /YELLOW|MINOR|WALKING/.test(t) ? '3' : /BLUE|DECEASED|DEAD/.test(t) ? '4' : null);
  return p ? MEDICAL_PRIORITIES[Number(p) - 1]! : '';
}

function severity(v: unknown): IncidentSeverity | null {
  const t = text(v, 20).toLowerCase();
  return t === 'low' ? 'Low' : t === 'medium' ? 'Medium' : t === 'high' ? 'High' : t === 'critical' ? 'Critical' : null;
}

/** A call the model has started, made into the intake form's fields. */
export function draftFromModel(raw: Record<string, unknown>, ctx: Pick<ResolveContext, 'me' | 'codes'>): CallDraft {
  const d = emptyCallDraft();
  d.caller_name = text(raw.caller_name, 100);
  d.caller_number = text(raw.caller_number, 40);
  d.is_caller_patient = typeof raw.is_caller_patient === 'boolean' ? raw.is_caller_patient : null;
  d.patient_names = d.is_caller_patient === false ? text(raw.patient_names, 300) : '';
  d.call_description = text(raw.description ?? raw.call_description, 500);
  const code = matchCode(ctx.codes, text(raw.incident_code ?? raw.incident_type, 200));
  if (code) Object.assign(d, code);
  d.incident_severity = severity(raw.severity ?? raw.incident_severity);
  d.location_address = text(raw.address ?? raw.location_address, 200);
  d.ems_not_required = raw.ems_not_required === true;
  if (d.ems_not_required) {
    d.number_of_victims = 0;
  } else {
    const n = typeof raw.victims === 'number' ? raw.victims : typeof raw.victims === 'string' && raw.victims.trim() !== '' ? Number(raw.victims) : null;
    d.number_of_victims = n !== null && Number.isFinite(n) && n >= 0 ? Math.min(5, Math.floor(n)) : null;
    d.medical_priority = priority(raw.medical_priority);
  }
  d.notes = text(raw.notes, 2000);
  const asked = parseDesks(raw.departments);
  // As the form: the call taker's own desk, and what the code and anyone hurt suggest.
  const chosen = new Set<DeskSilo>(asked.length ? asked : [
    ...(ctx.me.silo !== 'Ethekwini' ? [ctx.me.silo as DeskSilo] : []),
    ...suggestedDesks({
      category: d.incident_category, incidentType: d.incident_type,
      victims: d.number_of_victims, emsNotRequired: d.ems_not_required,
    }),
  ]);
  d.tagged_silos = DESKS.filter((s) => chosen.has(s));
  return d;
}

export function resolveProposals(raw: unknown, ctx: ResolveContext): Resolved {
  const out: Resolved = { views: [], drafts: [], problems: [] };
  const list = Array.isArray(raw) ? raw.slice(0, 4) : [];
  const { me } = ctx;
  const team = teamOf(me);
  const inTeam = (s: Silo) => team === 'all' || team.includes(s as DeskSilo);

  const findCall = (number: unknown, kind: ProposalKind): CritiIncident | string => {
    const n = text(number, 60);
    if (!n) return 'Say which call: its incident number.';
    const found = findByNumber(ctx.incidents, n);
    if (Array.isArray(found)) {
      return `${found.length} calls on your board have the number ${n} (${deptList(found.map((i) => i.silo))}). Open the one you mean and ask from there.`;
    }
    const call = found;
    if (!call) return `${n} is not on your board, so I cannot act on it.`;
    // A resolved call still takes notes while it waits for review.
    if (call.status === 'Closed' || (FINISHED.has(call.status) && kind !== 'add_note')) {
      return `${call.incident_number} is already ${call.status.toLowerCase()}.`;
    }
    return call;
  };

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const kind = text(p.kind, 30) as ProposalKind;
    if (!(kind in VERB)) continue;
    if (!canPropose(me.role, kind)) {
      out.problems.push(`Your role does not ${VERB[kind]}. ${WHO[kind]}`);
      continue;
    }

    if (kind === 'log_call') {
      const call = p.call && typeof p.call === 'object' ? (p.call as Record<string, unknown>) : p;
      out.drafts.push(draftFromModel(call, ctx));
      continue;
    }

    if (kind === 'broadcast') {
      const allowed = broadcastTargets(me.role, me.silo);
      const wanted = (Array.isArray(p.departments) ? p.departments : [p.departments])
        .map((d) => parseDepartment(String(d ?? ''))).filter((s): s is Silo => s !== null);
      const silos = (wanted.length ? wanted : [me.silo]).filter((s, i, a) => a.indexOf(s) === i);
      const refused = silos.filter((s) => !allowed.includes(s));
      if (refused.length) {
        out.problems.push(`You can broadcast to ${deptList(allowed)} only, not ${deptList(refused)}.`);
        continue;
      }
      const message = text(p.message, 500);
      if (message.length < 3) { out.problems.push('Say what the broadcast should say.'); continue; }
      const sev = severity(p.severity);
      out.views.push(viewProposal({
        kind: 'broadcast', silos, message, severity: sev === 'High' || sev === 'Critical' ? sev : 'Medium',
      }));
      continue;
    }

    const found = findCall(p.incident, kind);
    if (typeof found === 'string') { out.problems.push(found); continue; }
    const call = found;
    const base = { incident_id: call.id, incident_number: call.incident_number };
    const note = text(p.note, 500) || null;

    switch (kind) {
      case 'assign_officer': {
        if (call.accepted_by) {
          out.problems.push(`${call.incident_number} is already led by ${call.responding_officer || 'a crew member'}. Others can join it as backup from the app.`);
          break;
        }
        const silos = tagsOf(call).filter(inTeam);
        const wanted = text(p.officer, 160).toLowerCase();
        const pool = ctx.crews.filter((c) => silos.includes(c.silo as DeskSilo));
        // A badge number names one person; a name may not.
        const byBadge = pool.filter((c) => c.badge !== '' && c.badge.toLowerCase() === wanted);
        const byName = pool.filter((c) => wanted !== '' && c.name.toLowerCase() === wanted);
        const byPart = pool.filter((c) => wanted !== '' && c.name.toLowerCase().includes(wanted));
        const unique = byBadge.length ? byBadge : byName.length ? byName : byPart;
        if (unique.length !== 1) {
          out.problems.push(unique.length > 1
            ? `More than one person matches "${text(p.officer, 60)}". Use their badge number.`
            : `"${text(p.officer, 60)}" is not on duty in ${deptList(silos) || 'a department you dispatch'}.`);
          break;
        }
        const crew = unique[0]!;
        const eta = freeCrewsFor(call, [{ ...crew, activeCalls: 0 }], silos, ctx.thresholds)[0]?.minutes ?? null;
        out.views.push(viewProposal(
          { kind, ...base, user_id: crew.userId, officer: crew.name, note },
          {
            lines: eta !== null ? [`About ${eta} min away by road.`] : [],
            warnings: crew.activeCalls > 0 ? [`${crew.name} is already on ${crew.busyWith?.number ?? 'another call'}.`] : [],
          },
        ));
        break;
      }
      case 'dispatch_all': {
        const asked = parseDesks(p.departments);
        const sent = tagsOf(call);
        const silos = (asked.length ? asked : sent).filter(inTeam);
        const outside = asked.filter((s) => !inTeam(s));
        if (silos.length === 0) {
          out.problems.push(asked.length
            ? `You dispatch ${team === 'all' ? 'every department' : deptList(team)} only.`
            : `${call.incident_number} has not been sent to a desk you dispatch.`);
          break;
        }
        const nobody = silos.filter((s) => !ctx.crews.some((c) => c.silo === s));
        if (nobody.length === silos.length) {
          out.problems.push(`No one from ${deptList(silos)} is on duty in the app to receive ${call.incident_number}.`);
          break;
        }
        const notSent = silos.filter((s) => !sent.includes(s));
        out.views.push(viewProposal({ kind, ...base, silos, note }, {
          warnings: [
            ...(outside.length ? [`You dispatch ${deptList(silos)} crews only. ${deptList(outside)} is left out.`] : []),
            ...(nobody.length ? [`No one from ${deptList(nobody)} is on duty.`] : []),
            ...(notSent.length ? [`${deptList(notSent)} also joins the call.`] : []),
          ],
        }));
        break;
      }
      case 'send_to_desk': {
        const already = new Set(call.tagged_silos ?? []);
        const silos = parseDesks(p.departments).filter((s) => !already.has(s));
        if (silos.length === 0) {
          out.problems.push(`${call.incident_number} is already with ${deptList(tagsOf(call)) || 'those desks'}.`);
          break;
        }
        out.views.push(viewProposal({ kind, ...base, silos, note }));
        break;
      }
      case 'add_note': {
        const body = text(p.text ?? p.note, 1000);
        if (body.length < 2) { out.problems.push('Say what the note should say.'); break; }
        out.views.push(viewProposal({ kind, ...base, text: body }));
        break;
      }
      case 'set_status': {
        const step = STEPS.find((s) => s.toLowerCase() === text(p.status, 20).toLowerCase());
        if (!step) { out.problems.push('The desk can record En Route, Arrived, On Scene or Transporting. The report resolves a call.'); break; }
        if (PENDING.has(call.status)) { out.problems.push(`${call.incident_number} has not been sent to a crew yet.`); break; }
        out.views.push(viewProposal({ kind, ...base, status: step }));
        break;
      }
      case 'cancel_call': {
        const reason = text(p.reason, 500);
        if (reason.length < 10) { out.problems.push('Closing a live call needs a reason of at least 10 characters.'); break; }
        const warnings = call.accepted_by || call.assigned_to ? [`${call.responding_officer || call.assigned_to_name || 'A crew'} is on this call and will be stood down.`] : [];
        out.views.push(viewProposal({ kind, ...base, reason }, { warnings }));
        break;
      }
    }
  }
  return out;
}

/** The plain description of an existing proposal, for the history sent back to the model. */
export function describeForModel(p: Proposal): string {
  switch (p.kind) {
    case 'log_call': {
      const c = p.call;
      return `log_call draft: ${JSON.stringify({
        caller_name: c.caller_name, caller_number: c.caller_number, is_caller_patient: c.is_caller_patient,
        patient_names: c.patient_names, description: c.call_description, incident_code: c.incident_type,
        severity: c.incident_severity, address: c.location_address, victims: c.number_of_victims,
        ems_not_required: c.ems_not_required, medical_priority: c.medical_priority, notes: c.notes,
        departments: c.tagged_silos.map(deptName),
      })}`;
    }
    case 'assign_officer': return `assign ${p.officer} to ${p.incident_number}`;
    case 'dispatch_all': return `send ${p.incident_number} to everyone on duty in ${deptList(p.silos)}`;
    case 'send_to_desk': return `send ${p.incident_number} to the ${deptList(p.silos)} desk`;
    case 'add_note': return `note on ${p.incident_number}: ${p.text}`;
    case 'set_status': return `mark ${p.incident_number} ${p.status}`;
    case 'cancel_call': return `close ${p.incident_number}: ${p.reason}`;
    case 'broadcast': return `broadcast to ${deptList(p.silos)}: ${p.message}`;
  }
}
