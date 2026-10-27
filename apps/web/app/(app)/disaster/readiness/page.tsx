import Link from 'next/link';
import { Gauge } from 'lucide-react';
import {
  casualtyCounts, getDisasterSettings, listCallFacts, listDepartmentContacts, listDepartmentPlans, listDisasterIncidents, listDuty,
  listForumMeetings, listReadinessSessionsBetween, listReliefStocks, listReviewsSignedBetween, listScgChairs, listShelters, listSitrepFigures,
  listTaskTeams, listWardReliefSince, listWarningsBetween,
} from '@criticom/api';
import { LINE_FUNCTIONS } from '@criticom/db/disaster-departments';
import { JOC_LEVEL } from '@criticom/db/disaster-warnings';
import { idpFigures, readinessMeasures, readinessScore } from '@criticom/db/disaster-readiness';
import { RELIEF_STOCK_ITEMS, financialYear } from '@criticom/db/disaster-relief';
import { InfoDot } from '@/components/info-dot';
import { PageGuide } from '@/components/office/page-guide';
import { latestFigures } from '@/lib/disaster-desk';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { PopulationForm, StockTable } from './forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Readiness and IDP · HikTech' };

/**
 * The Disaster Management Centre's readiness score (the Directorate's
 * proposed measure for IDP indicator FD2.1), the relief stock against its
 * minimums, and the disaster figures the IDP reports each financial year,
 * counted from the incidents, warnings and relief logged here.
 */
