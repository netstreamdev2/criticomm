import 'server-only';
import { NextResponse } from 'next/server';
import {
  callDetailForModel, checkDuplicateIncident, deptName, featureEnabled, getIncidentCategoryTree, viewProposal,
  type CallDraft, type CallFacts, type CodeGroup, type CritiIncident, type CritiMe, type ProposalView, type TimelineEntry,
} from '@criticom/api';
import { roleName, type CriticomClient, type Silo, type UserRole } from '@criticom/db';
import { regionFor } from '@/lib/durban-regions';
import { searchAddress } from '@/lib/geocode';
import { checkPhone } from '@/lib/phone';
import { enforceRateLimit, type RateLimitName } from '@/lib/rate-limit';
import { getRequestSupabase } from '@/lib/supabase';
import { getFeatures, requireFeatureApi } from '@/lib/features';

/**
 * Criti's server side. Every read and every task goes through the person's
 * own session, so their role and department rules decide what Criti sees and
 * does. Who they are comes from their profile in the database, never from
 * the request.
 */

export type CritiSession = { supabase: CriticomClient; me: CritiMe };

export async function critiSession(
  req: Request,
  opts: { feature: string | string[]; limit: RateLimitName },
): Promise<CritiSession | NextResponse> {
  // On when any of the named switches is on.
  const keys = Array.isArray(opts.feature) ? opts.feature : [opts.feature];
  const map = await getFeatures();
  if (!keys.some((k) => featureEnabled(map, k))) {
    return (await requireFeatureApi(keys[0]!)) ?? NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const supabase = (await getRequestSupabase(req)) as CriticomClient;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const limited = await enforceRateLimit(supabase, opts.limit);
  if (limited) return limited;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, silo, full_name, deactivated_at')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as { role: UserRole; silo: Silo; full_name: string | null; deactivated_at: string | null } | null;
  if (p?.deactivated_at) return NextResponse.json({ error: 'This account is switched off.' }, { status: 403 });
  return {
    supabase,
    me: {
      userId: user.id,
      role: p?.role ?? ((user.app_metadata?.role as UserRole | undefined) ?? 'Viewer'),
      silo: p?.silo ?? ((user.app_metadata?.silo as Silo | undefined) ?? 'Ethekwini'),
      name: p?.full_name ?? (user.user_metadata?.full_name as string | undefined) ?? user.email ?? 'Operator',
    },
  };
}

/* ── A call in question ───────────────────────────────────────────── */

/** A call the person asked about, with its timeline, read under their own rules. */
export async function callDetail(supabase: CriticomClient, incident: CritiIncident, now: Date): Promise<string> {
  const [{ data: updates }, { data: facts }] = await Promise.all([
    supabase
      .from('incident_updates')
      .select('timestamp, message, created_by_name')
      .eq('incident_id', incident.id)
      .order('timestamp', { ascending: false })
      .limit(12),
    supabase
      .from('incidents')
      .select('call_description, notes, suburb, region, patient_name, medical_type, call_taken_by, dispatched_by')
      .eq('id', incident.id)
      .maybeSingle(),
  ]);
  const timeline = ((updates ?? []) as TimelineEntry[]).reverse();
  return callDetailForModel(incident, (facts ?? {}) as CallFacts, timeline, now);
}

/* ── The incident codes, for logging ─────────────────────────────────── */

export async function loadCodes(supabase: CriticomClient): Promise<CodeGroup[]> {
  const tree = await getIncidentCategoryTree(supabase).catch(() => []);
  return tree
    .map((g) => ({ category: g.name, codes: g.subcategories.map((s) => s.name).filter(Boolean) }))
    .filter((g) => g.codes.length > 0);
}

/* ── Finishing a call draft ──────────────────────────────────────────── */

/**
 * A call Criti is logging, made ready to confirm: the number checked as the
 * form checks it, the address placed on the map and given its region, and
 * any open call from the same number or the same place flagged.
 */
export async function finishDraft(supabase: CriticomClient, draft: CallDraft): Promise<ProposalView> {
  const call: CallDraft = { ...draft };
  const warnings: string[] = [];
  const missing: string[] = [];

  if (call.caller_number) {
    const phone = checkPhone(call.caller_number);
    if (phone.ok) call.caller_number = phone.e164;
    else missing.push(`a valid caller number (${phone.error.replace(/\.$/, '')})`);
  }

  if (call.location_address && (call.location_lat === null || call.location_lng === null)) {
    const [hit] = await searchAddress(call.location_address);
    if (hit) {
      call.location_lat = hit.lat;
      call.location_lng = hit.lng;
      call.suburb = call.suburb || hit.suburb || '';
      call.city = hit.city || call.city;
      call.postal_code = call.postal_code || hit.postalCode || '';
      warnings.push(`Placed on the map at ${hit.label}. Check it is the right place.`);
    } else {
      warnings.push('The address was not found on the map. Open the form to place it.');
    }
  }
  if (call.location_lat !== null && call.location_lng !== null && !call.region) {
    const region = regionFor(call.location_lat, call.location_lng, call.suburb || null);
    if (region) call.region = region;
  }

  if (call.caller_number.startsWith('+') || call.location_address) {
    const dupe = await checkDuplicateIncident(supabase, {
      phone: call.caller_number.startsWith('+') ? call.caller_number : null,
      location: call.location_address || null,
      type: call.incident_type || null,
    }).catch(() => null);
    if (dupe) {
      warnings.unshift(`Possible duplicate: ${dupe.incident_number} has the same ${dupe.reason === 'Caller' ? 'caller number' : 'address and code'} in the last 12 hours.`);
    }
  }
  return viewProposal({ kind: 'log_call', call }, { warnings, missing });
}

export const personLine = (me: CritiMe) => `${me.name}, ${roleName(me.role)}, ${deptName(me.silo)}`;
