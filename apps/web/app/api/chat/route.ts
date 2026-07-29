import { NextResponse } from 'next/server';
import {
  getDispatcherKpis, getOnDutyResponders, listActiveIncidents, listApparatus,
  listPendingIncidents, logAudit, raiseAlert, routeIncident, updateResponderStatus,
} from '@criticom/api';
import type { IncidentStatus, Silo } from '@criticom/db';
import { getServerSupabase } from '@/lib/supabase';

/**
 * Criti — the assistant behind the right-hand dock and /assistant.
 *
 * Descends from V4's ChatbotController.Ask: a Gemini call with the live board
 * injected as context, and secret action codes the model emits to actually
 * change something. V5 widens both sides — more context (queue, crews, fleet,
 * KPIs) and more actions (routing, broadcasts).
 *
 * Every read goes through the caller's own Supabase session, so RLS decides
 * what Criti can see. It can never surface a record the operator could not open
 * themselves.
 */
export const dynamic = 'force-dynamic';

const SYSTEM_INSTRUCTION = `You are Criti, the AI assistant embedded in the Criticom emergency-management platform for eThekwini Emergency Services.

RULES FOR INTERACTION:
1. STRICT FACTUALITY: Never invent or guess data, addresses, names, IDs or numbers. Use ONLY the records in [LIVE OPERATIONS BOARD]. If a section says "None", say plainly that there are no such records.
2. MISSING CONTEXT: If a question about incidents or reports is ambiguous about department, ask whether they mean Fire, Police, Medical or Disaster.
3. BREVITY: Operators are busy. Lead with the answer. Use short Markdown bullets for lists; no preamble.
4. FORMATTING: **bold** for emphasis, \`code\` for identifiers, "- " for bullets. No tables, no headings.
5. SCOPE: The board reflects only what this user is cleared to see. Never speculate about other departments' records.

RULES FOR ACTIONS (STRICT):
When the user asks you to DO something, emit ONLY the exact code, on its own line, with no explanation around it:
- Change an incident status:      [UPDATE_STATUS|IncidentNumber|Status]
- Fill a report field:            [FILL_REPORT|IncidentNumber|FieldName|Value]
- Route a call to departments:    [ROUTE_INCIDENT|IncidentNumber|Silo,Silo]
- Broadcast to a department:      [BROADCAST|Silo|Message]

Valid statuses: Dispatched, En Route, Arrived, On Scene, Transporting, Resolved, Closed.
Valid silos: MetroPolice, MetroFire, Medical, EthekwiniDisaster, Ethekwini.
IncidentNumber must be an exact incident_number from the board (e.g. INC-...).
Routing a call pops an alert on every screen in the receiving departments — only do it when explicitly asked.
If the user's request is ambiguous, ask before emitting a code. Never emit a code for a record not on the board.

APPLICATION KNOWLEDGE BASE:
- Log a call: Dispatch → Log Incoming Call. Fill caller, location and incident code, choose the receiving departments, then Dispatch Incident.
- Pending queue: Dispatch → Pending Queue; open a row for the full lifecycle, or Assign to commit a unit.
- Responder flow: Responder → My Incidents advances En Route → Arrived → On Scene → Resolved.
- Start of shift: Responder → Start of Shift (mental readiness → vehicle selection → vehicle checklist).
- Reports: each department section (Police / Fire & Rescue / EMS / Disaster Mgmt); archives under Reports Archive; combined exports under Report Hub.
- People: Resources → Roster, Leave, Training, Performance. Admin → Users, Fleet, Devices, Integrations.
- Themes: the palette icon in the top bar, or Profile → Appearance.
- Tip worth mentioning once: the user can ask YOU to update statuses and route calls directly from this chat.`;

const VALID_STATUSES: IncidentStatus[] = [
  'Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting', 'Resolved', 'Closed',
];
const VALID_SILOS: Silo[] = [
  'Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster',
];
// Whitelist of incident columns FILL_REPORT may touch (V4 wrote free-form; V5 is stricter).
const FILLABLE_FIELDS = new Set(['notes', 'responding_officer', 'unit_status', 'number_of_victims']);

type ChatMessage = { role: 'user' | 'assistant'; text: string };
type IncidentRow = Awaited<ReturnType<typeof listActiveIncidents>>[number];
type Supabase = Awaited<ReturnType<typeof getServerSupabase>>;

/* ── Context assembly ───────────────────────────────────────────────── */

function fmtIncidents(rows: IncidentRow[], limit: number): string {
  if (rows.length === 0) return 'None';
  const shown = rows.slice(0, limit).map((i) =>
    `${i.incident_number} | ${i.silo} | ${i.incident_type} | ${i.incident_severity} | ` +
    `${i.status} | ${i.location_address} | caller ${i.caller_name}`,
  );
  const extra = rows.length > limit ? `\n… and ${rows.length - limit} more` : '';
  return shown.join('\n') + extra;
}

