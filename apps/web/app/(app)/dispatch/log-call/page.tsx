import type { Metadata } from 'next';
import { getIncidentCategoryTree, getOperationalSettings } from '@criticom/api';
import { getSession } from '@/lib/session';
import { LogCallForm } from './log-call-form';

export const metadata: Metadata = { title: 'Log incoming call · Criticom' };
export const dynamic = 'force-dynamic';

export default async function LogCallPage() {
  const { supabase, silo, fullName } = await getSession();
  const [categoryTree, settings] = await Promise.all([
    getIncidentCategoryTree(supabase).catch(() => []),
    getOperationalSettings(supabase),
  ]);

  return (
    <LogCallForm
      defaultSilo={silo}
      callTaker={fullName}
      categoryTree={categoryTree}
      tuning={{
        clockWarnSeconds: settings['sla.clock_warn_seconds'],
        clockCriticalSeconds: settings['sla.clock_critical_seconds'],
        etaSpeedKmh: settings['dispatch.eta_speed_kmh'],
        etaRoadFactor: settings['dispatch.eta_road_factor'],
      }}
    />
  );
}
