import { listAllPartners } from '@criticom/api';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { PartnerList } from './list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Partner List · HikTech' };

/** Who keeps the list: Disaster Management's command and administrators (save_mutual_aid_partner, 0112). */
const KEEPERS = ['Admin', 'Supervisor', 'SystemAdmin', 'SuperAdmin', 'Disaster'];

/**
 * The partners the Disaster desk calls out (0112): the City's line
 * functions, provincial and national departments, neighbouring districts'
 * disaster centres and civil society relief organisations. Public only.
 * Each number says whether it has been checked.
 */
export default async function PartnersPage() {
  const { t } = await requestT();
  const { supabase, role } = await getSession();
  const partners = await listAllPartners(supabase).catch(() => []);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('Partner list')}</h1>
        <p className="max-w-3xl text-muted-foreground">{t('The public organisations the Disaster desk calls out. Press a number to call it.')}</p>
      </header>
      <PartnerList
        canEdit={KEEPERS.includes(role)}
        partners={partners.map((p) => ({
          id: p.id, name: p.agency_name, type: p.resource_type, phone: p.contact_number, radio: p.radio_frequency, commander: p.commander_name,
          sector: p.sector ?? null, verified: p.verified ?? false, notes: p.notes ?? null, active: p.is_active, sort: p.sort ?? 100,
        }))}
      />
    </div>
  );
}
