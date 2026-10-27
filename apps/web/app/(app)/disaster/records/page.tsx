import { History } from 'lucide-react';
import { listPastEvents } from '@criticom/api';
import { PRIORITY_RISKS } from '@criticom/db/disaster-plan';
import { InfoTile } from '@/components/disaster/info-tile';
import { PageGuide } from '@/components/office/page-guide';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { LoadRecords, RecordsTable, type RecordRow } from './table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Past Disasters · HikTech' };

/**
 * Past disasters in eThekwini from the records (0119): SAWS's record since
 * the 1800s and the major events of 2017 to 2022. Real events, kept apart
 * from live calls: they never alert. Counted by the top ten risks, and
 * listed with filters. They also fill the ward profiles.
 */
export default async function RecordsPage() {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const events = await listPastEvents(supabase);
  const rows: RecordRow[] = events.map((e) => ({
    id: e.id, year: e.year, date: e.occurred_on, event: e.event, category: e.category, risk: e.priority_risk, place: e.place, ward: e.ward,
    deaths: e.deaths, homes: e.homes, affected: e.affected, cost: e.cost, notes: e.notes,
    source: e.source === 'SA Weather Service records' ? 'SA Weather Service' : 'Director’s briefing',
  }));
  const byRisk = PRIORITY_RISKS.map((risk) => {
    const mine = events.filter((e) => e.priority_risk === risk);
    return { risk, count: mine.length, deaths: mine.reduce((n, e) => n + (e.deaths ?? 0), 0) };
  }).filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
  const since = events.length ? Math.min(...events.map((e) => e.year)) : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="flex items-center gap-2 text-2xl font-bold"><History className="h-6 w-6 text-accent" aria-hidden />{t('Past disasters')}</h1>
          <p className="mt-1 text-muted-foreground">
            {t('Real disasters in eThekwini from the records: the SA Weather Service’s list and the major events of 2017 to 2022. Kept apart from live calls; they never raise an alert.')}
          </p>
        </div>
        <LoadRecords hasRows={events.length > 0} />
      </header>
      <PageGuide id="disaster.records" steps={[
        t('Press Load the records once. It reads the SA Weather Service’s list from the NDMC and adds the major events. Loading again updates them.'),
        t('The tiles count the events and deaths for each of the top ten risks.'),
        t('Search or filter the list by risk, ward or decade. Each ward’s own history is on its ward profile.'),
      ]} />
      {events.length ? (
        <>
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
            {byRisk.map((r, i) => (
              <InfoTile key={r.risk} label={t(r.risk)} value={r.count} hint={t('{n} deaths recorded', { n: r.deaths })} icon={<History className="h-5 w-5" aria-hidden />}
                tone={r.deaths > 0 ? 'warn' : 'plain'} align={i % 5 >= 3 ? 'right' : 'left'}
                explain={t('Events recorded in eThekwini since {year} that count towards this risk, and the deaths recorded with them.', { year: since ?? '' })} />
            ))}
          </section>
          <RecordsTable rows={rows} />
        </>
      ) : (
        <p className="rounded-2xl border border-dashed border-border bg-bg-card p-8 text-center text-muted-foreground">
          {t('No records loaded yet. Press Load the records.')}
        </p>
      )}
    </div>
  );
}