/**
 * Everything Criti is allowed to reason over, in one prompt block. Each lookup
 * is independently fault-tolerant: a permission error on one section must not
 * blank out the rest of the board.
 */
async function buildBoard(supabase: Supabase, silo: Silo) {
  const scope = silo === 'Ethekwini' ? undefined : silo;

  const [active, pending, onDuty, fleet, kpis] = await Promise.all([
    listActiveIncidents(supabase, scope).catch(() => [] as IncidentRow[]),
    listPendingIncidents(supabase, scope).catch(() => [] as IncidentRow[]),
    getOnDutyResponders(supabase, scope).catch(() => [] as Array<Record<string, unknown>>),
    listApparatus(supabase, scope).catch(() => [] as Array<Record<string, unknown>>),
    getDispatcherKpis(supabase, scope).catch(() => null),
  ]);

  const available = fleet.filter((a) => (a as { status?: string }).status === 'Available');
  const crewLine = onDuty.length === 0
    ? 'None'
    : onDuty.slice(0, 20).map((p) => {
      const r = p as { full_name?: string; rank?: string; silo?: string; call_sign?: string };
      return `${r.full_name ?? 'Unknown'}${r.call_sign ? ` (${r.call_sign})` : ''} | ${r.rank ?? '—'} | ${r.silo ?? '—'}`;
    }).join('\n');

  const fleetLine = available.length === 0
    ? 'None'
    : available.slice(0, 20).map((a) => {
      const r = a as { unit_number?: string; name?: string; type?: string; silo?: string };
      return `${r.unit_number ?? '—'} ${r.name ?? ''} | ${r.type ?? '—'} | ${r.silo ?? '—'}`;
    }).join('\n');

  const k = kpis as null | {
    activeDeployments: number; criticalAlertsToday: number; totalIncidentsToday: number;
    personnelOnDuty: number; avgResponseTime: number;
  };
  const kpiLine = k
    ? `Active deployments ${k.activeDeployments} | Critical today ${k.criticalAlertsToday} | ` +
      `Total today ${k.totalIncidentsToday} | On duty ${k.personnelOnDuty} | ` +
      `Avg response ${Number(k.avgResponseTime ?? 0).toFixed(1)} min`
    : 'Unavailable';

  return {
    incidents: [...active, ...pending.filter((p) => !active.some((a) => a.id === p.id))],
    text:
      `ACTIVE INCIDENTS (${active.length}):\n${fmtIncidents(active, 25)}\n\n` +
      `AWAITING DISPATCH (${pending.length}):\n${fmtIncidents(pending, 15)}\n\n` +
      `CREWS ON DUTY (${onDuty.length}):\n${crewLine}\n\n` +
      `AVAILABLE UNITS (${available.length} of ${fleet.length}):\n${fleetLine}\n\n` +
      `TODAY'S KPIS: ${kpiLine}`,
  };
}

/* ── Action execution ───────────────────────────────────────────────── */

