import type { Silo, UserRole } from '@criticom/db';
import { describeAccess } from '@criticom/db/roles';
import { abilitiesFor, broadcastTargets, deptList, deptName, deskSiloOf } from './abilities.ts';
import type { CritiThresholds, ProposalKind } from './types.ts';

/**
 * What Criti knows about the work, per department and per role. As V4's
 * assistant did, it is told the department it is speaking to and how that
 * department works, so its answers are that department's, not generic.
 * Written in the words the platform's screens use.
 */

const HOW_A_CALL_MOVES = `HOW A CALL MOVES
1. A call taker logs it (Log Incoming Call) and chooses which dispatch desks receive it: Metro Police, Fire & Rescue, EMS, Disaster Management. Only those desks get it. Status: Pending Dispatch (a Disaster Management call starts as Pending Analysis).
2. A dispatcher either assigns one person on duty (they lead the call) or sends it to everyone on duty in a department (the first to respond leads, others can join as backup). Status: Dispatched.
3. The crew responds from the HikTech app: Accept · Mark En Route, then Mark On Scene. EMS and Fire & Rescue can Mark Transporting when a patient or casualty is moving.
4. The lead files the department's report in the app. Filing it resolves the call. A crew can never resolve a call without its report.
5. A case manager, command or the dispatch desk reviews the resolved call and closes it. A call that will never have a report (hoax, duplicate, caller cancelled) is closed live by the desk or command, with a reason, and the crew is stood down.
The desk may record a step for a crew that radioed it in (En Route, Arrived, On Scene, Transporting), never Resolved or Closed.
A department's dispatch desk sees only the calls sent to it and dispatches its own crews. To bring another department in, send the call to that department's desk.
An officer's SOS (the panic button in the app) raises a Critical call and alerts their department's desk, the control room and command at once.
Every department's start of shift begins with the same six readiness questions. A No needs a note and stands the person down until a supervisor deals with it.`;

const DEPARTMENTS: Record<Silo, string> = {
  Ethekwini: `CONTROL ROOM (eThekwini)
The central control room takes calls for all four departments, sends each call to the right dispatch desks, and can dispatch any department's crews.`,

  MetroPolice: `METRO POLICE
Crime, traffic and public order. Field roles: Police Officer and Captain (who also commands a team).
Start of shift, in the app: the readiness check, the vehicle checklist, the firearm checklist (the firearm is booked out of the armoury) and the bodycam.
On a call: Accept · Mark En Route, Mark On Scene, then File incident report, which resolves the call. Officers also serve fines from the app.
Console: Police operations (/police), Fines register (/police/fines), Armoury (/police/armoury) and Bodycam register (/police/bodycams), kept by captains and supervisors. Live bodycams (/cameras) for command and the desk.`,

  MetroFire: `FIRE & RESCUE
Fires, rescues, hazardous materials and fire safety. Field roles: Firefighter and Fire Chief. Crews ride appliances (fire engines).
Start of shift, in the app: the six readiness questions, an available appliance, fuel and the 11 checks (lights and siren, tyres, emergency equipment, radio and GPS, brakes, SCBA, water tank, pump, hoses and nozzles, ladders, turnout gear), then the declaration and signature.
On a call: Accept · Mark En Route, Mark On Scene, Mark Transporting when a casualty or the appliance is moving, then File fire report (numbered FR- and the incident number), which resolves the call. The fire report needs a summary of at least 20 characters, a cause (Under investigation is allowed), details of anyone hurt, and photos or a reason there are none.
Console: Fire & Rescue board (/fire) with crews waiting, en route, on scene and transporting, fire reports (/fire/reports), hydrants and fire safety inspections.`,

  Medical: `EMS (EMERGENCY MEDICAL SERVICES)
Medical emergencies, injuries and patient transport. Roles: Paramedic (the ambulance crew) and Doctor (the receiving doctor at the hospital, who reads reports and signs the handover, and is never dispatched).
At intake: is the caller the patient, how many are hurt (0 to 4, or Multiple 5+), and the medical priority code: P1 RED critical or life-threatening, P2 ORANGE urgent or serious, P3 YELLOW minor or walking wounded, P4 BLUE deceased. Both are needed unless "No injuries / EMS not required" is ticked.
Start of shift, in the app: the six readiness questions, an available ambulance, fuel and five vehicle checks, the eight-item stock check, and "Does the ambulance require cleaning?". A failed vehicle check or a Yes to cleaning takes the ambulance off road; stock not all ticked keeps the paramedic off duty until restocked.
On a call: Accept · Mark En Route, Mark On Scene, Mark Transporting, then File patient report (PCR- and the incident number), which resolves the call. When the patient goes by ambulance or air, the receiving doctor signs the hospital handover. A Yes to "Does the vehicle require cleaning?" takes the ambulance off road.
Console: EMS operations (/medical), the Clinical Archive of patient reports (/medical/pcr), Hospital Handovers (/medical/handovers).`,

  EthekwiniDisaster: `DISASTER MANAGEMENT
Floods, storms, landslides, evacuations and other disasters. Field role: Disaster Management Officer. They have no vehicle.
Start of shift, in the app: the readiness questions only, then on duty.
Calls start as Pending Analysis. On a call: Accept · Mark En Route, Mark On Scene, then File post-mortem (PM- and the incident number), the after-action report with injuries, fatalities, displaced people, root cause and lessons learned. Filing it resolves the call.
Console: Disaster dashboard (/disaster) with displaced people and average response, Dispatch Resources (/disaster/dispatch) with periodic updates, Post-Mortems (/disaster/post-mortem), mutual-aid partners and relief stock.`,
};

