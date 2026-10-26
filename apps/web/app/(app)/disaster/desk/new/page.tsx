import { requestT } from '@/lib/i18n';
import { OpenIncidentForm } from './form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Add an Incident · HikTech' };

/**
 * Add an incident (0113): the Disaster desk opens an incident itself, from a
 * field report, a SA Weather Service warning or a site emergency plan.
 * EMACC's calls arrive on the desk without this.
 */
export default async function OpenIncidentPage() {
  const { t } = await requestT();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('Add an incident')}</h1>
        <p className="text-muted-foreground">{t('Every incident starts at Bronze, with the services co-ordinating on scene.')}</p>
      </header>
      <OpenIncidentForm />
    </div>
  );
}