async function executeActions(
  supabase: Supabase,
  incidents: IncidentRow[],
  reply: string,
  userName: string,
  userSilo: Silo,
): Promise<{ cleaned: string; outcomes: string[] }> {
  const outcomes: string[] = [];
  let cleaned = reply;
  const byNumber = new Map(incidents.map((i) => [i.incident_number, i]));

  // ── status changes ──
  for (const m of reply.matchAll(/\[UPDATE_STATUS\|([^|\]]+)\|([^\]]+)\]/g)) {
    cleaned = cleaned.replace(m[0], '');
    const incident = byNumber.get(m[1]!.trim());
    const status = m[2]!.trim() as IncidentStatus;
    if (!incident) { outcomes.push(`⚠ No active incident "${m[1]!.trim()}" on the board.`); continue; }
    if (!VALID_STATUSES.includes(status)) { outcomes.push(`⚠ "${status}" is not a valid status.`); continue; }
    try {
      await updateResponderStatus(supabase, { incident_id: incident.id, status });
      await logAudit(supabase, {
        silo: incident.silo as Silo, action_type: 'StatusChange', entity_type: 'incident',
        entity_id: incident.id, user_name: userName, details: `Criti assistant → ${status}`,
      });
      outcomes.push(`✔ ${incident.incident_number} set to **${status}**.`);
    } catch (e) {
      outcomes.push(`⚠ Could not update ${incident.incident_number}: ${(e as Error).message}`);
    }
  }

  // ── report fields ──
  for (const m of reply.matchAll(/\[FILL_REPORT\|([^|\]]+)\|([^|\]]+)\|([^\]]+)\]/g)) {
    cleaned = cleaned.replace(m[0], '');
    const incident = byNumber.get(m[1]!.trim());
    const field = m[2]!.trim().toLowerCase();
    const value = m[3]!.trim();
    if (!incident) { outcomes.push(`⚠ No active incident "${m[1]!.trim()}" on the board.`); continue; }
    if (!FILLABLE_FIELDS.has(field)) {
      outcomes.push(`⚠ "${field}" is not editable from chat (allowed: ${[...FILLABLE_FIELDS].join(', ')}).`);
      continue;
    }
    try {
      const patch = field === 'number_of_victims' ? { [field]: Number(value) || 0 } : { [field]: value };
      const { error } = await supabase.from('incidents').update(patch).eq('id', incident.id);
      if (error) throw error;
      await logAudit(supabase, {
        silo: incident.silo as Silo, action_type: 'ReportFieldFilled', entity_type: 'incident',
        entity_id: incident.id, user_name: userName, details: `Criti assistant: ${field} = ${value}`,
      });
      outcomes.push(`✔ ${incident.incident_number}: **${field}** set to "${value}".`);
    } catch (e) {
      outcomes.push(`⚠ Could not fill ${field} on ${incident.incident_number}: ${(e as Error).message}`);
    }
  }

  // ── routing to departments (pops an alert on every receiving screen) ──
  for (const m of reply.matchAll(/\[ROUTE_INCIDENT\|([^|\]]+)\|([^\]]+)\]/g)) {
    cleaned = cleaned.replace(m[0], '');
    const incident = byNumber.get(m[1]!.trim());
    const silos = m[2]!.split(',').map((s) => s.trim()).filter((s): s is Silo =>
      VALID_SILOS.includes(s as Silo));
    if (!incident) { outcomes.push(`⚠ No active incident "${m[1]!.trim()}" on the board.`); continue; }
    if (silos.length === 0) { outcomes.push(`⚠ "${m[2]!.trim()}" contains no valid department.`); continue; }
    try {
      await routeIncident(supabase, { incident_id: incident.id, silos });
      outcomes.push(`✔ ${incident.incident_number} routed to **${silos.join(', ')}** — crews alerted.`);
    } catch (e) {
      outcomes.push(`⚠ Could not route ${incident.incident_number}: ${(e as Error).message}`);
    }
  }

  // ── department broadcast ──
  for (const m of reply.matchAll(/\[BROADCAST\|([^|\]]+)\|([^\]]+)\]/g)) {
    cleaned = cleaned.replace(m[0], '');
    const target = m[1]!.trim() as Silo;
    const message = m[2]!.trim();
    if (!VALID_SILOS.includes(target)) { outcomes.push(`⚠ "${target}" is not a valid department.`); continue; }
    try {
      await raiseAlert(supabase, {
        silo: target, kind: 'broadcast', severity: 'Medium',
        title: `Broadcast from ${userName}`, body: message,
        createdByName: userName, presentation: 'toast',
      });
      await logAudit(supabase, {
        silo: userSilo, action_type: 'Broadcast', entity_type: 'alert',
        user_name: userName, details: `${target}: ${message}`,
      });
      outcomes.push(`✔ Broadcast sent to **${target}**.`);
    } catch (e) {
      outcomes.push(`⚠ Could not broadcast to ${target}: ${(e as Error).message}`);
    }
  }

  return { cleaned: cleaned.trim(), outcomes };
}

/* ── Handler ────────────────────────────────────────────────────────── */

export async function POST(req: Request) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { messages, page } = (await req.json()) as { messages: ChatMessage[]; page?: string };
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({
      reply:
        'The AI assistant is not configured on this deployment yet — an administrator needs to set ' +
        '`GEMINI_API_KEY` (Admin → Integrations shows the status).\n\n' +
        'In the meantime: log calls under **Dispatch → Log Incoming Call**, assign units from the ' +
        '**Pending Queue**, responders update status under **My Incidents**, and reports live under ' +
        'each department section.',
      configured: false,
    });
  }

  const silo = (user.app_metadata?.silo ?? 'Ethekwini') as Silo;
  const role = (user.app_metadata?.role ?? 'Viewer') as string;
  const userName = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? 'Operator';

  const board = await buildBoard(supabase, silo);

  const history = messages.slice(0, -1).slice(-10)
    .map((m) => `${m.role.toUpperCase()}: ${m.text}`).join('\n');
  const current = messages[messages.length - 1]!.text;

  const finalPrompt =
    `[OPERATOR] ${userName} · role ${role} · department ${silo}` +
    `${page ? ` · currently viewing ${page}` : ''}\n` +
    `[TIME] ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })} SAST\n\n` +
    `[LIVE OPERATIONS BOARD]\n${board.text}\n\n` +
    `Previous chat history:\n${history || '(none)'}\n\n` +
    `CURRENT USER MESSAGE: ${current}`;

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite';
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1000 },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? 'No response.';

    const { cleaned, outcomes } = await executeActions(
      supabase, board.incidents, raw, userName, silo,
    );
    const reply = [cleaned, ...outcomes].filter(Boolean).join('\n\n') || 'Done.';

    return NextResponse.json({ reply, configured: true, actionsExecuted: outcomes.length });
  } catch (e) {
    return NextResponse.json(
      { reply: `Assistant temporarily unavailable (${(e as Error).message}).`, configured: true },
      { status: 200 },
    );
  }
}
