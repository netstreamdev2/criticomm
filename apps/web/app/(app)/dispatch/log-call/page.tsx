import type { Metadata } from 'next';
import { getIncidentCategoryTree, getOperationalSettings } from '@criticom/api';
import { canAccess } from '@criticom/db';
import { getSession } from '@/lib/session';
import { LogCallForm } from './log-call-form';

export const metadata: Metadata = { title: 'Log incoming call · HikTech' };
export const dynamic = 'force-dynamic';

export default async function LogCallPage() {
  const { supabase, silo, role, fullName } = await getSession();
  const [categoryTree, settings] = await Promise.all([
    getIncidentCategoryTree(supabase).catch(() => []),
    getOperationalSettings(supabase),
  ]);

  // Dual-role chairs (Operator/ControlRoom/admins) may route straight from
  // intake; a pure IncidentLogger only queues — routing is the dispatch
  // desk's job. Same check as the /dispatch/pending route rule.
  const canRoute = canAccess('/dispatch/pending', role, silo);

  return (
    <LogCallForm
      defaultSilo={silo}
      callTaker={fullName}
      canRoute={canRoute}
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
