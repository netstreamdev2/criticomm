import { redirect } from 'next/navigation';
import { listIntegrations } from '@criticom/api';
import { ADMIN_CONSOLE_ROLES } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getSession } from '@/lib/session';
import { IntegrationCard } from './integration-card';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Integrations · Criticom' };

/**
 * Which server-side environment variables each integration needs. Only
 * presence is reported to the browser — never the values.
 */
const REQUIRED_ENV: Record<string, string[]> = {
  supabase: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
  groq: ['GROQ_API_KEY'],
  gemini: ['GEMINI_API_KEY'],
  expo_push: [],
  bulksms: ['BULKSMS_USERNAME', 'BULKSMS_PASSWORD'],
  realptt: ['REALPTT_ACCOUNT', 'REALPTT_PASSWORD'],
  zoiper: [],
  tomtom: ['TOMTOM_API_KEY'],
  flightradar24: ['FR24_API_KEY'],
  ais: ['AISSTREAM_API_KEY'],
  itraffic: ['ITRAFFIC_API_KEY'],
  openweather: ['OPENWEATHER_API_KEY'],
  leaflet_esri: [],
  sanral: [],
  hikvision: ['HIKVISION_APP_KEY', 'HIKVISION_APP_SECRET'],
};

/** What each integration actually powers, in the operator's terms. */
const PURPOSE: Record<string, string> = {
  supabase: 'Database, authentication, file storage and the realtime channel every live screen listens on.',
  groq: 'Powers Criti — the assistant dock, its live board context and the actions it carries out. Fast Llama inference, first in the provider chain.',
  gemini: 'Fallback AI provider for Criti — takes over automatically if Groq is down or rate-limited.',
  expo_push: 'Delivers dispatch alerts to the responder app when it is closed or in the background.',
  bulksms: 'Outbound SMS to citizens, including the GPS location-request link.',
  realptt: 'Push-to-talk bridge for the dispatch radio console.',
  zoiper: 'One-click dial-out from the call-taking screen via the tel: scheme.',
  tomtom: 'Live road-traffic incidents overlaid on the incident map.',
  flightradar24: 'Aircraft positions for aerial support and airspace awareness.',
  ais: 'Vessel positions in and around Durban harbour.',
  itraffic: 'Bulk import of externally-reported road incidents from CSV.',
  openweather: 'Wind speed and direction feeding the fire spread model.',
  leaflet_esri: 'Satellite basemap used by the dispatch console and GIS views.',
  sanral: 'The current freeway camera wall. The registry behind Surveillance until Hikvision goes live.',
  hikvision: 'The incoming CCTV platform. Enabling it switches the camera wall to the live HikCentral estate and unlocks recorded-footage retrieval — no redeploy.',
};

export default async function IntegrationsPage() {
  const { supabase, role } = await getSession();
  if (!ADMIN_CONSOLE_ROLES.includes(role)) redirect('/dashboard');

  const integrations = await listIntegrations(supabase).catch(() => []);

  // Evaluated on the server; only booleans cross to the client.
  const envStatus = Object.fromEntries(
    Object.entries(REQUIRED_ENV).map(([key, vars]) => [
      key,
      vars.map((name) => ({ name, present: Boolean(process.env[name]) })),
    ]),
  );

  const categories = [...new Set(integrations.map((i) => i.category))];
  const configured = integrations.filter((i) => {
    const vars = envStatus[i.key] ?? [];
    return vars.every((v) => v.present);
  }).length;
  const live = integrations.filter((i) => i.enabled).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="text-muted-foreground">
          Every external service Criticom talks to — what it powers, whether its credentials are
          present, and whether it currently answers.
        </p>
      </header>

      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Integrations', value: integrations.length, hint: 'in the catalogue' },
          { label: 'Enabled', value: live, hint: 'switched on for this environment' },
          { label: 'Credentials present', value: configured, hint: 'all required variables set' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="py-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-3xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How configuration works</CardTitle>
          <CardDescription>
            Secrets live in server environment variables and are never stored in the database or
            sent to the browser — this page only reports whether each one is present. The switch and
            the JSON parameters below are stored in the database and take effect immediately, with
            no redeploy. Adding or changing a secret requires setting it on the host and redeploying.
          </CardDescription>
        </CardHeader>
      </Card>

      {categories.map((category) => (
        <section key={category} className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            {category}
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {integrations
              .filter((i) => i.category === category)
              .map((i) => (
                <IntegrationCard
                  key={i.key}
                  integration={i}
                  purpose={PURPOSE[i.key] ?? ''}
                  env={envStatus[i.key] ?? []}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
