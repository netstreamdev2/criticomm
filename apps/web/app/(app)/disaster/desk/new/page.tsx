import { getWarning } from '@criticom/api';
import { incidentHazardFor } from '@criticom/db/disaster-warnings';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { OpenIncidentForm, type FromWarning } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Add an Incident · HikTech' };

/**
 * Add an incident (0113): the Disaster desk opens an incident itself, from a
 * field report, a SA Weather Service warning or a site emergency plan.
 * EMACC's calls arrive on the desk without this. ?warning= (0116) starts it
 * from that warning: hazard, title and first report filled in, and linked.
 */
export default async function OpenIncidentPage({ searchParams }: { searchParams: Promise<{ warning?: string }> }) {
  const { t } = await requestT();
  const { warning: warningId } = await searchParams;
  let fromWarning: FromWarning | null = null;
  if (warningId && /^[0-9a-f-]{36}$/i.test(warningId)) {
    const { supabase } = await getSession();
    const w = await getWarning(supabase, warningId);
    if (w) {
      const label = `${w.colour} Level ${w.level} ${w.hazard}`;
      fromWarning = {
        id: w.id, label, hazard: incidentHazardFor(w.hazard), title: `${w.hazard} (Level ${w.level} warning)`.slice(0, 80),
        report: [`${label} warning from the SA Weather Service.`, w.impacts ? `Expected impacts: ${w.impacts}` : null, `Areas: ${w.areas}`]
          .filter(Boolean).join('\n').slice(0, 2000),
      };
    }
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('Add an incident')}</h1>
        <p className="text-muted-foreground">{t('Every incident starts at Bronze, with the services coordinating on scene.')}</p>
      </header>
      <OpenIncidentForm fromWarning={fromWarning} />
    </div>
  );
}
