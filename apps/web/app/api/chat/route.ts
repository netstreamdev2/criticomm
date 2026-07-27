import { NextResponse } from 'next/server';
import { listActiveIncidents, updateResponderStatus, logAudit } from '@criticom/api';
import type { IncidentStatus, Silo } from '@criticom/db';
import { getServerSupabase } from '@/lib/supabase';

/**
 * ChatbotController.Ask + ChatbotService — "Criti" assistant.
 * Faithful port: Gemini call with the V4 system prompt, live database context
 * injection, and execution of the secret action codes
 * [UPDATE_STATUS|IncidentID|Status] and [FILL_REPORT|IncidentID|FieldName|Value].
 */
export const dynamic = 'force-dynamic';

// V4 system instruction, updated for V5 navigation.
const SYSTEM_INSTRUCTION = `You are Criti, the highly efficient AI assistant for the Criticom emergency management dashboard.

RULES FOR INTERACTION:
1. MISSING CONTEXT: If a user asks about incidents or reports but DOES NOT specify a department, ask them to specify Fire, Police, Medical, or Disaster.
2. STRICT FACTUALITY: NEVER invent, hallucinate, or make up data, addresses, names, or IDs. You must ONLY display the exact records provided to you in the [DATABASE CONTEXT INJECTED BY SYSTEM]. If the system says 'None', you must tell the user there are no active records.
3. FORMATTING: Use Markdown (bolding and bullet points) to format database records and instructions nicely.

RULES FOR ACTIONS (STRICT):
If the user asks you to perform a task, output ONLY the exact secret code format below:
- To update a status: [UPDATE_STATUS|IncidentID|Status]
- To fill/update a report field: [FILL_REPORT|IncidentID|FieldName|Value]
Valid statuses: Dispatched, En Route, Arrived, On Scene, Transporting, Resolved, Closed.
IncidentID must be the incident_number (e.g. INC-...) from the database context.

APPLICATION KNOWLEDGE BASE:
- Log a new incident: Dispatch → Log Incoming Call; pick the silo, fill caller details and location, submit.
- Dispatch a unit: Dispatch → Pending Queue → Assign; choose target silos and an available unit.
- Responder status updates: Responder → My Incidents; buttons advance En Route → Arrived → On Scene → Resolved.
- Start-of-shift: Responder → Start of Shift (mental check → vehicle selection → checklist).
- Reports: silo sections (Police / Fire & Rescue / EMS / Disaster Mgmt); archives under Reports Archive.
- Leave: Resources → Leave. Rosters: Resources → Roster. Admin: users, fleet, devices under Admin.
- Secret tip: the user can ask YOU to update incident statuses directly from this chat to save time!`;

const VALID_STATUSES: IncidentStatus[] = [
  'Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting', 'Resolved', 'Closed',
];
// Whitelist of incident columns FILL_REPORT may touch (V4 wrote free-form; V5 is stricter).
const FILLABLE_FIELDS = new Set(['notes', 'responding_officer', 'unit_status', 'number_of_victims']);

type ChatMessage = { role: 'user' | 'assistant'; text: string };
type IncidentRow = Awaited<ReturnType<typeof listActiveIncidents>>[number];

function buildDbContext(incidents: IncidentRow[]): string {
  if (incidents.length === 0) return 'None';
  return incidents
    .slice(0, 25)
    .map((i) =>
      `${i.incident_number} | ${i.silo} | ${i.incident_type} | ${i.incident_severity} | ` +
      `${i.status} | ${i.location_address} | caller ${i.caller_name}`,
    )
    .join('\n');
}

