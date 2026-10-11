import { NextResponse } from 'next/server';
import {
  REGIONS, assignIncident, broadcastTargets, canPropose, closeCase, deptList, listOnDutyOfficers,
  logAudit, logIncomingCall, matchCode, missingCallFields, proposalSchema, routeIncident, tagIncidentDepartments,
  teamOf, updateResponderStatus, viewProposal, type DeskSilo, type Proposal,
} from '@criticom/api';
import type { LogIncomingCallInput, Silo } from '@criticom/db';
import { checkPhone } from '@/lib/phone';
import { critiSession, loadCodes } from '@/lib/criti/server';

/**
 * Carry out a task the person confirmed on one of Criti's cards.
 *
 * Nothing the card said is trusted. The task is read again against the
 * schema, the person's role, their team and the live record, and then done
 * through the same functions the forms use, under their own session, so the
 * database applies every rule it applies to the forms: roles, the
 * department desk wall (0068), on duty, not already led, a reason to
 * close. Each one is written to the audit trail as confirmed through Criti.
 *
 * Request:  { proposal }
 * Response: { ok: true, message, href?, push? } or { ok: false, error }
 * `push` tells the screen whom to reach on a locked phone (/api/push/notify),
 * as the dispatch forms do after the same step.
 */
export const dynamic = 'force-dynamic';

type Result = { ok: true; message: string; href?: string; push?: { userId?: string; silos?: DeskSilo[] } };

const fail = (error: string, status = 422) => NextResponse.json({ ok: false, error }, { status });

/** A database refusal as the person reads it: the reason, then what to do. */
function refusal(e: unknown): string {
  const err = e as { message?: string; hint?: string | null };
  return [err.message ?? 'That could not be done.', err.hint].filter(Boolean).join(' ');
}

