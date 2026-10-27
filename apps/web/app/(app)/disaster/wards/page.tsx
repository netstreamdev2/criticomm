import { MapPinned } from 'lucide-react';
import { listCouncillors, listOpenDisasterIncidents, listCallFacts, listPastEvents } from '@criticom/api';
import { PageGuide } from '@/components/office/page-guide';
import { wardFacts } from '@/lib/maps/wards';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { WardTable, type WardRow } from './table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ward Profiles · HikTech' };

/**
 * The 111 wards side by side: who the councillor is, how many people, the
 * share of informal homes, no piped water, children and older people, the
 * disasters on record, the April 2022 damage and the incidents open now.
 * Sort by any column to see where to look first; each opens its profile.
 */
export default async function WardsPage() {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const [{ wards, missing }, councillors, past, open] = await Promise.all([
    wardFacts(), listCouncillors(supabase), listPastEvents(supabase), listOpenDisasterIncidents(supabase).catch(() => []),
  ]);
  const facts = await listCallFacts(supabase, open.map((i) => i.id));
  const councillor = new Map(councillors.filter((c) => c.is_active && c.ward != null).map((c) => [c.ward!, c.name]));
  const count = (list: Array<number | null>) => list.reduce((m, w) => (w ? m.set(w, (m.get(w) ?? 0) + 1) : m), new Map<number, number>());
  const pastBy = count(past.map((e) => e.ward));
  const openBy = count(facts.filter((f) => (f.dm_status ?? 'Active') === 'Active').map((f) => (f.ward && /^\d+$/.test(f.ward) ? Number(f.ward) : null)));
  const rows: WardRow[] = wards.map((w) => ({
    ward: w.ward, councillor: councillor.get(w.ward) ?? null, people: w.people, informal: w.informal, water: w.water,
    children: w.children, older: w.older, past: pastBy.get(w.ward) ?? 0, damage2022: w.damage2022, open: openBy.get(w.ward) ?? 0,
    floodRisk: w.floodRisk,
  }));
  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><MapPinned className="h-6 w-6 text-accent" aria-hidden />{t('Ward profiles')}</h1>
        <p className="mt-1 text-muted-foreground">{t('Every eThekwini ward: its councillor, its people and their needs, the disasters on record and what is open now.')}</p>
      </header>
      <PageGuide id="disaster.wards" steps={[
        t('Press a column heading to sort. Sort by informal homes or past disasters to see where to look first.'),
        t('Open a ward for its map, councillor, needs, history, relief and incidents.'),
        t('Census figures are from 2011, fitted to the 2016 wards: a guide, not a count.'),
      ]} />
      {missing.length ? (
        <p className="rounded-lg border border-severity-medium/40 bg-bg-card px-4 py-2 text-sm text-severity-medium-ink">
          {t('Some figures could not be fetched just now: {what}. Try again in a few minutes.', { what: missing.join(', ') })}
        </p>
      ) : null}
      <WardTable rows={rows} />
    </div>
  );
}
