import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { getFireInspection, getFirePremises } from '@criticom/api';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { InspectionForm } from '../inspection-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New Site Inspection · HikTech' };

const FILERS = ['Firefighter', 'Captain', 'FireChief', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin'];

/** A site inspection filed from the console (0106), for a site on the register or a new one. */
export default async function NewInspectionPage({ searchParams }: { searchParams: Promise<{ premises?: string }> }) {
  const { t } = await requestT();
  const { supabase, role, silo } = await getSession();
  const { premises: premisesId } = await searchParams;
  if (!FILERS.includes(role) || silo !== 'MetroFire') {
    return <p className="rounded-lg border border-border bg-bg-card p-6 text-sm text-muted-foreground">{t('Site inspections are filed by Fire & Rescue.')}</p>;
  }
  const premises = premisesId && /^[0-9a-f-]{36}$/i.test(premisesId) ? await getFirePremises(supabase, premisesId).catch(() => null) : null;
  const last = premises?.last_inspection_id && premises.last_outcome && premises.last_outcome !== 'Compliant'
    ? await getFireInspection(supabase, premises.last_inspection_id).catch(() => null)
    : null;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{premises ? t('Inspect {name}', { name: premises.name }) : t('New site inspection')}</h1>
          <p className="text-muted-foreground">{t('The eThekwini Fire By-law checks, then what follows.')}</p>
        </div>
        <Link href="/fire/inspections" className="text-sm text-accent hover:underline">{t('Back to inspections')}</Link>
      </header>
      <InspectionForm premises={premises} lastNotice={(last?.notice_items ?? []).map((n) => n.key)} clientRef={randomUUID()} />
    </div>
  );
}
