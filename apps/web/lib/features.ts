import 'server-only';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { featureEnabled, getFeatureMap, type FeatureMap } from '@criticom/api';
import { getServerSupabase } from './supabase';

/**
 * Server-side feature enforcement.
 *
 * Nav filtering hides what is off; these guards make the destination itself
 * refuse, because hiding a link is not a boundary — a bookmark or a typed URL
 * still reaches the page. Pages redirect to the dashboard; APIs return 404,
 * because "this capability does not exist for your organisation" is exactly
 * what not-found means, and it reveals less than a 403.
 */

export async function getFeatures(): Promise<FeatureMap> {
  const supabase = await getServerSupabase();
  return getFeatureMap(supabase);
}

/**
 * Which navigation destinations each flag removes. Lives here — beside the
 * guards — so hiding a link and refusing the page can never disagree about
 * what a flag covers.
 */
const FEATURE_ROUTES: Record<string, string[]> = {
  'web.assistant': ['/assistant'],
  'web.cameras': ['/cameras', '/cameras/footage'],
  'web.ptt': ['/dispatch/ptt'],
  'web.reports_builder': ['/reports/builder'],
  'web.search': ['/search'],
  'web.command': ['/command'],
  'web.duty_maintenance': ['/duty-tasks'],
  'web.time_attendance': ['/attendance'],
  'web.enforcement': [
    '/police/fines', '/police/charges', '/police/transactions',
    '/police/warrants', '/police/summons',
  ],
  'web.mail': ['/mail'],
  'web.sections': ['/admin/sections'],
};

/** Hrefs the nav should not offer under this feature map. */
export function hiddenHrefs(map: FeatureMap): string[] {
  return Object.entries(FEATURE_ROUTES)
    .filter(([key]) => !featureEnabled(map, key))
    .flatMap(([, hrefs]) => hrefs);
}

/** Page guard: send the user somewhere real rather than erroring. */
export async function requireFeaturePage(key: string): Promise<void> {
  const map = await getFeatures();
  if (!featureEnabled(map, key)) redirect('/dashboard');
}

/** API guard: returns the refusal response, or null to continue. */
export async function requireFeatureApi(key: string): Promise<NextResponse | null> {
  const map = await getFeatures();
  if (featureEnabled(map, key)) return null;
  return NextResponse.json(
    { error: 'This feature is not enabled for your organisation.' },
    { status: 404 },
  );
}
