import { redirect } from 'next/navigation';
import {
  getOperationalSettings, OPERATIONAL_SETTINGS, type SettingDef,
} from '@criticom/api';
import { ADMIN_ROLES } from '@criticom/db';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getSession } from '@/lib/session';
import { SettingRow } from './setting-row';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Operations Settings · Criticom' };

export default async function OperationsSettingsPage() {
  const { supabase, role } = await getSession();
  if (!ADMIN_ROLES.includes(role)) redirect('/dashboard');

  const settings = await getOperationalSettings(supabase);

  // Which keys carry an override row (differ from the code default).
  const { data: overrides } = await supabase.from('app_settings').select('key, updated_by, updated_at');
  const overrideMap = new Map((overrides ?? []).map((o) => [o.key, o]));

  const categories = [...new Set(OPERATIONAL_SETTINGS.map((d) => d.category))];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Operations settings</h1>
        <p className="text-muted-foreground">
          Tune the service to your standing orders — SLA clocks, alert behaviour, the ETA model.
          Changes apply immediately, no deployment needed.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>How this works</CardTitle>
          <CardDescription>
            Every knob has a safe built-in default and hard bounds; a value outside its bounds is
            clamped, and deleting an override falls back to the default. Every change is written to
            the audit trail with your name on it.
          </CardDescription>
        </CardHeader>
      </Card>

      {categories.map((category) => (
        <section key={category} className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{category}</h2>
          <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
            <ul className="divide-y divide-border">
              {OPERATIONAL_SETTINGS.filter((d) => d.category === category).map((def: SettingDef) => {
                const override = overrideMap.get(def.key);
                return (
                  <SettingRow
                    key={def.key}
                    def={def}
                    value={settings[def.key]}
                    overridden={Boolean(override)}
                    updatedBy={override?.updated_by ?? null}
                  />
                );
              })}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}
