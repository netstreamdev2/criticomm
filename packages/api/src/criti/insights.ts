import type { IncidentSeverity, Silo, UserRole } from '@criticom/db';
import { suggestedDesks } from '@criticom/db/desks';
import { GLOBAL_ROLES, RESPONDER_ROLES } from '@criticom/db/roles';
import { DESKS, canPropose, deptList, deptName, deskSiloOf } from './abilities.ts';
import { viewProposal } from './proposals.ts';
import {
  OUT_OF_TOUCH_MS, silentFor,
  type CritiCrew, type CritiIncident, type CritiMe, type CritiThresholds, type DeskSilo, type Insight, type InsightAction, type InsightKind, type InsightTone,
} from './types.ts';

/**
 * Criti's suggestion tiles: what needs attention, worked out from the live
 * board by fixed rules. No AI model is involved, so the tiles work without
 * one, give the same answer every time, and can be checked by hand.
 *
 * The board is whatever the person may read (RLS), so a tile never names a
 * call or a crew they could not open themselves. Offered actions are limited
 * to what their role may do, and still need their confirmation.
 */

export type InsightInput = {
  me: CritiMe;
  /** Open calls the person can read. */
  incidents: CritiIncident[];
  /** People on duty the person can see. */
  crews: CritiCrew[];
  thresholds: CritiThresholds;
};

const PENDING = new Set(['New', 'Pending', 'Pending Dispatch', 'Pending Analysis']);
const FINISHED = new Set(['Resolved', 'Closed']);
const ON_SCENE = new Set(['Arrived', 'On Scene', 'Transporting']);
const SEVERE = new Set<IncidentSeverity>(['High', 'Critical']);
const COMMAND: readonly UserRole[] = ['Supervisor', 'Captain', 'FireChief', 'Admin', 'SystemAdmin', 'SuperAdmin', 'SystemController'];

/** Most tiles one call may have, so one bad call does not fill the panel. */
const PER_INCIDENT = 2;
const MAX_TILES = 30;

const minutesSince = (iso: string | null | undefined, now: Date) =>
  iso ? Math.max(0, (now.getTime() - new Date(iso).getTime()) / 60_000) : 0;
/** Milliseconds, for ordering times that may be written differently. */
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() || 0 : 0);

/** The desks a call was sent to; a call from before 0068 counts its own department. */
export function tagsOf(i: Pick<CritiIncident, 'silo' | 'tagged_silos' | 'dispatched_silos'>): DeskSilo[] {
  const tags = new Set<Silo>([...(i.tagged_silos ?? []), ...(i.dispatched_silos ?? [])]);
  if (tags.size === 0 && i.silo !== 'Ethekwini') tags.add(i.silo);
  return DESKS.filter((d) => tags.has(d));
}

/**
 * The departments whose crews this person dispatches: a department desk its
 * own (the database refuses the rest), the control room and the
 * tenant-wide roles every department, anyone else their own.
 */
export function teamOf(me: Pick<CritiMe, 'role' | 'silo'>): DeskSilo[] | 'all' {
  const desk = deskSiloOf(me.role, me.silo);
  if (desk) return [desk];
  if (me.silo === 'Ethekwini' || GLOBAL_ROLES.includes(me.role)) return 'all';
  return [me.silo as DeskSilo];
}

const inTeam = (team: DeskSilo[] | 'all', silo: Silo) => team === 'all' || team.includes(silo as DeskSilo);

/** Straight-line distance in kilometres. */
export function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type CrewOption = { crew: CritiCrew; minutes: number | null };

/**
 * Free crews for a call, nearest first: on duty, on no other call, in a
 * department the call went to and the person dispatches. Minutes are a road
 * estimate from Operations Settings; without a position there is none.
 */
