import { redirect } from 'next/navigation';
import { getFeatureMap, getMyTenant, FEATURES, featureEnabled } from '@criticom/api';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getSession } from '@/lib/session';
import { FeatureRow } from './feature-row';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Features · Criticomm' };

/**
 * The feature console. SuperAdmin only — a feature switch changes what an
 * entire organisation's screens offer, which is a policy decision, not an
 * administrative convenience.
 */
export default async function FeaturesPage() {
  const { supabase, role } = await getSession();
  if (role !== 'SuperAdmin') redirect('/dashboard');

  const [map, tenant] = await Promise.all([
    getFeatureMap(supabase),
    getMyTenant(supabase).catch(() => null),
  ]);

  const web = FEATURES.filter((f) => f.surface === 'web');
  const mobile = FEATURES.filter((f) => f.surface === 'mobile');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Features</h1>
        <p className="text-muted-foreground">
          What is switched on for {tenant?.name ?? 'this tenant'}. Changes apply to every user in
          the organisation, take effect on their next page load — the responder app follows within
          moments over realtime — and are written to the audit trail with your name.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Flags gate availability, never authorization</CardTitle>
          <CardDescription>
            Enabling a feature never grants a role anything the route matrix and row-level security
            would not — the two systems compose. Disabling one hides it everywhere and makes its
            server routes refuse, for this tenant only.
          </CardDescription>
        </CardHeader>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Console</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
          <ul className="divide-y divide-border">
            {web.map((def) => (
              <FeatureRow key={def.key} def={def} enabled={featureEnabled(map, def.key)} />
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Responder app
        </h2>
        <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
          <ul className="divide-y divide-border">
            {mobile.map((def) => (
              <FeatureRow key={def.key} def={def} enabled={featureEnabled(map, def.key)} />
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
