import { GraduationCap } from 'lucide-react';
import { getPracticeIncident } from '@criticom/api';
import { AskCriti } from '@/components/disaster/ask-criti';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { PracticeWizard } from './wizard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Practise an Incident · HikTech' };

/**
 * Practise an incident with Criti (0121): add one, move it up a level with
 * its reasons, log what came in, record relief for a ward and stand it
 * down, with the same rules as the real desk. Practice incidents are the
 * person's own and never reach the desk, the map, an SMS or a figure.
 */
export default async function PracticePage() {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const practice = await getPracticeIncident(supabase);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><GraduationCap className="h-6 w-6 text-accent" aria-hidden />{t('Practise an incident')}</h1>
        <p className="mt-1 text-muted-foreground">{t('Criti walks you through an incident from start to finish, with the same rules as the real desk.')}</p>
      </header>
      <p className="rounded-xl border-2 border-dashed border-accent/50 bg-accent/5 px-5 py-3 font-semibold">
        {t('Practice only: nothing here reaches the desk, the map, an SMS or any figure. Only you see it.')}
      </p>
      <PracticeWizard practice={practice ? {
        id: practice.id, title: practice.title, hazard: practice.hazard, severity: practice.severity, place: practice.place, ward: practice.ward,
        level: practice.level, status: practice.status, steps: practice.steps.map((s) => s.step),
      } : null} />
      <section className="rounded-2xl border border-border bg-bg-card p-5 shadow-sm">
        <h2 className="mb-3 font-semibold">{t('Ask Criti how to…')}</h2>
        <AskCriti page="Practise an incident" />
      </section>
    </div>
  );
}