export function freeCrewsFor(
  incident: CritiIncident,
  crews: CritiCrew[],
  silos: DeskSilo[],
  t: Pick<CritiThresholds, 'etaSpeedKmh' | 'etaRoadFactor'>,
  exclude: string | null = null,
  /** Given, crews whose app has been silent for hours are left out (gone home still marked on duty). */
  now: Date | null = null,
): CrewOption[] {
  const hasPin = incident.location_lat !== null && incident.location_lng !== null
    && !(incident.location_lat === 0 && incident.location_lng === 0);
  return crews
    // Free, and their app still in touch: one silent for hours has most likely gone home.
    .filter((c) => c.activeCalls === 0 && c.userId !== exclude && silos.includes(c.silo as DeskSilo) && !(now && silentFor(c, now, OUT_OF_TOUCH_MS)))
    .map((crew) => {
      if (!hasPin || crew.lat === null || crew.lng === null) return { crew, minutes: null };
      const road = km(crew.lat, crew.lng, incident.location_lat!, incident.location_lng!) * t.etaRoadFactor;
      return { crew, minutes: Math.max(1, Math.ceil((road / Math.max(1, t.etaSpeedKmh)) * 60)) };
    })
    .sort((a, b) => (a.minutes ?? Number.POSITIVE_INFINITY) - (b.minutes ?? Number.POSITIVE_INFINITY));
}

