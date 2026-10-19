import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { AssetImportWizard } from '@/components/register/asset-import';
import { fleetRolesFor } from '@/lib/assets/roles';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Import fleet list · HikTech' };

/** Import the fleet register from a spreadsheet (migration 0051). */
export default async function ImportFleetPage() {
  const { t } = await requestT();
  const { role, silo } = await getSession();
  if (!fleetRolesFor(role, silo).canManage) redirect('/admin/vehicles');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <Link href="/admin/vehicles" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> {' '}{t('Fleet')}</Link>
        <h1 className="text-2xl font-bold">{t('Import fleet list')}</h1>
        <p className="max-w-3xl text-muted-foreground">
          {t('Adds vehicles to the register and updates the ones already there, matched by department and unit number. A vehicle’s status never changes by import: one off the road stays off the road until fleet control returns it.')}</p>
      </header>
      <AssetImportWizard kind="vehicles" />
    </div>
  );
}