export async function POST(req: Request) {
  const session = await critiSession(req, { feature: ['web.assistant', 'web.criti_tiles'], limit: 'criti_act' });
  if (session instanceof NextResponse) return session;
  const { supabase, me } = session;

  const body = (await req.json().catch(() => null)) as { proposal?: unknown } | null;
  const parsed = proposalSchema.safeParse(body?.proposal);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'That task is incomplete. Ask Criti again.', 400);
  const p: Proposal = parsed.data;
  if (!canPropose(me.role, p.kind)) return fail('Your role cannot do this.', 403);

  const team = teamOf(me);
  const inTeam = (s: Silo) => team === 'all' || team.includes(s as DeskSilo);

  // The call, read under the person's own rules: no call, no task.
  type Call = { id: string; incident_number: string; silo: Silo; status: string };
  let incident: Call | null = null;
  if ('incident_id' in p) {
    const { data } = await supabase
      .from('incidents')
      .select('id, incident_number, silo, status')
      .eq('id', p.incident_id)
      .maybeSingle();
    incident = (data as Call | null) ?? null;
    if (!incident) return fail('That call is not on your desk.', 404);
    if (incident.incident_number !== p.incident_number) return fail('That call has changed. Ask Criti again.', 409);
  }

  let result: Result;
  // What the audit entry points at: the call acted on, or the call just logged.
  let subject: { id: string; silo: Silo } | null = incident ? { id: incident.id, silo: incident.silo } : null;
  try {
    switch (p.kind) {
      case 'assign_officer': {
        // Only someone on duty in a department this person dispatches.
        const crews = await listOnDutyOfficers(supabase, team === 'all' ? undefined : team);
        const crew = crews.find((c) => c.userId === p.user_id);
        if (!crew || !inTeam(crew.silo)) return fail(`${p.officer} is not on duty in a department you dispatch.`);
        await assignIncident(supabase, { incident_id: p.incident_id, user_id: p.user_id, notes: p.note });
        result = {
          ok: true, message: `${p.officer} is assigned to ${p.incident_number}. You will be told when they respond.`,
          href: `/incidents/${p.incident_id}`, push: { userId: p.user_id },
        };
        break;
      }
      case 'dispatch_all': {
        const outside = p.silos.filter((s) => !inTeam(s));
        if (outside.length) return fail(`You dispatch ${team === 'all' ? 'every department' : deptList(team)} only.`, 403);
        await routeIncident(supabase, { incident_id: p.incident_id, silos: p.silos, notes: p.note });
        result = {
          ok: true, message: `${p.incident_number} went to everyone on duty in ${deptList(p.silos)}. You will be told who responds.`,
          href: `/incidents/${p.incident_id}`, push: { silos: p.silos },
        };
        break;
      }
      case 'send_to_desk':
        await tagIncidentDepartments(supabase, { incident_id: p.incident_id, silos: p.silos, note: p.note });
        result = { ok: true, message: `${p.incident_number} is with the ${deptList(p.silos)} dispatch desk now.`, href: `/incidents/${p.incident_id}` };
        break;
      case 'add_note': {
        // On the timeline with the person's name, as the card says.
        const { error } = await supabase.from('incident_updates').insert({
          incident_id: p.incident_id, silo: incident!.silo, message: p.text, created_by: me.userId, created_by_name: me.name,
        });
        if (error) throw error;
        await logAudit(supabase, {
          silo: incident!.silo, action_type: 'IncidentUpdate', entity_type: 'incident', entity_id: p.incident_id,
          user_id: me.userId, user_name: me.name, details: p.text.slice(0, 200),
        }).catch(() => {});
        result = { ok: true, message: `Note added to ${p.incident_number}.`, href: `/incidents/${p.incident_id}` };
        break;
      }
      case 'set_status':
        await updateResponderStatus(supabase, { incident_id: p.incident_id, status: p.status });
        await logAudit(supabase, {
          silo: incident!.silo, action_type: 'StatusChange', entity_type: 'incident', entity_id: p.incident_id,
          user_id: me.userId, user_name: me.name, details: `Status → ${p.status} (set from the console through Criti)`,
        }).catch(() => {});
        result = { ok: true, message: `${p.incident_number} marked ${p.status}.`, href: `/incidents/${p.incident_id}` };
        break;
      case 'cancel_call':
        if (incident!.status === 'Resolved' || incident!.status === 'Closed') {
          return fail(`${p.incident_number} is ${incident!.status.toLowerCase()}. Close a resolved case from its case file, after reading the report.`);
        }
        await closeCase(supabase, { incident_id: p.incident_id, reason: p.reason });
        result = { ok: true, message: `${p.incident_number} is closed. Anyone on it has been stood down.`, href: `/incidents/${p.incident_id}` };
        break;
      case 'broadcast': {
        const allowed = broadcastTargets(me.role, me.silo);
        if (p.silos.some((s) => !allowed.includes(s))) return fail(`You can broadcast to ${deptList(allowed)} only.`, 403);
        const { data, error } = await supabase.rpc('send_broadcast', { p_silos: p.silos, p_message: p.message, p_severity: p.severity });
        if (error) throw error;
        const n = Number(data ?? 0);
        result = { ok: true, message: `Broadcast sent to ${n} ${n === 1 ? 'person' : 'people'} in ${deptList(p.silos)}.` };
        break;
      }
      case 'log_call': {
        const c = p.call;
        const missing = missingCallFields(c);
        if (missing.length) return fail(`Still needed: ${missing.join(', ')}.`);
        const phone = checkPhone(c.caller_number);
        if (!phone.ok) return fail(phone.error);
        // The code must be one of the configured codes, exactly.
        const code = matchCode(await loadCodes(supabase), c.incident_type);
        if (!code || code.incident_type !== c.incident_type) return fail('Choose an incident code from the list.');
        if (!(REGIONS as readonly string[]).includes(c.region)) return fail('Choose the region.');
        const payload: LogIncomingCallInput = {
          // Filed under the call taker's own department, as the form does for a call it queues.
          silo: me.silo,
          caller_name: c.caller_name,
          caller_number: phone.e164,
          call_description: c.call_description,
          incident_type: code.incident_type,
          incident_category: code.incident_category,
          incident_severity: c.incident_severity!,
          location_address: c.location_address,
          location_lat: c.location_lat!,
          location_lng: c.location_lng!,
          suburb: c.suburb || null,
          city: c.city || null,
          postal_code: c.postal_code || null,
          is_caller_patient: c.is_caller_patient!,
          patient_name: c.is_caller_patient ? c.caller_name : (c.patient_names || 'Unknown / Not Provided'),
          number_of_victims: c.ems_not_required ? 0 : c.number_of_victims,
          medical_type: c.ems_not_required ? 'EMS Not Required' : (c.medical_priority || null),
          notes: c.notes || null,
          region: c.region,
          tagged_silos: c.tagged_silos,
        };
        const logged = await logIncomingCall(supabase, payload);
        subject = { id: logged.id, silo: logged.silo };
        result = {
          ok: true,
          message: `${logged.incident_number} logged and sent to the ${deptList(c.tagged_silos)} dispatch desk${c.tagged_silos.length === 1 ? '' : 's'}.`,
          href: `/incidents/${logged.id}`,
        };
        break;
      }
    }
  } catch (e) {
    return fail(refusal(e));
  }

  // The trail: who confirmed what, through Criti. Best effort; the task itself already wrote its own.
  const view = viewProposal(p);
  await logAudit(supabase, {
    silo: subject?.silo ?? me.silo, action_type: 'CritiAction', entity_type: subject ? 'incident' : 'criti',
    entity_id: subject?.id ?? null, user_id: me.userId, user_name: me.name,
    details: `Confirmed through Criti: ${view.title}`.slice(0, 500),
  }).catch(() => {});

  return NextResponse.json(result);
}