/** Last nine digits, as the duplicate check compares numbers (0062). */
const callerTail = (n: string | null) => {
  const d = (n ?? '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : null;
};
const sameText = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The report that closes a call, in each department's words. */
const REPORT: Record<DeskSilo, string> = {
  MetroPolice: 'incident report',
  MetroFire: 'fire report',
  Medical: 'patient report',
  EthekwiniDisaster: 'post-mortem',
};

const leadDepartment = (i: CritiIncident): DeskSilo | null =>
  (i.dispatched_silos ?? []).find((s): s is DeskSilo => s !== 'Ethekwini')
  ?? (i.silo !== 'Ethekwini' ? (i.silo as DeskSilo) : tagsOf(i)[0] ?? null);

/** Whether any tile rule speaks to this role: the desk, command and field crews. */
export function insightsApply(role: UserRole): boolean {
  return canPropose(role, 'assign_officer') || canPropose(role, 'send_to_desk') || canPropose(role, 'log_call')
    || COMMAND.includes(role) || RESPONDER_ROLES.includes(role);
}

export function computeInsights(input: InsightInput, now: Date = new Date()): Insight[] {
  const { me, incidents, crews, thresholds: t } = input;
  const role = me.role;
  const dispatches = canPropose(role, 'assign_officer');
  const tags = canPropose(role, 'send_to_desk');
  const logs = canPropose(role, 'log_call');
  const desk = dispatches || tags || logs;
  const command = COMMAND.includes(role);
  const field = RESPONDER_ROLES.includes(role);
  /** Follows calls through to the scene: the dispatch desk and command, not the call taker. */
  const oversees = dispatches || command;
  if (!insightsApply(role)) return [];

  const team = teamOf(me);
  const open = incidents.filter((i) => !FINISHED.has(i.status));
  const out: Insight[] = [];

  const card = (i: CritiIncident) => ({
    id: i.id, number: i.incident_number, type: i.incident_type, severity: i.incident_severity,
    address: i.location_address, status: i.status,
  });
  const push = (
    kind: InsightKind, key: string, tone: InsightTone, rank: number, title: string, body: string,
    since: string | null, incident: CritiIncident | null, actions: InsightAction[],
  ) => out.push({ id: `${kind}:${key}`, kind, tone, rank, title, body, since, incident: incident ? card(incident) : null, actions });
  const openCall = (i: CritiIncident, label = 'Open the call'): InsightAction => ({ type: 'link', label, href: `/incidents/${i.id}` });

  /** The departments this person may send a call's crews from. */
  const dispatchSilos = (i: CritiIncident) => tagsOf(i).filter((s) => inTeam(team, s));
  const crewLine = (options: CrewOption[], silos: DeskSilo[]) => {
    const best = options[0];
    if (best) return best.minutes !== null ? ` ${best.crew.name} is free, about ${best.minutes} min away.` : ` ${best.crew.name} is free.`;
    return silos.length ? ` Nobody from ${deptList(silos)} is free on duty.` : '';
  };
  const assignAction = (i: CritiIncident, option: CrewOption | undefined): InsightAction[] =>
    option ? [{
      type: 'propose',
      label: `Assign ${option.crew.name}`,
      view: viewProposal(
        { kind: 'assign_officer', incident_id: i.id, incident_number: i.incident_number, user_id: option.crew.userId, officer: option.crew.name, note: null },
        { lines: option.minutes !== null ? [`About ${option.minutes} min away by road.`] : [] },
      ),
    }] : [];
  const everyoneAction = (i: CritiIncident, silos: DeskSilo[]): InsightAction[] =>
    silos.length ? [{
      type: 'propose',
      label: 'Send to everyone on duty',
      view: viewProposal({ kind: 'dispatch_all', incident_id: i.id, incident_number: i.incident_number, silos, note: null }),
    }] : [];

  /* ── An officer calling for help ── */
  for (const i of open) {
    if (i.source !== 'Responder-Panic') continue;
    if (field && !(i.silo === me.silo || (i.dispatched_silos ?? []).includes(me.silo))) continue;
    push('sos', i.id, 'critical', 0, `SOS from ${i.caller_name || 'a crew member'}`,
      `${i.location_address}. Their crew needs help now.`, i.incident_created_at, i,
      [openCall(i), { type: 'ask', label: 'Ask Criti', prompt: `Who is nearest to ${i.incident_number}?` }]);
  }
  const sos = new Set(open.filter((i) => i.source === 'Responder-Panic').map((i) => i.id));

  /* ── The desk and command: calls waiting, sent, stuck ── */
  if (desk || command) {
    for (const i of open) {
      if (sos.has(i.id)) continue;
      const severe = SEVERE.has(i.incident_severity);

      if (PENDING.has(i.status)) {
        const wait = minutesSince(i.call_timestamp || i.incident_created_at, now);
        const silos = dispatchSilos(i);
        const options = dispatches ? freeCrewsFor(i, crews, silos, t, null, now) : [];
        const sent = tagsOf(i);
        const where = `${i.incident_type} at ${i.location_address}.${sent.length ? ` Sent to the ${deptList(sent)} desk${sent.length === 1 ? '' : 's'}.` : ''}`;
        const actions: InsightAction[] = dispatches
          ? [...assignAction(i, options[0]), ...everyoneAction(i, silos), { type: 'link', label: 'Open in the queue', href: `/dispatch/assign/${i.id}` }]
          : [openCall(i)];
        if (severe && wait < t.lateWarnMinutes) {
          // The call taker who logged it already knows; the desk and command need to.
          if (oversees) {
            push('incoming_critical', i.id, i.incident_severity === 'Critical' ? 'critical' : 'high',
              i.incident_severity === 'Critical' ? 1 : 2, `${i.incident_severity} call waiting for dispatch`,
              where + (dispatches ? crewLine(options, silos) : ''), i.call_timestamp, i, actions);
          }
        } else if (wait >= t.lateWarnMinutes) {
          const bad = wait >= t.lateCriticalMinutes;
          push('late_dispatch', i.id, severe || bad ? 'critical' : 'warning', severe ? 1.5 : bad ? 3 : 4,
            bad ? 'Late dispatch: over ' + t.lateCriticalMinutes + ' min' : 'Late dispatch: over ' + t.lateWarnMinutes + ' min',
            where + (dispatches ? crewLine(options, silos) : ''), i.call_timestamp, i, actions);
        }
        continue;
      }
      // Once a call is out, following it is the desk's and command's work.
      if (!oversees) continue;

      // Sent out, and nobody has pressed Responding.
      if (i.status === 'Dispatched' && !i.accepted_by) {
        const since = i.assigned_at ?? i.dispatch_time;
        if (minutesSince(since, now) >= t.notAcceptedMinutes) {
          const silos = dispatchSilos(i);
          const options = dispatches ? freeCrewsFor(i, crews, silos, t, i.assigned_to, now) : [];
          push('not_accepted', i.id, severe ? 'high' : 'warning', severe ? 2.5 : 5, 'No one has responded',
            i.assigned_to_name
              ? `${i.assigned_to_name} has not pressed Responding on ${i.incident_number}.${dispatches ? crewLine(options, silos) : ''}`
              : `${i.incident_number} went to everyone on duty${silos.length ? ` in ${deptList(silos)}` : ''}. No one has taken it yet.`,
            since, i,
            dispatches
              ? [...assignAction(i, options[0]), ...(i.assigned_to ? everyoneAction(i, silos) : []), openCall(i)]
              : [openCall(i)]);
        }
        continue;
      }

      // Accepted, and nobody on scene yet.
      if (i.accepted_by && !i.arrived_timestamp && (i.status === 'Dispatched' || i.status === 'En Route')) {
        const since = i.accepted_at ?? i.dispatch_time;
        if (minutesSince(since, now) >= t.noArrivalMinutes) {
          const actions: InsightAction[] = [openCall(i)];
          if (canPropose(role, 'set_status')) {
            actions.unshift({
              type: 'propose', label: 'They radioed: mark on scene',
              view: viewProposal({ kind: 'set_status', incident_id: i.id, incident_number: i.incident_number, status: 'On Scene' }),
            });
          }
          push('no_arrival', i.id, 'warning', 6, 'Crew not on scene yet',
            `${i.responding_officer || 'The crew'} took ${i.incident_number} and has not reached ${i.location_address}.`, since, i, actions);
          continue;
        }
      }

      // On scene a long time (command).
      if (command && ON_SCENE.has(i.status) && minutesSince(i.arrived_timestamp, now) >= t.onSceneMinutes) {
        const lead = leadDepartment(i);
        push('on_scene_long', i.id, 'info', 9, 'Long time on scene',
          `${i.responding_officer || 'The crew'} has been at ${i.incident_number} a long time. It stays open until the ${lead ? REPORT[lead] : 'report'} is filed.`,
          i.arrived_timestamp, i, [openCall(i)]);
        continue;
      }

      // No news for hours.
      const last = ms(i.last_note_at) > ms(i.updated_at) ? i.last_note_at! : i.updated_at;
      if (minutesSince(last, now) >= t.quietHours * 60) {
        push('gone_quiet', i.id, 'info', 10, 'No news in a while',
          `Nothing has been added to ${i.incident_number} for over ${t.quietHours} hours.`, last, i,
          [openCall(i), { type: 'ask', label: 'Ask Criti', prompt: `Summarise ${i.incident_number} and tell me what is missing.` }]);
      }
    }
  }

  /* ── Intake and the desk: the same emergency twice, a desk left out ── */
  if (desk) {
    const byAge = [...open].filter((i) => !sos.has(i.id))
      .sort((a, b) => ms(a.incident_created_at) - ms(b.incident_created_at));
    for (let n = 1; n < byAge.length; n++) {
      const newer = byAge[n]!;
      const tail = callerTail(newer.caller_number);
      const place = sameText(newer.location_address);
      const older = byAge.slice(0, n).reverse().find((o) =>
        ms(newer.incident_created_at) - ms(o.incident_created_at) <= t.duplicateHours * 3_600_000
        && ((tail !== null && callerTail(o.caller_number) === tail)
          || (place !== '' && sameText(o.location_address) === place && o.incident_type === newer.incident_type)));
      if (!older) continue;
      const sameCaller = tail !== null && callerTail(older.caller_number) === tail;
      const actions: InsightAction[] = [
        { type: 'link', label: `Open ${older.incident_number}`, href: `/incidents/${older.id}` },
        { type: 'link', label: `Open ${newer.incident_number}`, href: `/incidents/${newer.id}` },
      ];
      if (canPropose(role, 'cancel_call') && PENDING.has(newer.status)) {
        actions.unshift({
          type: 'propose', label: `Close ${newer.incident_number} as a duplicate`,
          view: viewProposal({
            kind: 'cancel_call', incident_id: newer.id, incident_number: newer.incident_number,
            reason: `Duplicate of ${older.incident_number}`,
          }),
        });
      }
      push('possible_duplicate', newer.id, 'warning', 4.5, 'Possible duplicate',
        sameCaller
          ? `${newer.incident_number} has the same caller number as ${older.incident_number}.`
          : `${newer.incident_number} has the same address and code as ${older.incident_number}.`,
        newer.incident_created_at, newer, actions);
    }
  }

  if (tags) {
    for (const i of open) {
      if (sos.has(i.id)) continue;
      const sent = tagsOf(i);
      const victims = i.number_of_victims ?? 0;
      const ems = i.medical_type === 'EMS Not Required';
      const missing = suggestedDesks({
        category: i.incident_category, incidentType: i.incident_type, victims, emsNotRequired: ems,
      }).filter((s) => !sent.includes(s));
      if (missing.length === 0) continue;
      const hurt = missing.includes('Medical') && victims > 0 && !ems;
      push('missing_desk', i.id, hurt ? 'high' : 'warning', 3.5,
        hurt ? 'People hurt, EMS not sent' : `${deptList(missing)} not sent`,
        hurt
          ? `${i.incident_number} reports ${victims === 5 ? 'five or more' : victims} hurt, but the EMS desk does not have it.`
          : `${i.incident_number} is a ${i.incident_category || i.incident_type} call, but the ${deptList(missing)} desk does not have it.`,
        i.incident_created_at, i,
        [{
          type: 'propose', label: `Send to ${deptList(missing)}`,
          view: viewProposal({ kind: 'send_to_desk', incident_id: i.id, incident_number: i.incident_number, silos: missing, note: null }),
        }, openCall(i)]);
    }
  }

  /* ── Crews: nobody on duty, the queue building, long shifts ── */
  if (dispatches || command) {
    const waiting = open.filter((i) => PENDING.has(i.status) && !sos.has(i.id));
    for (const silo of DESKS) {
      if (!inTeam(team, silo)) continue;
      const calls = waiting.filter((i) => tagsOf(i).includes(silo)).length;
      if (calls === 0) continue;
      const onDuty = crews.filter((c) => c.silo === silo);
      const free = onDuty.filter((c) => c.activeCalls === 0 && !silentFor(c, now, OUT_OF_TOUCH_MS)).length;
      if (onDuty.length === 0) {
        push('no_crews', silo, 'high', 2.8, `Nobody on duty in ${deptName(silo)}`,
          `${calls} call${calls === 1 ? ' is' : 's are'} waiting for ${deptName(silo)}, and no one from ${deptName(silo)} is on duty in the app.`,
          null, null, [{ type: 'link', label: 'Duty board', href: '/roster/allocation' }]);
      } else if (calls >= t.queueBuilding && free < calls) {
        push('queue_building', silo, 'warning', 5.5, `Queue building for ${deptName(silo)}`,
          `${calls} calls waiting and ${free} crew${free === 1 ? '' : 's'} free.`, null, null,
          [{ type: 'link', label: 'Open the queue', href: '/dispatch/pending' }]);
      }
    }
  }

  if (command) {
    const long = crews.filter((c) => c.onDutySince && minutesSince(c.onDutySince, now) >= t.maxShiftHours * 60)
      .sort((a, b) => ms(a.onDutySince) - ms(b.onDutySince));
    if (long.length) {
      const names = long.slice(0, 3).map((c) => c.name).join(', ') + (long.length > 3 ? ` and ${long.length - 3} more` : '');
      push('long_shift', 'crews', 'info', 11,
        long.length === 1 ? `${long[0]!.name} is past ${t.maxShiftHours} hours on duty` : `${long.length} people past ${t.maxShiftHours} hours on duty`,
        long.length === 1 ? 'Confirm they are fit to continue, or stand them down.' : `${names}. Confirm they are fit to continue.`,
        long[0]!.onDutySince, null, [{ type: 'link', label: "Today's shift", href: '/shift/today' }]);
    }
  }

  /* ── Field crews on the console: their own calls ── */
  if (field) {
    for (const i of open) {
      if (sos.has(i.id)) continue;
      if (i.assigned_to === me.userId && !i.accepted_by && i.status === 'Dispatched') {
        push('my_call', i.id, 'high', 1.2, 'A call is waiting for you',
          `${i.incident_type} at ${i.location_address}. Press Responding in the app to take it.`, i.assigned_at ?? i.dispatch_time, i, [openCall(i)]);
      } else if (!i.assigned_to && !i.accepted_by && i.status === 'Dispatched' && (i.dispatched_silos ?? []).includes(me.silo)) {
        push('my_call', i.id, 'warning', 3, `Open call for ${deptName(me.silo)}`,
          `${i.incident_type} at ${i.location_address}. The first to respond in the app leads it.`, i.dispatch_time, i, [openCall(i)]);
      } else if (i.accepted_by === me.userId && ON_SCENE.has(i.status) && minutesSince(i.arrived_timestamp, now) >= t.onSceneMinutes) {
        const lead = leadDepartment(i);
        push('on_scene_long', i.id, 'info', 9, 'Your call is still open',
          `You have been on scene at ${i.incident_number} a long time. File the ${lead ? REPORT[lead] : 'report'} in the app when you are done.`,
          i.arrived_timestamp, i, [openCall(i)]);
      }
    }
  }

  // Most urgent first, the longest-standing first within a rank; at most a
  // couple of tiles for any one call.
  out.sort((a, b) => a.rank - b.rank || ms(a.since) - ms(b.since));
  const perIncident = new Map<string, number>();
  const seen = new Set<string>();
  return out.filter((x) => {
    if (seen.has(x.id)) return false;
    seen.add(x.id);
    if (!x.incident) return true;
    const n = (perIncident.get(x.incident.id) ?? 0) + 1;
    perIncident.set(x.incident.id, n);
    return n <= PER_INCIDENT;
  }).slice(0, MAX_TILES);
}
