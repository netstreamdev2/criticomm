import { Users } from 'lucide-react';
import { listCouncillors } from '@criticom/api';
import { PageGuide } from '@/components/office/page-guide';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { CouncillorRegister } from './register';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Councillors · HikTech' };

/**
 * The councillors (0116): every ward councillor, and PR councillors with no
 * ward, with a cellphone. Warnings go to all of them by SMS, and relief runs
 * through the ward councillor. Their numbers are personal: the Disaster desk
 * and command only.
 */
export default async function CouncillorsPage() {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const councillors = await listCouncillors(supabase);
  const wards = new Set(councillors.filter((c) => c.is_active && c.ward != null).map((c) => c.ward)).size;
  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Users className="h-6 w-6 text-accent" aria-hidden />{t('Councillors')}</h1>
        <p className="mt-1 text-muted-foreground">
          {t('{wards} of 111 wards have a councillor on the list. Warnings go to every councillor by SMS; relief runs through the ward councillor.', { wards })}
        </p>
      </header>
      <PageGuide id="disaster.councillors" steps={[
        t('Load the City’s list from a spreadsheet: columns Ward, Councillor, Cell and Email. A ward already listed gets the new name and number.'),
        t('Or add and change councillors one at a time. Leave the ward blank for a PR councillor.'),
        t('Take someone off the list when they leave office. They stop getting the warning SMS.'),
      ]} />
      <CouncillorRegister councillors={councillors.map((c) => ({ id: c.id, ward: c.ward, name: c.name, phone: c.phone, email: c.email, active: c.is_active }))} />
    </div>
  );
}