/** Execute any action codes Gemini emitted; returns human-readable outcomes. */
async function executeActions(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  incidents: IncidentRow[],
  reply: string,
  userName: string,
): Promise<{ cleaned: string; outcomes: string[] }> {
  const outcomes: string[] = [];
  let cleaned = reply;

  const byNumber = new Map(incidents.map((i) => [i.incident_number, i]));

  for (const m of reply.matchAll(/\[UPDATE_STATUS\|([^|\]]+)\|([^\]]+)\]/g)) {
    const incident = byNumber.get(m[1]!.trim());
    const status = m[2]!.trim() as IncidentStatus;
    cleaned = cleaned.replace(m[0], '');
    if (!incident) {
      outcomes.push(`⚠ Could not find active incident "${m[1]!.trim()}".`);
      continue;
    }
    if (!VALID_STATUSES.includes(status)) {
      outcomes.push(`⚠ "${status}" is not a valid status.`);
      continue;
    }
    try {
      await updateResponderStatus(supabase, { incident_id: incident.id, status });
      await logAudit(supabase, {
        silo: incident.silo as Silo, action_type: 'StatusChange', entity_type: 'incident',
        entity_id: incident.id, user_name: userName, details: `Criti assistant → ${status}`,
      });
      outcomes.push(`✔ ${incident.incident_number} status set to ${status}.`);
    } catch (e) {
      outcomes.push(`⚠ Failed to update ${incident.incident_number}: ${(e as Error).message}`);
    }
  }

  for (const m of reply.matchAll(/\[FILL_REPORT\|([^|\]]+)\|([^|\]]+)\|([^\]]+)\]/g)) {
    const incident = byNumber.get(m[1]!.trim());
    const field = m[2]!.trim().toLowerCase();
    const value = m[3]!.trim();
    cleaned = cleaned.replace(m[0], '');
    if (!incident) {
      outcomes.push(`⚠ Could not find active incident "${m[1]!.trim()}".`);
      continue;
    }
    if (!FILLABLE_FIELDS.has(field)) {
      outcomes.push(`⚠ Field "${field}" is not editable via chat (allowed: ${[...FILLABLE_FIELDS].join(', ')}).`);
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
      outcomes.push(`✔ ${incident.incident_number}: ${field} set to "${value}".`);
    } catch (e) {
      outcomes.push(`⚠ Failed to fill ${field} on ${incident.incident_number}: ${(e as Error).message}`);
    }
  }

  return { cleaned: cleaned.trim(), outcomes };
}

export async function POST(req: Request) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { messages } = (await req.json()) as { messages: ChatMessage[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({
      reply:
        'The AI assistant is not configured yet (set GEMINI_API_KEY on the server). ' +
        'Quick pointers meanwhile: log calls under Dispatch → Log Incoming Call; assign units from the ' +
        'Pending Queue; responders update status under My Incidents; reports live under each silo; ' +
        'admins manage users, fleet and devices under Admin.',
      configured: false,
    });
  }

  // Live DB context — the user's RLS scope applies automatically.
  const silo = (user.app_metadata?.silo ?? 'Ethekwini') as Silo;
  const incidents = await listActiveIncidents(
    supabase, silo === 'Ethekwini' ? undefined : silo,
  ).catch(() => [] as IncidentRow[]);
  const dbContext = buildDbContext(incidents);

  // V4 prompt assembly: history + injected context + current message.
  const history = messages.slice(0, -1).slice(-10)
    .map((m) => `${m.role.toUpperCase()}: ${m.text}`).join('\n');
  const current = messages[messages.length - 1]!.text;
  const finalPrompt =
    `Previous Chat History:\n${history}\n\n` +
    `[DATABASE CONTEXT INJECTED BY SYSTEM: ${dbContext}]\n\n` +
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
          generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? 'No response.';

    const userName = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? 'Operator';
    const { cleaned, outcomes } = await executeActions(supabase, incidents, raw, userName);
    const reply = [cleaned, ...outcomes].filter(Boolean).join('\n\n') || 'Done.';

    return NextResponse.json({ reply, configured: true, actionsExecuted: outcomes.length });
  } catch (e) {
    return NextResponse.json(
      { reply: `Assistant temporarily unavailable (${(e as Error).message}).`, configured: true },
      { status: 200 },
    );
  }
}