const ROLE_WORK: Partial<Record<UserRole, string>> = {
  IncidentLogger: 'Call Taker: logs calls and chooses the dispatch desks that receive them. Does not dispatch: the dispatch desk does.',
  Dispatcher: 'Dispatcher: works the Pending Queue, assigns a crew member or sends a call to everyone on duty, and watches calls until a crew is on scene. Does not log calls: call takers do.',
  ControlRoom: 'Control Room Operator: logs calls and dispatches them.',
  Supervisor: "Supervisor: oversees the department's calls and crews, rosters, leave approvals, readiness and performance. Can dispatch and record a crew's status.",
  Captain: 'Captain: commands a Metro Police team (readiness, rosters, bodycams, fines) and responds from the app like an officer.',
  FireChief: 'Fire Chief: commands Fire & Rescue crews and responds from the app.',
  Police: 'Police Officer: responds to calls and files reports in the app. On the console: own calls, schedule, leave, training, performance.',
  Firefighter: 'Firefighter: responds to calls and files fire reports in the app. On the console: own calls, schedule, leave, training.',
  Paramedic: 'Paramedic: responds to calls and files patient reports in the app. On the console: own calls, patient reports, schedule, leave.',
  Doctor: 'Doctor: the receiving doctor. Reads patient reports and hospital handovers. Never dispatched.',
  Disaster: 'Disaster Management Officer: responds to disaster calls and files post-mortems in the app.',
  CaseManager: 'Case Manager: reviews resolved calls (Awaiting Review) and closes cases. Does not cancel live calls.',
  Viewer: 'Viewer: reads incidents and reports. Changes nothing.',
  Admin: "Administrator: manages the department's accounts, fleet, devices and settings.",
  SystemAdmin: 'System Administrator: manages every account, the staff register, invitations and approvals.',
  SuperAdmin: 'Platform Administrator: runs the platform: organisations, features, access rules, automations.',
  SystemController: 'System Controller: command and reporting across every department and module.',
  Staff: 'Staff: leave, schedule, attendance and mail.',
};

const DOES: Record<ProposalKind, string> = {
  log_call: 'log a new call from what you tell me (or fill the intake form for you)',
  assign_officer: 'assign a call to someone on duty',
  dispatch_all: 'send a call to everyone on duty in a department',
  send_to_desk: "send a call to another department's dispatch desk",
  add_note: "add a note to a call's timeline",
  set_status: "record a crew's step when they radio it in",
  cancel_call: 'close a live call that needs no report (hoax, duplicate, cancelled), with a reason',
  broadcast: 'send a broadcast',
};

/** Everything Criti may do for this person, as they would say it. */
export function abilitiesText(role: UserRole, silo: Silo): string[] {
  return abilitiesFor(role).map((k) => k === 'broadcast'
    ? `send a broadcast to ${deptList(broadcastTargets(role, silo))}`
    : DOES[k]);
}

/** Department knowledge, role and access, and the rules in force, for the prompt. */
export function knowledgeFor(role: UserRole, silo: Silo, t: CritiThresholds): string {
  const desk = deskSiloOf(role, silo);
  const departments: Silo[] = silo === 'Ethekwini'
    ? ['Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster']
    : [silo];
  const access = describeAccess(role, silo);
  return [
    HOW_A_CALL_MOVES,
    `TIME LIMITS IN FORCE
A call waiting ${t.lateWarnMinutes} min for dispatch is late, ${t.lateCriticalMinutes} min is badly late (the system escalates both). Sent and not accepted after ${t.notAcceptedMinutes} min: chase it. No crew on scene ${t.noArrivalMinutes} min after accepting: check on them. No news on an open call for ${t.quietHours} h: it has gone quiet. Shifts over ${t.maxShiftHours} h are long. Travel estimates use ${t.etaSpeedKmh} km/h on roads ${t.etaRoadFactor} times the straight line.`,
    ...departments.map((d) => DEPARTMENTS[d]),
    `THE PERSON YOU ARE HELPING
${ROLE_WORK[role] ?? 'A member of staff.'}
Department: ${deptName(silo)}${desk ? ` (the ${deptName(desk)} dispatch desk: only calls sent to it, and ${deptName(desk)} crews only)` : ''}.
Screens they can open: ${access.length ? access.join('; ') : 'their dashboard, schedule, leave and profile'}.
What you may offer to do for them: ${abilitiesText(role, silo).join('; ') || 'nothing: answer questions and explain where things are'}.`,
    `CONSOLE SCREENS
Dashboard /dashboard · Log Incoming Call /dispatch/log-call · Pending Queue /dispatch/pending · Assign /dispatch/assign/<call> · Live map /incidents/map · All incidents /incidents · KPI dashboard /dispatch/kpi · Radio /dispatch/ptt · Case management /case-manager · Duty board /roster/allocation · Roster /roster · Today's shift /shift/today · Leave /leave · Reports archive /reports · Report hub /report-hub · Alerts /notifications · Profile /profile.`,
  ].join('\n\n');
}
