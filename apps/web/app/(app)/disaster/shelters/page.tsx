import { listOpenShelters, listShelters, listOpenDisasterIncidents } from '@criticom/api';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { ShelterRegister } from './register';
import { PageGuide } from '@/components/office/page-guide';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Shelters · HikTech' };

/**
 * Shelters and reception centres (0112): council halls and other facilities
 * for emergency assembly and shelter, with their key holders (the Plan:
 * Parks keeps the list of halls and key holders; Safer Cities manages the
 * reception centres). People there now and the space left, across every call.
 */
export default async function SheltersPage() {
  const { t } = await requestT();
  const { supabase, role } = await getSession();
  const [halls, open, calls] = await Promise.all([
    listShelters(supabase, true),
    listOpenShelters(supabase),
    listOpenDisasterIncidents(supabase).catch(() => []),
  ]);
  const number = new Map(calls.map((c) => [c.id, c.incident_number]));
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('Shelters and reception centres')}</h1>
        <p className="max-w-3xl text-muted-foreground">
          {t('Council halls and facilities for emergency assembly and shelter. Keep the key holders and space up to date.')}
        </p>
      </header>
      <PageGuide id="disaster.shelters" steps={[
        t('Keep the register of halls: capacity, the key holder and their number. A hall is ready when it has room and a key holder to phone.'),
        t('Open a hall on an incident from its board, under Reception centres. People in and out, and relief handed out, are logged there.'),
      ]} />
      <ShelterRegister
        canEdit={role !== 'Viewer'}
        halls={halls.map((h) => {
          const here = open.filter((o) => o.shelter_id === h.id);
          const people = here.reduce((n, o) => n + o.people_now, 0);
          return {
            id: h.id, name: h.name, kind: h.kind, municipality: h.municipality, ward: h.ward, address: h.address, capacity: h.capacity,
            keyHolder: h.key_holder, keyHolderPhone: h.key_holder_phone, notes: h.notes, active: h.is_active, people,
            calls: here.map((o) => ({ id: o.incident_id, number: number.get(o.incident_id) ?? t('Call'), people: o.people_now })),
          };
        })}
      />
    </div>
  );
}