export default async function ReadinessPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const now = new Date();
  const asked = Number((await searchParams).fy);
  const fy = Number.isInteger(asked) && asked >= 2020 && asked <= now.getFullYear()
    ? financialYear(new Date(`${asked}-08-01T12:00:00+02:00`)) : financialYear(now);

  const saMonth = Number(new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', month: 'numeric' }).format(now));
  const saYear = Number(new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', year: 'numeric' }).format(now));
  const [chairs, duty, contacts, plans, halls, stocks, meetings, teams, settings] = await Promise.all([
    listScgChairs(supabase, saYear), listDuty(supabase), listDepartmentContacts(supabase), listDepartmentPlans(supabase),
    listShelters(supabase, true).catch(() => []), listReliefStocks(supabase).catch(() => []), listForumMeetings(supabase), listTaskTeams(supabase),
    getDisasterSettings(supabase),
  ]);
  const measures = readinessMeasures({
    now, chairThisMonth: chairs.some((c) => c.month === saMonth),
    dutiesNow: duty.filter((d) => Date.parse(d.starts_at) <= now.getTime() && Date.parse(d.ends_at) > now.getTime()).map((d) => d.duty),
    departments: LINE_FUNCTIONS.map((d) => d.key),
    withRepresentative: [...new Set(contacts.filter((c) => c.doc_rep && c.is_active).map((c) => c.department))],
    planReviewed: Object.fromEntries(plans.map((p) => [p.department, p.plan_reviewed_on])),
    halls: halls.map((h) => ({ capacity: h.capacity, keyHolderPhone: h.key_holder_phone, active: h.is_active })),
    stock: stocks.filter((s) => s.item_key).map((s) => ({ key: s.item_key!, quantity: s.quantity, minimum: s.minimum ?? 0 })),
    lastForum: meetings.find((m) => m.body === 'forum')?.held_on ?? null,
    teamsWithChair: teams.filter((x) => x.chair).map((x) => x.team),
  });
  const score = readinessScore(measures);

  // The IDP year: incidents called in, relief recorded, warnings begun, sessions held and reviews signed within it.
  const [incidentsSince, relief, warnings, sessions, reviews] = await Promise.all([
    listDisasterIncidents(supabase, fy.start, 2000), listWardReliefSince(supabase, fy.start, fy.end),
    listWarningsBetween(supabase, fy.start, fy.end), listReadinessSessionsBetween(supabase, fy.start, fy.end),
    listReviewsSignedBetween(supabase, fy.start, fy.end),
  ]);
  const incidents = incidentsSince.filter((i) => Date.parse(i.call_timestamp) < fy.end.getTime());
  const ids = incidents.map((i) => i.id);
  const [facts, sitreps, deceased] = await Promise.all([
    listCallFacts(supabase, ids), listSitrepFigures(supabase, ids),
    Promise.all(ids.slice(0, 300).map((id) => casualtyCounts(supabase, id).then((c) => [id, c.deceased] as const).catch(() => [id, 0] as const))),
  ]);
  const factOf = new Map(facts.map((f) => [f.incident_id, f]));
  const deadOf = new Map(deceased);
  const idp = idpFigures({
    incidents: incidents.map((i) => ({
      hazard: factOf.get(i.id)?.hazard ?? i.disaster_type ?? i.incident_type, informalSettlement: factOf.get(i.id)?.informal_settlement ?? false,
      figures: latestFigures(sitreps.filter((u) => u.incident_id === i.id)), deceased: deadOf.get(i.id) ?? 0, victims: i.number_of_victims,
    })),
    wardPeople: relief.reduce((s, r) => s + r.people, 0), population: settings?.population ?? null,
    warningsL4: warnings.filter((w) => w.level >= JOC_LEVEL).length, readinessSessions: sessions.length,
    reviewsSignedOff: reviews.length,
  });
  const issued = Object.fromEntries(RELIEF_STOCK_ITEMS.map((x) => [x.key, relief.reduce((s, r) => s + r[x.key], 0)]));
  const years = Array.from({ length: Math.max(1, financialYear(now).start.getFullYear() - 2021) }, (_, i) => financialYear(now).start.getFullYear() - i);

  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Gauge className="h-6 w-6 text-accent" aria-hidden />{t('Readiness and IDP figures')}</h1>
        <p className="mt-1 text-muted-foreground">
          {t('A readiness score for the Disaster Management Centre, relief stock, and the disaster figures the IDP reports each year, counted from what is logged here.')}
        </p>
      </header>
      <PageGuide id="disaster.readiness" steps={[
        t('The score goes up as each measure is put in place: the duty roster, department representatives and plans, halls, stock, the Forum and its task teams.'),
        t('Update the relief stock after each delivery or stock count. Issued this year comes from the ward relief records.'),
        t('Choose the financial year for the IDP figures. Enter the city’s population once for the deaths per 100 000.'),
      ]} />

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-bg-card p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold">{t('Disaster Management Centre readiness')}
            <InfoDot text={t('Suggested measure for IDP indicator FD2.1, which has no baseline yet. Each of the eight lines counts equally.')} /></h2>
          <p className={cn('mt-1 text-5xl font-bold tabular-nums', score >= 75 ? 'text-severity-low-ink' : score >= 40 ? 'text-severity-medium-ink' : 'text-severity-critical-ink')}>
            {score}%
          </p>
          <ul className="mt-4 divide-y divide-border">
            {measures.map((m) => (
              <li key={m.key} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{t(m.label)}</span>
                  <span className="font-bold tabular-nums">{m.pct}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                  <div className={cn('h-full rounded-full', m.pct >= 75 ? 'bg-severity-low' : m.pct >= 40 ? 'bg-severity-medium' : 'bg-severity-critical')} style={{ width: `${m.pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t(m.detail, m.vars)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            <Link href="/disaster/duty" className="font-semibold text-accent hover:underline">{t('Duty and forum')}</Link>
            {' · '}<Link href="/disaster/departments" className="font-semibold text-accent hover:underline">{t('Departments')}</Link>
            {' · '}<Link href="/disaster/shelters" className="font-semibold text-accent hover:underline">{t('Shelters')}</Link>
          </p>
        </section>

        <section className="rounded-2xl border border-border bg-bg-card p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold">{t('Relief stock')}
            <InfoDot text={t('The relief materials the Directorate budgets for. Update what is in storage after each delivery or stock count.')} /></h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('Issued this year comes from the ward relief records for {fy}.', { fy: fy.label })}</p>
          <StockTable rows={RELIEF_STOCK_ITEMS.map((x) => {
            const s = stocks.find((r) => r.item_key === x.key);
            return { key: x.key, label: x.label, inStorage: s?.quantity ?? 0, minimum: s?.minimum ?? 0, issued: issued[x.key] ?? 0 };
          })} />
        </section>
      </div>

      <section className="space-y-4 rounded-2xl border border-border bg-bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">{t('IDP figures, {fy}', { fy: fy.label })}
            <InfoDot text={t('The disaster indicators in the IDP, counted for the financial year, July to June, from the incidents, warnings and relief logged here.')} /></h2>
          <nav className="flex flex-wrap gap-1.5" aria-label={t('Financial year')}>
            {years.map((y) => {
              const label = financialYear(new Date(`${y}-08-01T12:00:00+02:00`)).label;
              return (
                <Link key={y} href={`/disaster/readiness?fy=${y}`} aria-current={label === fy.label ? 'page' : undefined}
                  className={cn('rounded-full border px-3 py-1 text-sm font-semibold', label === fy.label ? 'border-accent bg-accent/15 text-accent' : 'border-border hover:bg-muted')}>
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { code: 'C69', label: t('Displaced persons the municipality assisted'), value: idp.c69.toLocaleString('en-ZA'), how: t('People on the ward beneficiary lists.') },
            { code: 'FD1.2', label: t('Disaster and extreme weather deaths per 100 000 people'), value: idp.fd12 == null ? '—' : String(idp.fd12),
              how: idp.fd12 == null ? t('Enter the population below.') : t('{d} deaths on incidents, against {p} people.', { d: idp.deaths, p: (settings?.population ?? 0).toLocaleString('en-ZA') }) },
            { code: 'C73', label: t('Structural fires in informal settlements'), value: String(idp.c73), how: t('Settlement fires marked as in an informal settlement.') },
            { code: 'C74', label: t('Informal dwellings affected by those fires'), value: idp.c74.toLocaleString('en-ZA'), how: t('Dwellings affected on those incidents.') },
            { code: 'FD2.1', label: t('Disaster Management Centre readiness'), value: `${score}%`, how: t('The readiness score above.') },
          ].map((x) => (
            <div key={x.code} className="rounded-xl border border-border bg-bg-soft p-4">
              <p className="font-mono text-xs font-bold text-muted-foreground">{x.code}</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">{x.value}</p>
              <p className="mt-1 text-sm font-medium">{x.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{x.how}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="overflow-x-auto xl:col-span-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">{t('Top ten priority risk')}</th><th className="py-2 pr-3 text-right">{t('Incidents')}</th>
                  <th className="py-2 pr-3 text-right">{t('People affected')}</th><th className="py-2 text-right">{t('Deaths')}</th>
                </tr>
              </thead>
              <tbody>
                {idp.byRisk.map((r) => (
                  <tr key={r.risk} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3">{t(r.risk)}</td><td className="py-2 pr-3 text-right tabular-nums">{r.incidents}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.affected.toLocaleString('en-ZA')}</td><td className="py-2 text-right tabular-nums">{r.deaths}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3">
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between gap-3"><span>{t('Level 4 or higher warnings')}</span><b className="tabular-nums">{idp.warningsL4}</b></li>
              <li className="flex justify-between gap-3"><span>{t('JOC readiness sessions')}</span><b className="tabular-nums">{idp.readinessSessions}</b></li>
              <li className="flex justify-between gap-3"><span>{t('Post-incident reviews signed off')}</span><b className="tabular-nums">{idp.reviewsSignedOff}</b></li>
            </ul>
            <PopulationForm population={settings?.population ?? null} note={settings?.population_note ?? ''} />
          </div>
        </div>
      </section>
    </div>
  );
}
